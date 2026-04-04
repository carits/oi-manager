/**
 * POJ (poj.org) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * POJ 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题: <div class="ptt">
 * - 时限/内存: <div class="plm"> 内 <b>Time Limit:</b> 1000MS / <b>Memory Limit:</b> 10000K
 * - 节: <p class="pst"> 标题 + <div class="ptx"> 内容 或 <pre class="sio"> 样例
 * - 支持中文（lang 参数切换）
 * - 老牌 OJ，HTML 结构简单规律
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { stripTags, unescapeHtml, convertHtmlToMarkdown, resolveRelativeUrls, convertSampleToCodeBlock, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'http://poj.org'

export class PojAdapter implements OjAdapter {
  name = 'POJ'
  platform: OjPlatform = 'poj'

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 POJ 题号: ${problemId}`)
    }

    logger.info('poj_fetch_start', { action: 'poj_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/problem?id=${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `POJ 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `POJ HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      // POJ 不返回 404，而是显示提示信息或无内容
      if (html.includes('No such problem') || !html.includes('class="ptt"')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `POJ 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `POJ 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `POJ 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits(html)
    const markdown = this.convertToMarkdown(html)
    const language = detectLanguage(markdown)

    logger.info('poj_fetch_success', {
      action: 'poj_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      timeLimit,
      memoryLimit,
      source: { platform: 'poj', problemId, url },
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
    const match = html.match(/<div\s+class="ptt"[^>]*>([\s\S]*?)<\/div>/i)
    if (match) {
      const title = stripTags(match[1].trim())
      if (title) return title
    }
    return `Problem ${problemId}`
  }

  /** 提取时限和内存 */
  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    let timeLimit: number | undefined
    let memoryLimit: number | undefined

    // <b>Time Limit:</b> 1000MS
    const timeMatch = html.match(/Time Limit:<\/b>\s*(\d+)\s*MS/i)
    if (timeMatch) {
      timeLimit = parseInt(timeMatch[1])
    }

    // <b>Memory Limit:</b> 10000K
    const memMatch = html.match(/Memory Limit:<\/b>\s*(\d+)\s*K/i)
    if (memMatch) {
      memoryLimit = Math.round(parseInt(memMatch[1]) / 1024)
    }

    return { timeLimit, memoryLimit }
  }

  /** 将 HTML 转为 Markdown */
  private convertToMarkdown(html: string): string {
    // 提取题目正文区域（<table border=0 ...> 内的最后一个 <td> 内容）
    // POJ 的题目内容在 class="ptt" 之后、</td></tr></table> 之前
    const contentStart = html.indexOf('class="ptt"')
    if (contentStart === -1) return ''

    // 找到题目区域的结束（Submit/Go Back 等链接之前）
    const contentEnd = html.indexOf('[<a href="submit?', contentStart)
    const contentHtml = contentEnd > 0 ? html.substring(contentStart, contentEnd) : html.substring(contentStart)

    // 提取所有 <p class="pst"> + 内容 配对
    const sections: Array<{ title: string; content: string }> = []

    // 匹配模式: <p class="pst">标题</p> 后面紧跟内容
    const sectionRegex = /<p\s+class="pst"[^>]*>([\s\S]*?)<\/p>\s*((?:(?:<div\s+class="ptx"[^>]*>[\s\S]*?<\/div>)|(?:<pre\s+class="sio"[^>]*>[\s\S]*?<\/pre>))+)/gi
    let match
    while ((match = sectionRegex.exec(contentHtml)) !== null) {
      const title = stripTags(match[1].trim())
      const content = match[2]
      sections.push({ title, content })
    }

    if (sections.length === 0) {
      // Fallback: 尝试更宽松的匹配
      const looseRegex = /<p\s+class="pst"[^>]*>([\s\S]*?)<\/p>/gi
      const titles: string[] = []
      let m
      while ((m = looseRegex.exec(contentHtml)) !== null) {
        titles.push(stripTags(m[1].trim()))
      }

      // 按标题分割内容
      for (let i = 0; i < titles.length; i++) {
        const startIdx = contentHtml.indexOf('</p>', contentHtml.indexOf(titles[i])) + 4
        const endIdx = i + 1 < titles.length
          ? contentHtml.indexOf('<p class="pst"', startIdx)
          : contentHtml.length
        const sectionContent = contentHtml.substring(startIdx, endIdx > 0 ? endIdx : contentHtml.length)
        sections.push({ title: titles[i], content: sectionContent.trim() })
      }
    }

    const allText = sections.map(s => stripTags(s.content)).join(' ')
    const isZh = detectLanguage(allText) === 'zh'

    const parts: string[] = []
    for (const section of sections) {
      const mdTitle = this.mapSectionTitle(section.title, isZh)
      let mdContent: string

      // 样例输入/输出用代码块
      if (section.title === 'Sample Input' || section.title === 'Sample Output') {
        mdContent = convertSampleToCodeBlock(section.content)
      } else {
        mdContent = convertHtmlToMarkdown(resolveRelativeUrls(section.content, BASE_URL))
      }

      if (mdContent.trim()) {
        parts.push(`## ${mdTitle}\n\n${mdContent}`)
      }
    }

    return parts.join('\n\n') + '\n'
  }

  /** 映射节标题 */
  private mapSectionTitle(title: string, isZh: boolean): string {
    if (isZh) {
      const map: Record<string, string> = {
        'Description': '题目描述',
        'Input': '输入格式',
        'Output': '输出格式',
        'Sample Input': '样例输入',
        'Sample Output': '样例输出',
        'Hint': '提示',
        'Source': '来源',
      }
      return map[title] || title
    }
    return title
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem?id=${problemId}`
  }
}
