/**
 * DMOJ (Don Mills Online Judge) 题目拉取适配器
 *
 * 使用 DMOJ API (v2) 拉取题目信息，纯 HTTP 实现。
 *
 * DMOJ 特点：
 * - 有完整的 REST API: https://dmoj.ca/api/v2/problem/{pid}
 * - API 返回 JSON，包含 title, time_limit, memory_limit, html (题面)
 * - 题号格式: slug（如 `aplusb`, `ccc06s1`）
 * - URL: https://dmoj.ca/problem/{pid}
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://dmoj.ca'
const API_URL = 'https://dmoj.ca/api/v2'

interface DmojApiProblem {
  id: string
  title: string
  time_limit: number    // seconds
  memory_limit: number   // kilobytes
  points?: number
  partial?: boolean
  html?: string          // problem statement HTML
  group: string[]
}

export class DmojAdapter implements OjAdapter {
  name = 'DMOJ'
  platform: OjPlatform = 'dmoj'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 DMOJ 题号: ${problemId}`)
    }

    logger.info('dmoj_fetch_start', { action: 'dmoj_fetch', metadata: { problemId } })

    try {
      // 先尝试 API 拉取
      const apiResult = await this.fetchFromApi(problemId)
      if (apiResult) return apiResult

      // API 失败则退化为 HTML 拉取
      return await this.fetchFromHtml(problemId)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `DMOJ 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `DMOJ 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchFromApi(problemId: string): Promise<OjProblem | null> {
    try {
      const url = `${API_URL}/problem/${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) return null
      if (!response.ok) return null

      const data = await response.json() as DmojApiProblem
      if (!data || !data.title) return null

      const title = data.title
      const timeLimit = data.time_limit ? Math.round(data.time_limit * 1000) : undefined
      const memoryLimit = data.memory_limit ? Math.round(data.memory_limit / 1024) : undefined

      let description = ''
      if (data.html) {
        description = convertHtmlToMarkdown(resolveRelativeUrls(data.html, BASE_URL)).trim()
      }

      if (!description) {
        // API 没有返回题面 HTML，退化为 HTML 拉取
        return null
      }

      const language = detectLanguage(description)
      const problemUrl = this.getProblemUrl(problemId)

      logger.info('dmoj_api_fetch_success', {
        action: 'dmoj_fetch',
        metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language }
      })

      return {
        title,
        description,
        timeLimit,
        memoryLimit,
        source: { platform: 'dmoj', problemId, url: problemUrl },
        statements: [{
          type: 'statement',
          format: 'markdown',
          language,
          content: description,
          isVisible: true,
        }],
      }
    } catch {
      return null
    }
  }

  private async fetchFromHtml(problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(30000),
    })

    if (response.status === 404) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `DMOJ 题目不存在: ${problemId}`)
    }
    if (!response.ok) {
      throw new OjFetchError(OjErrorCode.SERVER_ERROR, `DMOJ HTTP ${response.status}: ${problemId}`)
    }

    const html = await response.text()

    if (!html.includes('problem-content') && !html.includes('problem-statement')) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `DMOJ 题目不存在: ${problemId}`)
    }

    return this.parseHtml(html, problemId, url)
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)
    const description = this.extractDescription(html, problemId)
    const language = detectLanguage(description)

    logger.info('dmoj_html_fetch_success', {
      action: 'dmoj_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'dmoj', problemId, url },
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
    const m = html.match(/<title>([\s\S]*?)\s*-\s*DMOJ/i)
    if (m) return m[1].trim()
    return problemId
  }

  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    const timeMatch = html.match(/(\d+(?:\.\d+)?)\s*s(?:econds?)?/i)
    const timeLimit = timeMatch ? Math.round(parseFloat(timeMatch[1]) * 1000) : undefined

    const memMatch = html.match(/(\d+)\s*M(?:B|iB)/i)
    const memoryLimit = memMatch ? parseInt(memMatch[1]) : undefined

    return { timeLimit, memoryLimit }
  }

  private extractDescription(html: string, problemId: string): string {
    // DMOJ uses <div class="problem-statement"> or <div class="description">
    const statementMatch = html.match(/<div[^>]*class="[^"]*problem-statement[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div\s+class=")/i)
    if (statementMatch) {
      return convertHtmlToMarkdown(resolveRelativeUrls(statementMatch[1], BASE_URL)).trim()
    }

    const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    if (descMatch) {
      return convertHtmlToMarkdown(resolveRelativeUrls(descMatch[1], BASE_URL)).trim()
    }

    return `> 无法提取题面内容，请在原平台查看: ${this.getProblemUrl(problemId)}`
  }

  isValidProblemId(problemId: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(problemId.trim()) && problemId.trim().length > 0
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem/${problemId}`
  }
}
