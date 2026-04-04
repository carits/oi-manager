/**
 * OJ 适配器端到端测试脚本
 *
 * 用法:
 *   pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts                     # 全量测试
 *   pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts luogu P1000          # 单平台单题
 *   pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts luogu                # 单平台全部预设题
 *   pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts --random 5           # 5轮随机测试
 */

import { getAdapter, isPlatformSupported, getSupportedPlatforms } from '../index'
import { OjFetchError, OjErrorCode, type OjPlatform, type OjProblem } from '../types'

// ==================== 颜色输出 ====================
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function c(color: string, ...args: any[]): string {
  return `${color}${args.join(' ')}${RESET}`
}

// ==================== 各平台测试题号 ====================
const TEST_CASES: Record<string, string[]> = {
  luogu: ['P1000', 'P2002', 'P3811'],
  codeforces: ['2A', '474B', '1450E'],
  atcoder: ['abc301_e', 'abc312_g', 'arc170_d'],
  gym: ['102001A'],
  qoj: ['1', '1538'],
  hdu: ['1000', '1085', '1402'],
  poj: ['1000', '1258', '2104'],
  ural: ['1000', '1001', '1082'],
  usaco: ['1300', '1308'],
  tlx: ['tro-pemburu-harta'],
  libreoj: ['1', '2', '100'],
  yosupo: ['aplusb', 'unionfind'],
  '51nod': ['1000', '1056'],
  csacademy: ['max-score'],
  kattis: ['aplusb', 'hello'],
  yukicoder: ['1', '2'],
  vnoj: ['PLACE1'],
  kilonova: ['aplusb'],
  ojuz: ['apio14_palindrome'],
  aizu: ['ITP1_1_A', 'ALDS1_1_A'],
  openj_bailian: ['1'],
  openj_noi: ['ch0101/01'],
  openj_poj: ['1000'],
  uoj: ['1'],
  csg: ['1000'],
  nowcoder: ['166'],
  szkopul: ['sum', '9p6vgNb4lWTsrtHVnHNBR_0U'],
  darkbzoj: ['1000'],
  dmoj: ['aplusb'],
  cses: ['1068', '1641'],
  spoj: ['TEST'],
  baekjoon: ['1000'],
  vijos: ['1000'],
  eolymp: ['19'],
}

// ==================== 随机题号生成器 ====================
// 为每个平台定义随机题号生成逻辑，用于压力测试

const RANDOM_ID_GENERATORS: Record<string, () => string> = {
  luogu: () => `P${1000 + Math.floor(Math.random() * 99000)}`,
  codeforces: () => `${1 + Math.floor(Math.random() * 2000)}${String.fromCharCode(65 + Math.floor(Math.random() * 6))}`,
  atcoder: () => {
    const types = ['abc', 'arc', 'agc']
    const t = types[Math.floor(Math.random() * types.length)]
    const n = 100 + Math.floor(Math.random() * 300)
    const c = String.fromCharCode(97 + Math.floor(Math.random() * 7))
    return `${t}${n}_${c}`
  },
  gym: () => `${100000 + Math.floor(Math.random() * 900000)}${String.fromCharCode(65 + Math.floor(Math.random() * 13))}`,
  qoj: () => String(1 + Math.floor(Math.random() * 10000)),
  hdu: () => String(1000 + Math.floor(Math.random() * 7000)),
  poj: () => String(1000 + Math.floor(Math.random() * 4000)),
  ural: () => String(1000 + Math.floor(Math.random() * 1500)),
  usaco: () => String(1000 + Math.floor(Math.random() * 9000)),
  libreoj: () => String(1 + Math.floor(Math.random() * 7000)),
  '51nod': () => String(1000 + Math.floor(Math.random() * 5000)),
  yukicoder: () => String(1 + Math.floor(Math.random() * 2000)),
  openj_bailian: () => String(1 + Math.floor(Math.random() * 4000)),
  openj_poj: () => String(1000 + Math.floor(Math.random() * 4000)),
  uoj: () => String(1 + Math.floor(Math.random() * 500)),
  nowcoder: () => String(100 + Math.floor(Math.random() * 900)),
  cses: () => String(1000 + Math.floor(Math.random() * 300)),
  baekjoon: () => String(1000 + Math.floor(Math.random() * 30000)),
  vijos: () => String(1000 + Math.floor(Math.random() * 2000)),
  eolymp: () => String(1 + Math.floor(Math.random() * 9000)),
  darkbzoj: () => String(1000 + Math.floor(Math.random() * 4000)),
  csg: () => String(1000 + Math.floor(Math.random() * 9000)),
}

