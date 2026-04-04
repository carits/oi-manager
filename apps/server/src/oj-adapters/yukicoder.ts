/**
 * yukicoder (yukicoder.me) 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * yukicoder 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8，日语界面
 * - 标题: <h3> 内，如 "No.1  道のショートカット"
 * - 时限/内存: <div> 内含 "実行時間制限" 和 "メモリ制限"
 * - 题面分块: <div class="block"> 内，<h4 class="shadow"> 为小节标题，内容在后面
 * - 数学公式: KaTeX 格式 \( ... \) 和 \[ ... \]，需转为 $ 和 $$
 * - 样例: <div class="sample"> 内，<h6>Input/Output</h6> + <pre>
 * - 难度: 星级 1-5（fas fa-star 计数）
 * - 题号: 纯数字（1, 2, 3, ...）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { stripTags, unescapeHtml, convertHtmlToMarkdown, resolveRelativeUrls } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://yukicoder.me'

export class YukicoderAdapter implements OjAdapter {
  name = 'yukicoder'
  platform: OjPlatform = 'yukicoder'

  rateLimitConfig = {
    requestsPerSecond: 0.3,
    jitterRange: [2, 5] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 yukicoder 题号: ${problemId}`)
    }

    logger.info('yukicoder_fetch_start', { action: 'yukicoder_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/problems/no/${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `yukicoder 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `yukicoder HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      if (!html.includes('class="block"') && !html.includes('id="content"')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `yukicoder 题目不存在: ${problemId}`)
      }

      return this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `yukicoder 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `yukicoder 拉取失败: ${e.message}`, e)
    }
  }

  private parseHtml(html: string, problemId: string, url: string): OjProblem {
    const title = this.extractTitle(html)
    const timeLimit = this.extractTimeLimit(html)
    const memoryLimit = this.extractMemoryLimit(html)
    const difficulty = this.extractDifficulty(html)
    const description = this.extractDescription(html)

    logger.info('yukicoder_fetch_success', {
      action: 'yukicoder_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit }
    })

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      difficulty,
      source: { platform: 'yukicoder', problemId, url },
      statements: [{
        type: 'statement',
        format: 'markdown',
        language: 'en',
        content: description,
        isVisible: true,
      }],
    }
  }

  private extractTitle(html: string): string {
    // <h3>No.1  道のショートカット</h3>
    const m = html.match(/<h3>(No\.\d+)\s+(.*?)<\/h3>/i)
    if (m) return `${m[1]} ${unescapeHtml(m[2].trim())}`
    // fallback: from <title>
    const tm = html.match(/<title>\s*(.*?)\s*-\s*yukicoder/i)
    if (tm) return unescapeHtml(tm[1].trim())
    return `No.${0}`
  }

  private extractTimeLimit(html: string): number | undefined {
    // 実行時間制限 : 1ケース 5.000秒
    const m = html.match(/実行時間制限\s*:\s*1ケース\s*([\d.]+)\s*秒/i)
    if (m) return Math.round(parseFloat(m[1]) * 1000)
    // fallback: "Time limit" English
    const m2 = html.match(/Time\s*limit\s*:\s*([\d.]+)\s*sec/i)
    if (m2) return Math.round(parseFloat(m2[1]) * 1000)
    return undefined
  }

  private extractMemoryLimit(html: string): number | undefined {
    // メモリ制限 : 512 MB
    const m = html.match(/メモリ制限\s*:\s*(\d+)\s*MB/i)
    if (m) return parseInt(m[1])
    // fallback
    const m2 = html.match(/Memory\s*limit\s*:\s*(\d+)\s*MB/i)
    if (m2) return parseInt(m2[1])
    return undefined
  }

  private extractDifficulty(html: string): string | undefined {
    // Count <i class="fas fa-star"></i> before the difficulty section ends
    const diffSection = html.match(/レベル\s*:\s*([\s\S]*?)<\/div>/i)
    if (diffSection) {
      const stars = (diffSection[1].match(/fas fa-star/g) || []).length
      if (stars > 0) return `${stars} ★`
    }
    return undefined
  }

  private extractDescription(html: string): string {
    // Extract all <div class="block"> sections
    const blocks: string[] = []
    const blockRegex = /<div\s+class="block">([\s\S]*?)<\/div>\s*(?=<div\s+class="block"|<div\s+style|<form|$)/gi
    let match

    while ((match = blockRegex.exec(html)) !== null) {
      const blockHtml = match[1]
      const section = this.parseBlock(blockHtml)
      if (section) blocks.push(section)
    }

    // If block extraction failed, try extracting from the whole content area
    if (blocks.length === 0) {
      const contentMatch = html.match(/id="content"[\s\S]*?<div\s+class="block">([\s\S]*)/)
      if (contentMatch) {
        return this.convertYukicoderHtml(contentMatch[1])
      }
      return ''
    }

    return blocks.join('\n\n')
  }

  private parseBlock(blockHtml: string): string {
    // <h4 class="shadow">問題文</h4> followed by content
    const h4Match = blockHtml.match(/<h4\s+class="shadow">([\s\S]*?)<\/h4>/i)
    const sectionTitle = h4Match ? stripTags(h4Match[1]).trim() : ''

    // Get content after the h4
    const contentStart = h4Match ? blockHtml.indexOf('</h4>') + 5 : 0
    const contentHtml = blockHtml.substring(contentStart)

    if (!contentHtml.trim()) return ''

    const md = this.convertYukicoderHtml(contentHtml)

    if (sectionTitle) {
      return `## ${sectionTitle}\n\n${md}`
    }
    return md
  }

  private convertYukicoderHtml(html: string): string {
    let content = html

    // Convert KaTeX delimiters: \( ... \) → $ ... $
    content = content.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$')

    // Convert KaTeX display: \[ ... \] → $$ ... $$
    content = content.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$1$$')

    // Handle sample sections specially
    // <div class="sample" data-file="..."> contains <h5>, <h6>Input/Output</h6>, <pre>
    content = content.replace(
      /<div\s+class="sample"[^>]*>\s*<h5[^>]*>([\s\S]*?)<\/h5>\s*<div\s+class="paragraph">([\s\S]*?)<\/div>\s*<\/div>/gi,
      (_match, title, body) => {
        let result = `### ${stripTags(title).trim()}\n\n`
        // Extract Input/Output sections
        const sections = body.split(/<h6[^>]*>/i)
        for (const sec of sections) {
          if (!sec.trim()) continue
          const isInput = sec.startsWith('入力') || sec.toLowerCase().startsWith('input')
          const isOutput = sec.startsWith('出力') || sec.toLowerCase().startsWith('output')
          const label = isInput ? 'Input' : isOutput ? 'Output' : stripTags(sec.split('</h6>')[0]).trim()
          const preMatch = sec.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
          if (preMatch) {
            const code = unescapeHtml(stripTags(preMatch[1])).trim()
            result += `**${label}:**\n\n\`\`\`\n${code}\n\`\`\`\n\n`
          } else {
            // Description after the label
            const descHtml = sec.replace(/^[^<]*<\/h6>/i, '')
            if (descHtml.trim()) {
              result += convertHtmlToMarkdown(descHtml) + '\n\n'
            }
          }
        }
        return result
      }
    )

    // General HTML → Markdown conversion
    content = convertHtmlToMarkdown(resolveRelativeUrls(content, BASE_URL))

    return content.trim()
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problems/no/${problemId}`
  }
}
