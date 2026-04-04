/**
 * USACO (usaco.org) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * USACO 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 题面在 <span id="probtext-text" class="mathjax"> 内，已是 HTML 格式（含 MathJax $...$）
 * - 输入格式: <div class='prob-in-spec'>
 * - 输出格式: <div class='prob-out-spec'>
 * - 样例: <pre class='in'> / <pre class='out'>
 * - 题号用 cpid（contest problem id），不是传统题号
 * - 支持多语言（lang 参数）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { stripTags, unescapeHtml, convertHtmlToMarkdown, resolveRelativeUrls, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://usaco.org'

export class UsacoAdapter implements OjAdapter {
  name = 'USACO'
  platform: OjPlatform = 'usaco'

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 USACO 题号(cpid): ${problemId}`)
    }

    logger.info('usaco_fetch_start', { action: 'usaco_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/index.php?page=viewproblem2&cpid=${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `USACO 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `USACO HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      // 检测题目不存在
      if (!html.includes('probtext-text')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `USACO 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `USACO 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `USACO 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const markdown = this.convertToMarkdown(html)
    const language = detectLanguage(markdown)

    logger.info('usaco_fetch_success', {
      action: 'usaco_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      source: { platform: 'usaco', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language,
        content: markdown,
        isVisible: true,
      }],
    }
  }

  /** 提取标题 */
  private extractTitle(html: string, problemId: string): string {
    // USACO 页面有两个 <h2>: 比赛名 + 题目名
    const h2Matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    if (h2Matches.length >= 2) {
      // 第二个 h2 是题目名
      const contestName = stripTags(h2Matches[0][1]).trim()
      const problemName = stripTags(h2Matches[1][1]).trim()
      if (problemName) return problemName
    }
    if (h2Matches.length === 1) {
      const title = stripTags(h2Matches[0][1]).trim()
      if (title) return title
    }
    return `Problem ${problemId}`
  }

  /** 将 HTML 转为 Markdown */
  private convertToMarkdown(html: string): string {
    // 提取 <span id="probtext-text" class="mathjax"> 内的完整内容
    const textMatch = html.match(/<span\s+id="probtext-text"[^>]*>([\s\S]*?)<\/span>/i)
    if (!textMatch) return ''

    const contentHtml = textMatch[1]

    // 将相对 URL 转为绝对 URL（图片等资源）
    const resolvedHtml = resolveRelativeUrls(contentHtml, 'https://usaco.org')

    // USACO 题面已经是比较干净的 HTML，直接转为 Markdown
    // MathJax $...$ 公式已在 HTML 中，convertHtmlToMarkdown 会保护它们

    const md = convertHtmlToMarkdown(resolvedHtml)

    return md + '\n'
  }

  isValidProblemId(problemId: string): boolean {
    // USACO cpid 是纯数字
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/index.php?page=viewproblem2&cpid=${problemId}`
  }
}
