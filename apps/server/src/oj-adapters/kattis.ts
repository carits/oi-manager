/**
 * Kattis (open.kattis.com) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * Kattis 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题: <h1 class="book-page-heading">
 * - 题面: <div class="problembody"> 内，标准 HTML（h2, p, pre 等）
 * - 时限/内存: metadata tab 中的 card（如 "5 seconds"、"1024 MB"）
 * - 难度: metadata tab 中的 difficulty card
 * - 题号格式: 小写字母+数字+连字符的 slug（如 hello, 4thought）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://open.kattis.com'

export class KattisAdapter implements OjAdapter {
  readonly name = 'Kattis' as const
  platform: OjPlatform = 'kattis'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 Kattis 题号: ${problemId}`)
    }

    logger.info('kattis_fetch_start', { action: 'kattis_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/problems/${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Kattis 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `Kattis HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      // 检测题目不存在
      if (!html.includes('class="problembody"')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Kattis 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Kattis 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Kattis 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html)
    const description = this.extractDescription(html)
    const timeLimit = this.extractTimeLimit(html)
    const memoryLimit = this.extractMemoryLimit(html)
    const difficulty = this.extractDifficulty(html)

    logger.info('kattis_fetch_success', {
      action: 'kattis_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, difficulty }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      difficulty,
      source: { platform: 'kattis', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language: 'en',
        content: description,
        isVisible: true,
      }],
    }
  }

  private extractTitle(html: string): string {
    const m = html.match(/<h1\s+class="book-page-heading"[^>]*>([\s\S]*?)<\/h1>/i)
    if (m) return m[1].replace(/&ndash;/g, '-').replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim()
    return ''
  }

  private extractDescription(html: string): string {
    const m = html.match(/<div\s+class="problembody">([\s\S]*?)<\/div>\s*<\/div>/i)
    if (!m) {
      const start = html.indexOf('class="problembody"')
      if (start < 0) return ''
      const end = html.indexOf('</div>', start + 20)
      if (end < 0) return ''
      const content = html.substring(html.indexOf('>', start) + 1, end)
      return convertHtmlToMarkdown(resolveRelativeUrls(content, BASE_URL)).trim()
    }
    return convertHtmlToMarkdown(resolveRelativeUrls(m[1], BASE_URL)).trim()
  }

  private extractTimeLimit(html: string): number | undefined {
    // e.g. "CPU Time limit</span><span ...>5 seconds</span>"
    const m = html.match(/CPU\s+Time\s+limit[^<]*<\/span>[^<]*<[^>]*>(\d+(?:\.\d+)?)\s*s/i)
    if (m) return Math.round(parseFloat(m[1]) * 1000)
    return undefined
  }

  private extractMemoryLimit(html: string): number | undefined {
    // e.g. "Memory limit</span><span ...>1024 MB</span>"
    const m = html.match(/Memory\s+limit[^<]*<\/span>[^<]*<[^>]*>(\d+)\s*MB/i)
    if (m) return parseInt(m[1])
    return undefined
  }

  private extractDifficulty(html: string): string | undefined {
    // e.g. difficulty_number difficulty_easy">1.1 ... Easy
    const m = html.match(/difficulty_([a-z]+)">[\d.]+<\/span>[\s\S]*?font-bold[^>]*>(\w+)/i)
    if (m) return `${m[2]} (${m[1]})`
    return undefined
  }

  isValidProblemId(problemId: string): boolean {
    return /^[a-z][a-z0-9_-]*$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problems/${problemId}`
  }
}
