/**
 * URAL / Timus (acm.timus.ru) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * URAL 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题: <H2 class="problem_title"> → "1000. A+B Problem"
 * - 时限/内存: <DIV class="problem_limits"> → "Time limit: 1.0 second" / "Memory limit: 64 MB"
 * - 小节: <H3 CLASS="problem_subtitle"> → Input/Output/Sample/Notes
 * - 内容: <DIV CLASS="problem_par"> / <TABLE CLASS="sample">
 * - 来源: <DIV CLASS="problem_source">
 * - 支持 en/ru 两种语言
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { stripTags, unescapeHtml, convertHtmlToMarkdown, resolveRelativeUrls, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://acm.timus.ru'

export class UralAdapter implements OjAdapter {
  name = 'URAL'
  platform: OjPlatform = 'ural'

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 URAL 题号: ${problemId}`)
    }

    logger.info('ural_fetch_start', { action: 'ural_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/problem.aspx?space=1&num=${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `URAL 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `URAL HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      // 检测题目不存在
      if (!html.includes('problem_title') && !html.includes('problem_content')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `URAL 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `URAL 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `URAL 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)
    const markdown = this.convertToMarkdown(html)
    const language = detectLanguage(markdown)

    logger.info('ural_fetch_success', {
      action: 'ural_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      timeLimit,
      memoryLimit,
      source: { platform: 'ural', problemId, url },
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
    const match = html.match(/<H2\s+class="problem_title"[^>]*>([\s\S]*?)<\/H2>/i)
    if (match) {
      let title = stripTags(match[1].trim())
      // 去掉题号前缀（如 "1000. "）
      title = title.replace(/^\d+\.\s*/, '')
      if (title) return title
    }
    return `Problem ${problemId}`
  }

  /** 提取时限和内存 */
  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    let timeLimit: number | undefined
    let memoryLimit: number | undefined

    // Time limit: 1.0 second
    const timeMatch = html.match(/Time limit:\s*([\d.]+)\s*second/i)
    if (timeMatch) {
      timeLimit = Math.round(parseFloat(timeMatch[1]) * 1000)
    }

    // Memory limit: 64 MB
    const memMatch = html.match(/Memory limit:\s*(\d+)\s*MB/i)
    if (memMatch) {
      memoryLimit = parseInt(memMatch[1])
    }

    return { timeLimit, memoryLimit }
  }

  /** 将 HTML 转为 Markdown */
  private convertToMarkdown(html: string): string {
    // 从整个 HTML 中提取 problem_text 区域（不依赖嵌套 DIV 匹配）
    const textStart = html.indexOf('ID="problem_text"')
    const textEnd = html.indexOf('CLASS="problem_source"', textStart)
    const textHtml = textStart >= 0
      ? html.substring(textStart, textEnd > textStart ? textEnd : html.length)
      : html

    const parts: string[] = []

    // 提取标题前的描述内容（problem_text 开头到第一个 H3 之间）
    const firstH3 = textHtml.indexOf('<H3')
    if (firstH3 > 0) {
      const beforeH3 = textHtml.substring(0, firstH3)
      // 移除 problem_text 的开 DIV 标签
      const descHtml = beforeH3.replace(/^[^>]*>/, '').trim()
      if (descHtml) {
        const desc = convertHtmlToMarkdown(resolveRelativeUrls(descHtml, BASE_URL))
        if (desc) parts.push(`## Description\n\n${desc}`)
      }
    }

    // 提取各小节：H3 subtitle + 后续的 problem_par 或 sample 表格
    // 策略：按 H3 标题分段，每段提取 DIV.problem_par 或 TABLE.sample
    const sections = textHtml.split(/<H3\s+CLASS="problem_subtitle"[^>]*>/i)
    for (let i = 1; i < sections.length; i++) {
      const section = sections[i]
      const titleEnd = section.indexOf('</H3>')
      if (titleEnd < 0) continue
      const sectionTitle = stripTags(section.substring(0, titleEnd).trim())
      const sectionBody = section.substring(titleEnd + 5)

      let mdContent: string
      if (sectionTitle === 'Sample') {
        mdContent = this.convertSampleTable(sectionBody)
      } else {
        mdContent = convertHtmlToMarkdown(resolveRelativeUrls(sectionBody, BASE_URL))
      }

      if (mdContent.trim()) {
        parts.push(`## ${sectionTitle}\n\n${mdContent}`)
      }
    }

    // 提取来源信息
    const sourceMatch = html.match(/<DIV\s+CLASS="problem_source">([\s\S]*?)<\/DIV>/i)
    if (sourceMatch) {
      const sourceText = convertHtmlToMarkdown(resolveRelativeUrls(sourceMatch[1], BASE_URL))
      if (sourceText.trim()) {
        parts.push(`## Source\n\n${sourceText}`)
      }
    }

    return parts.join('\n\n') + '\n'
  }

  /** 转换 URAL 样例表格（TABLE.sample）为 Markdown */
  private convertSampleTable(html: string): string {
    // 提取表格中的 input/output
    const inputMatch = html.match(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)
    if (!inputMatch || inputMatch.length < 2) {
      // Fallback: 直接提取 pre 内容
      const preMatches = [...html.matchAll(/<PRE[^>]*>([\s\S]*?)<\/PRE>/gi)]
      if (preMatches.length >= 2) {
        const input = unescapeHtml(stripTags(preMatches[0][1])).trim()
        const output = unescapeHtml(stripTags(preMatches[1][1])).trim()
        return `**Input:**\n\`\`\`\n${input}\n\`\`\`\n\n**Output:**\n\`\`\`\n${output}\n\`\`\``
      }
      // 最后 fallback
      return convertHtmlToMarkdown(resolveRelativeUrls(html, BASE_URL))
    }

    // 从表格提取
    const input = unescapeHtml(stripTags(inputMatch[0])).trim()
    const output = unescapeHtml(stripTags(inputMatch[1])).trim()

    return `**Input:**\n\`\`\`\n${input}\n\`\`\`\n\n**Output:**\n\`\`\`\n${output}\n\`\`\``
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem.aspx?space=1&num=${problemId}`
  }
}
