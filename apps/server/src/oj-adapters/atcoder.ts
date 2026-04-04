/**
 * AtCoder 适配器
 * @description 从 AtCoder 平台拉取题目信息（HTML 抓取）
 *
 * 题号格式: {contest_id}_{task_letter}，如 arc216_a、abc100_a
 * URL: https://atcoder.jp/contests/{contest_id}/tasks/{task_ref}?lang=en
 *
 * 限流配置：
 * - REQS_PER_SEC: 1.0
 * - JITTER_SEC: 0.3-1.0
 * - MAX_RETRIES: 3
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjStatement } from './types'
import { LuoguAdapter } from './luogu'
import * as cheerio from 'cheerio'
import type { AnyNode, Element as DomElement } from 'domhandler'

/**
 * 时间/内存限制提取结果
 */
interface ProblemLimits {
  timeLimitMs?: number
  memoryLimitMB?: number
}

export class AtcoderAdapter implements OjAdapter {
  name = 'AtCoder'
  platform: OjPlatform = 'atcoder'

  // 限流配置
  private static REQS_PER_SEC = 1.0
  private static JITTER_SEC: [number, number] = [0.3, 1.0]
  private static MAX_RETRIES = 3
  private static lastRequestTime = 0

  rateLimitConfig = {
    requestsPerSecond: AtcoderAdapter.REQS_PER_SEC,
    jitterRange: AtcoderAdapter.JITTER_SEC,
    maxRetries: AtcoderAdapter.MAX_RETRIES,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(
        OjErrorCode.INVALID_PROBLEM_ID,
        `无效的 AtCoder 题号: ${problemId}。格式应为 arc216_a、abc100_a 等。`
      )
    }

    let lastError: Error | null = null

    for (let attempt = 1; attempt <= AtcoderAdapter.MAX_RETRIES; attempt++) {
      try {
        await this.rateLimit()

        const url = this.getProblemUrl(problemId)
        const html = await this.fetchPage(url)

        return this.parsePage(html, problemId, url)
      } catch (error) {
        lastError = error as Error

        if (this.isNetworkError(error) && attempt < AtcoderAdapter.MAX_RETRIES) {
          await this.sleep(1000 * attempt)
          continue
        }

        if (this.isClientError(error)) {
          if (this.isNotFoundError(error)) {
            throw new OjFetchError(
              OjErrorCode.PROBLEM_NOT_FOUND,
              `题目不存在: ${problemId}`,
              error as Error
            )
          }
          throw new OjFetchError(
            OjErrorCode.CLIENT_ERROR,
            `请求失败: ${(error as Error).message}`,
            error as Error
          )
        }

        if (this.isServerError(error) && attempt === AtcoderAdapter.MAX_RETRIES) {
          throw new OjFetchError(
            OjErrorCode.SERVER_ERROR,
            `AtCoder 服务器错误，请稍后重试`,
            error as Error
          )
        }

        if (error instanceof OjFetchError) {
          throw error
        }
      }
    }

    // 兜底：从洛谷拉取 AT_ 题号
    try {
      const luoguProblemId = `AT_${problemId}`
      console.log(`[AtCoder Adapter] Direct fetch failed, falling back to Luogu: ${luoguProblemId}`)
      const luoguAdapter = new LuoguAdapter()
      const luoguProblem = await luoguAdapter.fetch(luoguProblemId)

      // 覆盖 source 为 atcoder
      luoguProblem.source = {
        platform: 'atcoder',
        problemId,
        url: this.getProblemUrl(problemId).replace('?lang=en', ''),
      }

      return luoguProblem
    } catch (fallbackError) {
      console.error('[AtCoder Adapter] Luogu fallback also failed:', fallbackError)
    }

