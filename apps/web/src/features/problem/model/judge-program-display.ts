import { getLanguageLabel } from '@/lib/judge-constants'

const COPY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Validator DSL/gi, '输入规则'],
  [/Validator/gi, '输入检查程序'],
  [/Classifier/gi, '子任务判定程序'],
  [/Generator/gi, '数据生成程序'],
  [/\bSTD\b/g, '标准答案程序'],
  [/\bFixture(s)?\b/gi, '验证样例'],
  [/\bSubtask(s)?\b/gi, '子任务'],
  [/Parameter Schema/gi, '参数规则'],
  [/\bSchema\b/gi, '参数规则'],
  [/\bProfile(s)?\b/gi, '参数方案'],
  [/\bJudge\b/gi, '评测服务'],
  [/stdin/gi, '输入'],
  [/stdout/gi, '输出'],
]

export function judgeProgramCopy(value: string | null | undefined, fallback = '说明待确认') {
  if (!value?.trim()) return fallback
  return COPY_REPLACEMENTS.reduce((copy, [pattern, replacement]) => copy.replace(pattern, replacement), value)
}

export function judgeProgramKindLabel(kind: string | null | undefined) {
  return ({
    standard: '标准答案程序',
    validator: '输入检查程序',
    classifier: '子任务判定程序',
    generator: '数据生成程序',
  } as Record<string, string>)[kind || ''] || '评测程序'
}

export function judgeProgramLanguageLabel(language: string | null | undefined) {
  if (language === 'validator-dsl') return '输入规则'
  return getLanguageLabel(language)
}

export function judgeProgramProtocolLabel(protocol: string | null | undefined) {
  return ({
    'oj.standard/v1': '标准答案运行规则',
    'oj.validator/v1': '输入检查运行规则',
    'oj.classifier/v1': '子任务判定运行规则',
    'oj.generator/v1': '数据生成运行规则',
    'legacy-args-v1': '兼容运行规则',
  } as Record<string, string>)[protocol || ''] || '运行规则待确认'
}

export function judgeProgramVerificationStatusLabel(status: string | null | undefined) {
  return ({ queued: '等待检查', running: '检查中', completed: '检查完成', failed: '检查未通过', cancelled: '已取消' } as Record<string, string>)[status || ''] || '状态待确认'
}
