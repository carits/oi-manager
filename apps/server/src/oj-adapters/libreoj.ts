/**
 * LibreOJ (loj.ac) 题目拉取适配器
 *
 * 需要 Playwright（SPA 页面，JS 渲染）。
 *
 * LibreOJ 页面特点：
 * - Vue/React SPA，无公开 API
 * - URL 格式: https://loj.ac/problem/{problemId}
 * - 中文 OJ，社区维护
 * - 支持 LaTeX 数学公式
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { browserManager } from '../lib/browser/manager'
import { convertHtmlToMarkdown, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://loj.ac'

export class LibreojAdapter implements OjAdapter {
  name = 'LibreOJ'
  platform: OjPlatform = 'libreoj'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 LibreOJ 题号: ${problemId}`)
    }

    logger.info('libreoj_fetch_start', { action: 'libreoj_fetch', metadata: { problemId } })

    try {
      return await browserManager.withPage(
        { stealth: false, timeout: 60000 },
        (page) => this.fetchWithPage(page, problemId)
      )
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `LibreOJ 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `LibreOJ 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchWithPage(page: Page, problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)

    await page.goto(url, { waitUntil: 'networkidle', timeout: 50000 })

    // 等待题面加载
    await page.waitForSelector(
      '.problem-content, [class*="statement"], [class*="content"], article, main',
      { timeout: 15000 }
    ).catch(() => {})

    await page.waitForTimeout(2000)

    const result = await page.evaluate(() => {
      const selectors = [
        '.problem-content',
        '.problem-statement',
        '[class*="problem-content"]',
        '[class*="statement"]',
        'article',
        'main',
      ]

      let el: Element | null = null
      for (const sel of selectors) {
        el = document.querySelector(sel)
        if (el) break
      }

      if (!el) return { html: '', title: '', timeLimit: '', memoryLimit: '' }

      const title = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() || ''
      const tl = document.querySelector('[class*="time-limit"], [class*="timeLimit"]')?.textContent?.trim() || ''
      const ml = document.querySelector('[class*="memory-limit"], [class*="memoryLimit"]')?.textContent?.trim() || ''

      return { html: el.innerHTML, title, timeLimit: tl, memoryLimit: ml }
    })

    if (!result.html) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `LibreOJ 题目不存在或无法解析: ${problemId}`)
    }

    const title = result.title || `Problem ${problemId}`
    const markdown = convertHtmlToMarkdown(result.html)
    const language = detectLanguage(markdown)

    // 解析时限
    let timeLimit: number | undefined
    let memoryLimit: number | undefined
    const tlMatch = (result.timeLimit || '').match(/(\d+)\s*(?:ms|sec|s)/i)
    if (tlMatch) timeLimit = parseInt(tlMatch[1])
    const mlMatch = (result.memoryLimit || '').match(/(\d+)\s*(?:MB|KB|GB)/i)
    if (mlMatch) {
      const val = parseInt(mlMatch[1])
      const unit = mlMatch[0].match(/(MB|KB|GB)/i)?.[1]?.toUpperCase()
      if (unit === 'KB') memoryLimit = Math.round(val / 1024)
      else if (unit === 'GB') memoryLimit = val * 1024
      else memoryLimit = val
    }

    logger.info('libreoj_fetch_success', {
      action: 'libreoj_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      timeLimit,
      memoryLimit,
      source: { platform: 'libreoj', problemId, url },
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
    return `${BASE_URL}/problem/${problemId}`
  }
}
