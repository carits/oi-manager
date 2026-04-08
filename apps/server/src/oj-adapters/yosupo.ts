/// <reference lib="dom" />
/**
 * Yosupo / Library Checker (judge.yosupo.jp) 题目拉取适配器
 *
 * 需要 Playwright（Vue SPA）。
 *
 * Yosupo 页面特点：
 * - Vue SPA，题目以算法命名（如 aplusb, unionfind）
 * - URL 格式: https://judge.yosupo.jp/problem/{problemSlug}
 * - 题面在 JS 渲染后可见
 * - 日本 OJ，题目全英文
 * - Library Checker 类型的题目
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { browserManager } from '../lib/browser/manager'
import { convertHtmlToMarkdown, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://judge.yosupo.jp'

export class YosupoAdapter implements OjAdapter {
  name = 'Yosupo'
  platform: OjPlatform = 'yosupo'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 Yosupo 题号: ${problemId}`)
    }

    logger.info('yosupo_fetch_start', { action: 'yosupo_fetch', metadata: { problemId } })

    try {
      return await browserManager.withPage(
        { stealth: false, timeout: 60000 },
        (page) => this.fetchWithPage(page, problemId)
      )
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Yosupo 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchWithPage(page: Page, problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)

    await page.goto(url, { waitUntil: 'networkidle', timeout: 50000 })

    // 等待题面内容加载
    await page.waitForSelector(
      '[class*="statement"], [class*="problem"], [class*="content"], article, main',
      { timeout: 15000 }
    ).catch(() => {})

    await page.waitForTimeout(2000)

    const result = await page.evaluate(() => {
      const selectors = [
        '.statement',
        '.problem-statement',
        '[class*="statement"]',
        '[class*="problem"]',
        'article',
        'main',
        '#root',
      ]

      let el: Element | null = null
      for (const sel of selectors) {
        el = document.querySelector(sel)
        if (el && el.textContent?.trim()) break
      }

      if (!el) return { html: '', title: '', timeLimit: '', memoryLimit: '' }

      const title = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() || ''
      const tl = document.querySelector('[class*="time-limit"], [class*="timeLimit"], [class*="timelimit"]')?.textContent?.trim() || ''
      const ml = document.querySelector('[class*="memory-limit"], [class*="memoryLimit"], [class*="memorylimit"]')?.textContent?.trim() || ''

      return { html: el.innerHTML, title, timeLimit: tl, memoryLimit: ml }
    })

    if (!result.html || result.html.length < 50) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Yosupo 题目不存在或无法解析: ${problemId}`)
    }

    const title = result.title || `Problem ${problemId}`
    const markdown = convertHtmlToMarkdown(result.html)
    const language = detectLanguage(markdown)

    // 解析时限
    let timeLimit: number | undefined
    let memoryLimit: number | undefined
    const tlMatch = (result.timeLimit || markdown).match(/(\d+(?:\.\d+)?)\s*(?:sec|s|ms)/i)
    if (tlMatch) {
      const val = parseFloat(tlMatch[1])
      timeLimit = tlMatch[0].includes('ms') ? val : Math.round(val * 1000)
    }
    const mlMatch = (result.memoryLimit || markdown).match(/(\d+)\s*(?:MB|KB|GB|M)/i)
    if (mlMatch) {
      const val = parseInt(mlMatch[1])
      const unit = mlMatch[0].match(/(MB|KB|GB)/i)?.[1]?.toUpperCase()
      if (unit === 'KB') memoryLimit = Math.round(val / 1024)
      else if (unit === 'GB') memoryLimit = val * 1024
      else memoryLimit = val
    }

    logger.info('yosupo_fetch_success', {
      action: 'yosupo_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      timeLimit,
      memoryLimit,
      source: { platform: 'yosupo', problemId, url },
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
    // Yosupo 使用 slug 格式（如 aplusb, unionfind, lca）
    return /^[a-zA-Z0-9_-]+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem/${problemId}`
  }
}
