/**
 * Codeforces 适配器
 * @description 从 Codeforces 平台拉取题目信息（HTML 抓取）
 *
 * 题号格式: {contestId}{letter}，如 2A、1450E、1840C
 * 主站 URL: https://codeforces.com/problemset/problem/{contestId}/{letter}
 * 镜像 URL: https://mirror.codeforces.com/problemset/problem/{contestId}/{letter}
 *
 * 兜底机制：主站/镜像都失败时，从洛谷拉取 CF{contestId}{letter}
 *
 * 限流配置：
 * - REQS_PER_SEC: 1.0
 * - JITTER_SEC: 0.5-1.5
 * - MAX_RETRIES: 3
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjStatement } from './types'
import { LuoguAdapter } from './luogu'
import * as cheerio from 'cheerio'
import type { AnyNode, Element as DomElement } from 'domhandler'
import logger from '../lib/logger'

/**
 * 题号解析结果
 */
interface ParsedProblemId {
  contestId: string
  index: string
}

export class CodeforcesAdapter implements OjAdapter {
  name = 'Codeforces'
  platform: OjPlatform = 'codeforces'

  // 限流配置
  protected static REQS_PER_SEC = 1.0
  protected static JITTER_SEC: [number, number] = [0.5, 1.5]
  protected static MAX_RETRIES = 3
  protected static lastRequestTime = 0

  rateLimitConfig = {
    requestsPerSecond: CodeforcesAdapter.REQS_PER_SEC,
    jitterRange: CodeforcesAdapter.JITTER_SEC,
    maxRetries: CodeforcesAdapter.MAX_RETRIES,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(
        OjErrorCode.INVALID_PROBLEM_ID,
        `无效的 Codeforces 题号: ${problemId}。格式应为 2A、1450E 等。`
      )
    }

    let lastError: Error | null = null

    for (let attempt = 1; attempt <= CodeforcesAdapter.MAX_RETRIES; attempt++) {
      try {
        await this.rateLimit()

        const { contestId, index } = this.parseProblemId(problemId)
        const url = this.buildMirrorUrl(contestId, index)
        const html = await this.fetchPage(url)

        // 检测 Cloudflare 拦截页
        if (this.isCloudflareBlock(html)) {
          throw new Error('CLOUDFLARE_BLOCKED: Codeforces 返回了 Cloudflare 拦截页')
        }

        return this.parsePage(html, problemId, contestId, index)
      } catch (error) {
        lastError = error as Error

        if (this.isNetworkError(error) && attempt < CodeforcesAdapter.MAX_RETRIES) {
          await this.sleep(1000 * attempt)
          continue
        }

        if (this.isClientError(error)) {
          if (this.isNotFoundError(error)) {
            // 404 不重试，但可以兜底
            break
          }
          break
        }

        // Cloudflare 拦截，直接跳到兜底
        if (this.isCloudflareError(error)) {
          break
        }

        if (error instanceof OjFetchError) {
          // 解析错误，不重试
          break
        }
      }
    }

    // 兜底：从洛谷拉取
    try {
      logger.info('cf_adapter_fallback_to_luogu', { action: 'cf_adapter', metadata: { problemId: `CF${problemId}` } })
      const luoguAdapter = new LuoguAdapter()
      const luoguProblem = await luoguAdapter.fetch(`CF${problemId}`)

      // 覆盖 source 为 codeforces
      const { contestId, index } = this.parseProblemId(problemId)
      luoguProblem.source = {
        platform: 'codeforces',
        problemId,
        url: `https://codeforces.com/problemset/problem/${contestId}/${index}`,
      }

      return luoguProblem
    } catch (fallbackError) {
      console.error('[CF Adapter] Luogu fallback also failed:', fallbackError)
    }

