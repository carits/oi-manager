/**
 * 评测记录共享常量
 * 评测结果、编程语言等下拉选项，全局唯一。
 */

export interface SelectOption {
  value: string
  label: string
}

/** 评测结果选项 */
export const JUDGE_RESULT_OPTIONS: readonly SelectOption[] = [
  { value: '', label: 'All' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'pe', label: 'Presentation Error' },
  { value: 'wa', label: 'Wrong Answer' },
  { value: 'tle', label: 'Time Limit Exceed' },
  { value: 'mle', label: 'Memory Limit Exceed' },
  { value: 'ole', label: 'Output Limit Exceed' },
  { value: 're', label: 'Runtime Error' },
  { value: 'ce', label: 'Compile Error' },
  { value: 'remote_unavailable', label: 'Remote OJ Unavailable' },
  { value: 'judge_failed', label: 'Judge Failed' },
  { value: 'unknown_error', label: 'Unknown Error' },
  { value: 'submit_failed', label: 'Submit Failed' },
  { value: 'queuing', label: 'Queuing' },
  { value: 'judging', label: 'Judging' },
] as const

/** 编程语言选项 */
export const LANGUAGE_OPTIONS: readonly SelectOption[] = [
  { value: '', label: 'All' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'cpp98', label: 'C++98' },
  { value: 'cpp11', label: 'C++11' },
  { value: 'cpp14', label: 'C++14' },
  { value: 'cpp17', label: 'C++17' },
  { value: 'cpp20', label: 'C++20' },
  { value: 'cpp23', label: 'C++23' },
  { value: 'csharp', label: 'C#' },
  { value: 'csharp_mono', label: 'C# Mono' },
  { value: 'd', label: 'D' },
  { value: 'go', label: 'Go' },
  { value: 'haskell', label: 'Haskell' },
  { value: 'java', label: 'Java' },
  { value: 'java8', label: 'Java 8' },
  { value: 'java21', label: 'Java 21' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'lua', label: 'Lua' },
  { value: 'nodejs', label: 'Node.js' },
  { value: 'objectivec', label: 'Objective-C' },
  { value: 'ocaml', label: 'OCaml' },
  { value: 'pascal', label: 'Pascal' },
  { value: 'perl', label: 'Perl' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'python2', label: 'Python 2' },
  { value: 'python3', label: 'Python 3' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'scala', label: 'Scala' },
  { value: 'swift', label: 'Swift' },
  { value: 'julia', label: 'Julia' },
  { value: 'other', label: 'Other' },
] as const

/** 评测结果 value → label 映射 */
export const JUDGE_RESULT_LABEL_MAP: Record<string, string> = Object.fromEntries(
  JUDGE_RESULT_OPTIONS.map(o => [o.value, o.label]),
)

/** 语言 value → label 映射 */
export const LANGUAGE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  LANGUAGE_OPTIONS.map(o => [o.value, o.label]),
)

// HDU 平台语言 ID 映射
export const HDU_LANGUAGE_MAP: Record<string, string> = {
  '0': 'G++',
  '1': 'GCC',
  '2': 'C++',
  '3': 'C',
  '4': 'Pascal',
  '5': 'Java',
  '6': 'C#',
}

// 洛谷语言映射
export const LUOGU_LANGUAGE_MAP: Record<string, string> = {
  // 带 O2 版本（新格式）
  'cpp11_o2': 'C++11 (O2)',
  'cpp14_o2': 'C++14 (O2)',
  'cpp17_o2': 'C++17 (O2)',
  'cpp20_o2': 'C++20 (O2)',
  // 旧格式（假设为 O2 版本，洛谷默认推荐）
  'cpp11': 'C++11 (O2)',
  'cpp14': 'C++14 (O2)',
  'cpp17': 'C++17 (O2)',
  'cpp20': 'C++20 (O2)',
  // 无 O2 版本（无后缀）
  'cpp11_noo2': 'C++11',
  'cpp14_noo2': 'C++14',
  'cpp17_noo2': 'C++17',
  'cpp20_noo2': 'C++20',
  // 基础语言
  'c': 'C',
  'cpp': 'C++',
  'c89': 'C89',
  'c99': 'C99',
  'c11': 'C11',
  // Python 系列
  'python2': 'Python 2',
  'python3': 'Python 3',
  'pypy2': 'PyPy 2',
  'pypy3': 'PyPy 3',
  // 其他语言
  'go': 'Go',
  'rust': 'Rust',
  'java': 'Java',
  'pascal': 'Pascal',
  'ruby': 'Ruby',
  'haskell': 'Haskell',
  'kotlin': 'Kotlin',
  'javascript': 'JavaScript',
  'typescript': 'TypeScript',
}

// 获取语言显示名称（支持 HDU、洛谷等平台语言 ID）
export function getLanguageLabel(lang: string): string {
  return LANGUAGE_LABEL_MAP[lang]
    || LUOGU_LANGUAGE_MAP[lang]
    || HDU_LANGUAGE_MAP[lang]
    || lang
}
