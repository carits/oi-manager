/**
 * go-judge 沙箱客户端
 *
 * 支持两种模式：
 * 1. go-judge 沙箱模式（Linux 生产环境）— 编译产物通过 fileId 传递
 * 2. 本地执行模式（无 go-judge，无隔离）
 */

import superagent from 'superagent'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { config } from '../config'
import { getLanguageConfig } from '../langs'
import { localExecute, localCompile } from './local'
import type { SandboxResult } from '../types'

const SANDBOX_HOST = config.sandboxHost

let useLocalMode = false

/**
 * 检测沙箱是否可用
 */
export async function detectSandboxMode(): Promise<boolean> {
  try {
    const res = await superagent.get(`${SANDBOX_HOST}/version`).timeout(3000)
    if (res.status === 200) {
      console.log('[Sandbox] Using go-judge sandbox at', SANDBOX_HOST)
      useLocalMode = false
      return true
    }
  } catch {
    console.log('[Sandbox] go-judge not available, using local execution mode')
    console.log('[Sandbox] WARNING: Local mode has no process isolation, only for development!')
    useLocalMode = true
  }
  return false
}

// 启动时检测
detectSandboxMode()

/**
 * 编译结果 — go-judge 模式返回 fileId，本地模式返回 workDir
 */
export interface CompileResult {
  success: boolean
  error?: string
  /** go-judge 模式：编译产物的 fileId */
  fileId?: string
  /** 本地模式：包含编译产物的工作目录 */
  workDir?: string
}

/**
 * 编译代码
 *
 * go-judge 模式：通过 sandbox 编译，使用 copyOutCached 获取编译产物 fileId
 * 本地模式：直接在本地目录编译
 */
