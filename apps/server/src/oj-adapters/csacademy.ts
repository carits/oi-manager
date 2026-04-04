/**
 * CSAcademy (csacademy.com) 题目拉取适配器
 *
 * 需要 Playwright（React SPA）。
 *
 * CSAcademy 页面特点：
 * - React SPA
 * - URL 格式: https://csacademy.com/contest/archive/task/{taskSlug}/
 * - 题面在 JS 渲染后可见
 * - 部分题目有 Editorials
 * - 罗马尼亚 OJ
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { browserManager } from '../lib/browser/manager'
import { convertHtmlToMarkdown, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://csacademy.com'

export class CsacademyAdapter implements OjAdapter {
  name = 'CSAcademy'
  platform: OjPlatform = 'csacademy'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 CSAcademy 题号: ${problemId}`)
    }

    logger.info('csacademy_fetch_start', { action: 'csacademy_fetch', metadata: { problemId } })

    try {
      return await browserManager.withPage(
        { stealth: false, timeout: 60000 },
        (page) => this.fetchWithPage(page, problemId)
      )
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `CSAcademy 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `CSAcademy 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchWithPage(page: Page, problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)

    await page.goto(url, { waitUntil: 'networkidle', timeout: 50000 })

    // 等待题面加载
    await page.waitForSelector(
      '[class*="statement"], [class*="task"], [class*="problem"], article, main',
      { timeout: 15000 }
    ).catch(() => {})

    await page.waitForTimeout(2000)

    const result = await page.evaluate(() => {
      const selectors = [
        '.task-statement',
        '.statement',
        '[class*="statement"]',
        '[class*="task-content"]',
        '[class*="problem"]',
        'article',
        'main',
      ]

      let el: Element | null = null
      for (const sel of selectors) {
        el = document.querySelector(sel)
        if (el && el.textContent?.trim()) break
      }

      if (!el) return { html: '', title: '' }

      const title = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() || ''

      return { html: el.innerHTML, title }
    })

    if (!result.html || result.html.length < 50) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `CSAcademy 题目不存在或无法解析: ${problemId}`)
    }

    const title = result.title || `Problem ${problemId}`
    const markdown = convertHtmlToMarkdown(result.html)
    const language = detectLanguage(markdown)

    logger.info('csacademy_fetch_success', {
      action: 'csacademy_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      source: { platform: 'csacademy', problemId, url },
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
    // CSAcademy 使用 slug 格式（如 min-distances, aplusb）
    return /^[a-zA-Z0-9_-]+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/contest/archive/task/${problemId}/`
  }
}
