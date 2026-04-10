/**
 * 本地执行器（无沙箱，仅用于开发测试）
 *
 * 当 go-judge 沙箱不可用时（如 Windows 环境），使用本地直接执行。
 * 警告：无进程隔离和资源限制，仅用于开发测试，不可用于生产环境！
 */

import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import type { SandboxResult } from '../types'

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
    const compileProcess = spawn('cmd', ['/c', langConfig.compile!], {
      cwd: workDir,
      shell: true
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
}): Promise<SandboxResult> {
  const { language, code, stdin, timeLimit, workDir, skipCompile = false } = params

  console.log(`[LocalExecute] Starting execution`)
  console.log(`[LocalExecute] language: ${language}`)
  console.log(`[LocalExecute] workDir: ${workDir}`)
  console.log(`[LocalExecute] stdin length: ${stdin?.length || 0}`)
  console.log(`[LocalExecute] timeLimit: ${timeLimit}ms`)

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

  console.log(`[LocalExecute] Lang config: code_file=${langConfig.code_file}, execute=${langConfig.execute}`)

  // 写入源代码文件
  const codeFile = path.join(workDir, langConfig.code_file)
  fs.writeFileSync(codeFile, code, 'utf-8')
  console.log(`[LocalExecute] Code written to: ${codeFile}`)

  // 如果需要编译（且未跳过）
  if (langConfig.compile && !skipCompile) {
    console.log(`[LocalExecute] Compiling with: ${langConfig.compile}`)
    const compileResult = await localCompile({ language, code, workDir })
    console.log(`[LocalExecute] Compile result: success=${compileResult.success}, error=${compileResult.error}`)
    if (!compileResult.success) {
      return {
        status: 'Compilation Error',
        time: 0,
        memory: 0,
        exitCode: 1,
        stderr: compileResult.error
      }
    }
  } else if (skipCompile) {
    console.log(`[LocalExecute] Skipping compilation (already compiled)`)
  }

  // 执行程序
  console.log(`[LocalExecute] Executing: ${langConfig.execute}`)
  const startTime = Date.now()

  return new Promise((resolve) => {
    const execProcess = spawn('cmd', ['/c', langConfig.execute], {
      cwd: workDir,
      shell: true
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

    if (stdin) {
      execProcess.stdin.write(stdin)
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

      console.log(`[LocalExecute] Process closed with code: ${code}, elapsed: ${elapsed}ms`)
      console.log(`[LocalExecute] stdout length: ${stdout.length}, stderr length: ${stderr.length}`)

      if (timedOut) {
        console.log(`[LocalExecute] Process timed out`)
        resolve({
          status: 'Time Limit Exceeded',
          time: elapsed,
          memory: 0,
          exitCode: -1,
          stdout,
          stderr
        })
      } else if (code !== 0) {
        console.log(`[LocalExecute] Runtime error`)
        resolve({
          status: 'Runtime Error',
          time: elapsed,
          memory: 0,
          exitCode: code || 1,
          stdout,
          stderr
        })
      } else {
        console.log(`[LocalExecute] Success!`)
        resolve({
          status: 'Accepted',
          time: elapsed,
          memory: 0, // 无法获取内存使用
          exitCode: 0,
          stdout,
          stderr
        })
      }
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

/**
 * 获取语言配置
 */
function getLanguageConfig(lang: string): {
  code_file: string
  execute_file?: string
  compile?: string
  execute: string
  compile_time_limit?: number
} | null {
  // Windows 下使用 .exe 后缀和 .\ 前缀
  const configs: Record<string, any> = {
    'c': {
      code_file: 'main.c',
      execute: '.\\main.exe',
      compile: 'gcc main.c -o main.exe -O2 -Wall'
    },
    'c11': {
      code_file: 'main.c',
      execute: '.\\main.exe',
      compile: 'gcc main.c -o main.exe -O2 -std=c11 -Wall'
    },
    'cpp': {
      code_file: 'main.cpp',
      execute: '.\\main.exe',
      compile: 'g++ main.cpp -o main.exe -O2 -std=c++17 -Wall'
    },
    'cpp11': {
      code_file: 'main.cpp',
      execute: '.\\main.exe',
      compile: 'g++ main.cpp -o main.exe -O2 -std=c++11 -Wall'
    },
    'cpp14': {
      code_file: 'main.cpp',
      execute: '.\\main.exe',
      compile: 'g++ main.cpp -o main.exe -O2 -std=c++14 -Wall'
    },
    'cpp17': {
      code_file: 'main.cpp',
      execute: '.\\main.exe',
      compile: 'g++ main.cpp -o main.exe -O2 -std=c++17 -Wall'
    },
    'cpp20': {
      code_file: 'main.cpp',
      execute: '.\\main.exe',
      compile: 'g++ main.cpp -o main.exe -O2 -std=c++20 -Wall'
    },
  }

  return configs[lang] || null
}