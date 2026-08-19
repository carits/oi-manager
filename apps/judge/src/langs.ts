/**
 * 统一语言配置
 *
 * 所有编译/执行配置统一使用 Linux 格式。
 * 被 sandbox/client.ts 和 sandbox/local.ts 共同引用。
 */

import type { LanguageConfig } from './types'

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  'c': {
    code_file: 'main.c',
    execute_file: 'main',
    compile: 'gcc main.c -o main -O2 -Wall',
    execute: './main',
    compile_time_limit: 60000,
    compile_memory_limit: 524288,
  },
  'c11': {
    code_file: 'main.c',
    execute_file: 'main',
    compile: 'gcc main.c -o main -O2 -std=c11 -Wall',
    execute: './main',
    compile_time_limit: 60000,
    compile_memory_limit: 524288,
  },
  'cpp': {
    code_file: 'main.cpp',
    execute_file: 'main',
    compile: 'g++ main.cpp -o main -O2 -std=c++17 -Wall',
    execute: './main',
    compile_time_limit: 60000,
    compile_memory_limit: 524288,
  },
  'cpp11': {
    code_file: 'main.cpp',
    execute_file: 'main',
    compile: 'g++ main.cpp -o main -O2 -std=c++11 -Wall',
    execute: './main',
    compile_time_limit: 60000,
    compile_memory_limit: 524288,
  },
  'cpp14': {
    code_file: 'main.cpp',
    execute_file: 'main',
    compile: 'g++ main.cpp -o main -O2 -std=c++14 -Wall',
    execute: './main',
    compile_time_limit: 60000,
    compile_memory_limit: 524288,
  },
  'cpp17': {
    code_file: 'main.cpp',
    execute_file: 'main',
    compile: 'g++ main.cpp -o main -O2 -std=c++17 -Wall',
    execute: './main',
    compile_time_limit: 60000,
    compile_memory_limit: 524288,
  },
  'cpp20': {
    code_file: 'main.cpp',
    execute_file: 'main',
    compile: 'g++ main.cpp -o main -O2 -std=c++20 -Wall',
    execute: './main',
    compile_time_limit: 60000,
    compile_memory_limit: 524288,
  },
}

export function getLanguageConfig(lang: string): LanguageConfig | null {
  return LANGUAGE_CONFIGS[lang] || null
}