    // 兜底也失败，抛出原始错误
    if (lastError instanceof OjFetchError) {
      throw lastError
    }
    throw new OjFetchError(
      OjErrorCode.NETWORK_ERROR,
      `Codeforces 拉取失败（含洛谷兜底）: ${lastError?.message}`,
      lastError || undefined
    )
  }

  /**
   * 验证题号格式
   * Codeforces 题号格式: {contestId}{letter}
   * contestId = 纯数字, letter = 大写字母 + 可选数字
   * 例如: 2A, 1450E, 1840C, 2211H
   */
  isValidProblemId(problemId: string): boolean {
    return /^\d+[A-Za-z]\d*$/.test(problemId)
  }

  /**
   * 获取题目在 Codeforces 的 URL
   */
  getProblemUrl(problemId: string): string {
    const { contestId, index } = this.parseProblemId(problemId)
    return `https://codeforces.com/problemset/problem/${contestId}/${index}`
  }

  /**
   * 解析题号为 contestId + index
   */
  protected parseProblemId(problemId: string): ParsedProblemId {
    const match = problemId.match(/^(\d+)([A-Za-z]\d*)$/)
    if (!match) {
      throw new OjFetchError(
        OjErrorCode.INVALID_PROBLEM_ID,
        `无法解析 Codeforces 题号: ${problemId}`
      )
    }
    return { contestId: match[1], index: match[2].toUpperCase() }
  }

  /**
   * 构建镜像站 URL
   */
  protected buildMirrorUrl(contestId: string, index: string): string {
    return `https://mirror.codeforces.com/problemset/problem/${contestId}/${index}`
  }

  // ──────────────────────────────────────────
  // 限流
  // ──────────────────────────────────────────

  protected async rateLimit(): Promise<void> {
    const now = Date.now()
    const minInterval = 1000 / CodeforcesAdapter.REQS_PER_SEC
    const jitter = this.getRandomJitter()
    const elapsed = now - CodeforcesAdapter.lastRequestTime
    const waitTime = minInterval + jitter - elapsed
    if (waitTime > 0) {
      await this.sleep(waitTime)
    }
    CodeforcesAdapter.lastRequestTime = Date.now()
  }

  protected getRandomJitter(): number {
    const [min, max] = CodeforcesAdapter.JITTER_SEC
    return (min + Math.random() * (max - min)) * 1000
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ──────────────────────────────────────────
  // HTTP 请求
  // ──────────────────────────────────────────

  protected async fetchPage(url: string): Promise<string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }

    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const error: any = new Error(`HTTP ${response.status}`)
      error.response = response
      throw error
    }

    return response.text()
  }

  // ──────────────────────────────────────────
  // HTML 解析
  // ──────────────────────────────────────────

  protected parsePage(html: string, problemId: string, contestId: string, index: string): OjProblem {
    const $ = cheerio.load(html)

    // 查找题面主体
    const statementEl = $('div.problem-statement')
    if (!statementEl.length) {
      throw new OjFetchError(
        OjErrorCode.PARSE_ERROR,
        '没有找到 div.problem-statement，可能被 Cloudflare 拦截或页面结构变更'
      )
    }

    // 1. 提取标题
    const title = this.extractTitle($, statementEl)

    // 2. 提取时间/内存限制
    const limits = this.extractLimits($, statementEl)

    // 3. 提取样例
    const samples = this.extractSamples($, statementEl)

    // 4. 按 HTML 顺序收集所有内容（header → content → input → output → sample → note）
    //    然后重排为：content → input → output → sample → note
    const fullMarkdown = this.buildMarkdownFromHtml($, statementEl, title, samples)

    const sourceUrl = `https://codeforces.com/problemset/problem/${contestId}/${index}`

    return {
      title: title || `Codeforces ${problemId}`,
      description: fullMarkdown,
      timeLimit: limits.timeLimitMs,
      memoryLimit: limits.memoryLimitMB,
      source: {
        platform: 'codeforces',
        problemId,
        url: sourceUrl,
      },
      statements: [
        {
          type: 'statement',
          format: 'markdown',
          language: 'en',
          content: fullMarkdown,
          isVisible: true,
        } satisfies OjStatement,
      ],
    }
  }

  /**
   * 提取题目标题
   */
  protected extractTitle($: cheerio.CheerioAPI, statementEl: cheerio.Cheerio<AnyNode>): string {
    const titleEl = statementEl.find('div.header div.title')
    if (!titleEl.length) return ''
    // 标题格式如 "A. Theatre Square"，去掉前面的字母编号
    const text = titleEl.text().trim()
    const dotIndex = text.indexOf('.')
    if (dotIndex >= 0 && dotIndex < 5) {
      return text.substring(dotIndex + 1).trim()
    }
    return text
  }

  /**
   * 提取时间和内存限制
   */
  protected extractLimits($: cheerio.CheerioAPI, statementEl: cheerio.Cheerio<AnyNode>): {
    timeLimitMs?: number
    memoryLimitMB?: number
  } {
    const result: { timeLimitMs?: number; memoryLimitMB?: number } = {}

    const timeEl = statementEl.find('div.header div.time-limit')
    if (timeEl.length) {
      const text = timeEl.text()
      const match = text.match(/([\d.]+)\s*s/i)
      if (match) {
        result.timeLimitMs = Math.round(parseFloat(match[1]) * 1000)
      }
    }

    const memEl = statementEl.find('div.header div.memory-limit')
    if (memEl.length) {
      const text = memEl.text()
      const match = text.match(/(\d+)\s*(?:MB|MiB|megabytes?)/i)
      if (match) {
        result.memoryLimitMB = parseInt(match[1], 10)
      }
    }

    return result
  }

  /**
   * 按 HTML 顺序遍历 problem-statement 的所有直接子节点，
   * 按出现顺序输出 Markdown，保证内容顺序与原页面一致。
   *
   * CF HTML 结构：
   *   header → 内容块 → input-specification → output-specification → sample-test → note
   *
   * 输出顺序与 HTML 一致，不做重排
   */
  protected buildMarkdownFromHtml(
    $: cheerio.CheerioAPI,
    statementEl: cheerio.Cheerio<AnyNode>,
    title: string,
    samples: string
  ): string {
    const parts: string[] = []

    // 标题
    if (title) {
      parts.push(`# ${title}`)
      parts.push('')
    }

    // 时间/内存限制已通过 extractLimits() 提取到 OjProblem.timeLimit / memoryLimit，
    // 不再写入 Markdown 题面

    // 遍历所有直接子节点，按顺序输出
    let samplesInserted = false
    statementEl.children().each((_i, el) => {
      if (!('tagName' in el)) return
      const tagName = (el as DomElement).tagName.toLowerCase()
      const $el = $(el)
      const classes = $el.attr('class') || ''

      // 跳过 header（标题和限制已单独处理）
      if (tagName === 'div' && classes.includes('header')) return

      // 样例：用单独提取的结果（更精确）
      if (tagName === 'div' && classes.includes('sample-test')) {
        if (samples.trim()) {
          parts.push(samples.trim())
          parts.push('')
        }
        samplesInserted = true
        return
      }

      // 其他所有内容块，按出现顺序输出
      const md = this.renderContentBlock($, $el)
      if (md.trim()) {
        parts.push(md)
        parts.push('')
      }
    })

    // 如果没找到 sample-test div（不太可能），追加样例
    if (!samplesInserted && samples.trim()) {
      parts.push(samples.trim())
      parts.push('')
    }

    let markdown = parts.join('\n')
    markdown = markdown.replace(/\r\n/g, '\n')
    markdown = this.fixCfMath(markdown)
    markdown = markdown.replace(/\n{3,}/g, '\n\n')
    // 安全网：剥离可能残留的 time/memory limit 文本
    //   即使 header div 裁剪逻辑正常工作，某些 CF 题目可能有非标准结构
    markdown = markdown.replace(/^.*?time\s+limit\s+per\s+test.*$/gim, '')
    markdown = markdown.replace(/^.*?memory\s+limit\s+per\s+test.*$/gim, '')
    markdown = markdown.replace(/\n{3,}/g, '\n\n')
    markdown = markdown.split('\n').map(line => line.trimEnd()).join('\n')

    return markdown.trim() + '\n'
  }

  /**
   * 修复 CF Markdown 中的数学定界符嵌套问题
   *
   * CF 的 <span class="tex"> 内容可能自带 $ 或 $$ 定界符，
   * 即使 renderInline 已做剥离，仍可能有遗漏。
   * 参考 platform/codeforces/codeforces.py 中的 fix_cf_math
   */
  protected fixCfMath(markdown: string): string {
    // CF MathJax 使用 $$$ 表示 inline math，$$$$$$ 表示 display math
    // 需要在 fixCfMath 中统一处理

    // 6个$ → display math（先处理长模式，避免被3个$部分匹配）
    markdown = markdown.replace(/\${6}([\s\S]*?)\${6}/g, (_match, content: string) => {
      // 必须用 \n\n 包裹，确保 $$ 单独成行，remark-math 才能正确识别 display math
      return `\n\n$$\n${content.trim()}\n$$\n\n`
    })
    // 3个$ → inline math
    markdown = markdown.replace(/\${3}([\s\S]*?)\${3}/g, (_match, content: string) => {
      return `$${content.trim()}$`
    })

    // 修复相邻 inline math：$a$$b$ → $a$ $b$
    // 当两个 inline math 表达式直接相邻时，中间的 $$ 会被 remark-math 误解为 display math
    // display math 的 $$ 总是独占一行（前后有 \n），所以用 lookbehind/lookahead 排除
    markdown = markdown.replace(/(?<!\n)\$\$(?!\n)/g, '$ $')

    // CF MathJax 使用 \mbox{} 而 KaTeX 对 \mbox 支持不完善，替换为等价的 \text{}
    markdown = markdown.replace(/\\mbox\b/g, '\\text')

    return markdown
  }

  /**
   * 渲染一个内容块为 Markdown
   * 处理带 section-title 的 div 和普通内容块
   */
  protected renderContentBlock($: cheerio.CheerioAPI, $el: cheerio.Cheerio<AnyNode>): string {
    const el = $el.get(0)
    if (!el || !('tagName' in el)) return ''

    const tag = (el as DomElement).tagName.toLowerCase()
    // 只处理块级容器（div 等）
    if (tag !== 'div' && tag !== 'section' && tag !== 'article') {
      return this.renderBlock($, $el)
    }

    // 检查是否有 section-title 子元素
    const sectionTitle = $el.find('div.section-title')
    if (sectionTitle.length) {
      const titleText = sectionTitle.text().trim()
      const parts: string[] = []
      if (titleText) {
        parts.push(`## ${titleText}`)
        parts.push('')
      }
      // 输出 section-title 之外的所有子元素
      $el.children().each((_j, child) => {
        if (!('tagName' in child)) return
        const childTag = (child as DomElement).tagName.toLowerCase()
        if (childTag === 'div' && ($(child).attr('class') || '').includes('section-title')) return
        const md = this.renderBlock($, $(child))
        if (md.trim()) parts.push(md)
      })
      return parts.join('\n\n')
    }

    // 普通 div，递归处理子元素
    return this.renderBlock($, $el)
  }

  /**
   * 提取样例输入输出
   */
  protected extractSamples($: cheerio.CheerioAPI, statementEl: cheerio.Cheerio<AnyNode>): string {
    const parts: string[] = []
    const sampleTest = statementEl.find('div.sample-test')
    if (!sampleTest.length) return ''

    const inputs = sampleTest.find('> div.input')
    const outputs = sampleTest.find('> div.output')

    // 配对输入输出
    const count = Math.max(inputs.length, outputs.length)
    for (let i = 0; i < count; i++) {
      const inputEl = inputs.eq(i)
      const outputEl = outputs.eq(i)

      parts.push(`### Sample Input${count > 1 ? ` ${i + 1}` : ''}`)
      parts.push('')
      const inputPre = inputEl.find('pre')
      if (inputPre.length) {
        parts.push('```text')
        parts.push(this.extractPreText($, inputPre))
        parts.push('```')
      }
      parts.push('')

      parts.push(`### Sample Output${count > 1 ? ` ${i + 1}` : ''}`)
      parts.push('')
      const outputPre = outputEl.find('pre')
      if (outputPre.length) {
        parts.push('```text')
        parts.push(this.extractPreText($, outputPre))
        parts.push('```')
      }
      parts.push('')
    }

    return parts.join('\n')
  }

  /**
   * 提取 <pre> 内的文本
   * 处理三种格式：
   * 1. CF 样例的 .test-example-line div 格式
   * 2. <br> 分隔的行
   * 3. 原始文本（含真实 \n）
   */
  protected extractPreText($: cheerio.CheerioAPI, preEl: cheerio.Cheerio<AnyNode>): string {
    // 格式1: .test-example-line
    const lines = preEl.find('.test-example-line')
    if (lines.length) {
      const texts: string[] = []
      lines.each((_i, line) => {
        texts.push($(line).text().replace(/\n$/, ''))
      })
      return texts.join('\n')
    }

    // 格式2: 用 <br> 分隔行（cheerio .text() 不会转换 <br>）
    const brCount = preEl.find('br').length
    if (brCount > 0) {
      // 将 <br> 替换为 \n，然后获取文本
      const html = preEl.html() || ''
      const $clone = $('<div>').html(html)
      $clone.find('br').replaceWith('\n')
      return $clone.text().trim()
    }

    // 格式3: 原始文本
    return preEl.text().trim()
  }

  // ──────────────────────────────────────────
  // HTML → Markdown 转换
  // ──────────────────────────────────────────

  /**
   * 转换块级元素
   */
  protected renderBlock($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
    const node = el.get(0)
    if (!node || !('tagName' in node)) return ''

    const tag = (node as DomElement).tagName.toLowerCase()

    switch (tag) {
      case 'p':
        return this.renderInline($, el)

      case 'pre': {
        // 使用 extractPreText 保留换行（处理 .test-example-line 格式）
        const text = this.extractPreText($, el)
        return `\`\`\`text\n${text}\n\`\`\``
      }

      case 'ul': {
        const items: string[] = []
        el.children('li').each((_i, li) => {
          const text = this.renderInline($, $(li))
          items.push(`- ${text}`)
        })
        return items.join('\n')
      }

      case 'ol': {
        const items: string[] = []
        el.children('li').each((_i, li) => {
          const text = this.renderInline($, $(li))
          items.push(`${_i + 1}. ${text}`)
        })
        return items.join('\n')
      }

      case 'blockquote': {
        const inner = this.renderChildren($, el)
        return inner.split('\n').map(line => `> ${line}`).join('\n')
      }

      case 'table':
        return this.convertTable($, el)

      case 'div':
      case 'section':
      case 'article':
      case 'span':
        return this.renderChildren($, el)

      case 'script':
      case 'style':
      case 'svg':
        return ''

      case 'hr':
        return '---'

      case 'h1': return `# ${this.renderInline($, el)}`
      case 'h2': return `## ${this.renderInline($, el)}`
      case 'h3': return `### ${this.renderInline($, el)}`
      case 'h4': return `#### ${this.renderInline($, el)}`

      default:
        return this.renderInline($, el)
    }
  }

  /**
   * 转换行内元素
   */
  protected renderInline($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
    const parts: string[] = []

    el.contents().each((_i, node) => {
      if (node.type === 'text') {
        let text = $(node).text()
        // CF 使用 thin space ( ) 和 non-breaking space
        text = text.replace(/\u2009/g, ' ').replace(/\u00a0/g, ' ')
        // 不要把换行压缩为空格，保留 <br> 和 block 元素产生的换行
        text = text.replace(/[^\S\n]+/g, ' ')
        parts.push(text)
        return
      }

      if (!('tagName' in node)) return

      const tag = (node as DomElement).tagName.toLowerCase()
      const $node = $(node)

      switch (tag) {
        case 'strong':
        case 'b':
          parts.push(`**${this.renderInline($, $node)}**`)
          break
        case 'em':
        case 'i':
          parts.push(`*${this.renderInline($, $node)}*`)
          break
        case 'code': {
          const codeText = $node.text()
          if (codeText.includes('\n')) {
            parts.push(`\`\`\`\n${codeText}\n\`\`\``)
          } else {
            parts.push(`\`${codeText}\``)
          }
          break
        }
        case 'a': {
          const href = $node.attr('href') || ''
          const text = this.renderInline($, $node)
          // CF 内部链接转为绝对 URL
          const fullHref = href.startsWith('http') ? href : `https://codeforces.com${href}`
          parts.push(href ? `[${text}](${fullHref})` : text)
          break
        }
        case 'img': {
          const src = $node.attr('src') || ''
          const alt = $node.attr('alt') || ''
          // CF 图片 CDN
          const fullSrc = src.startsWith('http') ? src : `https:${src}`
          parts.push(`![${alt}](${fullSrc})`)
          break
        }
        case 'br':
          parts.push('\n')
          break
        case 'sub':
          parts.push(`~${this.renderInline($, $node)}~`)
          break
        case 'sup':
          parts.push(`^${this.renderInline($, $node)}^`)
          break
        case 'span': {
              // CF 的 tex-span 包裹数学公式
              const classes = $node.attr('class') || ''
              if (classes.includes('tex-span')) {
                let inner = this.renderInline($, $node)
                // CF tex-span 内部的 <span class="tex"> 内容可能已自带 $...$ 或 $$...$$ 定界符，
                // 先记录原始定界符类型（display vs inline），再剥离
                const wasDisplayMath = /^\${2}[\s\S]*\${2}\s*$/.test(inner.trim())
                inner = inner.replace(/^\${1,2}\s*/, '').replace(/\s*\${1,2}$/, '').trim()
                if (!inner) break
                if (wasDisplayMath || inner.includes('\n') || inner.length > 50) {
                  parts.push(`$$\n${inner}\n$$`)
                } else {
                  parts.push(`$${inner}$`)
                }
              } else if (classes.includes('tex-font-style-bf')) {
                // CF 粗体
                parts.push(`**${this.renderInline($, $node)}**`)
              } else if (classes.includes('tex-font-style-it')) {
                // CF 斜体
                parts.push(`*${this.renderInline($, $node)}*`)
              } else if (classes.includes('tex-font-style-tt')) {
                // CF 等宽字体（代码片段）
                parts.push(`\`${$node.text()}\``)
              } else if (classes.includes('tex-font-style-underline')) {
                // CF 下划线（Markdown 无原生支持，用 HTML）
                parts.push(`<u>${this.renderInline($, $node)}</u>`)
              } else {
                parts.push(this.renderInline($, $node))
              }
              break
            }
        case 'pre': {
          const codeText = this.extractPreText($, $node)
          parts.push(`\n\`\`\`text\n${codeText}\n\`\`\`\n`)
          break
        }
        case 'ul': {
          const items: string[] = []
          $node.children('li').each((__i, li) => {
            items.push(`  - ${this.renderInline($, $(li))}`)
          })
          parts.push('\n' + items.join('\n'))
          break
        }
        case 'ol': {
          const items: string[] = []
          $node.children('li').each((__i, li) => {
            items.push(`  ${__i + 1}. ${this.renderInline($, $(li))}`)
          })
          parts.push('\n' + items.join('\n'))
          break
        }
        case 'table':
          parts.push('\n' + this.convertTable($, $node) + '\n')
          break
        case 'p':
          parts.push('\n' + this.renderInline($, $node))
          break
        case 'script':
        case 'style':
        case 'svg':
          break
        default:
          parts.push(this.renderInline($, $node))
          break
      }
    })

    let result = parts.join('')
    result = result.replace(/ {2,}/g, ' ')
    return result.trim()
  }

  /**
   * 转换块级子元素
   */
  protected renderChildren($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
    const parts: string[] = []
    el.contents().each((_i, child) => {
      if ('tagName' in child) {
        const md = this.renderBlock($, $(child))
        if (md.trim()) parts.push(md)
      } else {
        const text = $(child).text().trim()
        if (text) parts.push(text)
      }
    })
    return parts.join('\n\n')
  }

  /**
   * 转换表格
   */
  protected convertTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<AnyNode>): string {
    const rows: string[][] = []

    table.find('tr').each((_i, tr) => {
      const cells: string[] = []
      $(tr).find('th, td').each((_j, cell) => {
        cells.push(this.renderInline($, $(cell)).replace(/\|/g, '\\|').replace(/\n/g, ' '))
      })
      if (cells.length) rows.push(cells)
    })

    if (rows.length === 0) return ''

    const parts: string[] = []
    parts.push('| ' + rows[0].join(' | ') + ' |')
    parts.push('| ' + rows[0].map(() => '---').join(' | ') + ' |')
    for (let i = 1; i < rows.length; i++) {
      parts.push('| ' + rows[i].join(' | ') + ' |')
    }

    return parts.join('\n')
  }

  // ──────────────────────────────────────────
  // Cloudflare 检测
  // ──────────────────────────────────────────

  protected isCloudflareBlock(html: string): boolean {
    const lower = html.toLowerCase()
    return (
      lower.includes('just a moment') ||
      lower.includes('cf-browser-verification') ||
      lower.includes('challenge-platform') ||
      lower.includes('cf-challenge') ||
      lower.includes('ray id') && lower.includes('cloudflare')
    )
  }

  protected isCloudflareError(error: any): boolean {
    const msg = (error?.message || '').toLowerCase()
    return msg.includes('cloudflare') || msg.includes('cf_clearance')
  }

  // ──────────────────────────────────────────
  // 错误判断
  // ──────────────────────────────────────────

  protected isNetworkError(error: any): boolean {
    return error.code === 'ECONNREFUSED' ||
           error.code === 'ETIMEDOUT' ||
           error.code === 'ENOTFOUND' ||
           error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
           error.name === 'TimeoutError'
  }

  protected isClientError(error: any): boolean {
    const status = error.response?.status
    return status >= 400 && status < 500
  }

  protected isNotFoundError(error: any): boolean {
    return error.response?.status === 404
  }
}

type OjPlatform = import('./types').OjPlatform