export async function compile(params: {
  language: string
  code: string
  timeLimit: number   // ms
  memoryLimit: number // KB
  workDir?: string    // 可选（仅本地模式使用）
}): Promise<CompileResult> {
  const { language, code, timeLimit, memoryLimit, workDir: providedWorkDir } = params

  const langConfig = getLanguageConfig(language)
  if (!langConfig) {
    return { success: false, error: `不支持的语言: ${language}` }
  }

  // 如果没有编译命令，直接返回成功
  if (!langConfig.compile) {
    return { success: true }
  }

  // 本地模式
  if (useLocalMode) {
    const uniqueDir = providedWorkDir || path.join(os.tmpdir(), `judge_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    if (!providedWorkDir) {
      fs.mkdirSync(uniqueDir, { recursive: true })
    }

    const result = await localCompile({ language, code, workDir: uniqueDir })
    return { ...result, workDir: uniqueDir }
  }

  // go-judge 沙箱模式
  try {
    const copyIn: Record<string, any> = {
      [langConfig.code_file]: { content: code }
    }

    // 编译并缓存编译产物，将 stderr 重定向到文件以获取编译错误信息
    const compileCommand = `${langConfig.compile} 2>stderr`
    const result = await runCommand({
      args: ['sh', '-c', compileCommand],
      env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      copyIn,
      copyOut: ['stderr'],
      copyOutOptional: ['stderr'],
      copyOutCached: [langConfig.execute_file || 'main'],
      cpuLimit: (langConfig.compile_time_limit || timeLimit) * 1000000,
      memoryLimit: (langConfig.compile_memory_limit || memoryLimit) * 1024,
      strictMemoryLimit: true,
      procLimit: 50
    })

    // 编译失败时 exitStatus != 0
    if (result.exitStatus !== 0) {
      let error = result.error || '编译失败'
      if (result.files?.stderr) {
        error = result.files.stderr || error
      }
      if (error.includes('g++: not found') || error.includes('gcc: not found') || error.includes('clang++: not found') || error.includes('clang: not found')) {
        const uniqueDir = providedWorkDir || path.join(os.tmpdir(), `judge_compile_${Date.now()}_${Math.random().toString(36).slice(2)}`)
        if (!providedWorkDir) {
          fs.mkdirSync(uniqueDir, { recursive: true })
        }
        const localResult = await localCompile({ language, code, workDir: uniqueDir })
        return { ...localResult, workDir: uniqueDir }
      }
      return { success: false, error }
    }

    // 获取编译产物的 fileId
    const executeFile = langConfig.execute_file || 'main'
    const fileId = result.fileIds?.[executeFile]
    if (!fileId) {
      return { success: false, error: '编译产物未找到' }
    }

    return { success: true, fileId }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/**
 * 执行程序
 *
 * go-judge 模式：通过 fileId 传入编译产物执行
 * 本地模式：在本地目录执行
 */
export async function execute(params: {
  language: string
  stdin?: string
  timeLimit: number   // ms
  memoryLimit: number // KB
  outputLimit?: number // bytes
  /** go-judge 模式：编译产物的 fileId */
  compileFileId?: string
  /** 本地模式：包含编译产物的工作目录 */
  workDir?: string
  /** File IO 模式：当设置时，程序通过 {filename}.in/{filename}.out 文件读写，而非 stdin/stdout */
  filename?: string
  /** 额外需要拷入执行环境的文件（如 user_extra_files） */
  extraCopyIn?: Record<string, string>
  /** 启用地址空间限制（RLIMIT_AS），默认 false（使用 cgroup 内存限制） */
  addressSpaceLimit?: boolean
}): Promise<SandboxResult> {
  // addressSpaceLimit 默认 false，让 cgroup 内存限制生效
  // RLIMIT_AS 会导致 malloc 提前失败，无法正确检测 MLE
  const { language, stdin, timeLimit, memoryLimit, outputLimit = 65536, compileFileId, workDir: providedWorkDir, filename, extraCopyIn, addressSpaceLimit = false } = params

  const langConfig = getLanguageConfig(language)
  if (!langConfig) {
    return {
      status: 'Runtime Error',
      time: 0,
      memory: 0,
      exitCode: 1,
      stderr: `不支持的语言: ${language}`
    }
  }

  // Local execution is also required for binaries compiled by the host fallback.
  if (useLocalMode || (providedWorkDir && !compileFileId)) {
    const uniqueDir = providedWorkDir || path.join(os.tmpdir(), `judge_exec_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    if (!providedWorkDir) {
      fs.mkdirSync(uniqueDir, { recursive: true })
    }

    // 本地模式下需要重新编译（因为工作目录不同）
    // 写入源代码并编译
    const codeFile = path.join(uniqueDir, langConfig.code_file)
    if (!providedWorkDir && langConfig.compile) {
      // 需要编译但新目录中没有源代码 — 这种情况下应该通过 workDir 传入
      // 调用方应确保 workDir 中已有编译产物
    }

    try {
      return await localExecute({
        language,
        code: '', // 本地模式下代码已在 workDir 中
        stdin,
        timeLimit,
        memoryLimit,
        workDir: uniqueDir,
        skipCompile: !!providedWorkDir, // 如果提供了 workDir（已编译过），跳过编译
        filename,
        extraCopyIn
      })
    } finally {
      if (!providedWorkDir) {
        try {
          fs.rmSync(uniqueDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
    }
  }

  // go-judge 沙箱模式
  return sandboxExecute(langConfig, params)
}

/**
 * go-judge 沙箱执行 — 使用 fileId 传入编译产物
 */
async function sandboxExecute(
  langConfig: NonNullable<ReturnType<typeof getLanguageConfig>>,
  params: {
    stdin?: string
    timeLimit: number
    memoryLimit: number
    outputLimit?: number
    compileFileId?: string
    workDir?: string
    filename?: string
    extraCopyIn?: Record<string, string>
    addressSpaceLimit?: boolean
  }
): Promise<SandboxResult> {
  const { stdin, timeLimit, memoryLimit, outputLimit = 65536, compileFileId, filename, extraCopyIn, addressSpaceLimit = true } = params

  try {
    // 构建 copyIn：如果有编译产物 fileId，用 fileId 传入
    const copyIn: Record<string, any> = {}
    const executeFile = langConfig.execute_file || 'main'
    if (compileFileId) {
      copyIn[executeFile] = { fileId: compileFileId }
    } else if (params.workDir) {
      copyIn[executeFile] = { src: path.join(params.workDir, executeFile) }
    }

    // 额外文件（user_extra_files 等）
    if (extraCopyIn) {
      for (const [name, content] of Object.entries(extraCopyIn)) {
        copyIn[name] = { content }
      }
    }

    let execCommand: string
    let copyOutFiles: string[]

    if (filename) {
      // File IO 模式：程序通过 {filename}.in / {filename}.out 读写
      copyIn[`${filename}.in`] = { content: stdin || '' }
      execCommand = `${langConfig.execute} 2>stderr`
      copyOutFiles = [`${filename}.out`, 'stderr']
    } else {
      // 标准 stdin/stdout 模式
      if (stdin) {
        copyIn['stdin'] = { content: stdin }
      }
      execCommand = `${langConfig.execute} <stdin >stdout 2>stderr`
      copyOutFiles = ['stdout', 'stderr']
    }

    const result = await runCommand({
      args: ['sh', '-c', execCommand],
      env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      copyIn: Object.keys(copyIn).length > 0 ? copyIn : undefined,
      copyOut: copyOutFiles,
      copyOutOptional: copyOutFiles,
      cpuLimit: timeLimit * 1000000,
      memoryLimit: memoryLimit * 1024,
      strictMemoryLimit: true,
      addressSpaceLimit,
      procLimit: 50,
      outputLimit
    })

    // 解析结果
    // File Error 状态只表示 copyOutOptional 文件不存在，不代表执行失败
    let status: SandboxResult['status'] = 'Accepted'
    const realStatus = (result.status === 'File Error') ? 'Accepted' : result.status
    // TLE 时 go-judge 返回的 CPU 时间不准确，用 timeLimit 代替
    let time = Math.round(result.time / 1000000)
    let memory = Math.round(result.memory / 1024)

    // 先获取 stdout/stderr，用于后续判断
    let stdout: string | undefined
    let stderr: string | undefined

    if (filename) {
      // File IO 模式：从输出文件获取 stdout
      stdout = result.files?.[`${filename}.out`]
    } else {
      // go-judge v1.8+ returns copyOut file contents as plain strings (not base64)
      stdout = result.files?.stdout
    }
    stderr = result.files?.stderr

    // 检测内存分配失败的信号（bad_alloc、OOM、memory allocation failed 等）
    const isMemoryAllocationError = (stderr && (
      stderr.includes('bad_alloc') ||
      stderr.includes('std::bad_alloc') ||
      stderr.includes('memory allocation failed') ||
      stderr.includes('Cannot allocate memory') ||
      stderr.includes('Out of memory')
    )) || false

    if (realStatus === 'Time Limit Exceeded' || result.time > timeLimit * 1000000) {
      status = 'Time Limit Exceeded'
      time = timeLimit
    } else if (realStatus === 'Memory Limit Exceeded') {
      status = 'Memory Limit Exceeded'
      memory = memoryLimit
    } else if (realStatus === 'Output Limit Exceeded') {
      status = 'Output Limit Exceeded'
    } else if (realStatus === 'Signalled') {
      // 当程序被信号终止（如 SIGKILL/OOM 或 SIGSEGV），检查是否因为内存超限
      // 如果内存使用接近限制（>90%）或有内存分配错误信号，判定为 MLE
      if (memory >= memoryLimit * 0.9 || isMemoryAllocationError) {
        status = 'Memory Limit Exceeded'
        memory = memoryLimit
      } else {
        status = 'Runtime Error'
      }
    } else if (result.exitStatus !== 0) {
      // Nonzero Exit Status: 检查是否因为内存分配失败
      // 如果内存使用接近限制或有内存分配错误信号，判定为 MLE
      if (memory >= memoryLimit * 0.9 || isMemoryAllocationError) {
        status = 'Memory Limit Exceeded'
        memory = memoryLimit
      } else {
        status = 'Runtime Error'
      }
    }

    // 手动检测 OLE：go-judge 的 outputLimit 在 copyOut 模式下不自动触发 OLE
    // 需要检查输出大小是否超过限制
    if (status === 'Accepted' && stdout && stdout.length > outputLimit) {
      status = 'Output Limit Exceeded'
    }

    // 手动检测 MLE：当 memoryUsed > memoryLimit 时标记为 MLE
    // go-judge 可能返回 Accepted 但实际内存超限（取决于 cgroup 配置）
    if (status === 'Accepted' && memory > memoryLimit) {
      status = 'Memory Limit Exceeded'
    }

    return {
      status,
      time,
      memory,
      exitCode: result.exitStatus,
      stdout,
      stderr
    }
  } catch (e: any) {
    return {
      status: 'Runtime Error',
      time: 0,
      memory: 0,
      exitCode: 1,
      stderr: e.message
    }
  }
}

/**
 * 获取沙箱中的文件内容（通过 fileId）
 */
export async function getFileContent(fileId: string): Promise<Buffer | null> {
  try {
    const res = await superagent
      .get(`${SANDBOX_HOST}/file/${fileId}`)
      .responseType('arraybuffer')
      .timeout(30000)
    return Buffer.from(res.body)
  } catch {
    return null
  }
}

/**
 * 删除沙箱中的文件（通过 fileId）
 */
export async function deleteFile(fileId: string): Promise<void> {
  try {
    await superagent.delete(`${SANDBOX_HOST}/file/${fileId}`).timeout(10000)
  } catch {
    // ignore
  }
}

/**
 * 执行单个命令（go-judge API）— 公开接口，供 judge.ts 调用
 */
export async function runCommand(params: {
  args: string[]
  env?: string[]
  files?: Record<string, { content: string } | { fd: number }>
  stdin?: { fd: number } | { content: string }
  stdout?: { fd: number } | { max: number }
  stderr?: { fd: number } | { max: number }
  cpuLimit?: number
  memoryLimit?: number
  strictMemoryLimit?: boolean
  addressSpaceLimit?: boolean
  procLimit?: number
  copyIn?: Record<string, { content: string } | { src: string } | { fileId: string }>
  copyOut?: string[]
  copyOutCached?: string[]
  copyOutOptional?: string[]
  outputLimit?: number
}): Promise<{
  status: string
  exitStatus: number
  time: number
  memory: number
  runTime: number
  files?: Record<string, string>
  fileIds?: Record<string, string>
  fileError?: Array<{ name: string; type: string; message: string }>
  error?: string
}> {
  const res = await runCommands([params])
  return res[0]
}

/**
 * 执行多个命令，支持管道映射（go-judge pipeMapping API）
 * 用于交互题和通信题的多进程管道连接
 */
export async function runPiped(params: {
  cmds: Array<{
    args: string[]
    env?: string[]
    copyIn?: Record<string, { content: string } | { fileId: string }>
    copyOut?: string[]
    copyOutOptional?: string[]
    cpuLimit?: number
    memoryLimit?: number
    strictMemoryLimit?: boolean
    addressSpaceLimit?: boolean
    outputLimit?: number
    procLimit?: number
  }>
  pipeMapping?: Array<{
    in: { index: number; fd: number }
    out: { index: number; fd: number }
  }>
}): Promise<Array<{
  status: string
  exitStatus: number
  time: number
  memory: number
  files?: Record<string, string>
  fileIds?: Record<string, string>
  error?: string
}>> {
  const { cmds, pipeMapping } = params

  const body: any = {
    cmd: cmds.map(cmd => {
      const c: any = { args: cmd.args }
      if (cmd.env) c.env = cmd.env
      if (cmd.copyIn) c.copyIn = cmd.copyIn
      if (cmd.copyOut) c.copyOut = cmd.copyOut
      if (cmd.copyOutOptional) c.copyOutOptional = cmd.copyOutOptional
      if (cmd.cpuLimit) c.cpuLimit = cmd.cpuLimit
      if (cmd.memoryLimit) c.memoryLimit = cmd.memoryLimit
      if (cmd.strictMemoryLimit) c.strictMemoryLimit = cmd.strictMemoryLimit
      if (cmd.addressSpaceLimit) c.addressSpaceLimit = cmd.addressSpaceLimit
      if (cmd.procLimit) c.procLimit = cmd.procLimit
      if (cmd.outputLimit) c.outputLimit = cmd.outputLimit
      // pipeMapping 模式下 stdin/stdout 需要 null
      if (pipeMapping) {
        const idx = cmds.indexOf(cmd)
        if (pipeMapping.find((p: any) => p.out.index === idx && p.out.fd === 0)) {
          c.files = [{ fd: 0 }, { fd: 1 }, { fd: 2 }]
          c.files[0] = null
        }
        if (pipeMapping.find((p: any) => p.in.index === idx && p.in.fd === 1)) {
          if (!c.files) c.files = [{ fd: 0 }, { fd: 1 }, { fd: 2 }]
          c.files[1] = null
        }
        if (!c.files) c.files = [{ fd: 0 }, { fd: 1 }, { fd: 2 }]
      } else {
        c.files = [{ fd: 0 }, { fd: 1 }, { fd: 2 }]
      }
      return c
    }),
  }

  if (pipeMapping && pipeMapping.length > 0) {
    body.pipeMapping = pipeMapping.map((p: any) => ({
      ...p,
      proxy: true,
      max: 16 * 1024 * 1024, // 16MB buffer
    }))
  }

  const res = await superagent
    .post(`${SANDBOX_HOST}/run`)
    .send(body)
    .timeout(120000)

  return res.body
}

/**
 * 执行多个命令（内部辅助）
 */
async function runCommands(cmds: Array<{
  args: string[]
  env?: string[]
  files?: Record<string, { content: string } | { fd: number }>
  stdin?: { fd: number } | { content: string }
  stdout?: { fd: number } | { max: number }
  stderr?: { fd: number } | { max: number }
  cpuLimit?: number
  memoryLimit?: number
  strictMemoryLimit?: boolean
  procLimit?: number
  copyIn?: Record<string, { content: string } | { src: string } | { fileId: string }>
  copyOut?: string[]
  copyOutCached?: string[]
  copyOutOptional?: string[]
}>): Promise<Array<{
  status: string
  exitStatus: number
  time: number
  memory: number
  runTime: number
  files?: Record<string, string>
  fileIds?: Record<string, string>
  fileError?: Array<{ name: string; type: string; message: string }>
  error?: string
}>> {
  const formattedCmds = cmds.map(params => {
    const cmd: any = { args: params.args }
    if (params.env) cmd.env = params.env
    if (params.files) cmd.files = params.files
    if (params.stdin) cmd.stdin = params.stdin
    if (params.stdout) cmd.stdout = params.stdout
    if (params.stderr) cmd.stderr = params.stderr
    if (params.cpuLimit) cmd.cpuLimit = params.cpuLimit
    if (params.memoryLimit) cmd.memoryLimit = params.memoryLimit
    if (params.strictMemoryLimit) cmd.strictMemoryLimit = params.strictMemoryLimit
    if (params.procLimit) cmd.procLimit = params.procLimit
    if (params.copyIn) cmd.copyIn = params.copyIn
    if (params.copyOut) cmd.copyOut = params.copyOut
    if (params.copyOutCached) cmd.copyOutCached = params.copyOutCached
    if (params.copyOutOptional) cmd.copyOutOptional = params.copyOutOptional
    return cmd
  })

  const res = await superagent
    .post(`${SANDBOX_HOST}/run`)
    .send({ cmd: formattedCmds })
    .timeout(60000)

  return res.body
}

/**
 * 健康检查
 */
export async function healthCheck(): Promise<boolean> {
  if (useLocalMode) {
    return true
  }

  try {
    const res = await superagent.get(`${SANDBOX_HOST}/version`).timeout(5000)
    return res.status === 200
  } catch {
    return false
  }
}

/**
 * 是否使用本地模式
 */
export function isLocalMode(): boolean {
  return useLocalMode
}
