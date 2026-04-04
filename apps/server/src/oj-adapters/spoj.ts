/**
 * SPOJ (Sphere Online Judge) 题目拉取适配器
 *
 * 使用 Playwright + Stealth 模式，因为 SPOJ 有 Cloudflare 保护。
 *
 * SPOJ 特点：
 * - Cloudflare JS Challenge 保护，需 headed 模式通过
 * - URL: https://www.spoj.com/problems/{pid}/
 * - 题号格式: 大写字母+数字（如 TEST, PRIME1, FASHION）
 * - 标题: #problem-name
 * - 题面: #problem-body 内含 HTML
 * - 时限: 元信息表格 "Time limit: 6s"
 * - 内存: 元信息表格 "Memory limit: 1536MB"
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, detectLanguage } from './html-utils'
import { browserManager } from '../lib/browser/manager'
import { logger } from '../lib/logger'

const BASE_URL = 'https://www.spoj.com'

export class SpojAdapter implements OjAdapter {
  name = 'SPOJ'
  platform: OjPlatform = 'spoj'

  rateLimitConfig = {
    requestsPerSecond: 0.3,
    jitterRange: [2, 5] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 SPOJ 题号: ${problemId}`)
    }

    logger.info('spoj_fetch_start', { action: 'spoj_fetch', metadata: { problemId } })

    try {
      return await browserManager.withPage(
        { stealth: true, timeout: 60000, headless: false },
        (page) => this.fetchWithPage(page, problemId),
      )
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `SPOJ 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `SPOJ 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchWithPage(page: Page, problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (!resp) {
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `SPOJ 页面加载失败: ${problemId}`)
    }

    // 处理 Cloudflare challenge
    if (resp.status() === 403 || resp.status() === 503) {
      const passed = await this.waitForCloudflare(page)
      if (!passed) {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `SPOJ Cloudflare 拦截: ${problemId}`)
      }
    } else if (resp.status() === 404) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `SPOJ 题目不存在: ${problemId}`)
    } else if (resp.status() >= 400) {
      throw new OjFetchError(OjErrorCode.SERVER_ERROR, `SPOJ HTTP ${resp.status()}: ${problemId}`)
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    // 检查是否真的到了题目页面
    const hasBody = await page.locator('#problem-body').count()
    if (hasBody === 0) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `SPOJ 题目不存在: ${problemId}`)
    }

    return this.extractProblem(page, problemId, url)
  }

  private async extractProblem(page: Page, problemId: string, url: string): Promise<OjProblem> {
    // 提取标题
    const title = await page.locator('#problem-name').first().textContent()
      .then(t => t?.trim() || `SPOJ ${problemId}`)

    // 提取时限和内存限制
    const { timeLimit, memoryLimit } = await this.extractLimits(page)

    // 提取题面 HTML
    const bodyHtml = await page.locator('#problem-body').first().innerHTML()
    const description = convertHtmlToMarkdown(resolveRelativeUrls(bodyHtml, BASE_URL)).trim()
    const language = detectLanguage(description)

    logger.info('spoj_fetch_success', {
      action: 'spoj_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language },
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'spoj', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language,
        content: description,
        isVisible: true,
      }],
    }
  }

  private async extractLimits(page: Page): Promise<{ timeLimit?: number; memoryLimit?: number }> {
    const text = await page.textContent('body').catch(() => '')
    const fullText = text || ''

    // Time limit: "Time limit: 6s" or "Time limit: 1.5 s"
    const timeMatch = fullText.match(/Time\s*limit:\s*(\d+(?:\.\d+)?)\s*s/i)
    const timeLimit = timeMatch ? Math.round(parseFloat(timeMatch[1]) * 1000) : undefined

    // Memory limit: "Memory limit: 1536MB"
    const memMatch = fullText.match(/Memory\s*limit:\s*(\d+)\s*MB/i)
    const memoryLimit = memMatch ? parseInt(memMatch[1]) : undefined

    return { timeLimit, memoryLimit }
  }

  /** 等待 Cloudflare JS Challenge 通过 */
  private async waitForCloudflare(page: Page, maxWaitMs = 30000): Promise<boolean> {
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitMs) {
      await page.waitForTimeout(3000)
      const title = await page.title().catch(() => '')
      if (title && !title.includes('Just a moment') && !title.includes('请稍候') && title.length > 0) {
        return true
      }
    }
    return false
  }

  isValidProblemId(problemId: string): boolean {
    return /^[A-Z0-9_]+$/i.test(problemId.trim()) && problemId.trim().length > 0
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problems/${problemId}/`
  }
}
