/**
 * 本地执行器（无沙箱，仅用于开发测试）
 *
 * 当 go-judge 沙箱不可用时，使用本地直接执行。
 * 警告：无进程隔离和资源限制，仅用于开发测试，不可用于生产环境！
 */

import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { getLanguageConfig } from '../langs'
import type { SandboxResult } from '../types'

/**
 * 本地模式下的管道执行结果
 */
export interface LocalPipedResult {
  status: string
  exitStatus: number
  time: number      // ms
  memory: number    // KB
  stdout?: string
  stderr?: string
  files?: Record<string, string>
  fileIds?: Record<string, string>
  error?: string
}

/**
 * 本地模式下的管道执行（用于交互题和通信题）
 *
 * 使用 Node.js child_process 创建多个进程并通过 stdin/stdout 管道连接
 * 注意：本地模式下无法真正实现进程隔离，仅用于开发测试
 *
 * @param cmds 多个进程的执行配置
 * @param pipeMapping 管道映射关系
 * @param workDirBase 工作目录基础路径
 */
export async function runPipedLocal(params: {
  cmds: Array<{
    args: string[]
    env?: string[]
    copyIn?: Record<string, string | { content: string }>
    copyOut?: string[]
    cpuLimit?: number
    memoryLimit?: number
    procLimit?: number
    /** 进程标识（用于日志） */
    name?: string
  }>
  pipeMapping?: Array<{
    in: { index: number; fd: number }
    out: { index: number; fd: number }
  }>
  /** 基础工作目录 */
  workDirBase?: string
}): Promise<LocalPipedResult[]> {
  const { cmds, pipeMapping = [], workDirBase } = params

  // 为每个进程创建独立工作目录
  const workDirs: string[] = []
  for (let i = 0; i < cmds.length; i++) {
    const dir = workDirBase
      ? path.join(workDirBase, `proc_${i}`)
      : path.join(require('os').tmpdir(), `piped_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(dir, { recursive: true })
    workDirs.push(dir)
  }

  // 写入 copyIn 文件
  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i]
    if (cmd.copyIn) {
      for (const [name, value] of Object.entries(cmd.copyIn)) {
        const filePath = path.join(workDirs[i], name)
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        // 支持 string 或 { content: string } 格式
        const content = typeof value === 'string' ? value : value.content
        fs.writeFileSync(filePath, content, 'utf-8')
      }
    }
  }

  // 创建进程
  const processes: ChildProcess[] = []
  const results: LocalPipedResult[] = cmds.map(() => ({
    status: 'Accepted',
    exitStatus: 0,
    time: 0,
    memory: 0,
    stdout: '',
    stderr: '',
    files: {},
  }))

  // 建立 pipe 映射
  // fd 0 = stdin, fd 1 = stdout, fd 2 = stderr
  // pipeMapping: { in: { index, fd }, out: { index, fd } }
  // 表示将 out 进程的 fd 输出连接到 in 进程的 fd 输入

  const pipeStreams: Map<string, { readable?: NodeJS.ReadableStream; writable?: NodeJS.WritableStream }> = new Map()

  try {
    // 启动所有进程
    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i]
      const workDir = workDirs[i]
      const envObj: Record<string, string> = {}
      if (cmd.env) {
        for (const e of cmd.env) {
          const [k, v] = e.split('=')
          if (k) envObj[k] = v || ''
        }
      }

      const proc = spawn('sh', ['-c', cmd.args.join(' ')], {
        cwd: workDir,
        env: { ...process.env, ...envObj },
      })

      processes.push(proc)
      const startTime = Date.now()

      // 收集 stdout/stderr
      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      // 处理管道连接
      // 查找当前进程是否是某个 pipe 的输出端
      for (const pipe of pipeMapping) {
        if (pipe.out.index === i) {
          // 当前进程的 fd 是输出端，需要将其流导向另一个进程的输入端
          const key = `pipe_${pipe.in.index}_${pipe.in.fd}`
          if (!pipeStreams.has(key)) pipeStreams.set(key, {})
          const streamInfo = pipeStreams.get(key)!
          if (pipe.out.fd === 1) {
            // stdout 作为输出
            streamInfo.readable = proc.stdout
          } else if (pipe.out.fd === 2) {
            // stderr 作为输出
            streamInfo.readable = proc.stderr
          }
        }
        if (pipe.in.index === i) {
          // 当前进程的 fd 是输入端，需要接收另一个进程的输出
          const key = `pipe_${i}_${pipe.in.fd}`
          if (!pipeStreams.has(key)) pipeStreams.set(key, {})
          const streamInfo = pipeStreams.get(key)!
          if (pipe.in.fd === 0) {
            // stdin 作为输入
            streamInfo.writable = proc.stdin
          }
        }
      }

      // 监听进程结束
      proc.on('close', (code) => {
        const elapsed = Date.now() - startTime
        results[i].exitStatus = code || 0
        results[i].time = elapsed
        results[i].stdout = stdout
        results[i].stderr = stderr

        if (code !== 0 && code !== 13) { // 13 = SIGPIPE (Broken Pipe)
          results[i].status = 'Runtime Error'
        }
      })

      proc.on('error', (err) => {
        results[i].status = 'Runtime Error'
        results[i].error = err.message
      })
    }

    // 连接管道流
    for (const [key, streamInfo] of pipeStreams) {
      if (streamInfo.readable && streamInfo.writable) {
        streamInfo.readable.pipe(streamInfo.writable)
      }
    }

    // 等待所有进程结束（带超时）
    const maxWaitTime = Math.max(...cmds.map(c => c.cpuLimit || 30000)) // 默认 30s
    await new Promise<void>((resolve) => {
      const checkComplete = () => {
        const allClosed = processes.every(p => p.killed || p.exitCode !== null)
        if (allClosed) {
          resolve()
          return
        }
      }

      // 定期检查
      const interval = setInterval(checkComplete, 100)

      // 超时处理
      setTimeout(() => {
        clearInterval(interval)
        for (const p of processes) {
          if (p.exitCode === null) {
            p.kill()
          }
        }
        resolve()
      }, maxWaitTime)
    })

    // 收集 copyOut 文件
    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i]
      if (cmd.copyOut) {
        for (const name of cmd.copyOut) {
          const filePath = path.join(workDirs[i], name)
          if (fs.existsSync(filePath)) {
            results[i].files![name] = fs.readFileSync(filePath, 'utf-8')
          }
        }
      }
    }

    return results
  } finally {
    // 清理工作目录
    for (const dir of workDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }
}

/**
 * 本地编译代码
 */
export async function localCompile(params: {
  language: string
  code: string
  workDir: string
}): Promise<{ success: boolean; error?: string }> {
  const { language, code, workDir } = params

  const langConfig = getLanguageConfig(language)
  if (!langConfig) {
    return { success: false, error: `不支持的语言: ${language}` }
  }

  // 如果没有编译命令，直接返回成功
  if (!langConfig.compile) {
    return { success: true }
  }

  // 写入源代码文件
  const codeFile = path.join(workDir, langConfig.code_file)
  fs.writeFileSync(codeFile, code, 'utf-8')

  return new Promise((resolve) => {
    const compileProcess = spawn('sh', ['-c', langConfig.compile!], {
      cwd: workDir,
    })

    let stderr = ''

    compileProcess.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    compileProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr || `编译失败，退出码: ${code}` })
      }
    })

    compileProcess.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })

    // 超时处理
    setTimeout(() => {
      compileProcess.kill()
      resolve({ success: false, error: '编译超时' })
    }, langConfig.compile_time_limit || 15000)
  })
}

/**
 * 本地执行程序
 */
export async function localExecute(params: {
  language: string
  code: string
  stdin?: string
  timeLimit: number   // ms
  memoryLimit: number // KB
  workDir: string
  skipCompile?: boolean // 是否跳过编译（已编译过）
  /** File IO 模式：程序通过 {filename}.in / {filename}.out 读写 */
  filename?: string
  /** 额外需要拷入执行环境的文件 */
  extraCopyIn?: Record<string, string>
}): Promise<SandboxResult> {
  const { language, code, stdin, timeLimit, workDir, skipCompile = false, filename, extraCopyIn } = params

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

  // 写入源代码文件
  const codeFile = path.join(workDir, langConfig.code_file)
  fs.writeFileSync(codeFile, code, 'utf-8')

  // 如果需要编译（且未跳过）
  if (langConfig.compile && !skipCompile) {
    const compileResult = await localCompile({ language, code, workDir })
    if (!compileResult.success) {
      return {
        status: 'Compilation Error',
        time: 0,
        memory: 0,
        exitCode: 1,
        stderr: compileResult.error
      }
    }
  }

  // 写入额外文件（user_extra_files 等）
  if (extraCopyIn) {
    for (const [name, content] of Object.entries(extraCopyIn)) {
      const filePath = path.join(workDir, name)
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(filePath, content, 'utf-8')
    }
  }

  // File IO 模式：写入输入文件（即使 stdin 为空也要写入，与 go-judge 模式保持一致）
  if (filename) {
    fs.writeFileSync(path.join(workDir, `${filename}.in`), stdin || '', 'utf-8')
  }

  // 执行程序
  const startTime = Date.now()

  return new Promise((resolve) => {
    const execProcess = spawn('sh', ['-c', langConfig.execute], {
      cwd: workDir,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    execProcess.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    execProcess.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    // File IO mode does not pass input through stdin.
    // User programs may exit early; EPIPE must not crash the judge process.
    execProcess.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        stderr += err.message
      }
    })

    if (!filename && stdin) {
      execProcess.stdin.write(stdin, (err) => {
        if (err && (err as NodeJS.ErrnoException).code !== 'EPIPE') {
          stderr += (err as Error).message
        }
        execProcess.stdin.end()
      })
    } else {
      execProcess.stdin.end()
    }

    // 超时处理
    const timer = setTimeout(() => {
      timedOut = true
      execProcess.kill()
    }, timeLimit)

    execProcess.on('close', (code) => {
      clearTimeout(timer)
      const elapsed = Date.now() - startTime

      if (timedOut) {
        resolve({
          status: 'Time Limit Exceeded',
          time: elapsed,
          memory: 0,
          exitCode: -1,
          stdout,
          stderr
        })
        return
      }

      if (code !== 0) {
        resolve({
          status: 'Runtime Error',
          time: elapsed,
          memory: 0,
          exitCode: code || 1,
          stdout,
          stderr
        })
        return
      }

      // File IO 模式：从输出文件读取 stdout
      if (filename) {
        const outPath = path.join(workDir, `${filename}.out`)
        if (fs.existsSync(outPath)) {
          stdout = fs.readFileSync(outPath, 'utf-8')
        } else {
          stdout = ''
        }
      }

      resolve({
        status: 'Accepted',
        time: elapsed,
        memory: 0,
        exitCode: 0,
        stdout,
        stderr
      })
    })

    execProcess.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        status: 'Runtime Error',
        time: 0,
        memory: 0,
        exitCode: 1,
        stderr: err.message
      })
    })
  })
}
