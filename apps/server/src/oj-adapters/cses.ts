/**
 * CSES Problem Set 题目拉取适配器
 *
 * 纯 HTTP 实现，简洁 HTML 结构。
 *
 * CSES 特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 题面在 <div class="md"> 内，Markdown-like 内容
 * - 标题: <h1> 内
 * - 时限: "Time limit: 1.00 s"
 * - 内存: "Memory limit: 512 MB"
 * - 题号: 纯数字（如 1080, 1640）
 * - URL: https://cses.fi/problemset/task/{pid}
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, stripTags, unescapeHtml, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://cses.fi'

export class CsesAdapter implements OjAdapter {
  name = 'CSES'
  platform: OjPlatform = 'cses'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 CSES 题号: ${problemId}`)
    }

    logger.info('cses_fetch_start', { action: 'cses_fetch', metadata: { problemId } })

    try {
      const url = this.getProblemUrl(problemId)
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404 || response.status === 403) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `CSES 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `CSES HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      // CSES 404 页面可能返回 200 但无题目内容
      if (!html.includes('md') && !html.includes('problem') && !html.includes('task')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `CSES 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `CSES 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `CSES 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)
    const description = this.extractDescription(html, problemId)
    const language = detectLanguage(description)

    logger.info('cses_fetch_success', {
      action: 'cses_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'cses', problemId, url },
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
    // <h1>Weird Algorithm</h1> or <title>CSES - Weird Algorithm</title>
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (h1) return h1[1].replace(/<[^>]+>/g, '').trim()
    const title = html.match(/<title>([\s\S]*?)(?:\s*-\s*CSES)?<\/title>/i)
    if (title) return title[1].replace(/<[^>]+>/g, '').trim()
    return `CSES Task ${problemId}`
  }

  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    // "Time limit: 1.00 s" or "time limit 1.0s"
    const timeMatch = html.match(/time\s*limit[^\d]*(\d+(?:\.\d+)?)\s*s/i)
    const timeLimit = timeMatch ? Math.round(parseFloat(timeMatch[1]) * 1000) : undefined

    // "Memory limit: 512 MB"
    const memMatch = html.match(/memory\s*limit[^\d]*(\d+)\s*MB/i)
    const memoryLimit = memMatch ? parseInt(memMatch[1]) : undefined

    return { timeLimit, memoryLimit }
  }

  private extractDescription(html: string, problemId: string): string {
    // CSES uses <div class="md"> for markdown-like content
    const mdDiv = html.match(/<div\s+class="md">([\s\S]*?)<\/div>/i)
    if (mdDiv) {
      return convertHtmlToMarkdown(resolveRelativeUrls(mdDiv[1], BASE_URL)).trim()
    }

    // Fallback: look for task-content
    const content = html.match(/<div[^>]*class="[^"]*(?:content|statement|task)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    if (content) {
      return convertHtmlToMarkdown(resolveRelativeUrls(content[1], BASE_URL)).trim()
    }

    return `> 无法提取题面内容，请在原平台查看: ${this.getProblemUrl(problemId)}`
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problemset/task/${problemId}`
  }
}
