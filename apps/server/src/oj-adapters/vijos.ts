/**
 * Vijos Online Judge 题目拉取适配器
 *
 * 纯 HTTP 实现，服务端渲染 HTML，无反爬保护。
 *
 * Vijos 特点：
 * - URL: https://vijos.org/p/{pid}（注意：不带 P 前缀）
 * - 题号格式: 纯数字（如 1000, 1001）
 * - 服务端渲染，编码 UTF-8
 * - 标题: <title> 标签（格式: "{title} - Vijos"）
 * - 题面: Markdown 渲染后的 HTML，以 <h2> 标题分节
 * - 时限/内存: "## 限制" 节（如 "各个测试点1s，16MiB内存空间"）
 * - 样例: "## 样例输入1" / "## 样例输出1" 在 <pre><code> 中
 * - 语言: 中文为主
 */

import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://vijos.org'

export class VijosAdapter implements OjAdapter {
  name = 'Vijos'
  platform: OjPlatform = 'vijos'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 Vijos 题号: ${problemId}`)
    }

    logger.info('vijos_fetch_start', { action: 'vijos_fetch', metadata: { problemId } })

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
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Vijos 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `Vijos HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()
      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Vijos 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Vijos 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const $ = cheerio.load(html)

    // 检查题目是否存在
    const title = this.extractTitle($, problemId)
    if (title === `Vijos ${problemId}` && $('h1, h2, .problem-content, article').length === 0) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Vijos 题目不存在: ${problemId}`)
    }

    const description = this.extractDescription($, problemId)
    const language = detectLanguage(description)
    const { timeLimit, memoryLimit } = this.extractLimits($, description)

    logger.info('vijos_fetch_success', {
      action: 'vijos_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language },
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'vijos', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language,
        content: description,
        isVisible: true,
      }],
    }
  }

  private extractTitle($: cheerio.CheerioAPI, problemId: string): string {
    // <title>A+B Problem - Vijos</title>
    const titleText = $('title').first().text().trim()
    if (titleText) {
      const parts = titleText.split(/\s*-\s*Vijos\s*$/i)
      if (parts[0] && parts[0].trim()) return parts[0].trim()
    }
    return `Vijos ${problemId}`
  }

  private extractLimits($: cheerio.CheerioAPI, description: string): { timeLimit?: number; memoryLimit?: number } {
    let timeLimit: number | undefined
    let memoryLimit: number | undefined

    // Vijos 格式: "各个测试点1s，16MiB内存空间"
    // 也可能出现在 "限制" 节中
    const fullText = description

    // 时间限制: "1s" / "2s" / "1000ms"
    const timeMatch = fullText.match(/(?:时间限制|测试点)\s*(\d+(?:\.\d+)?)\s*(s|ms)/i)
      || fullText.match(/(\d+(?:\.\d+)?)\s*(s|ms)(?:，|,|\s)/)
    if (timeMatch) {
      const value = parseFloat(timeMatch[1])
      const unit = timeMatch[2].toLowerCase()
      timeLimit = unit === 'ms' ? value : Math.round(value * 1000)
    }

    // 内存限制: "16MiB" / "128 MB"
    const memMatch = fullText.match(/(\d+)\s*(?:MiB|MB|MiB内存)/i)
      || fullText.match(/内存(?:空间)?\s*(\d+)\s*(?:MiB|MB)/i)
    if (memMatch) {
      memoryLimit = parseInt(memMatch[1])
    }

    return { timeLimit, memoryLimit }
  }

  private extractDescription($: cheerio.CheerioAPI, problemId: string): string {
    // Vijos 使用 Markdown 渲染，内容在主内容区域
    // 尝试多种选择器定位主要内容
    const contentSelectors = [
      '.problem-content',
      'article',
      '.content',
      '.statement',
      'main',
    ]

    let contentEl: ReturnType<typeof $> | null = null
    for (const sel of contentSelectors) {
      const el = $(sel).first()
      if (el.length > 0 && el.text().trim().length > 50) {
        contentEl = el
        break
      }
    }

    // 兜底: 提取 body 中所有内容
    if (!contentEl) {
      const body = $('body')
      if (body.length > 0) {
        contentEl = body
      } else {
        return `> 无法提取题面内容，请在原平台查看: ${this.getProblemUrl(problemId)}`
      }
    }

    const html = contentEl.html() || ''
    const md = convertHtmlToMarkdown(resolveRelativeUrls(html, BASE_URL)).trim()
    return md || `> 无法提取题面内容，请在原平台查看: ${this.getProblemUrl(problemId)}`
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/p/${problemId}`
  }
}
