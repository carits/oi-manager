/**
 * UOJ (Universal Online Judge / uoj.ac) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * UOJ 页面特点：
 * - 服务端渲染 HTML（PHP），编码 UTF-8
 * - 标题: <title>A + B Problem - 题目 - Universal Online Judge</title>
 * - 时限/内存: 在 <article class="uoj-article"> 内 <p><strong>时间限制</strong>：$1\texttt{s}$</p>
 * - 题面: <article class="uoj-article"> 内，标准 HTML（<h3>, <h4>, <pre>, <p>）
 * - 数学公式: MathJax $...$ 格式
 * - 样例: <h4>input</h4> + <pre>, <h4>output</h4> + <pre>
 * - 题号格式: 纯数字（如 1, 2, 3）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, stripTags, unescapeHtml, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://uoj.ac'

export class UojAdapter implements OjAdapter {
  name = 'UOJ'
  platform: OjPlatform = 'uoj'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 UOJ 题号: ${problemId}`)
    }

    logger.info('uoj_fetch_start', { action: 'uoj_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/problem/${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `UOJ 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `UOJ HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      if (!html.includes('uoj-article') && !html.includes('tab-statement')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `UOJ 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `UOJ 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `UOJ 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)
    const description = this.extractDescription(html, problemId)
    const language = detectLanguage(description)

    logger.info('uoj_fetch_success', {
      action: 'uoj_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'uoj', problemId, url },
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
    // <title>A + B Problem - 题目 - Universal Online Judge</title>
    const m = html.match(/<title>([\s\S]*?)\s*-\s*题目\s*-\s*Universal Online Judge/i)
    if (m) return m[1].trim()
    // fallback: <title>... - Universal Online Judge</title>
    const m2 = html.match(/<title>([\s\S]*?)\s*-\s*Universal Online Judge/i)
    if (m2) return m2[1].trim()
    return `Problem ${problemId}`
  }

  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    let timeLimit: number | undefined
    let memoryLimit: number | undefined

    // UOJ format: <strong>时间限制</strong>：$1\texttt{s}$</p>
    // The \texttt{...} LaTeX wrapper sits between the number and the unit,
    // so we just extract the number after the label and assume seconds.
    const timeMatch = html.match(/(?:时间限制|Time\s*Limit)[^\d]*(\d+(?:\.\d+)?)/i)
    if (timeMatch) {
      timeLimit = Math.round(parseFloat(timeMatch[1]) * 1000)
    }

    // <strong>空间限制</strong>：$256\texttt{MB}$</p>
    const memMatch = html.match(/(?:空间限制|Memory\s*Limit)[^\d]*(\d+)/i)
    if (memMatch) memoryLimit = parseInt(memMatch[1])

    return { timeLimit, memoryLimit }
  }

  private extractDescription(html: string, problemId: string): string {
    // <article class="uoj-article">...</article>
    const m = html.match(/<article\s+class="uoj-article[^"]*">([\s\S]*?)<\/article>/i)
    if (!m) return `> 请在原平台查看: ${this.getProblemUrl(problemId)}`

    let content = m[1]

    // Remove "限制与约定" section (time/memory limits already extracted)
    content = content.replace(/<h3>\s*限制与约定[\s\S]*?(?=<h3|<\/article|$)/gi, '')

    // Remove "下载" section
    content = content.replace(/<h3>\s*下载[\s\S]*?(?=<h3|<\/article|$)/gi, '')

    // Clean up LaTeX \texttt{...} — convert to plain text
    content = content.replace(/\\texttt\{([^}]*)\}/g, '$1')

    return convertHtmlToMarkdown(resolveRelativeUrls(content, BASE_URL)).trim()
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem/${problemId}`
  }
}