// ==================== Markdown 质量检查 ====================

interface QualityIssue {
  severity: 'error' | 'warning' | 'info'
  category: string
  message: string
}

function checkMarkdownQuality(md: string): QualityIssue[] {
  const issues: QualityIssue[] = []

  // 1. HTML 残留检查
  const htmlPatterns = [
    { pattern: /<div[\s>]/gi, tag: '<div>' },
    { pattern: /<\/div>/gi, tag: '</div>' },
    { pattern: /<span[\s>]/gi, tag: '<span>' },
    { pattern: /<\/span>/gi, tag: '</span>' },
    { pattern: /<br\s*\/?>/gi, tag: '<br>' },
    { pattern: /<p[\s>]/gi, tag: '<p>' },
    { pattern: /<\/p>/gi, tag: '</p>' },
    { pattern: /<table[\s>]/gi, tag: '<table>' },
    { pattern: /<tr[\s>]/gi, tag: '<tr>' },
    { pattern: /<td[\s>]/gi, tag: '<td>' },
    { pattern: /<th[\s>]/gi, tag: '<th>' },
    { pattern: /<li[\s>]/gi, tag: '<li>' },
    { pattern: /<ul[\s>]/gi, tag: '<ul>' },
    { pattern: /<ol[\s>]/gi, tag: '<ol>' },
    { pattern: /<h[1-6][\s>]/gi, tag: '<h1-6>' },
    { pattern: /<strong[\s>]/gi, tag: '<strong>' },
    { pattern: /<em[\s>]/gi, tag: '<em>' },
    { pattern: /<a\s+href/gi, tag: '<a href>' },
    { pattern: /<img\s/gi, tag: '<img>' },
  ]

  for (const { pattern, tag } of htmlPatterns) {
    const matches = md.match(pattern)
    if (matches) {
      issues.push({
        severity: 'error',
        category: 'HTML残留',
        message: `发现 ${matches.length} 个未转换的 ${tag} 标签`,
      })
    }
  }

  // 2. LaTeX 完整性: 检查 $ 配对
  const dollarCount = (md.match(/(?<!\$)\$(?!\$)/g) || []).length
  if (dollarCount % 2 !== 0) {
    issues.push({
      severity: 'error',
      category: 'LaTeX',
      message: `行内 LaTeX $ 符号数量为奇数 (${dollarCount})，可能未配对`,
    })
  }

  const doubleDollarCount = (md.match(/\$\$/g) || []).length
  if (doubleDollarCount % 2 !== 0) {
    issues.push({
      severity: 'error',
      category: 'LaTeX',
      message: `块级 LaTeX $$ 符号数量为奇数 (${doubleDollarCount})，可能未配对`,
    })
  }

  // 3. 连续空行
  const multiBlankMatch = md.match(/\n{4,}/g)
  if (multiBlankMatch) {
    issues.push({
      severity: 'warning',
      category: '格式',
      message: `发现 ${multiBlankMatch.length} 处连续 3+ 空行`,
    })
  }

  // 4. 标题层级检查 (跳级)
  const headings = md.match(/^#{1,6}\s/gm) || []
  const levels = headings.map(h => h.trim().length - h.trim().indexOf(' ') - 1)
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      issues.push({
        severity: 'warning',
        category: '标题层级',
        message: `标题跳级: ${'#'.repeat(levels[i - 1])} → ${'#'.repeat(levels[i])}`,
      })
      break // 只报一次
    }
  }

  // 5. 样例格式检查: 样例应该在代码块中
  const sampleInputPattern = /(?:样例输入|Sample\s*Input|Example\s*Input)/i
  if (sampleInputPattern.test(md)) {
    // 检查样例后面是否有代码块
    const afterSample = md.split(sampleInputPattern).slice(1).join('')
    if (!afterSample.trimStart().startsWith('```')) {
      // 可能是通过其他方式格式化的（如表格后的代码块）
      const nearbyCode = afterSample.substring(0, 200).includes('```')
      if (!nearbyCode) {
        issues.push({
          severity: 'warning',
          category: '样例格式',
          message: '样例输入后未紧跟代码块 ` ``` `，可能格式异常',
        })
      }
    }
  }

  // 6. 检查空内容
  if (md.length < 50) {
    issues.push({
      severity: 'error',
      category: '内容',
      message: `内容过短 (${md.length} 字符)，可能拉取失败`,
    })
  }

  // 7. 检查是否有多余的转义 (反斜杠过多)
  // 排除 LaTeX 公式内的反斜杠（$...$ 和 $$...$$ 中的 \leq, \times 等是合法 LaTeX 命令）
  const strippedMd = md
    .replace(/\$\$[\s\S]*?\$\$/g, '')  // 移除块级公式
    .replace(/\$[^$]+?\$/g, '')        // 移除行内公式
  const excessiveEscape = strippedMd.match(/\\[^\\`*_{}[\]()#+\-.!|~>$%^&=]/g)
  if (excessiveEscape && excessiveEscape.length > 5) {
    issues.push({
      severity: 'warning',
      category: '转义',
      message: `发现 ${excessiveEscape.length} 个可能多余的反斜杠转义`,
    })
  }

  return issues
}

// ==================== 问题结构验证 ====================

interface StructureIssue {
  field: string
  message: string
}

function validateProblemStructure(problem: OjProblem, platform: string, problemId: string): StructureIssue[] {
  const issues: StructureIssue[] = []

  // 标题
  if (!problem.title || problem.title.trim().length === 0) {
    issues.push({ field: 'title', message: '标题为空' })
  } else if (problem.title === `${platform} ${problemId}` || problem.title === `Problem ${problemId}`) {
    issues.push({ field: 'title', message: `标题为默认值: "${problem.title}"` })
  }

  // 描述
  if (!problem.description || problem.description.trim().length === 0) {
    issues.push({ field: 'description', message: '描述为空' })
  } else if (problem.description.trim().length < 50) {
    issues.push({ field: 'description', message: `描述过短 (${problem.description.length} 字符)` })
  }

  // 来源 URL
  if (!problem.source?.url) {
    issues.push({ field: 'source.url', message: '来源 URL 为空' })
  } else if (!problem.source.url.startsWith('http')) {
    issues.push({ field: 'source.url', message: `来源 URL 格式异常: ${problem.source.url}` })
  }

  // 时限
  if (!problem.timeLimit) {
    issues.push({ field: 'timeLimit', message: '时限缺失' })
  } else if (problem.timeLimit < 100 || problem.timeLimit > 60000) {
    issues.push({ field: 'timeLimit', message: `时限值异常: ${problem.timeLimit}ms` })
  }

  // 内存限制
  if (!problem.memoryLimit) {
    issues.push({ field: 'memoryLimit', message: '内存限制缺失' })
  } else if (problem.memoryLimit < 1 || problem.memoryLimit > 1024 * 16) {
    issues.push({ field: 'memoryLimit', message: `内存限制值异常: ${problem.memoryLimit}MB` })
  }

  // statements
  if (problem.statements && problem.statements.length > 0) {
    for (const stmt of problem.statements) {
      if (stmt.format === 'markdown' && (!stmt.content || stmt.content.trim().length === 0)) {
        issues.push({ field: 'statements[].content', message: 'statement 的 markdown 内容为空' })
      }
    }
  }

  return issues
}

// ==================== 单个测试执行 ====================

interface TestResult {
  platform: string
  problemId: string
  success: boolean
  durationMs: number
  problem?: OjProblem
  error?: string
  structureIssues: StructureIssue[]
  qualityIssues: QualityIssue[]
}

async function testSingleProblem(platform: string, problemId: string): Promise<TestResult> {
  const startTime = Date.now()

  try {
    if (!isPlatformSupported(platform as OjPlatform)) {
      return {
        platform,
        problemId,
        success: false,
        durationMs: Date.now() - startTime,
        error: `平台 ${platform} 没有注册适配器`,
        structureIssues: [],
        qualityIssues: [],
      }
    }

    const adapter = getAdapter(platform as OjPlatform)
    const problem = await adapter.fetch(problemId)
    const durationMs = Date.now() - startTime

    // 结构验证
    const structureIssues = validateProblemStructure(problem, platform, problemId)

    // Markdown 质量检查
    const content = problem.description || problem.statements?.[0]?.content || ''
    const qualityIssues = checkMarkdownQuality(content)

    return {
      platform,
      problemId,
      success: true,
      durationMs,
      problem,
      structureIssues,
      qualityIssues,
    }
  } catch (e: any) {
    return {
      platform,
      problemId,
      success: false,
      durationMs: Date.now() - startTime,
      error: e instanceof OjFetchError ? `[${e.code}] ${e.message}` : e.message,
      structureIssues: [],
      qualityIssues: [],
    }
  }
}

// ==================== 结果输出 ====================

function printTestResult(result: TestResult) {
  const status = result.success ? c(GREEN, '✓ PASS') : c(RED, '✗ FAIL')
  const duration = c(GRAY, `${result.durationMs}ms`)

  console.log(`  ${status} ${c(BOLD, result.problemId)} ${duration}`)

  if (!result.success) {
    console.log(`    ${c(RED, 'Error:')} ${result.error}`)
    return
  }

  if (result.problem) {
    const p = result.problem
    console.log(`    ${c(CYAN, 'Title:')} ${p.title}`)
    console.log(`    ${c(CYAN, 'URL:')} ${p.source.url}`)
    if (p.timeLimit) console.log(`    ${c(CYAN, 'Time:')} ${p.timeLimit}ms`)
    if (p.memoryLimit) console.log(`    ${c(CYAN, 'Memory:')} ${p.memoryLimit}MB`)
    console.log(`    ${c(CYAN, 'Content:')} ${p.description.length} chars`)

    // 图片统计
    const imgCount = (p.description.match(/!\[.*?\]\(.*?\)/g) || []).length
    if (imgCount > 0) {
      console.log(`    ${c(CYAN, 'Images:')} ${imgCount} images in content`)
    }

    // Statements
    if (p.statements && p.statements.length > 0) {
      console.log(`    ${c(CYAN, 'Statements:')} ${p.statements.length}`)
      for (const stmt of p.statements) {
        if (stmt.content) {
          const stmtImgs = (stmt.content.match(/!\[.*?\]\(.*?\)/g) || []).length
          console.log(`      - ${stmt.format}/${stmt.language || '?'}: ${stmt.content.length} chars${stmtImgs > 0 ? `, ${stmtImgs} images` : ''}`)
        }
      }
    }

    // Attachments
    if (p.attachments && p.attachments.length > 0) {
      console.log(`    ${c(CYAN, 'Attachments:')} ${p.attachments.length}`)
      for (const att of p.attachments) {
        console.log(`      - ${att.filename}: ${att.downloadLink}`)
      }
    }
  }

  // 结构问题
  for (const issue of result.structureIssues) {
    console.log(`    ${c(YELLOW, `[结构] ${issue.field}: ${issue.message}`)}`)
  }

  // 质量问题
  for (const issue of result.qualityIssues) {
    const icon = issue.severity === 'error' ? c(RED, '!!') : issue.severity === 'warning' ? c(YELLOW, '~~') : c(GRAY, 'ii')
    console.log(`    ${icon} ${c(YELLOW, `[${issue.category}] ${issue.message}`)}`)
  }
}

function printSummary(results: TestResult[]) {
  const total = results.length
  const passed = results.filter(r => r.success).length
  const failed = total - passed

  console.log('\n' + '='.repeat(60))
  console.log(c(BOLD, '测试汇总'))
  console.log('='.repeat(60))
  console.log(`总计: ${total}  通过: ${c(GREEN, String(passed))}  失败: ${failed > 0 ? c(RED, String(failed)) : c(GREEN, '0')}`)

  if (failed > 0) {
    console.log(`\n${c(RED, BOLD, '失败列表:')}`)
    for (const r of results.filter(r => !r.success)) {
      console.log(`  ${c(RED, '✗')} ${r.platform}/${r.problemId}: ${r.error}`)
    }
  }

  // 统计质量问题
  const allQualityIssues = results.flatMap(r => r.qualityIssues)
  const errors = allQualityIssues.filter(i => i.severity === 'error')
  const warnings = allQualityIssues.filter(i => i.severity === 'warning')

  if (errors.length > 0 || warnings.length > 0) {
    console.log(`\n${c(BOLD, '质量统计:')}`)
    console.log(`  错误: ${errors.length > 0 ? c(RED, String(errors.length)) : '0'}`)
    console.log(`  警告: ${warnings.length > 0 ? c(YELLOW, String(warnings.length)) : '0'}`)

    // 按类别分组
    const byCategory = new Map<string, number>()
    for (const issue of allQualityIssues) {
      byCategory.set(issue.category, (byCategory.get(issue.category) || 0) + 1)
    }
    console.log(`  ${c(GRAY, '分类:')}`)
    for (const [cat, count] of byCategory) {
      console.log(`    ${cat}: ${count}`)
    }
  }
}

// ==================== Markdown 内容片段打印 ====================

function printContentPreview(result: TestResult) {
  if (!result.success || !result.problem) return

  const content = result.problem.description
  const lines = content.split('\n')
  const previewLines = lines.slice(0, 30)
  const totalLines = lines.length

  console.log(`\n    ${c(GRAY, `--- 内容预览 (前30行/共${totalLines}行) ---`)}`)
  for (const line of previewLines) {
    console.log(`    ${c(GRAY, line)}`)
  }
  if (totalLines > 30) {
    console.log(`    ${c(GRAY, `... (${totalLines - 30} more lines)`)}`)
  }
}

// ==================== 主函数 ====================

async function main() {
  const args = process.argv.slice(2)

  // 帮助
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${c(BOLD, 'OJ 适配器端到端测试')}

用法:
  pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts                       # 全量测试
  pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts <platform> <problemId>  # 单题测试
  pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts <platform>              # 单平台测试
  pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts --random <n>            # n轮随机测试
  pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts --preview               # 显示内容预览
  pnpm tsx src/oj-adapters/__tests__/adapter-e2e-test.ts --list                  # 列出已注册平台
`)
    process.exit(0)
  }

  // 列出平台
  if (args.includes('--list')) {
    console.log(c(BOLD, '\n已注册适配器平台:'))
    const platforms = getSupportedPlatforms()
    for (const p of platforms) {
      const adapter = isPlatformSupported(p.platform as OjPlatform) ? c(GREEN, '✓') : c(RED, '✗')
      const hasTests = TEST_CASES[p.platform] ? c(GREEN, `${TEST_CASES[p.platform].length} 题`) : c(GRAY, '无预设')
      console.log(`  ${adapter} ${p.platform.padEnd(15)} ${p.name.padEnd(20)} 测试: ${hasTests}`)
    }
    process.exit(0)
  }

  const showPreview = args.includes('--preview')

  // 随机测试模式
  const randomIdx = args.indexOf('--random')
  if (randomIdx !== -1) {
    const rounds = parseInt(args[randomIdx + 1]) || 20
    const platformKeys = Object.keys(RANDOM_ID_GENERATORS)

    console.log(c(BOLD, `\n🎲 随机压力测试: ${rounds} 轮 × ${platformKeys.length} 平台 = ${rounds * platformKeys.length} 次\n`))

    type RandomOutcome = 'fetched' | 'not_found' | 'parse_error' | 'network_error' | 'other_error'
    interface RandomResult {
      round: number
      platform: string
      problemId: string
      outcome: RandomOutcome
      durationMs: number
      error?: string
      qualityIssues: QualityIssue[]
      structureIssues: StructureIssue[]
    }

    const allResults: RandomResult[] = []
    const counters = { fetched: 0, not_found: 0, parse_error: 0, network_error: 0, other_error: 0 }

    for (let round = 1; round <= rounds; round++) {
      console.log(c(BOLD, `\n── 第 ${round}/${rounds} 轮 ──`))

      for (const platform of platformKeys) {
        const problemId = RANDOM_ID_GENERATORS[platform]()
        const result = await testSingleProblem(platform, problemId)

        let outcome: RandomOutcome
        if (result.success) {
          outcome = 'fetched'
        } else if (result.error?.includes('PROBLEM_NOT_FOUND')) {
          outcome = 'not_found'
        } else if (result.error?.includes('PARSE_ERROR')) {
          outcome = 'parse_error'
        } else if (result.error?.includes('NETWORK_ERROR') || result.error?.includes('超时')) {
          outcome = 'network_error'
        } else {
          outcome = 'other_error'
        }
        counters[outcome]++

        // 输出
        const icon = outcome === 'fetched' ? c(GREEN, '✓')
          : outcome === 'not_found' ? c(GRAY, '○')
          : c(RED, '✗')
        const tag = outcome === 'fetched' ? ''
          : outcome === 'not_found' ? ''
          : ` [${outcome}]`
        console.log(`  ${icon} ${platform.padEnd(15)} ${problemId.padEnd(20)} ${c(GRAY, `${result.durationMs}ms`)}${tag}`)

        if (outcome === 'fetched' && result.problem) {
          console.log(`    ${c(CYAN, result.problem.title)}`)
          for (const qi of result.qualityIssues) {
            console.log(`    ${c(YELLOW, `[${qi.category}] ${qi.message}`)}`)
          }
          for (const si of result.structureIssues) {
            console.log(`    ${c(YELLOW, `[结构] ${si.field}: ${si.message}`)}`)
          }
        }
        if (outcome !== 'fetched' && outcome !== 'not_found' && result.error) {
          console.log(`    ${c(RED, result.error)}`)
        }

        allResults.push({
          round, platform, problemId, outcome,
          durationMs: result.durationMs,
          error: result.error,
          qualityIssues: result.qualityIssues,
          structureIssues: result.structureIssues,
        })

        await new Promise(r => setTimeout(r, 400))
      }
    }

    // ==================== 汇总 ====================
    const total = allResults.length
    console.log('\n' + '='.repeat(70))
    console.log(c(BOLD, '随机压力测试汇总'))
    console.log('='.repeat(70))
    console.log(`总测试: ${total}`)
    console.log(`  成功拉取:   ${c(GREEN, String(counters.fetched))} (${(counters.fetched / total * 100).toFixed(1)}%)`)
    console.log(`  题目不存在: ${c(GRAY, String(counters.not_found))} (${(counters.not_found / total * 100).toFixed(1)}%)`)
    console.log(`  解析错误:   ${counters.parse_error > 0 ? c(RED, String(counters.parse_error)) : '0'}`)
    console.log(`  网络错误:   ${c(YELLOW, String(counters.network_error))} (${(counters.network_error / total * 100).toFixed(1)}%)`)
    console.log(`  其他错误:   ${counters.other_error > 0 ? c(YELLOW, String(counters.other_error)) : '0'}`)

    // 解析错误（代码 bug）
    const parseErrors = allResults.filter(r => r.outcome === 'parse_error')
    if (parseErrors.length > 0) {
      console.log(`\n${c(RED, BOLD, '⚠️ 解析错误（代码 bug）:')}`)
      for (const r of parseErrors) {
        console.log(`  ${c(RED, '✗')} R${r.round} ${r.platform}/${r.problemId}: ${r.error}`)
      }
    }

    // 其他非预期错误
    const otherErrors = allResults.filter(r => r.outcome === 'other_error')
    if (otherErrors.length > 0) {
      console.log(`\n${c(YELLOW, BOLD, '⚠️ 其他错误:')}`)
      for (const r of otherErrors) {
        console.log(`  ${c(YELLOW, '!')} R${r.round} ${r.platform}/${r.problemId}: ${r.error}`)
      }
    }

    // 各平台拉取成功率
    console.log(`\n${c(BOLD, '各平台拉取成功率:')}`)
    const platMap = new Map<string, { fetched: number; total: number }>()
    for (const r of allResults) {
      const s = platMap.get(r.platform) || { fetched: 0, total: 0 }
      s.total++
      if (r.outcome === 'fetched') s.fetched++
      platMap.set(r.platform, s)
    }
    const sorted = [...platMap.entries()].sort((a, b) => (b[1].fetched / b[1].total) - (a[1].fetched / a[1].total))
    for (const [platform, s] of sorted) {
      const rate = s.fetched / s.total
      const bar = '█'.repeat(Math.round(rate * 20)) + '░'.repeat(20 - Math.round(rate * 20))
      const pct = (rate * 100).toFixed(0)
      console.log(`  ${platform.padEnd(15)} ${bar} ${pct}% (${s.fetched}/${s.total})`)
    }

    // 质量统计
    const fetchedResults = allResults.filter(r => r.outcome === 'fetched')
    const allQi = fetchedResults.flatMap(r => r.qualityIssues)
    if (allQi.length > 0) {
      console.log(`\n${c(BOLD, '质量统计（成功拉取的题目）:')}`)
      const byCat = new Map<string, number>()
      for (const qi of allQi) {
        byCat.set(qi.category, (byCat.get(qi.category) || 0) + 1)
      }
      for (const [cat, count] of byCat) {
        console.log(`  ${cat}: ${count}`)
      }
    }

    process.exit(parseErrors.length > 0 ? 1 : 0)
  }

  // 全量测试
  if (args.length === 0 || (args.length === 1 && args[0] === '--preview')) {
    console.log(c(BOLD, '\n📋 OJ 适配器全量端到端测试\n'))

    const allResults: TestResult[] = []

    for (const [platform, problemIds] of Object.entries(TEST_CASES)) {
      console.log(c(BOLD, `\n▸ ${platform} (${problemIds.length} 题)`))

      for (const pid of problemIds) {
        const result = await testSingleProblem(platform, pid)
        printTestResult(result)
        if (showPreview) printContentPreview(result)
        allResults.push(result)

        // 限流: 每题之间间隔 500ms
        await new Promise(r => setTimeout(r, 500))
      }
    }

    printSummary(allResults)
    process.exit(allResults.some(r => !r.success) ? 1 : 0)
  }

  // 单平台测试
  const platform = args[0]

  if (!isPlatformSupported(platform as OjPlatform)) {
    console.log(c(RED, `平台 ${platform} 没有注册适配器`))
    process.exit(1)
  }

  // 单题测试
  if (args[1] && !args[1].startsWith('--')) {
    const problemId = args[1]
    console.log(c(BOLD, `\n▸ ${platform}/${problemId}\n`))

    const result = await testSingleProblem(platform, problemId)
    printTestResult(result)
    if (showPreview) printContentPreview(result)

    process.exit(result.success ? 0 : 1)
  }

  // 单平台全量测试
  const problemIds = TEST_CASES[platform] || []
  if (problemIds.length === 0) {
    console.log(c(YELLOW, `平台 ${platform} 没有预设测试题号，请手动指定题号`))
    process.exit(1)
  }

  console.log(c(BOLD, `\n▸ ${platform} (${problemIds.length} 题)\n`))

  const results: TestResult[] = []
  for (const pid of problemIds) {
    const result = await testSingleProblem(platform, pid)
    printTestResult(result)
    if (showPreview) printContentPreview(result)
    results.push(result)
    await new Promise(r => setTimeout(r, 500))
  }

  printSummary(results)
  process.exit(results.some(r => !r.success) ? 1 : 0)
}

main().catch(e => {
  console.error(c(RED, `致命错误: ${e.message}`))
  process.exit(1)
})
