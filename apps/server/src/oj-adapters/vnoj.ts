/**
 * VNOJ (oj.vnoi.info) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * VNOJ 页面特点（基于 DMOJ 框架）：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题: <title> 标签，格式 "题目名 - VNOJ: VNOI Online Judge"
 * - 时限: <span class="pi-value">1.0s</span>
 * - 内存: <span class="pi-value">256M</span>
 * - 题面: <div class="content-description screen"> 内，HTML 格式
 * - 数学公式: DMOJ 风格 ~...~ 转为 $...$
 * - 样例在题面 HTML 中，用 <h4>Sample Input/Output</h4> + <pre>
 * - 题号格式: 字母数字 slug（如 hello23_a）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://oj.vnoi.info'

export class VnojAdapter implements OjAdapter {
  name = 'VNOJ'
  platform: OjPlatform = 'vnoj'

  rateLimitConfig = {
    requestsPerSecond: 0.3,
    jitterRange: [2, 5] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 VNOJ 题号: ${problemId}`)
    }

    logger.info('vnoj_fetch_start', { action: 'vnoj_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/problem/${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `VNOJ 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `VNOJ HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      if (!html.includes('content-description') && !html.includes('pi-value')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `VNOJ 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `VNOJ 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `VNOJ 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const timeLimit = this.extractTimeLimit(html)
    const memoryLimit = this.extractMemoryLimit(html)
    const description = this.extractDescription(html)

    logger.info('vnoj_fetch_success', {
      action: 'vnoj_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'vnoj', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language: 'en',
        content: description,
        isVisible: true,
      }],
    }
  }

  private extractTitle(html: string, problemId: string): string {
    // <title>Khai Trương Bīngqílín - VNOJ: VNOI Online Judge</title>
    const m = html.match(/<title>([\s\S]*?)\s*-\s*VNOJ/i)
    if (m) return m[1].trim()
    // fallback: og:title
    const og = html.match(/og:title"\s+content="([^"]*)"/i)
    if (og) return og[1].trim()
    // fallback: use problemId
    return problemId
  }

  private extractTimeLimit(html: string): number | undefined {
    // <span class="pi-value">1.0s</span>
    const m = html.match(/Giới hạn thời gian[\s\S]*?<span\s+class="pi-value">([\d.]+)\s*s/i)
    if (m) return Math.round(parseFloat(m[1]) * 1000)
    // English fallback
    const m2 = html.match(/Time\s*limit[\s\S]*?<span\s+class="pi-value">([\d.]+)\s*s/i)
    if (m2) return Math.round(parseFloat(m2[1]) * 1000)
    return undefined
  }

  private extractMemoryLimit(html: string): number | undefined {
    // <span class="pi-value">256M</span>
    const m = html.match(/Giới hạn bộ nhớ[\s\S]*?<span\s+class="pi-value">(\d+)\s*M/i)
    if (m) return parseInt(m[1])
    // English fallback
    const m2 = html.match(/Memory\s*limit[\s\S]*?<span\s+class="pi-value">(\d+)\s*M/i)
    if (m2) return parseInt(m2[1])
    return undefined
  }

  private extractDescription(html: string): string {
    // <div class="content-description screen">...</div>
    const m = html.match(/<div\s+class="content-description\s+screen">([\s\S]*?)<\/div>\s*<div\s/m)
    if (m) {
      let content = m[1]
      // Remove the <iframe> for raw problem
      content = content.replace(/<iframe[^>]*><\/iframe>/gi, '')
      content = this.convertVnojHtml(content)
      return content
    }

    // Fallback: try broader extraction
    const start = html.indexOf('class="content-description screen"')
    if (start < 0) return ''
    const divStart = html.indexOf('>', start) + 1
    const divEnd = html.indexOf('</div>', divStart)
    if (divEnd < 0) return ''
    let content = html.substring(divStart, divEnd)
    content = content.replace(/<iframe[^>]*><\/iframe>/gi, '')
    return this.convertVnojHtml(content)
  }

  private convertVnojHtml(html: string): string {
    let content = html

    // Convert DMOJ math notation: ~...~ → $...$
    // Be careful not to match ~ in normal text
    content = content.replace(/~([^~\n]+?)~/g, '$$$1$')

    // Handle sample input/output sections
    // VNOJ uses <h4>Sample Input</h4> and <pre>
    content = content.replace(
      /<h4>\s*(Sample Input|Sample Output|Sample Input \d+|Sample Output \d+)\s*<\/h4>\s*<pre>([\s\S]*?)<\/pre>/gi,
      (_match, label, code) => {
        return `**${label}:**\n\n\`\`\`\n${code.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()}\n\`\`\``
      }
    )

    return convertHtmlToMarkdown(resolveRelativeUrls(content, BASE_URL)).trim()
  }

  isValidProblemId(problemId: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem/${problemId}`
  }
}
