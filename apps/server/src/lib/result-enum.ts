/**
 * 评测结果统一枚举
 * 所有 submission.result 必须使用这些标准值
 */

/** 评测结果标准枚举类型 */
export type ResultEnum =
  | 'accepted'
  | 'pe'
  | 'wa'
  | 'tle'
  | 'mle'
  | 'ole'
  | 're'
  | 'ce'
  | 'remote_unavailable'
  | 'judge_failed'
  | 'unknown_error'
  | 'submit_failed'
  | 'queuing'
  | 'judging'

/** 标准结果值列表（与前端 JUDGE_RESULT_OPTIONS 一致） */
export const STANDARD_RESULTS: readonly ResultEnum[] = [
  'accepted',
  'pe',
  'wa',
  'tle',
  'mle',
  'ole',
  're',
  'ce',
  'remote_unavailable',
  'judge_failed',
  'unknown_error',
  'submit_failed',
  'queuing',
  'judging',
]

/**
 * 统一映射：任意 result 字符串 → ResultEnum
 *
 * 支持的输入格式：
 * - 洛谷全称：wrong_answer, time_limit_exceeded, memory_limit_exceeded, runtime_error, compile_error
 * - CF verdict：OK, WRONG_ANSWER, TIME_LIMIT_EXCEEDED, MEMORY_LIMIT_EXCEEDED, RUNTIME_ERROR, COMPILATION_ERROR
 * - HDU result：Accepted, Wrong Answer, Time Limit Exceeded, etc.
 * - 缩写：AC, WA, TLE, MLE, RE, CE, PE, OLE
 * - 标准值：accepted, wa, tle, mle, re, ce, pe, ole, queuing
 */
export function normalizeResult(result: string): ResultEnum {
  if (!result) return 'unknown_error'

  const normalized = result.trim().toLowerCase()

  // 已是标准值，直接返回
  if (STANDARD_RESULTS.includes(normalized as ResultEnum)) {
    return normalized as ResultEnum
  }

  // 映射表：非标准值 → 标准值
  const resultMap: Record<string, ResultEnum> = {
    // 洛谷/CF/HDU 全称（toLowerCase 后统一）
    'wrong_answer': 'wa',
    'time_limit_exceeded': 'tle',
    'memory_limit_exceeded': 'mle',
    'runtime_error': 're',
    'compile_error': 'ce',
    'compilation_error': 'ce',
    'output_limit_exceeded': 'ole',
    'presentation_error': 'pe',
    'waiting': 'queuing',
    'pending': 'queuing',
    'submitted': 'queuing',
    'pending_review': 'queuing',

    // CF 特有 verdict（toLowerCase 后）
    'ok': 'accepted',
    'challenged': 'wa',
    'skipped': 'wa',
    'testing': 'queuing',
    'rejected': 'wa',
    'partial': 'wa',
    'idleness_limit_exceeded': 'tle',
    'security_violated': 'wa',
    'crashed': 'unknown_error',
    'input_preparation_crashed': 'unknown_error',

    // HDU / 其他平台
    'accepted': 'accepted',
    'ac': 'accepted',
    'wa': 'wa',
    'wrong answer': 'wa',
    'wronganswer': 'wa',
    'tle': 'tle',
    'time limit exceeded': 'tle',
    'timelimitexceeded': 'tle',
    'mle': 'mle',
    'memory limit exceeded': 'mle',
    'memorylimitexceeded': 'mle',
    're': 're',
    'runtime error': 're',
    'runtimeerror': 're',
    'ce': 'ce',
    'compile error': 'ce',
    'compileerror': 'ce',
    'compilation error': 'ce',
    'pe': 'pe',
    'presentation error': 'pe',
    'ole': 'ole',
    'output limit exceeded': 'ole',
    'outputlimitexceeded': 'ole',
    'se': 'unknown_error',
    'system error': 'unknown_error',

    // 其他常见格式
    'hacked': 'wa',
    'unaccepted': 'wa',
    'partial_accepted': 'wa',
  }

  return resultMap[normalized] || 'unknown_error'
}

/**
 * 检查是否为标准结果值
 */
export function isStandardResult(result: string): boolean {
  return STANDARD_RESULTS.includes(result as ResultEnum)
}

/**
 * 检查是否为 Accepted（通过）
 */
export function isAcceptedResult(result: string | null | undefined): boolean {
  if (!result) return false
  return normalizeResult(result) === 'accepted'
}
