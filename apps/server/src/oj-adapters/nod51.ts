/**
 * 51Nod (www.51nod.com) 题目拉取适配器
 *
 * 需要 Playwright（Vue SPA，数据通过 AJAX 加载）。
 *
 * 51Nod 页面特点：
 * - Vue SPA，URL 有 # 号: https://www.51nod.com/Challenge/Problem.html#problemId={pid}
 * - 题目数据通过 AJAX API 加载
 * - 中文 OJ
 * - 支持数学公式
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { browserManager } from '../lib/browser/manager'
import { convertHtmlToMarkdown, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://www.51nod.com'

export class Nod51Adapter implements OjAdapter {
  name = '51Nod'
  platform: OjPlatform = '51nod'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 51Nod 题号: ${problemId}`)
    }

    logger.info('51nod_fetch_start', { action: '51nod_fetch', metadata: { problemId } })

    try {
      return await browserManager.withPage(
        { stealth: false, timeout: 60000 },
        (page) => this.fetchWithPage(page, problemId)
      )
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `51Nod 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `51Nod 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchWithPage(page: Page, problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)

    await page.goto(url, { waitUntil: 'networkidle', timeout: 50000 })

    // 等待题面加载（51Nod 是 AJAX 加载）
    await page.waitForSelector(
      '[class*="statement"], [class*="content"], [class*="problem"], article, main',
      { timeout: 15000 }
    ).catch(() => {})

    await page.waitForTimeout(3000)

    const result = await page.evaluate(() => {
      const selectors = [
        '.problem-statement',
        '.statement',
        '[class*="statement"]',
        '[class*="problem-content"]',
        '[class*="content"]',
        'article',
        'main',
      ]

      let el: Element | null = null
      for (const sel of selectors) {
        el = document.querySelector(sel)
        if (el && el.textContent?.trim()) break
      }

      if (!el) return { html: '', title: '', timeLimit: '', memoryLimit: '' }

      const title = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() || ''
      const tl = document.querySelector('[class*="time"], [class*="Time"]')?.textContent?.trim() || ''
      const ml = document.querySelector('[class*="memory"], [class*="Memory"]')?.textContent?.trim() || ''

      return { html: el.innerHTML, title, timeLimit: tl, memoryLimit: ml }
    })

    if (!result.html || result.html.length < 50) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `51Nod 题目不存在或无法解析: ${problemId}`)
    }

    const title = result.title || `Problem ${problemId}`
    const markdown = convertHtmlToMarkdown(result.html)
    const language = detectLanguage(markdown)

    logger.info('51nod_fetch_success', {
      action: '51nod_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      source: { platform: '51nod', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language,
        content: markdown,
        isVisible: true,
      }],
    }
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/Challenge/Problem.html#problemId=${problemId}`
  }
}
