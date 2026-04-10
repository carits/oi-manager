/**
 * go-judge 沙箱客户端
 *
 * 支持两种模式：
 * 1. go-judge 沙箱模式（Linux 生产环境）
 * 2. 本地执行模式（Windows 开发环境，无隔离）
 */

import superagent from 'superagent'
import { config } from '../config'
import type { SandboxResult } from '../types'
import { localExecute, localCompile } from './local'

const SANDBOX_HOST = config.sandboxHost

// 检测是否使用本地模式
let useLocalMode = false

/**
 * 检测沙箱是否可用
 */
export async function detectSandboxMode(): Promise<boolean> {
  try {
    const res = await superagent.get(`${SANDBOX_HOST}/`).timeout(3000)
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
 * 编译代码（单独步骤）
 */
export async function compile(params: {
  language: string
  code: string
  timeLimit: number   // ms
  memoryLimit: number // KB
  workDir?: string    // 可选的工作目录，如果不提供则创建临时目录
}): Promise<{ success: boolean; error?: string; workDir?: string }> {
  const { language, code, timeLimit, memoryLimit, workDir: providedWorkDir } = params

  // 本地模式
  if (useLocalMode) {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    // 使用提供的目录或创建临时目录
    const uniqueDir = providedWorkDir || path.join(os.tmpdir(), `judge_${Date.now()}_${Math.random().toString(36).slice(2)}`)

    if (!providedWorkDir) {
      fs.mkdirSync(uniqueDir, { recursive: true })
    }

    try {
      const result = await localCompile({ language, code, workDir: uniqueDir })
      // 如果提供了工作目录，不清理，让调用方管理
      if (!providedWorkDir) {
        try {
          fs.rmSync(uniqueDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
      return { ...result, workDir: uniqueDir }
    } catch (e: any) {
      if (!providedWorkDir) {
        try {
          fs.rmSync(uniqueDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
      return { success: false, error: e.message }
    }
  }

  // go-judge 沙箱模式
  const langConfig = getLanguageConfig(language)
  if (!langConfig) {
    return { success: false, error: `不支持的语言: ${language}` }
  }

  // 如果没有编译命令，直接返回成功
  if (!langConfig.compile) {
    return { success: true }
  }

  try {
    const copyIn: Record<string, any> = {
      [langConfig.code_file]: { content: code }
    }

    const compileResult = await runCommand({
      args: ['sh', '-c', langConfig.compile],
      env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      copyIn,
      copyOut: ['stderr'],
      cpuLimit: timeLimit * 1000000,
      memoryLimit: memoryLimit * 1024,
      procLimit: 50
    })

    if (compileResult.exitStatus !== 0) {
      let error = compileResult.error || '编译失败'
      if (compileResult.files?.stderr) {
        try {
          error = Buffer.from(compileResult.files.stderr, 'base64').toString('utf-8')
        } catch {
          // ignore
        }
      }
      return { success: false, error }
    }

    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/**
 * 执行程序
 */
export async function execute(params: {
  language: string
  code: string
  stdin?: string
  timeLimit: number   // ms
  memoryLimit: number // KB
  outputLimit?: number // bytes
  skipCompile?: boolean // 是否跳过编译（已编译过）
  workDir?: string    // 可选的工作目录，如果不提供则创建临时目录
}): Promise<SandboxResult> {
  const { language, code, stdin, timeLimit, memoryLimit, outputLimit = 65536, skipCompile = false, workDir: providedWorkDir } = params

  // 本地模式
  if (useLocalMode) {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    // 使用提供的目录或创建临时目录
    const uniqueDir = providedWorkDir || path.join(os.tmpdir(), `judge_${Date.now()}_${Math.random().toString(36).slice(2)}`)

    if (!providedWorkDir) {
      fs.mkdirSync(uniqueDir, { recursive: true })
    }

    try {
      return await localExecute({
        language,
        code,
        stdin,
        timeLimit,
        memoryLimit,
        workDir: uniqueDir,
        skipCompile
      })
    } finally {
      // 如果提供了工作目录，不清理，让调用方管理
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
  return sandboxExecute(params)
}

/**
 * go-judge 沙箱执行
 */
async function sandboxExecute(params: {
  language: string
  code: string
  stdin?: string
  timeLimit: number
  memoryLimit: number
  outputLimit?: number
  skipCompile?: boolean
}): Promise<SandboxResult> {
  const { language, code, stdin, timeLimit, memoryLimit, outputLimit = 65536, skipCompile = false } = params

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

  try {
    const copyIn: Record<string, any> = {
      [langConfig.code_file]: { content: code }
    }

    // 编译型语言需要先编译（除非已编译过）
    if (langConfig.compile && !skipCompile) {
      const compileResult = await runCommand({
        args: ['sh', '-c', langConfig.compile],
        env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
        copyIn,
        copyOut: ['stderr'],
        cpuLimit: (langConfig.compile_time_limit || 15000) * 1000000,
        memoryLimit: (langConfig.compile_memory_limit || 524288) * 1024,
        procLimit: 50
      })

      if (compileResult.exitStatus !== 0) {
        let error = compileResult.error || '编译失败'
        if (compileResult.files?.stderr) {
          try {
            error = Buffer.from(compileResult.files.stderr, 'base64').toString('utf-8')
          } catch {
            // ignore
          }
        }
        return {
          status: 'Compilation Error',
          time: 0,
          memory: 0,
          exitCode: 1,
          stderr: error
        }
      }
    }

    // 执行程序
    const result = await runCommand({
      args: ['sh', '-c', langConfig.execute],
      env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      copyIn,
      stdin: stdin ? { content: stdin } : undefined,
      stdout: { max: outputLimit },
      stderr: { max: 65536 },
      cpuLimit: timeLimit * 1000000,
      memoryLimit: memoryLimit * 1024,
      procLimit: 50
    })

    // 解析结果
    let status: SandboxResult['status'] = 'Accepted'
    if (result.status === 'Time Limit Exceeded' || result.time > timeLimit * 1000000) {
      status = 'Time Limit Exceeded'
    } else if (result.status === 'Memory Limit Exceeded') {
      status = 'Memory Limit Exceeded'
    } else if (result.status === 'Output Limit Exceeded') {
      status = 'Output Limit Exceeded'
    } else if (result.exitStatus !== 0) {
      status = 'Runtime Error'
    }

    let stdout: string | undefined
    let stderr: string | undefined

    if (result.files?.stdout) {
      try {
        stdout = Buffer.from(result.files.stdout, 'base64').toString('utf-8')
      } catch {
        // ignore
      }
    }

    if (result.files?.stderr) {
      try {
        stderr = Buffer.from(result.files.stderr, 'base64').toString('utf-8')
      } catch {
        // ignore
      }
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
  copyIn?: Record<string, { content: string } | { src: string }>
  copyOut?: string[]
  copyOutCached?: string[]
}): Promise<{
  status: string
  exitStatus: number
  time: number
  memory: number
  runTime: number
  files?: Record<string, string>
  fileIDs?: Record<string, string>
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

  const res = await superagent
    .post(`${SANDBOX_HOST}/run`)
    .send({ cmd: [cmd] })
    .timeout(60000)

  return res.body[0]
}

/**
 * 获取语言配置
 */
function getLanguageConfig(lang: string): {
  code_file: string
  execute_file?: string
  compile?: string
  execute: string
  compile_time_limit?: number
  compile_memory_limit?: number
} | null {
  const configs: Record<string, any> = {
    'c': { code_file: 'main.c', execute: './main', compile: 'gcc main.c -o main -O2 -Wall' },
    'c11': { code_file: 'main.c', execute: './main', compile: 'gcc main.c -o main -O2 -std=c11 -Wall' },
    'cpp': { code_file: 'main.cpp', execute: './main', compile: 'g++ main.cpp -o main -O2 -std=c++17 -Wall' },
    'cpp11': { code_file: 'main.cpp', execute: './main', compile: 'g++ main.cpp -o main -O2 -std=c++11 -Wall' },
    'cpp14': { code_file: 'main.cpp', execute: './main', compile: 'g++ main.cpp -o main -O2 -std=c++14 -Wall' },
    'cpp17': { code_file: 'main.cpp', execute: './main', compile: 'g++ main.cpp -o main -O2 -std=c++17 -Wall' },
    'cpp20': { code_file: 'main.cpp', execute: './main', compile: 'g++ main.cpp -o main -O2 -std=c++20 -Wall' },
  }

  return configs[lang] || null
}

/**
 * 健康检查
 */
export async function healthCheck(): Promise<boolean> {
  if (useLocalMode) {
    return true // 本地模式总是可用
  }

  try {
    const res = await superagent.get(`${SANDBOX_HOST}/`).timeout(5000)
    return res.status === 200
  } catch {
    return false
  }
}