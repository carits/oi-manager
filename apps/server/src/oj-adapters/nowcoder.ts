/**
 * 牛客 NowCoder (ac.nowcoder.com) 题目拉取适配器
 *
 * 纯 HTTP + Cheerio 实现，不需要 Playwright。
 *
 * NowCoder 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题: <div class="subject-item-title"> 或 <title> 内
 * - 时限/内存: <span>时间限制：...</span> <span>空间限制：...</span>
 * - 题面主体: <div class="subject-describe"> 内
 * - OI 题样例: <div class="question-oi"> 内 <textarea data-clipboard-text-id>
 * - 普通题样例: <h2>样例输入</h2> + <pre>
 * - 题号格式: 纯数字（如 14965）
 * - URL: https://ac.nowcoder.com/acm/problem/{pid}
 */

import * as cheerio from 'cheerio'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, stripTags, unescapeHtml, detectLanguage } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://ac.nowcoder.com'

/**
 * NowCoder 用 <img src="https://(www|hr).nowcoder.com/equation?tex=..." alt="...">
 * 表示行内 LaTeX 公式。在 HTML→Markdown 之前，先把这些 img 替换为 $...$。
 *
 * alt 属性可能为空或缺失，此时从 URL 的 tex 参数提取并 URL-decode。
 */
