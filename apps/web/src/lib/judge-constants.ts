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
  { value: 'queuing', label: 'Queuing && Judging' },
] as const

/** 编程语言选项 */
export const LANGUAGE_OPTIONS: readonly SelectOption[] = [
  { value: '', label: 'All' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'd', label: 'D' },
  { value: 'go', label: 'Go' },
  { value: 'haskell', label: 'Haskell' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'lua', label: 'Lua' },
  { value: 'objectivec', label: 'Objective-C' },
  { value: 'pascal', label: 'Pascal' },
  { value: 'perl', label: 'Perl' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'scala', label: 'Scala' },
  { value: 'swift', label: 'Swift' },
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

// 获取语言显示名称（支持 HDU 等平台语言 ID）
export function getLanguageLabel(lang: string): string {
  return LANGUAGE_LABEL_MAP[lang] || HDU_LANGUAGE_MAP[lang] || lang
}
