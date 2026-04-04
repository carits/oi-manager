/**
 * CSG OJ (csgoj.com) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * CSG 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题: <title>1316:部署基本环境</title>
 * - 题面: <div name="description" class="md_display_div"> 内
 * - 各节用 <div name="xxx" class="md_display_div"> 包裹
 * - 节标题: <h2 class="text-info bilingual-inline">题目描述<span class="en-text">Description</span></h2>
 * - 样例: <div name="Sample"> 内 <textarea id="sample_input/output_hidden">
 * - 题号格式: 纯数字（如 1316）
 * - URL: https://csgoj.com/problem/{pid}
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, stripTags, unescapeHtml, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://csgoj.com'

export class CsgAdapter implements OjAdapter {
  name = 'CSG'
  platform: OjPlatform = 'csg'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 CSG 题号: ${problemId}`)
    }

    logger.info('csg_fetch_start', { action: 'csg_fetch', metadata: { problemId } })

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
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `CSG 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `CSG HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      if (!html.includes('md_display_div')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `CSG 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `CSG 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `CSG 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const description = this.extractDescription(html)
    const language = detectLanguage(description)

    logger.info('csg_fetch_success', {
      action: 'csg_fetch',
      metadata: { problemId, title, contentLength: description.length, language }
    })

    return {
      title,
      description,
      source: { platform: 'csg', problemId, url },
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
    // <title>1316:部署基本环境</title>
    const m = html.match(/<title>\d+:([\s\S]*?)<\/title>/i)
    if (m) return m[1].trim()
    return `Problem ${problemId}`
  }

  private extractDescription(html: string): string {
    const parts: string[] = []

    // Extract all <div name="xxx" class="md_display_div"> sections
    const sectionRegex = /<div\s+name="(\w+)"\s+class="md_display_div">([\s\S]*?)<\/div>\s*(?=<div\s+name=|<hr|$)/gi
    let match
    while ((match = sectionRegex.exec(html)) !== null) {
      const sectionName = match[1].toLowerCase()
      const sectionHtml = match[2]

      // Extract section title
      const titleMatch = sectionHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
      const sectionTitle = titleMatch ? stripTags(titleMatch[1].replace(/<span\s+class="en-text">[\s\S]*?<\/span>/gi, '')).trim() : sectionName

      if (sectionName === 'sample') {
        // Handle samples separately
        const samples = this.extractSamples(sectionHtml)
        if (samples) parts.push(samples)
      } else if (sectionName === 'author' || sectionName === 'source') {
        // Skip author and source sections
        continue
      } else {
        // Regular content
        let contentHtml = sectionHtml.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '')
        const md = convertHtmlToMarkdown(resolveRelativeUrls(contentHtml, BASE_URL))
        if (md.trim()) {
          parts.push(`## ${sectionTitle}\n\n${md}`)
        }
      }
    }

    return parts.join('\n\n') + '\n'
  }

  private extractSamples(html: string): string {
    // <textarea id="sample_input_hidden" style="display: none;">...</textarea>
    // <textarea id="sample_output_hidden" style="display: none;">...</textarea>
    const inputMatch = html.match(/id="sample_input_hidden"[^>]*>([\s\S]*?)<\/textarea>/i)
    const outputMatch = html.match(/id="sample_output_hidden"[^>]*>([\s\S]*?)<\/textarea>/i)

    const parts: string[] = []
    if (inputMatch) {
      const input = unescapeHtml(inputMatch[1]).trim()
      if (input) parts.push(`## 样例输入\n\n\`\`\`\n${input}\n\`\`\``)
    }
    if (outputMatch) {
      const output = unescapeHtml(outputMatch[1]).trim()
      if (output) parts.push(`## 样例输出\n\n\`\`\`\n${output}\n\`\`\``)
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