function replaceEquationImages(html: string): string {
  return html.replace(
    /<img\s[^>]*>/gi,
    (tag: string) => {
      // 检查是否是 equation 图片
      const srcMatch = tag.match(/src="([^"]*nowcoder\.com\/equation\?tex=([^"]*))"/i)
        || tag.match(/src='([^']*nowcoder\.com\/equation\?tex=([^']*))'/i)
      if (!srcMatch) return tag

      // 优先用 alt（非空时）
      const altMatch = tag.match(/alt="([^"]*)"/i) || tag.match(/alt='([^']*)'/i)
      const alt = altMatch ? altMatch[1].trim() : ''

      if (alt) return `$${alt}$`

      // alt 为空时，从 tex 参数 URL-decode 获取
      try {
        const texEncoded = srcMatch[2]
        const tex = decodeURIComponent(texEncoded)
        return `$${tex}$`
      } catch {
        return tag
      }
    }
  )
}

export class NowcoderAdapter implements OjAdapter {
  name = 'NowCoder'
  platform: OjPlatform = 'nowcoder'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 NowCoder 题号: ${problemId}`)
    }

    logger.info('nowcoder_fetch_start', { action: 'nowcoder_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/acm/problem/${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `NowCoder 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `NowCoder HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      if (!html.includes('subject-describe') && !html.includes('subject-question')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `NowCoder 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `NowCoder 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `NowCoder 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const $ = cheerio.load(html)

    const title = this.extractTitle($, problemId)
    const { timeLimit, memoryLimit } = this.extractLimits($)
    const description = this.extractDescription($)
    const language = detectLanguage(description)

    logger.info('nowcoder_fetch_success', {
      action: 'nowcoder_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, language }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'nowcoder', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language,
        content: description,
        isVisible: true,
      }],
    }
  }

  private extractTitle($: cheerio.CheerioAPI, problemId: string): string {
    // 方法 1: <title> 标签 — "牛客竞赛-xxx题解..."
    const titleText = $('title').text()
    const titleMatch = titleText.match(/牛客竞赛[^\-]*-\s*([\s\S]*?)(?:题解|_牛客|$)/i)
    if (titleMatch && titleMatch[1].trim()) return titleMatch[1].trim()

    // 方法 2: terminal-topic-title
    const topicText = $('.terminal-topic-title').text().trim()
    if (topicText) return topicText

    return `Problem ${problemId}`
  }

  private extractLimits($: cheerio.CheerioAPI): { timeLimit?: number; memoryLimit?: number } {
    // 从页面中找 "时间限制：C/C++ 1秒" 这样的文本
    const limitText = $('span, div').text()

    const timeMatch = limitText.match(/时间限制[：:]\s*C\/C\+\+\s*(\d+)\s*秒/i)
      || limitText.match(/时间限制[：:][^<]*(\d+)\s*[秒s]/i)
    const timeLimit = timeMatch ? parseInt(timeMatch[1]) * 1000 : undefined

    const memMatch = limitText.match(/空间限制[：:][^<]*(\d+)\s*M/i)
    const memoryLimit = memMatch ? parseInt(memMatch[1]) : undefined

    return { timeLimit, memoryLimit }
  }

  private extractDescription($: cheerio.CheerioAPI): string {
    const parts: string[] = []

    // 1. 题目描述: <div class="subject-question">
    const questionEl = $('.subject-question')
    if (questionEl.length) {
      const html = replaceEquationImages(questionEl.html() || '')
      const md = convertHtmlToMarkdown(resolveRelativeUrls(html, BASE_URL))
      if (md.trim()) parts.push(`## 题目描述\n\n${md}`)
    }

    // 2. 输入描述: 在 subject-describe 中找 h2 标签
    const inputSection = this.extractSection($, '输入描述')
    if (inputSection) parts.push(`## 输入格式\n\n${inputSection}`)

    // 3. 输出描述
    const outputSection = this.extractSection($, '输出描述')
    if (outputSection) parts.push(`## 输出格式\n\n${outputSection}`)

    // 4. 样例: 优先从 textarea 提取（OI 题），否则从 pre 提取
    const samples = this.extractSamples($)
    if (samples) parts.push(samples)

    // 5. 备注/提示
    const noteSection = this.extractSection($, '备注')
    if (noteSection) parts.push(`## 提示\n\n${noteSection}`)

    return parts.join('\n\n') + '\n'
  }

  /**
   * 从 subject-describe 中提取指定 h2 标签后的内容
   */
  private extractSection($: cheerio.CheerioAPI, heading: string): string {
    const container = $('.subject-describe')
    if (!container.length) return ''

    // 找到包含目标文字的 h2
    const headings = container.find('h2')
    let targetHeading: any = null

    headings.each((_, el) => {
      const text = $(el).text().trim()
      if (text.startsWith(heading)) {
        targetHeading = el
        return false // break
      }
    })

    if (!targetHeading) return ''

    // 收集 h2 后面、下一个 h2 或 question-oi 之前的所有兄弟元素
    const contentParts: string[] = []
    let sibling = $(targetHeading).next()

    while (sibling.length) {
      const tagName = sibling.prop('tagName')?.toLowerCase()
      // 遇到下一个 h2 或 question-oi 就停止
      if (tagName === 'h2') break
      if (sibling.hasClass('question-oi')) break

      let html = replaceEquationImages(sibling.html() || '')
      if (html) {
        const md = convertHtmlToMarkdown(resolveRelativeUrls(html, BASE_URL))
        if (md.trim()) contentParts.push(md.trim())
      }

      sibling = sibling.next()
    }

    return contentParts.join('\n\n')
  }

  /**
   * 提取样例输入/输出
   * NowCoder 有两种样例格式：
   * - OI 题: <textarea data-clipboard-text-id="input1/output1">
   * - 普通题: <h2>样例输入</h2> + <pre>
   */
  private extractSamples($: cheerio.CheerioAPI): string {
    const parts: string[] = []

    // 方法 1: 从 textarea data-clipboard-text-id 提取（OI 题格式）
    const inputAreas = $('textarea[data-clipboard-text-id^="input"]')
    const outputAreas = $('textarea[data-clipboard-text-id^="output"]')

    if (inputAreas.length > 0 || outputAreas.length > 0) {
      const inputs: string[] = []
      const outputs: string[] = []

      inputAreas.each((_, el) => {
        inputs.push(unescapeHtml($(el).text()).trim())
      })
      outputAreas.each((_, el) => {
        outputs.push(unescapeHtml($(el).text()).trim())
      })

      for (let i = 0; i < Math.max(inputs.length, outputs.length); i++) {
        const numStr = inputs.length > 1 || outputs.length > 1 ? ` ${i + 1}` : ''

        if (i < inputs.length) {
          parts.push(`### 样例输入${numStr}\n\n\`\`\`\n${inputs[i]}\n\`\`\``)
        }
        if (i < outputs.length) {
          parts.push(`### 样例输出${numStr}\n\n\`\`\`\n${outputs[i]}\n\`\`\``)
        }
      }

      return parts.join('\n\n')
    }

    // 方法 2: 从 h2 + pre 提取（普通题格式）
    const container = $('.subject-describe')
    if (!container.length) return ''

    const headings = container.find('h2')
    headings.each((_, el) => {
      const text = $(el).text().trim()

      if (/样例输入/.test(text)) {
        const pre = $(el).next('pre')
        if (pre.length) {
          const content = unescapeHtml(stripTags(pre.html() || '')).trim()
          const numMatch = text.match(/(\d+)/)
          const numStr = numMatch ? ` ${numMatch[1]}` : ''
          parts.push(`### 样例输入${numStr}\n\n\`\`\`\n${content}\n\`\`\``)
        }
      }

      if (/样例输出/.test(text)) {
        const pre = $(el).next('pre')
        if (pre.length) {
          const content = unescapeHtml(stripTags(pre.html() || '')).trim()
          const numMatch = text.match(/(\d+)/)
          const numStr = numMatch ? ` ${numMatch[1]}` : ''
          parts.push(`### 样例输出${numStr}\n\n\`\`\`\n${content}\n\`\`\``)
        }
      }
    })

    return parts.join('\n\n')
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/acm/problem/${problemId}`
  }
}
