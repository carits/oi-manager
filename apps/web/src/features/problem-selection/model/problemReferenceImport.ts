import { normalizeOjPlatformKey } from '@/lib/oj-platforms'
import { MAX_PROBLEM_SELECTION_BATCH } from './problemSelection'

export interface ProblemReferenceImportRow {
  clientKey: string
  lineNumber: number
  raw: string
  platformInput: string
  platform: string | null
  problemId: string
  alias: string | null
  error: string | null
}

export interface ProblemReferenceImportParseResult {
  rows: ProblemReferenceImportRow[]
  validRows: ProblemReferenceImportRow[]
  error: string | null
}

function splitColumns(raw: string): string[] | null {
  if (raw.includes('|') || raw.includes('｜')) {
    return raw.replaceAll('｜', '|').split('|').map(item => item.trim())
  }
  if (raw.includes('\t')) return raw.split('\t').map(item => item.trim())
  return null
}

/**
 * OI-Manager bulk reference syntax is platform | problemId | alias.
 * Alias is optional. Four-column clipboard rows are accepted by discarding
 * the third column entirely; that column has no model, contract or business meaning.
 */
export function parseProblemReferenceImport(value: string): ProblemReferenceImportParseResult {
  const rows = value.split(/\r?\n/u).map((raw, index) => ({ raw, lineNumber: index + 1 }))
    .filter(item => item.raw.trim().length > 0)
    .map(({ raw, lineNumber }) => {
      const columns = splitColumns(raw)
      if (!columns || columns.length < 2 || columns.length > 4) {
        return {
          clientKey: `line-${lineNumber}`, lineNumber, raw, platformInput: '', platform: null,
          problemId: '', alias: null, error: '格式应为“平台 | 题号 | 别名”，别名可省略',
        } satisfies ProblemReferenceImportRow
      }
      const [platformInput, problemId] = columns
      const alias = (columns.length === 4 ? columns[3] : columns[2])?.trim() || null
      const platform = normalizeOjPlatformKey(platformInput || '')
      let error: string | null = null
      if (!platformInput) error = '平台不能为空'
      else if (!platform) error = '平台名称未注册'
      else if (!problemId) error = '题号不能为空'
      else if (problemId.length > 128) error = '题号不能超过 128 个字符'
      else if (/:\/\//u.test(problemId)) error = '请填写原始题号，不要填写题目链接'
      else if (alias && alias.length > 50) error = '别名不能超过 50 个字符'
      return {
        clientKey: `line-${lineNumber}`, lineNumber, raw, platformInput, platform,
        problemId, alias, error,
      } satisfies ProblemReferenceImportRow
    })

  const error = rows.length > MAX_PROBLEM_SELECTION_BATCH
    ? `每次最多检索 ${MAX_PROBLEM_SELECTION_BATCH} 道题，请分批输入；本次输入未截断。`
    : null
  return { rows, validRows: error ? [] : rows.filter(row => !row.error && row.platform), error }
}
