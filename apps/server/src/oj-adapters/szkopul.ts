/**
 * Szkopuł (波兰 OI 平台) 题目拉取适配器
 *
 * 纯 HTTP 实现，支持 Markdown 和 PDF 两种题面格式。
 *
 * Szkopuł 页面特点：
 * - 部分题目直接输出 Markdown 文本（几乎不需要解析）
 * - 部分题目嵌入 PDF（<object data="...statement/" type="application/pdf">）
 * - URL: https://szkopul.edu.pl/problemset/problem/{pid}/site/
 * - 题号格式: 字母数字 slug（如 `7FdDcCShZPh`）
 * - 节标题用 ## heading
 * - 图片: ![Image N](https://szkopul.edu.pl/images/...)
 * - 代码块: fenced code blocks
 * - 样例: "Przykładowe dane wejściowe/wyjściowe"（波兰语标题）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, downloadAndSavePdf, detectLanguage, stripTags } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://szkopul.edu.pl'

export class SzkopulAdapter implements OjAdapter {
  name = 'Szkopuł'
  platform: OjPlatform = 'szkopul'

  rateLimitConfig = {
    requestsPerSecond: 0.3,
    jitterRange: [2, 5] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 Szkopuł 题号: ${problemId}`)
    }

    logger.info('szkopul_fetch_start', { action: 'szkopul_fetch', metadata: { problemId } })

    try {
      const url = this.getProblemUrl(problemId)
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Szkopuł 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `Szkopuł HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      // PDF-type pages have <object type="application/pdf"> or a statement link
      if (this.isPdfPage(html)) {
        return await this.handlePdfProblem(html, problemId, url)
      }

      // HTML/Markdown-type pages
      if (!html.includes('problem-content') && !html.includes('statement')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Szkopuł 题目不存在: ${problemId}`)
      }

      return this.parseHtmlContent(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Szkopuł 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Szkopuł 拉取失败: ${e.message}`, e)
    }
  }

  /**
   * Detect PDF-type pages by looking for <object type="application/pdf"> tag
   * or the "open the problem's statement" text
   */
  private isPdfPage(html: string): boolean {
    return html.includes('type="application/pdf"') || html.includes('type=\'application/pdf\'')
  }

  /**
   * Handle PDF-type problems: extract PDF URL, download and save locally
   */
  private async handlePdfProblem(html: string, problemId: string, url: string): Promise<OjProblem> {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)

    // Extract PDF URL from <object data="..."> tag
    let pdfUrl = this.extractPdfUrl(html, problemId)

    // Try to download and save the PDF locally
    let localPdfUrl: string | null = null
    if (pdfUrl) {
      localPdfUrl = await downloadAndSavePdf(pdfUrl, problemId, 'szkopul')
    }

    const description = localPdfUrl
      ? `**题目为 PDF 格式，已下载到本地。**\n\n[查看 PDF 题面](${localPdfUrl})\n\n> 原始链接: ${url}`
      : pdfUrl
        ? `**题目为 PDF 格式。**\n\n[查看 PDF 题面](${pdfUrl})\n\n> 请在原平台查看完整题面: ${url}`
        : `**题目为 PDF 格式。**\n\n> 请在原平台查看完整题面: ${url}`

    logger.info('szkopul_fetch_pdf', {
      action: 'szkopul_fetch',
      metadata: { problemId, title, timeLimit, memoryLimit, pdfUrl, localPdfUrl }
    })

    const statements: OjProblem['statements'] = [{
      type: 'statement',
      format: 'pdf',
      language: null,
      fileUrl: localPdfUrl || pdfUrl || undefined,
      isVisible: true,
    }]

    return {
      title,
      description: localPdfUrl || pdfUrl
        ? `**题目为 PDF 格式。**\n\n> 原始链接: ${url}`
        : `**题目为 PDF 格式。**\n\n> 请在原平台查看完整题面: ${url}`,
      timeLimit,
      memoryLimit,
      source: { platform: 'szkopul', problemId, url },
      statements,
    }
  }

  /**
   * Extract PDF URL from <object data="..."> tag
   * Pattern: <object data="/problemset/problem/{pid}/statement/" type="application/pdf">
   * Also fallback to <a href="...statement/"> link
   */
  private extractPdfUrl(html: string, problemId: string): string | null {
    // Try <object data="...">
    const objectMatch = html.match(/<object[^>]+data="([^"]+)"[^>]*type="application\/pdf"/i)
    if (objectMatch) {
      return this.resolveUrl(objectMatch[1])
    }

    // Try <object type="application/pdf" data="...">
    const objectMatch2 = html.match(/<object[^>]+type="application\/pdf"[^>]+data="([^"]+)"/i)
    if (objectMatch2) {
      return this.resolveUrl(objectMatch2[1])
    }

    // Fallback: look for /statement/ link
    const linkMatch = html.match(/href="(\/problemset\/problem\/[^/]+\/statement\/?)"/i)
    if (linkMatch) {
      return this.resolveUrl(linkMatch[1])
    }

    // Last fallback: construct from problemId
    return `${BASE_URL}/problemset/problem/${problemId}/statement/`
  }

  private resolveUrl(href: string): string {
    if (href.startsWith('http')) return href
    if (href.startsWith('/')) return `${BASE_URL}${href}`
    return `${BASE_URL}/${href}`
  }

  private parseHtmlContent(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)
    const description = this.extractDescription(html, problemId)

    logger.info('szkopul_fetch_success', {
      action: 'szkopul_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'szkopul', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language: detectLanguage(description),
        content: description,
        isVisible: true,
      }],
    }
  }

  private extractTitle(html: string, problemId: string): string {
    // <title>... - Problem ... - Szkopuł</title>
    const m = html.match(/<title>([\s\S]*?)(?:\s*-\s*(?:Problem|Zadanie|Szkopuł|Main Page))*/i)
    if (m && m[1].trim()) return m[1].trim()
    // Try h1
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (h1) return h1[1].replace(/<[^>]+>/g, '').trim()
    return `Problem ${problemId}`
  }

  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    // Szkopuł uses <h3>Memory limit: 64 MB</h3> and possibly <h3>Time limit: N s</h3>
    // Also Polish: "Pamięć" and "Czas"
    const timeMatch = html.match(/(?:Time\s+limit|Czas|Time)\s*:?\s*(\d+)\s*(s|ms|sek)/i)
    const timeLimit = timeMatch
      ? (timeMatch[2].toLowerCase() === 'ms' ? parseInt(timeMatch[1]) : parseInt(timeMatch[1]) * 1000)
      : undefined

    const memMatch = html.match(/(?:Memory\s+limit|Pamięć)\s*:?\s*(\d+)\s*(MB|MiB|KB)/i)
    const memoryLimit = memMatch ? parseInt(memMatch[1]) : undefined

    return { timeLimit, memoryLimit }
  }

  private extractDescription(html: string, problemId: string): string {
    // Strategy 1: nav-content area (Szkopuł's statement tab content)
    const navContentMatch = html.match(/<div[^>]*class="nav-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)
    if (navContentMatch) {
      let content = navContentMatch[1]

      // Strip outer wrapper divs: <div width="100%"...><div>...actual content...</div></div>
      const innerMatch = content.match(/<div[^>]*>\s*<div[^>]*>([\s\S]*)/)
      if (innerMatch) {
        content = innerMatch[1].replace(/\s*<\/div>\s*$/, '')
      }

      // Convert LaTeX equation images before HTML→Markdown
      content = this.replaceEquationImages(content, problemId)

      // Remove <h3>Memory/Time limit...</h3> from content (extracted separately)
      content = content.replace(/<h3[^>]*>\s*(?:Memory|Time|Pamięć|Czas)\s+(?:limit|Limit)?\s*:?\s*\d+\s*(?:MB|MiB|KB|s|ms|sek)?\s*<\/h3>/gi, '')

      // Convert HTML to Markdown
      const md = convertHtmlToMarkdown(resolveRelativeUrls(content, `https://szkopul.edu.pl/problemset/problem/${problemId}/site/`))
      if (md.trim().length > 50) return this.cleanMarkdown(md)
    }

    // Strategy 2: problem-content / statement / uoj-article / markdown-body
    const contentMatch = html.match(
      /<div[^>]*class="[^"]*(?:problem-content|statement|uoj-article|markdown-body)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div\s+class=")/i
    )

    if (contentMatch) {
      let content = contentMatch[1]

      // If it's raw Markdown in <pre> or <code>
      const preMatch = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
      if (preMatch) {
        const text = preMatch[1].replace(/<[^>]+>/g, '')
        return this.decodeHtmlEntities(text).trim()
      }

      // Convert equation images
      content = this.replaceEquationImages(content, problemId)
      const md = convertHtmlToMarkdown(resolveRelativeUrls(content, BASE_URL))
      if (md.trim().length > 50) return this.cleanMarkdown(md)

      const stripped = content.replace(/<[^>]+>/g, '').trim()
      if (stripped.length > 100) return stripped
    }

    // Fallback: try to find any significant text block
    const bodyMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    if (bodyMatch) {
      return bodyMatch[1].replace(/<[^>]+>/g, '').trim()
    }

    return ''
  }

  /**
   * Clean up Markdown output: remove excessive whitespace, fix indentation
   */
  private cleanMarkdown(md: string): string {
    // Protect fenced code blocks first
    const codeBlocks: string[] = []
    let result = md.replace(/```[\s\S]*?```/g, (m) => {
      codeBlocks.push(m)
      return `\x00CODE${codeBlocks.length - 1}\x00`
    })

    // Remove all leading whitespace on non-code lines (caused by wrapper div indentation)
    result = result.replace(/^ +/gm, '')

    // Restore code blocks
    result = result.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)])

    return result
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /**
   * Szkopuł equation images: <span class="texmath"><img src="images/OI18/xxx-en-tex.N.png"/></span>
   * These are pre-rendered LaTeX PNGs — we can't extract the LaTeX source,
   * so we convert them to image references with full absolute URLs.
   */
  private replaceEquationImages(html: string, problemId: string): string {
    const baseUrl = `${BASE_URL}/problemset/problem/${problemId}/site/`
    return html.replace(
      /<span\s+class="texmath"\s*>\s*<img\s+src="([^"]+)"[^>]*\/?>\s*<\/span>/gi,
      (_match, src) => {
        const fullUrl = src.startsWith('http')
          ? src
          : src.startsWith('/')
            ? `${BASE_URL}${src}`
            : `${baseUrl}${src}`
        return `![tex](${fullUrl})`
      }
    )
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&nbsp;/g, ' ')
  }

  isValidProblemId(problemId: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(problemId.trim()) && problemId.trim().length > 0
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problemset/problem/${problemId}/site/?key=statement`
  }
}