    throw new OjFetchError(
      OjErrorCode.NETWORK_ERROR,
      `网络请求失败: ${lastError?.message}`,
      lastError || undefined
    )
  }

  /**
   * 验证题号格式
   * AtCoder 题号格式: {contest_id}_{task_letter}
   * 例如: abc361_a, arc216_a, dp_a, agc001_a
   */
  isValidProblemId(problemId: string): boolean {
    return /^[a-z]{2,}\d*_[a-z]\d*$/i.test(problemId)
  }

  /**
   * 构建题目在 AtCoder 的 URL
   * contest_id = abc361_a → abc361（去掉最后的 _x）
   * task_ref = abc361_a（完整题号）
   */
  getProblemUrl(problemId: string): string {
    const lastUnderscore = problemId.lastIndexOf('_')
    const contestId = lastUnderscore >= 0 ? problemId.substring(0, lastUnderscore) : problemId
    return `https://atcoder.jp/contests/${contestId}/tasks/${problemId}?lang=en`
  }

  // ──────────────────────────────────────────
  // 限流
  // ──────────────────────────────────────────

  private async rateLimit(): Promise<void> {
    const now = Date.now()
    const minInterval = 1000 / AtcoderAdapter.REQS_PER_SEC
    const jitter = this.getRandomJitter()
    const elapsed = now - AtcoderAdapter.lastRequestTime
    const waitTime = minInterval + jitter - elapsed
    if (waitTime > 0) {
      await this.sleep(waitTime)
    }
    AtcoderAdapter.lastRequestTime = Date.now()
  }

  private getRandomJitter(): number {
    const [min, max] = AtcoderAdapter.JITTER_SEC
    return (min + Math.random() * (max - min)) * 1000
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ──────────────────────────────────────────
  // HTTP 请求
  // ──────────────────────────────────────────

  private async fetchPage(url: string): Promise<string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en,en-US;q=0.9',
      'Cookie': 'language=en',
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

    // 检测是否被重定向到登录页
    const finalUrl = response.url
    if (finalUrl.includes('/login') && !finalUrl.includes('/tasks/')) {
      throw new OjFetchError(
        OjErrorCode.CLIENT_ERROR,
        '请求被重定向到了登录页，题目可能不可访问'
      )
    }

    return response.text()
  }

  // ──────────────────────────────────────────
  // HTML 解析
  // ──────────────────────────────────────────

  private parsePage(html: string, problemId: string, url: string): OjProblem {
    const $ = cheerio.load(html)

    // 1. 提取标题
    const title = this.extractTitle($)

    // 2. 查找题面区域
    const statementEl = $('#task-statement')
    if (!statementEl.length) {
      throw new OjFetchError(
        OjErrorCode.PARSE_ERROR,
        '没有找到 #task-statement，页面结构可能已变更'
      )
    }

    // 3. 提取时间/内存限制
    const limits = this.extractLimits($, statementEl)

    // 4. 获取英文题面
    const englishEl = statementEl.find('span.lang-en')
    let contentRoot: cheerio.Cheerio<AnyNode>
    if (englishEl.length) {
      // 找内容最多的英文 span
      let best = englishEl.first()
      let bestScore = 0
      englishEl.each((_i, el) => {
        const txt = $(el).text()
        const score = txt.length + (txt.includes('Problem Statement') ? 1_000_000 : 0)
        if (score > bestScore) {
          bestScore = score
          best = $(el)
        }
      })
      contentRoot = best
    } else {
      // 没有英文区域，使用整个 statement
      contentRoot = statementEl
    }

    // 5. 预处理 HTML
    this.preprocessHtml($, contentRoot, url)

    // 6. 转换为 Markdown
    let markdown = this.htmlToMarkdown($, contentRoot, url)

    // 6.5 标题层级归一化：内容中的标题归一化到 ## 起
    // AtCoder HTML 中 <h3> 是最小节标题，归一化后应为 ##
    markdown = this.normalizeHeadings(markdown)

    // 7. 清建前置信息（不含 Source URL，由绑定信息存储）
    const front = this.buildFrontMatter(title, limits)


    const fullMarkdown = front + markdown

    return {
      title: title || `${problemId} 题目`,
      description: fullMarkdown,
      timeLimit: limits.timeLimitMs,
      memoryLimit: limits.memoryLimitMB,
      source: {
        platform: 'atcoder',
        problemId,
        url: url.replace('?lang=en', ''),
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
   * 归一化标题层级：找到内容中最低级标题，将整体偏移使其从 ## 开始
   * 例如 h3→h2, h4→h3（在已有 # Title 前缀下保持层级连续）
   */
  private normalizeHeadings(md: string): string {
    const headingRegex = /^(#{2,6})\s/gm
    let minLevel = 6
    let match: RegExpExecArray | null
    while ((match = headingRegex.exec(md)) !== null) {
      minLevel = Math.min(minLevel, match[1].length)
    }
    if (minLevel <= 2) return md // 已经从 ## 开始，无需调整

    const shift = minLevel - 2
    return md.replace(/^(#{2,6})\s/gm, (full, hashes: string) => {
      const newLevel = hashes.length - shift
      return '#'.repeat(Math.max(1, newLevel)) + ' '
    })
  }

  /**
   * 提取题目标题
   */
  private extractTitle($: cheerio.CheerioAPI): string {
    const titleTag = $('title').text().trim()
    if (titleTag) return titleTag
    const h2 = $('span.h2')
    if (h2.length) {
      const directText = h2.contents()
        .filter(function () { return this.type === 'text' })
        .text()
        .trim()
      return directText || h2.text().trim()
    }
    return ''
  }

  /**
   * 提取时间和内存限制
   */
  private extractLimits($: cheerio.CheerioAPI, statementEl: cheerio.Cheerio<AnyNode>): ProblemLimits {
    const result: ProblemLimits = {}

    // 在 statement 之前或周围的元素中查找 Time/Memory Limit
    let limitsText = ''

    // 向上查找 section 容器中的 p 标签
    const section = statementEl.closest('section')
    const searchScope = section.length ? section.find('p') : $('p')

    searchScope.each((_i, el) => {
      const text = $(el).text()
      if (/Time\s*Limit/i.test(text) || /Memory\s*Limit/i.test(text)) {
        limitsText += ' ' + text
      }
    })

    if (limitsText) {
      const timeMatch = limitsText.match(/Time\s*Limit[:\s]*(\d+(?:\.\d+)?)\s*sec/i)
      if (timeMatch) {
        result.timeLimitMs = Math.round(parseFloat(timeMatch[1]) * 1000)
      }

      const memMatch = limitsText.match(/Memory\s*Limit[:\s]*(\d+)\s*(?:MB|MiB)/i)
      if (memMatch) {
        result.memoryLimitMB = parseInt(memMatch[1], 10)
      }
    }

    return result
  }

  /**
   * 预处理 HTML：处理 <var> 标签、链接、图片
   */
  private preprocessHtml($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>, baseUrl: string): void {
    // <var> 标签 → 用行内公式包裹文本（但跳过 <pre> 内的 <var>，留给后续处理）
    // 增强：处理 <var> 内嵌套的 <sup>/<sub>，如 <var>x<sub>i</sub></var> → $x_{i}$
    root.find('var').each((_i, el) => {
      if ($(el).closest('pre').length > 0) return

      // 递归转换 <var> 内部内容为 LaTeX 文本
      const latexText = this.varToLatex($, $(el))
      $(el).replaceWith(`$${latexText}$`)
    })

    // 移除 Score / Time Limit / Memory Limit 等元数据 <p>（已提取到结构化字段）
    root.find('p').each((_i, el) => {
      const text = $(el).text().trim()
      if (
        /^(Score\s*[:：]|Time\s*Limit\s*[:：]|Memory\s*Limit\s*[:：])/i.test(text) ||
        /^(\d+)\s*(?:MB|MiB|KB|KiB|GB|GiB)$/i.test(text)
      ) {
        $(el).remove()
      }
    })

    // 链接绝对化
    root.find('a[href]').each((_i, el) => {
      const href = $(el).attr('href')
      if (href && !href.startsWith('http') && !href.startsWith('#')) {
        $(el).attr('href', this.resolveUrl(baseUrl, href))
      }
    })

    // 图片绝对化
    root.find('img[src]').each((_i, el) => {
      const src = $(el).attr('src')
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        $(el).attr('src', this.resolveUrl(baseUrl, src))
      }
    })
  }

  private resolveUrl(base: string, relative: string): string {
    try {
      return new URL(relative, base).href
    } catch {
      return relative
    }
  }

  /**
   * 递归将 <var> 内部内容转为 LaTeX 文本
   * 处理嵌套 <sup> → ^{...} 和 <sub> → _{...}
   */
  private varToLatex($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
    const parts: string[] = []

    el.contents().each((_i, node) => {
      if (node.type === 'text') {
        parts.push($(node).text())
        return
      }

      if (!('tagName' in node)) return
      const tag = (node as DomElement).tagName.toLowerCase()
      const $node = $(node)

      switch (tag) {
        case 'sub': {
          const inner = this.varToLatex($, $node)
          // 单字符不需要花括号，多字符需要
          parts.push(inner.length <= 1 ? `_${inner}` : `_{${inner}}`)
          break
        }
        case 'sup': {
          const inner = this.varToLatex($, $node)
          parts.push(inner.length <= 1 ? `^${inner}` : `^{${inner}}`)
          break
        }
        default:
          parts.push($node.text())
          break
      }
    })

    return parts.join('')
  }

  // ──────────────────────────────────────────
  // HTML → Markdown 转换
  // ──────────────────────────────────────────

  private htmlToMarkdown($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>, _baseUrl: string): string {
    const parts: string[] = []

    root.children().each((_i, el) => {
      const tagName = 'tagName' in el ? (el as DomElement).tagName.toLowerCase() : null
      if (!tagName) return

      const md = this.convertElement($, $(el))
      if (md.trim()) {
        parts.push(md)
      }
    })

    let markdown = parts.join('\n\n')
    markdown = markdown.replace(/\r\n/g, '\n')
    markdown = markdown.replace(/\n{3,}/g, '\n\n')
    markdown = markdown.replace(/```+\n\n+/g, '```\n')
    markdown = markdown.replace(/\n+```/g, '\n```')
    markdown = markdown.split('\n').map(line => line.trimEnd()).join('\n')

    return markdown.trim() + '\n'
  }

  /**
   * 转换单个元素为 Markdown
   */
  private convertElement($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
    const node = el.get(0)
    if (!node || !('tagName' in node)) return ''

    const tag = (node as DomElement).tagName.toLowerCase()

    switch (tag) {
      case 'h1': return `# ${this.convertInline($, el)}`
      case 'h2': return `## ${this.convertInline($, el)}`
      case 'h3': return `### ${this.convertInline($, el)}`
      case 'h4': return `#### ${this.convertInline($, el)}`
      case 'h5': return `##### ${this.convertInline($, el)}`
      case 'h6': return `###### ${this.convertInline($, el)}`

      case 'p':
        return this.convertInline($, el)

      case 'pre': {
        // <pre> 内含 <var> 标签 → 格式说明块，用 blockquote
        if (el.find('var').length > 0) {
          const inline = this.convertInline($, el)
          return inline.split('\n').map(line => `> ${line}`).join('\n')
        }
        // 普通 <pre>（如样例输入输出）→ 保持代码块
        const code = el.find('code')
        const codeEl = code.length ? code : el
        const text = codeEl.text()
        const lang = code.attr('class')?.match(/language-(\w+)/)?.[1] || ''
        return `\`\`\`${lang}\n${text}\n\`\`\``
      }

      case 'ul': {
        const items: string[] = []
        el.children('li').each((_i, li) => {
          const text = this.convertInline($, $(li))
          items.push(`- ${text}`)
        })
        return items.join('\n')
      }

      case 'ol': {
        const items: string[] = []
        el.children('li').each((_i, li) => {
          const text = this.convertInline($, $(li))
          items.push(`${_i + 1}. ${text}`)
        })
        return items.join('\n')
      }

      case 'blockquote': {
        const inner = this.convertChildren($, el)
        return inner.split('\n').map(line => `> ${line}`).join('\n')
      }

      case 'table':
        return this.convertTable($, el)

      case 'section':
      case 'div':
      case 'article':
      case 'span':
      case 'main':
      case 'header':
      case 'footer':
      case 'nav':
        return this.convertChildren($, el)

      case 'script':
      case 'style':
      case 'svg':
        return ''

      case 'hr':
        return '---'

      default:
        return this.convertInline($, el)
    }
  }

  /**
   * 转换行内元素（递归处理子节点）
   */
  private convertInline($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
    const parts: string[] = []

    el.contents().each((_i, node) => {
      if (node.type === 'text') {
        let text = $(node).text()
        text = text.replace(/\s+/g, ' ')
        parts.push(text)
        return
      }

      if (!('tagName' in node)) return

      const tag = (node as DomElement).tagName.toLowerCase()
      const $node = $(node)

      switch (tag) {
        case 'strong':
        case 'b':
          parts.push(`**${this.convertInline($, $node)}**`)
          break
        case 'em':
        case 'i':
          parts.push(`*${this.convertInline($, $node)}*`)
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
          const text = this.convertInline($, $node)
          parts.push(href ? `[${text}](${href})` : text)
          break
        }
        case 'img': {
          const src = $node.attr('src') || ''
          const alt = $node.attr('alt') || ''
          parts.push(`![${alt}](${src})`)
          break
        }
        case 'br':
          parts.push('\n')
          break
        case 'sub':
          parts.push(`~${this.convertInline($, $node)}~`)
          break
        case 'sup':
          parts.push(`^${this.convertInline($, $node)}^`)
          break
        case 'var': {
          const varText = $node.text()
          parts.push(`$${varText}$`)
          break
        }
        case 'pre': {
          // <pre> 内含 <var> → blockquote
          if ($node.find('var').length > 0) {
            const inline = this.convertInline($, $node)
            const quoted = inline.split('\n').map((line: string) => `> ${line}`).join('\n')
            parts.push(`\n${quoted}\n`)
          } else {
            const code = $node.find('code')
            const codeEl = code.length ? code : $node
            const codeText2 = codeEl.text()
            const lang = code.attr('class')?.match(/language-(\w+)/)?.[1] || ''
            parts.push(`\n\`\`\`${lang}\n${codeText2}\n\`\`\`\n`)
          }
          break
        }
        case 'ul': {
          const items: string[] = []
          $node.children('li').each((__i, li) => {
            items.push(`  - ${this.convertInline($, $(li))}`)
          })
          parts.push('\n' + items.join('\n'))
          break
        }
        case 'ol': {
          const items: string[] = []
          $node.children('li').each((__i, li) => {
            items.push(`  ${__i + 1}. ${this.convertInline($, $(li))}`)
          })
          parts.push('\n' + items.join('\n'))
          break
        }
        case 'table':
          parts.push('\n' + this.convertTable($, $node) + '\n')
          break
        case 'p':
          parts.push('\n' + this.convertInline($, $node))
          break
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
          const level = '#'.repeat(parseInt(tag[1], 10))
          parts.push(`\n${level} ${this.convertInline($, $node)}\n`)
          break
        }
        case 'script':
        case 'style':
        case 'svg':
          break
        default:
          parts.push(this.convertInline($, $node))
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
  private convertChildren($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
    const parts: string[] = []
    el.children().each((_i, child) => {
      if ('tagName' in child) {
        const md = this.convertElement($, $(child))
        if (md.trim()) parts.push(md)
      } else {
        const text = $(child).text().trim()
        if (text) parts.push(text)
      }
    })
    return parts.join('\n\n')
  }

  /**
   * 转换表格为 Markdown
   */
  private convertTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<AnyNode>): string {
    const rows: string[][] = []

    table.find('tr').each((_i, tr) => {
      const cells: string[] = []
      $(tr).find('th, td').each((_j, cell) => {
        cells.push(this.convertInline($, $(cell)).replace(/\|/g, '\\|').replace(/\n/g, ' '))
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
  // 前置信息
  // ──────────────────────────────────────────

  private buildFrontMatter(title: string, _limits: ProblemLimits): string {
    const parts: string[] = []
    if (title) {
      parts.push(`# ${title}`)
    }
    parts.push('')
    return parts.join('\n')
  }

  // ──────────────────────────────────────────
  // 错误判断
  // ──────────────────────────────────────────

  private isNetworkError(error: any): boolean {
    return error.code === 'ECONNREFUSED' ||
           error.code === 'ETIMEDOUT' ||
           error.code === 'ENOTFOUND' ||
           error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
           error.name === 'TimeoutError'
  }

  private isClientError(error: any): boolean {
    const status = error.response?.status
    return status >= 400 && status < 500
  }

  private isServerError(error: any): boolean {
    const status = error.response?.status
    return status >= 500
  }

  private isNotFoundError(error: any): boolean {
    return error.response?.status === 404
  }
}

type OjPlatform = import('./types').OjPlatform
