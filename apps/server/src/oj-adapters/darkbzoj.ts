/**
 * DarkBZOJ (黑暗爆炸) 题目拉取适配器
 *
 * 基于 UOJ/SZOJ 系统，复用 UOJ 的 HTML 结构解析逻辑。
 *
 * DarkBZOJ 页面特点：
 * - 基于 UOJ/SZOJ 系统，HTML 结构与 UOJ 相同
 * - URL: https://darkbzoj.cc/problem/{pid}
 * - 题号格式: 纯数字（如 1000, 1001）
 * - 题面: <article class="uoj-article"> 内，标准 HTML
 * - 数学公式: MathJax $...$ 格式
 * - 样例: <h4>input</h4> + <pre>, <h4>output</h4> + <pre>
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, stripTags, unescapeHtml, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://darkbzoj.cc'

export class DarkbzojAdapter implements OjAdapter {
  name = 'DarkBZOJ'
  platform: OjPlatform = 'darkbzoj'

  rateLimitConfig = {
    requestsPerSecond: 0.3,
    jitterRange: [2, 5] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 DarkBZOJ 题号: ${problemId}`)
    }

    logger.info('darkbzoj_fetch_start', { action: 'darkbzoj_fetch', metadata: { problemId } })

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
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `DarkBZOJ 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `DarkBZOJ HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      // UOJ-based pages have uoj-article or tab-statement markers
      if (!html.includes('uoj-article') && !html.includes('tab-statement')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `DarkBZOJ 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `DarkBZOJ 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `DarkBZOJ 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)
    const description = this.extractDescription(html, problemId)
    const language = detectLanguage(description)

    logger.info('darkbzoj_fetch_success', {
      action: 'darkbzoj_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'darkbzoj', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language,
        content: description,
        isVisible: true,
      }],
    }
  }

  private extractTitle(html: string, problemId: string): string {
    // UOJ-style: <title>Problem Title - 题目 - Szkopuł / DarkBZOJ</title>
    const m = html.match(/<title>([\s\S]*?)(?:\s*-\s*(?:题目|Problem|Universal Online Judge|DarkBZOJ))+(?:<\/|$)/i)
    if (m && m[1].trim()) return m[1].trim()
    const m2 = html.match(/<h1[^>]*class="[^"]*problem-title[^"]*"[^>]*>([\s\S]*?)<small/i)
    if (m2) return m2[1].replace(/<[^>]+>/g, '').trim()
    const m3 = html.match(/<h1>([\s\S]*?)<\/h1>/i)
    if (m3) return m3[1].replace(/<[^>]+>/g, '').trim()
    return `BZOJ ${problemId}`
  }

  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    // UOJ-style limits: 时间限制：$1\texttt{s}$
    const timeMatch = html.match(/(?:时间限制|Time\s*Limit)[^<]*<\/[^>]*>[^$\d]*(\d+)\s*(?:\\texttt\{s\}|s\b)/i)
    const timeLimit = timeMatch ? parseInt(timeMatch[1]) * 1000 : undefined

    const memMatch = html.match(/(?:空间限制|内存限制|Memory\s*Limit)[^<]*<\/[^>]*>[^$\d]*(\d+)\s*(?:\\texttt\{MB\}|MB\b)/i)
    const memoryLimit = memMatch ? parseInt(memMatch[1]) : undefined

    return { timeLimit, memoryLimit }
  }

  private extractDescription(html: string, problemId: string): string {
    // UOJ-based: <article class="uoj-article">...</article>
    const articleMatch = html.match(/<article\s+class="uoj-article">([\s\S]*?)<\/article>/i)
    if (articleMatch) {
      const content = resolveRelativeUrls(articleMatch[1], BASE_URL)
      return convertHtmlToMarkdown(content).trim()
    }

    // Fallback: problem-content div
    const contentMatch = html.match(/<div[^>]*class="[^"]*problem-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    if (contentMatch) {
      return convertHtmlToMarkdown(resolveRelativeUrls(contentMatch[1], BASE_URL)).trim()
    }

    return `> 无法提取题面内容，请在原平台查看: ${this.getProblemUrl(problemId)}`
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem/${problemId}`
  }
}
