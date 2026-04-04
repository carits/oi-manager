/**
 * EOlymp (eolymp.com) 题目拉取适配器
 *
 * 使用 Playwright，因为 EOlymp 是 Next.js SPA，
 * 样例输入输出等内容需要客户端 JS 渲染。
 *
 * EOlymp 特点：
 * - URL: https://www.eolymp.com/en/problems/{pid}（英文）或 /uk/problems/{pid}（乌克兰语）
 * - 题号格式: 纯数字（如 19, 45, 283）
 * - Next.js SPA，服务端渲染提供基础内容，样例需要 JS 执行
 * - 标题: <meta og:title> 或页面 <h1>
 * - 题面: 页面主内容区域，含描述、输入、输出、样例
 * - 时限: "Execution time limit is 1 second"
 * - 内存: "Runtime memory usage limit is 64 megabytes"
 * - 图片: static.e-olymp.com, eolympusercontent.com
 * - 无 Cloudflare 或反爬保护
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, detectLanguage } from './html-utils'
import { browserManager } from '../lib/browser/manager'
import { logger } from '../lib/logger'

const BASE_URL = 'https://www.eolymp.com'

export class EolympAdapter implements OjAdapter {
  name = 'EOlymp'
  platform: OjPlatform = 'eolymp'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 EOlymp 题号: ${problemId}`)
    }

    logger.info('eolymp_fetch_start', { action: 'eolymp_fetch', metadata: { problemId } })

    try {
      return await browserManager.withPage(
        { stealth: true, timeout: 60000 },
        (page) => this.fetchWithPage(page, problemId),
      )
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `EOlymp 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `EOlymp 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchWithPage(page: Page, problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (!resp) {
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `EOlymp 页面加载失败: ${problemId}`)
    }

    if (resp.status() === 404) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `EOlymp 题目不存在: ${problemId}`)
    }
    if (resp.status() >= 400) {
      throw new OjFetchError(OjErrorCode.SERVER_ERROR, `EOlymp HTTP ${resp.status()}: ${problemId}`)
    }

    // 等待内容渲染
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})

    return this.extractProblem(page, problemId, url)
  }

  private async extractProblem(page: Page, problemId: string, url: string): Promise<OjProblem> {
    // 提取标题 — 从 og:title meta 或 h1
    const title = await page.locator('meta[property="og:title"]').first().getAttribute('content')
      .then(t => t?.trim())
      .catch(() => null)
      || await page.locator('h1').first().textContent()
        .then(t => t?.trim() || `EOlymp ${problemId}`)
        .catch(() => `EOlymp ${problemId}`)

    // 提取时限和内存限制
    const { timeLimit, memoryLimit } = await this.extractLimits(page)

    // 提取题面 — 等主要内容区域加载
    const description = await this.extractDescription(page, problemId)
    const language = detectLanguage(description)

    logger.info('eolymp_fetch_success', {
      action: 'eolymp_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language },
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'eolymp', problemId, url },
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

    // "Execution time limit is 1 second" or "time limit 1.0 s"
    const timeMatch = fullText.match(/(?:execution\s+)?time\s*limit[^.]*?(\d+(?:\.\d+)?)\s*(?:second|sec|s)/i)
    let timeLimit: number | undefined
    if (timeMatch) {
      timeLimit = Math.round(parseFloat(timeMatch[1]) * 1000)
    }

    // "Runtime memory usage limit is 64 megabytes"
    const memMatch = fullText.match(/(?:runtime\s+)?memory[^.]*?(\d+)\s*(?:megabyte|MB|MiB)/i)
    const memoryLimit = memMatch ? parseInt(memMatch[1]) : undefined

    return { timeLimit, memoryLimit }
  }

  private async extractDescription(page: Page, problemId: string): Promise<string> {
    // EOlymp 内容在主区域，尝试多种选择器
    const selectors = [
      'article',
      '[class*="problem"]',
      '[class*="statement"]',
      '[class*="content"]',
      'main',
    ]

    for (const sel of selectors) {
      const el = page.locator(sel).first()
      const count = await el.count()
      if (count > 0) {
        const text = await el.textContent().catch(() => '')
        if (text && text.trim().length > 100) {
          const html = await el.innerHTML().catch(() => '')
          if (html) {
            const md = convertHtmlToMarkdown(resolveRelativeUrls(html, BASE_URL)).trim()
            if (md.length > 50) return md
          }
        }
      }
    }

    // 兜底: 提取 og:description
    const ogDesc = await page.locator('meta[property="og:description"]').first().getAttribute('content')
      .catch(() => null)
    if (ogDesc && ogDesc.trim().length > 20) {
      return ogDesc.trim()
    }

    return `> 无法提取题面内容，请在原平台查看: ${this.getProblemUrl(problemId)}`
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/en/problems/${problemId}`
  }
}
