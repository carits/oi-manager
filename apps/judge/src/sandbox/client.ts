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
      procLimit: 50
    })

    // 编译失败时 exitStatus != 0
    if (result.exitStatus !== 0) {
      let error = result.error || '编译失败'
      if (result.files?.stderr) {
        error = result.files.stderr || error
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
}): Promise<SandboxResult> {
  const { language, stdin, timeLimit, memoryLimit, outputLimit = 65536, compileFileId, workDir: providedWorkDir } = params

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

  // 本地模式
  if (useLocalMode) {
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
        skipCompile: !!providedWorkDir // 如果提供了 workDir（已编译过），跳过编译
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
  }
): Promise<SandboxResult> {
  const { stdin, timeLimit, memoryLimit, outputLimit = 65536, compileFileId } = params

  try {
    // 构建 copyIn：如果有编译产物 fileId，用 fileId 传入
    const copyIn: Record<string, any> = {}
    if (compileFileId) {
      const executeFile = langConfig.execute_file || 'main'
      copyIn[executeFile] = { fileId: compileFileId }
    }

    // 使用文件重定向捕获 stdout/stderr，然后通过 copyOut 获取
    // stdin 通过 copyIn 传入文件，而不是管道（避免和 shell 重定向冲突）
    if (stdin) {
      copyIn['stdin'] = { content: stdin }
    }

    const execCommand = `${langConfig.execute} <stdin >stdout 2>stderr`

    const result = await runCommand({
      args: ['sh', '-c', execCommand],
      env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      copyIn: Object.keys(copyIn).length > 0 ? copyIn : undefined,
      copyOut: ['stdout', 'stderr'],
      copyOutOptional: ['stderr'],
      cpuLimit: timeLimit * 1000000,
      memoryLimit: memoryLimit * 1024,
      procLimit: 50
    })

    // 解析结果
    // File Error 状态只表示 copyOutOptional 文件不存在，不代表执行失败
    let status: SandboxResult['status'] = 'Accepted'
    const realStatus = (result.status === 'File Error') ? 'Accepted' : result.status

    if (realStatus === 'Time Limit Exceeded' || result.time > timeLimit * 1000000) {
      status = 'Time Limit Exceeded'
    } else if (realStatus === 'Memory Limit Exceeded') {
      status = 'Memory Limit Exceeded'
    } else if (realStatus === 'Output Limit Exceeded') {
      status = 'Output Limit Exceeded'
    } else if (result.exitStatus !== 0) {
      status = 'Runtime Error'
    }

    let stdout: string | undefined
    let stderr: string | undefined

    // go-judge v1.8+ returns copyOut file contents as plain strings (not base64)
    if (result.files?.stdout) {
      stdout = result.files.stdout
    }
    if (result.files?.stderr) {
      stderr = result.files.stderr
    }

    return {
      status,
      time: Math.round(result.time / 1000000),
      memory: Math.round(result.memory / 1024),
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
 * 执行单个命令（go-judge API）
 */
async function runCommand(params: {
  args: string[]
  env?: string[]
  files?: Record<string, { content: string } | { fd: number }>
  stdin?: { fd: number } | { content: string }
  stdout?: { fd: number } | { max: number }
  stderr?: { fd: number } | { max: number }
  cpuLimit?: number
  memoryLimit?: number
  procLimit?: number
  copyIn?: Record<string, { content: string } | { src: string } | { fileId: string }>
  copyOut?: string[]
  copyOutCached?: string[]
  copyOutOptional?: string[]
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
  const cmd: any = {
    args: params.args,
  }

  if (params.env) cmd.env = params.env
  if (params.files) cmd.files = params.files
  if (params.stdin) cmd.stdin = params.stdin
  if (params.stdout) cmd.stdout = params.stdout
  if (params.stderr) cmd.stderr = params.stderr
  if (params.cpuLimit) cmd.cpuLimit = params.cpuLimit
  if (params.memoryLimit) cmd.memoryLimit = params.memoryLimit
  if (params.procLimit) cmd.procLimit = params.procLimit
  if (params.copyIn) cmd.copyIn = params.copyIn
  if (params.copyOut) cmd.copyOut = params.copyOut
  if (params.copyOutCached) cmd.copyOutCached = params.copyOutCached
  if (params.copyOutOptional) cmd.copyOutOptional = params.copyOutOptional

  const res = await superagent
    .post(`${SANDBOX_HOST}/run`)
    .send({ cmd: [cmd] })
    .timeout(60000)

  return res.body[0]
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
