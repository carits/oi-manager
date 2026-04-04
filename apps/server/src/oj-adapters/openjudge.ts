/**
 * OpenJudge (openjudge.cn) 题目拉取适配器 — 基类
 *
 * 百炼 / NOI / POJ 三个子站共享相同的 HTML 结构，仅 BASE_URL 和路径模板不同。
 *
 * OpenJudge 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题: <title> 内，格式 "OpenJudge - 1000:A+B Problem"
 * - 时限/内存: <dl class="problem-info"> 内 <dt>时间限制:</dt><dd>1000ms</dd>
 * - 题面: <dl class="problem-content"> 内，用 <dt>标题</dt><dd>内容</dd> 配对
 * - 样例: <dd><pre>...</pre></dd>
 * - 题号格式: 纯数字（百炼/POJ）或 section/number（NOI）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, stripTags, unescapeHtml, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

/**
 * OpenJudge 适配器基类
 * 百炼、NOI、POJ 三个子站共享同一套 HTML 解析逻辑
 */
export abstract class OpenjudgeBaseAdapter implements OjAdapter {
  abstract name: string
  abstract platform: OjPlatform
  abstract baseUrl: string
  abstract urlTemplate: string  // e.g. '/practice/{pid}/' or '/{pid}/'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 ${this.name} 题号: ${problemId}`)
    }

    logger.info('openjudge_fetch_start', { action: 'openjudge_fetch', metadata: { platform: this.platform, problemId } })

    try {
      const url = this.getProblemUrl(problemId)
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `${this.name} 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `${this.name} HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      if (!html.includes('problem-content') && !html.includes('subject-describe')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `${this.name} 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `${this.name} 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `${this.name} 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)
    const description = this.extractDescription(html)
    const language = detectLanguage(description)

    logger.info('openjudge_fetch_success', {
      action: 'openjudge_fetch',
      metadata: { platform: this.platform, problemId, title, contentLength: description.length, timeLimit, memoryLimit, language }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: this.platform, problemId, url },
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
    const m = html.match(/<title>[^<]*-\s*\d+:([\s\S]*?)<\/title>/i)
    if (m) return unescapeHtml(m[1].trim())
    return `Problem ${problemId}`
  }

  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    const timeMatch = html.match(/(?:时间限制|Time Limit)[^<]*<\/dt>\s*<dd>(\d+)\s*ms/i)
    const timeLimit = timeMatch ? parseInt(timeMatch[1]) : undefined

    const memMatch = html.match(/(?:内存限制|Memory Limit)[^<]*<\/dt>\s*<dd>(\d+)\s*k?b/i)
    const memoryLimit = memMatch ? Math.round(parseInt(memMatch[1]) / 1024) : undefined

    return { timeLimit, memoryLimit }
  }

  private extractDescription(html: string): string {
    const m = html.match(/<dl\s+class="problem-content">([\s\S]*?)<\/dl>/i)
    if (!m) return ''

    const contentHtml = m[1]
    const parts: string[] = []

    // Extract <dt>/<dd> pairs
    const dtRegex = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi
    let match
    while ((match = dtRegex.exec(contentHtml)) !== null) {
      const sectionTitle = stripTags(match[1]).trim()
      const sectionContent = match[2]

      const mdTitle = this.mapSectionTitle(sectionTitle)

      // 样例输入/输出用代码块
      if (sectionTitle === '样例输入' || sectionTitle === '样例输出' ||
          sectionTitle.toLowerCase() === 'sample input' || sectionTitle.toLowerCase() === 'sample output') {
        const preText = this.extractPreText(sectionContent)
        parts.push(`## ${mdTitle}\n\n\`\`\`\n${preText}\n\`\`\``)
      } else {
        const md = convertHtmlToMarkdown(resolveRelativeUrls(sectionContent, this.baseUrl))
        if (md.trim()) {
          parts.push(`## ${mdTitle}\n\n${md}`)
        }
      }
    }

    return parts.join('\n\n') + '\n'
  }

  private mapSectionTitle(title: string): string {
    const map: Record<string, string> = {
      '描述': '题目描述',
      '输入': '输入格式',
      '输出': '输出格式',
      '样例输入': '样例输入',
      '样例输出': '样例输出',
      '提示': '提示',
      '来源': '来源',
    }
    return map[title] || title
  }

  private extractPreText(html: string): string {
    const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
    if (m) return unescapeHtml(stripTags(m[1])).trim()
    return unescapeHtml(stripTags(html)).trim()
  }

  abstract isValidProblemId(problemId: string): boolean

  getProblemUrl(problemId: string): string {
    const path = this.urlTemplate.replace('{pid}', problemId)
    return `${this.baseUrl}${path}`
  }
}
