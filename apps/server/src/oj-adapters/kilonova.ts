/**
 * Kilonova (kilonova.ro) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * Kilonova 页面特点：
 * - 服务端渲染 HTML（部分 HTMX），编码 UTF-8
 * - 标题: <title> 内，格式 " Problem 1: sum "；或 <h1><b>sum</b></h1>
 * - 时限: <span class="block">Time limit: 0.1s</span>
 * - 内存: <span class="block">Memory limit: 64MB</span>
 * - 题面: <article class="text-justify"> 内，已渲染的 HTML（接近 Markdown）
 * - 输入输出: <kn-glossary> 标签
 * - 题号: 纯数字（1, 2, 3, ...）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://kilonova.ro'

export class KilonovaAdapter implements OjAdapter {
  name = 'Kilonova'
  platform: OjPlatform = 'kilonova'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 Kilonova 题号: ${problemId}`)
    }

    logger.info('kilonova_fetch_start', { action: 'kilonova_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/problems/${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Kilonova 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `Kilonova HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      if (!html.includes('statement-content') && !html.includes('text-justify')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Kilonova 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Kilonova 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Kilonova 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const timeLimit = this.extractTimeLimit(html)
    const memoryLimit = this.extractMemoryLimit(html)
    const description = this.extractDescription(html)

    logger.info('kilonova_fetch_success', {
      action: 'kilonova_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'kilonova', problemId, url },
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
    // <title> Problem 1: sum </title>
    const m = html.match(/<title>\s*Problem\s+\d+:\s*(.*?)\s*<\/title>/i)
    if (m) return m[1].trim()
    // <h1><b>sum</b></h1>
    const h1 = html.match(/<h1[^>]*>\s*<b>([\s\S]*?)<\/b>\s*<\/h1>/i)
    if (h1) return h1[1].trim()
    return `Problem ${problemId}`
  }

  private extractTimeLimit(html: string): number | undefined {
    // <span class="block">Time limit: 0.1s</span>
    const m = html.match(/Time\s*limit:\s*([\d.]+)\s*s/i)
    if (m) return Math.round(parseFloat(m[1]) * 1000)
    return undefined
  }

  private extractMemoryLimit(html: string): number | undefined {
    // <span class="block">Memory limit: 64MB</span>
    const m = html.match(/Memory\s*limit:\s*(\d+)\s*MB/i)
    if (m) return parseInt(m[1])
    return undefined
  }

  private extractDescription(html: string): string {
    // <article class="text-justify">...</article>
    const m = html.match(/<article\s+class="text-justify">([\s\S]*?)<\/article>/i)
    if (m) {
      let content = m[1]
      // Remove <kn-glossary> custom tags
      content = content.replace(/<kn-glossary[^>]*>([\s\S]*?)<\/kn-glossary>/gi, '$1')
      return convertHtmlToMarkdown(resolveRelativeUrls(content, BASE_URL)).trim()
    }
    return ''
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problems/${problemId}`
  }
}
