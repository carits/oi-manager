/// <reference lib="dom" />
/**
 * TLX / TOKI (tlx.toki.id) 题目拉取适配器
 *
 * 需要 Playwright（SPA 页面，JS 渲染）。
 *
 * TLX 页面特点：
 * - React SPA，无公开 API
 * - URL 格式: https://tlx.toki.id/problems/{problemSlug}
 * - 题面在 JS 渲染后可见
 * - 支持 Bahasa Indonesia 和 English
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { browserManager } from '../lib/browser/manager'
import { convertHtmlToMarkdown, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://tlx.toki.id'

export class TlxAdapter implements OjAdapter {
  name = 'TLX'
  platform: OjPlatform = 'tlx'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 TLX 题号: ${problemId}`)
    }

    logger.info('tlx_fetch_start', { action: 'tlx_fetch', metadata: { problemId } })

    try {
      return await browserManager.withPage(
        { stealth: false, timeout: 60000 },
        (page) => this.fetchWithPage(page, problemId)
      )
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'TimeoutError' || e.message?.includes('Timeout')) {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `TLX 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `TLX 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchWithPage(page: Page, problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)

    await page.goto(url, { waitUntil: 'networkidle', timeout: 50000 })

    // 等待题面内容加载
    await page.waitForSelector('.problem-statement, .statement-card, [class*="problem"], [class*="statement"], article', {
      timeout: 15000
    }).catch(() => {})

    // 额外等待确保内容完全渲染
    await page.waitForTimeout(2000)

    // 提取题面 HTML
    const result = await page.evaluate(() => {
      // 尝试多种选择器找到题面内容
      const selectors = [
        '.problem-statement',
        '.statement-card',
        '[class*="problem-statement"]',
        '[class*="statement"]',
        'article',
        '.content',
        'main',
      ]

      let statementEl: Element | null = null
      for (const sel of selectors) {
        statementEl = document.querySelector(sel)
        if (statementEl) break
      }

      if (!statementEl) return { html: '', title: '' }

      const title = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() || ''

      return {
        html: statementEl.innerHTML,
        title,
      }
    })

    if (!result.html) {
      throw new OjFetchError(OjErrorCode.PARSE_ERROR, `TLX 未找到题面内容: ${problemId}`)
    }

    const title = result.title || `Problem ${problemId}`
    const markdown = convertHtmlToMarkdown(result.html)
    const language = detectLanguage(markdown)

    logger.info('tlx_fetch_success', {
      action: 'tlx_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      source: { platform: 'tlx', problemId, url },
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
    // TLX 使用 slug 格式（如 aplusb, tro-15-pengurangan）
    return /^[a-zA-Z0-9_-]+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problems/${problemId}`
  }
}
