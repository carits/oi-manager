/**
 * Aizu Online Judge (onlinejudge.u-aizu.ac.jp) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * Aizu 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题通过 AJAX API 加载（judgeapi.u-aizu.ac.jp），但也存在于 <h1> 中
 * - 时限/内存: 通过 AJAX 加载到 span#problemTimeLimit/span#problemMemoryLimit
 * - 题面: <div class="description"> 内，使用 <H1>, <H2>, <pre> 等标准 HTML
 * - 数学公式: MathJax $...$ 格式
 * - 题号格式: 字母数字组合（如 ITP1_1_A, ALDS1_1_A, 0000）
 * - API: https://judgeapi.u-aizu.ac.jp/problems/{id} 返回 JSON（含标题、时限、内存）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, stripTags, unescapeHtml } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://onlinejudge.u-aizu.ac.jp'
const API_URL = 'https://judgeapi.u-aizu.ac.jp'

export class AizuAdapter implements OjAdapter {
  name = 'Aizu'
  platform: OjPlatform = 'aizu'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 Aizu 题号: ${problemId}`)
    }

    logger.info('aizu_fetch_start', { action: 'aizu_fetch', metadata: { problemId } })

    try {
      // 1. 并行获取 HTML 页面和 API 数据
      const [html, apiData] = await Promise.all([
        this.fetchPage(`${BASE_URL}/problems/${problemId}`),
        this.fetchApiData(problemId).catch(() => null),
      ])

      if (!html.includes('class="description"')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Aizu 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, apiData, problemId)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Aizu 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Aizu 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(30000),
    })
    if (response.status === 404) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Aizu 题目不存在`)
    }
    if (!response.ok) {
      throw new OjFetchError(OjErrorCode.SERVER_ERROR, `Aizu HTTP ${response.status}`)
    }
    return response.text()
  }

  private async fetchApiData(problemId: string): Promise<any> {
    const response = await fetch(`${API_URL}/problems/${problemId}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return null
    return response.json()
  }

  private parseHtml(html: string, apiData: any, problemId: string): OjProblem {
    const title = apiData?.name || this.extractTitle(html, problemId)
    const timeLimit = apiData?.problemTimeLimit ? parseFloat(apiData.problemTimeLimit) * 1000 : undefined
    const memoryLimit = apiData?.problemMemoryLimit ? Math.round(parseInt(apiData.problemMemoryLimit) / 1024) : undefined
    const description = this.extractDescription(html)

    logger.info('aizu_fetch_success', {
      action: 'aizu_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'aizu', problemId, url: `${BASE_URL}/problems/${problemId}` },
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
    const m = html.match(/<h1\s+class="title"[^>]*>([\s\S]*?)<\/h1>/i)
    if (m) return stripTags(m[1]).trim()
    return `Problem ${problemId}`
  }

  private extractDescription(html: string): string {
    const m = html.match(/<div\s+class="description">([\s\S]*?)<div\s+class="dat"/i)
    if (!m) {
      // Fallback: extract from description div to spacer60
      const start = html.indexOf('class="description"')
      if (start < 0) return ''
      const end = html.indexOf('class="spacer60"', start)
      const content = html.substring(html.indexOf('>', start) + 1, end > start ? end : html.length)
      return convertHtmlToMarkdown(resolveRelativeUrls(content, BASE_URL)).trim()
    }

    let content = m[1]
    // Remove MathJax script tags
    content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove source div
    content = content.replace(/<div\s+class="dat"[^>]*>[\s\S]*?<\/div>/gi, '')
    // Remove <hr>
    content = content.replace(/<hr[^>]*>/gi, '')

    return convertHtmlToMarkdown(resolveRelativeUrls(content, BASE_URL)).trim()
  }

  isValidProblemId(problemId: string): boolean {
    return /^[A-Za-z0-9_]+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problems/${problemId}`
  }
}
