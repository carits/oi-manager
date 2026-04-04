/**
 * HDU (acm.hdu.edu.cn) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * HDU 页面特点：
 * - 服务端渲染 HTML，编码 GB2312
 * - 页面结构规律：div.panel_title + div.panel_content 分节
 * - 数学公式已用 $...$ LaTeX 格式（MathJax）
 * - 时限格式：Time Limit: 4000/2000 MS (Java/Others)
 * - 内存格式：Memory Limit: 131072/131072 K (Java/Others)
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { logger } from '../lib/logger'

const BASE_URL = 'https://acm.hdu.edu.cn'

export class HduAdapter implements OjAdapter {
  name = 'HDU'
  platform: OjPlatform = 'hdu'

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 HDU 题号: ${problemId}`)
    }

    logger.info('hdu_fetch_start', {
      action: 'hdu_fetch',
      metadata: { problemId }
    })

    try {
      const url = `${BASE_URL}/showproblem.php?pid=${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `HDU 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `HDU HTTP ${response.status}: ${problemId}`)
      }

      // GB2312 → UTF-8
      const buffer = await response.arrayBuffer()
      const html = new TextDecoder('gb2312').decode(buffer)

      // 检测无此题目（HDU 不返回 404，而是显示空页面）
      if (html.includes('No such problem') || !html.includes('panel_title')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `HDU 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `HDU 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `HDU 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    // 提取标题
    const title = this.extractTitle(html, problemId)

    // 提取时限和内存
    const { timeLimit, memoryLimit } = this.extractLimits(html)

    // 提取各节内容并转为 Markdown
    const markdown = this.convertToMarkdown(html)

    // 检测语言
    const language = this.detectLanguage(markdown)

    logger.info('hdu_fetch_success', {
      action: 'hdu_fetch',
      metadata: { problemId, title, contentLength: markdown.length, language }
    })

    return {
      title,
      description: markdown,
      timeLimit,
      memoryLimit,
      source: { platform: 'hdu', problemId, url },
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
    const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (match) {
      const title = this.stripTags(this.unescapeHtml(match[1].trim()))
      if (title) return title
    }
    return `Problem ${problemId}`
  }

  /** 提取时限和内存 */
  private extractLimits(html: string): { timeLimit?: number; memoryLimit?: number } {
    let timeLimit: number | undefined
    let memoryLimit: number | undefined

    // Time Limit: 4000/2000 MS (Java/Others)
    const timeMatch = html.match(/Time Limit:\s*(\d+)\/?\d*\s*MS/i)
    if (timeMatch) {
      timeLimit = parseInt(timeMatch[1])
    }

    // Memory Limit: 131072/131072 K (Java/Others)
    const memMatch = html.match(/Memory Limit:\s*(\d+)\/?\d*\s*K/i)
    if (memMatch) {
      memoryLimit = Math.round(parseInt(memMatch[1]) / 1024)
    }

    return { timeLimit, memoryLimit }
  }

  /** 将 HTML 转为 Markdown */
  private convertToMarkdown(html: string): string {
    // 提取所有 panel_title + panel_content 配对
    const sections: Array<{ title: string; content: string }> = []
    const regex = /<div\s+class=panel_title[^>]*>([\s\S]*?)<\/div>\s*<div\s+class=panel_content>([\s\S]*?)<\/div>/gi
    let match

    while ((match = regex.exec(html)) !== null) {
      const title = this.stripTags(match[1].trim())
      const content = match[2]
      sections.push({ title, content })
    }

    // 检测语言（基于所有内容文本）
    const allText = sections.map(s => this.stripTags(s.content)).join(' ')
    const isZh = this.detectLanguage(allText) === 'zh'

    // 转换为 Markdown
    const parts: string[] = []
    for (const section of sections) {
      const mdTitle = this.mapSectionTitle(section.title, isZh)
      const mdContent = this.convertSectionContent(section.title, section.content)

      if (mdContent.trim()) {
        parts.push(`## ${mdTitle}\n\n${mdContent}`)
      }
    }

    return parts.join('\n\n') + '\n'
  }

  /** 映射节标题（根据语言选择中文或英文标题） */
  private mapSectionTitle(title: string, isZh: boolean): string {
    if (isZh) {
      const map: Record<string, string> = {
        'Problem Description': '题目描述',
        'Input': '输入格式',
        'Output': '输出格式',
        'Sample Input': '样例输入',
        'Sample Output': '样例输出',
        'Hint': '提示',
        'Author': '作者',
        'Source': '来源',
      }
      return map[title] || title
    }
    // 英文题面保留原始英文标题
    return title
  }

  /** 转换节内容 */
  private convertSectionContent(title: string, content: string): string {
    // 样例输入/输出：提取 pre 内文本，转为代码块
    if (title === 'Sample Input' || title === 'Sample Output') {
      return this.convertSampleContent(content)
    }

    // 普通内容：HTML → Markdown
    return this.convertHtmlContent(content)
  }

  /** 转换样例内容 */
  private convertSampleContent(content: string): string {
    // 提取 <pre>...</pre> 或 <div style="font-family:Courier New..."> 内的文本
    let text = content

    // 先尝试提取 pre 内的 div 文本
    const preMatch = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
    if (preMatch) {
      text = preMatch[1]
    }

    // 剥掉内部 div
    text = this.stripTags(text)
    text = this.unescapeHtml(text).trim()

    return `\`\`\`\n${text}\n\`\`\``
  }

  /** 转换普通 HTML 内容为 Markdown */
  private convertHtmlContent(html: string): string {
    let md = html

    // 保护数学公式（$...$ 和 $$...$$）— 先替换为占位符
    const mathPlaceholders: string[] = []
    // 先保护 display math $$...$$
    md = md.replace(/\$\$([\s\S]*?)\$\$/g, (m) => {
      mathPlaceholders.push(m)
      return `\x00MATH${mathPlaceholders.length - 1}\x00`
    })
    // 再保护 inline math $...$
    md = md.replace(/\$([^\$]+?)\$/g, (m) => {
      mathPlaceholders.push(m)
      return `\x00MATH${mathPlaceholders.length - 1}\x00`
    })

    // 列表
    md = md.replace(/<li[^>]*>/gi, '- ')
    md = md.replace(/<\/li>/gi, '\n')
    md = md.replace(/<\/?[ou]l[^>]*>/gi, '\n')

    // 加粗/斜体
    md = md.replace(/<(strong|b)>([\s\S]*?)<\/(strong|b)>/gi, '**$2**')
    md = md.replace(/<(em|i)>([\s\S]*?)<\/(em|i)>/gi, '*$2*')

    // 行内代码
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')

    // 链接
    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')

    // 图片
    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*(?:\s+alt="([^"]*)")?[^>]*\/?>/gi, (_match, src, alt) => {
      const altText = alt || ''
      const fullSrc = src.startsWith('http') ? src : `${BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`
      return `![${altText}](${fullSrc})`
    })
    md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*\s+src="([^"]*)"[^>]*\/?>/gi, (_match, alt, src) => {
      const fullSrc = src.startsWith('http') ? src : `${BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`
      return `![${alt}](${fullSrc})`
    })

    // 换行
    md = md.replace(/<br\s*\/?>/gi, '\n')
    md = md.replace(/<\/p>/gi, '\n\n')
    md = md.replace(/<p[^>]*>/gi, '')

    // 段落 div → 换行
    md = md.replace(/<\/div>/gi, '\n')
    md = md.replace(/<div[^>]*>/gi, '\n')

    // 清理剩余标签
    md = this.stripTags(md)

    // HTML 实体解码
    md = this.unescapeHtml(md)

    // 还原数学公式
    md = md.replace(/\x00MATH(\d+)\x00/g, (_, idx) => {
      return mathPlaceholders[parseInt(idx)]
    })

    // 清理多余空行
    md = md.replace(/\r\n/g, '\n')
    md = md.replace(/\n{3,}/g, '\n\n')

    return md.trim()
  }

  /** 检测语言 */
  private detectLanguage(text: string): 'zh' | 'en' {
    const chineseChars = text.match(/[\u4e00-\u9fff]/g)
    const ratio = chineseChars ? chineseChars.length / text.length : 0
    return ratio > 0.05 ? 'zh' : 'en'
  }

  /** 去除 HTML 标签 */
  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '')
  }

  /** 解码 HTML 实体 */
  private unescapeHtml(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#0?3;/g, '')     // 控制字符
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => {
        const num = parseInt(code)
        if (num < 32 && num !== 10) return '' // 清除不可见控制字符
        return String.fromCharCode(num)
      })
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/showproblem.php?pid=${problemId}`
  }
}
