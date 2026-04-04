/**
 * Baekjoon Online Judge (BOJ) 题目拉取适配器
 *
 * 使用 Playwright + Stealth 模式，因为 acmicpc.net 对服务器 IP 有访问限制。
 *
 * Baekjoon 特点：
 * - AWS ELB 层 IP 封锁，服务器 IP 直接返回 403
 * - 需配置 BROWSER_PROXY 环境变量使用住宅代理
 * - URL: https://www.acmicpc.net/problem/{pid}
 * - 题号格式: 纯数字（如 1000, 1001）
 * - 标题: #problem_title
 * - 题面: #problem_description, #problem_input, #problem_output
 * - 时限: #problem-info 表格 "시간 제한" 行
 * - 内存: #problem-info 表格 "메모리 제한" 行
 * - 样例: #sample-input-{n}, #sample-output-{n}
 * - 图片: /problem/images/{pid}/ 路径
 * - 韩语为主，部分题目有英文翻译
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, detectLanguage } from './html-utils'
import { browserManager } from '../lib/browser/manager'
import { logger } from '../lib/logger'

const BASE_URL = 'https://www.acmicpc.net'

export class BaekjoonAdapter implements OjAdapter {
  name = 'Baekjoon'
  platform: OjPlatform = 'baekjoon'

  rateLimitConfig = {
    requestsPerSecond: 1,
    jitterRange: [0.5, 1.5] as [number, number],
    maxRetries: 3,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 Baekjoon 题号: ${problemId}`)
    }

    logger.info('baekjoon_fetch_start', { action: 'baekjoon_fetch', metadata: { problemId } })

    try {
      return await browserManager.withPage(
        { stealth: true, timeout: 60000 },
        (page) => this.fetchWithPage(page, problemId),
      )
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Baekjoon 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Baekjoon 拉取失败: ${e.message}`, e)
    }
  }

  private async fetchWithPage(page: Page, problemId: string): Promise<OjProblem> {
    const url = this.getProblemUrl(problemId)

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (!resp) {
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `Baekjoon 页面加载失败: ${problemId}`)
    }

    // IP blocked by AWS ELB
    if (resp.status() === 403) {
      throw new OjFetchError(
        OjErrorCode.SERVER_ERROR,
        `Baekjoon 拒绝访问（IP 被封锁），请配置 BROWSER_PROXY 环境变量: ${problemId}`,
      )
    }

    if (resp.status() === 404) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Baekjoon 题目不存在: ${problemId}`)
    }

    if (resp.status() >= 400) {
      throw new OjFetchError(OjErrorCode.SERVER_ERROR, `Baekjoon HTTP ${resp.status()}: ${problemId}`)
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    // 检查题目是否存在
    const hasTitle = await page.locator('#problem_title').count()
    if (hasTitle === 0) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `Baekjoon 题目不存在: ${problemId}`)
    }

    return this.extractProblem(page, problemId, url)
  }

  private async extractProblem(page: Page, problemId: string, url: string): Promise<OjProblem> {
    // 提取标题
    const title = await page.locator('#problem_title').first().textContent()
      .then(t => t?.trim() || `BOJ ${problemId}`)

    // 提取时限和内存限制
    const { timeLimit, memoryLimit } = await this.extractLimits(page)

    // 提取题面各节
    const description = await this.extractDescription(page)
    const language = detectLanguage(description)

    logger.info('baekjoon_fetch_success', {
      action: 'baekjoon_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language },
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'baekjoon', problemId, url },
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
    const text = await page.locator('#problem-info').first().textContent().catch(() => '')
    const info = text || ''

    // "시간 제한" (Korean: Time Limit) → "2 초" or "1000 ms"
    const timeMatch = info.match(/(?:시간\s*제한|Time\s*Limit)[^\d]*(\d+(?:\.\d+)?)\s*(초|s|ms)/i)
    let timeLimit: number | undefined
    if (timeMatch) {
      const value = parseFloat(timeMatch[1])
      const unit = timeMatch[2].toLowerCase()
      timeLimit = unit === 'ms' ? value : Math.round(value * 1000)
    }

    // "메모리 제한" (Korean: Memory Limit) → "128 MB"
    const memMatch = info.match(/(?:메모리\s*제한|Memory\s*Limit)[^\d]*(\d+)\s*(?:MB|MiB)/i)
    const memoryLimit = memMatch ? parseInt(memMatch[1]) : undefined

    return { timeLimit, memoryLimit }
  }

  private async extractDescription(page: Page): Promise<string> {
    const parts: string[] = []

    // 题目描述
    const descHtml = await page.locator('#problem_description').first().innerHTML().catch(() => '')
    if (descHtml) {
      const md = convertHtmlToMarkdown(resolveRelativeUrls(descHtml, BASE_URL)).trim()
      if (md) parts.push(md)
    }

    // 输入格式
    const inputHtml = await page.locator('#problem_input').first().innerHTML().catch(() => '')
    if (inputHtml) {
      const md = convertHtmlToMarkdown(resolveRelativeUrls(inputHtml, BASE_URL)).trim()
      if (md) parts.push('## Input\n\n' + md)
    }

    // 输出格式
    const outputHtml = await page.locator('#problem_output').first().innerHTML().catch(() => '')
    if (outputHtml) {
      const md = convertHtmlToMarkdown(resolveRelativeUrls(outputHtml, BASE_URL)).trim()
      if (md) parts.push('## Output\n\n' + md)
    }

    // 样例
    const sampleParts = await this.extractSamples(page)
    if (sampleParts) parts.push(sampleParts)

    // 提示
    const hintHtml = await page.locator('#problem_hint').first().innerHTML().catch(() => '')
    if (hintHtml) {
      const md = convertHtmlToMarkdown(resolveRelativeUrls(hintHtml, BASE_URL)).trim()
      if (md) parts.push('## Hint\n\n' + md)
    }

    return parts.join('\n\n')
  }

  private async extractSamples(page: Page): Promise<string> {
    const parts: string[] = []
    let idx = 1

    while (true) {
      const inputText = await page.locator(`#sample-input-${idx}`).first().textContent().catch(() => null)
      const outputText = await page.locator(`#sample-output-${idx}`).first().textContent().catch(() => null)

      if (!inputText && !outputText) break

      if (inputText !== null) {
        parts.push(`### Sample Input ${idx}\n\`\`\`\n${inputText.trim()}\n\`\`\``)
      }
      if (outputText !== null) {
        parts.push(`### Sample Output ${idx}\n\`\`\`\n${outputText.trim()}\n\`\`\``)
      }

      idx++
      if (idx > 20) break // safety limit
    }

    return parts.join('\n\n')
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem/${problemId}`
  }
}
