/**
 * oj.uz 题目拉取适配器
 *
 * 纯 HTTP 实现，不需要 Playwright。
 *
 * oj.uz 页面特点：
 * - 服务端渲染 HTML，编码 UTF-8
 * - 标题: <h1>Dreaming<small>...</small></h1>
 * - 时限/内存: 表格中 <td>1000 ms</td>, <td>64 MiB</td>
 * - 题面: 多数为 PDF iframe（<iframe src="...pdf">），少数有 HTML 题面
 * - 附件: sidebar 中有下载链接
 * - 题号: 字母数字 slug（如 IOI13_dreaming, CEOI10_progress）
 * - CF 保护: 但普通 HTTP 请求可返回 200
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform, OjAttachment } from './types'
import { convertHtmlToMarkdown, resolveRelativeUrls, downloadAndSavePdf } from './html-utils'
import { logger } from '../lib/logger'

const BASE_URL = 'https://oj.uz'

export class OjuzAdapter implements OjAdapter {
  name = 'oj.uz'
  platform: OjPlatform = 'ojuz'

  rateLimitConfig = {
    requestsPerSecond: 0.5,
    jitterRange: [1, 3] as [number, number],
    maxRetries: 2,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 oj.uz 题号: ${problemId}`)
    }

    logger.info('ojuz_fetch_start', { action: 'ojuz_fetch', metadata: { problemId } })

    try {
      const url = `${BASE_URL}/problem/view/${problemId}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 404) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `oj.uz 题目不存在: ${problemId}`)
      }
      if (!response.ok) {
        throw new OjFetchError(OjErrorCode.SERVER_ERROR, `oj.uz HTTP ${response.status}: ${problemId}`)
      }

      const html = await response.text()

      if (!html.includes('problem-title') && !html.includes('statement')) {
        throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `oj.uz 题目不存在: ${problemId}`)
      }

      return await this.parseHtml(html, problemId, url)
    } catch (e: any) {
      if (e instanceof OjFetchError) throw e
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `oj.uz 请求超时: ${problemId}`, e)
      }
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `oj.uz 拉取失败: ${e.message}`, e)
    }
  }

  private async parseHtml(html: string, problemId: string, url: string): Promise<OjProblem> {
    const title = this.extractTitle(html, problemId)
    const timeLimit = this.extractTimeLimit(html)
    const memoryLimit = this.extractMemoryLimit(html)
    const { description, pdfFileUrl } = await this.extractDescription(html, problemId)
    const attachments = this.extractAttachments(html)

    logger.info('ojuz_fetch_success', {
      action: 'ojuz_fetch',
      metadata: { problemId, title, contentLength: description.length, timeLimit, memoryLimit, attachments: attachments.length, hasPdf: !!pdfFileUrl }
    })

    // PDF 题面存为独立的 statement
    const statements: OjProblem['statements'] = [{
      type: 'statement',
      format: 'markdown',
      language: 'en',
      content: description,
      isVisible: true,
    }]

    if (pdfFileUrl) {
      statements.push({
        type: 'statement',
        format: 'pdf',
        language: null,
        fileUrl: pdfFileUrl,
        isVisible: true,
      })
    }

    return {
      title,
      description,
      timeLimit,
      memoryLimit,
      source: { platform: 'ojuz', problemId, url },
      attachments: attachments.length > 0 ? attachments : undefined,
      statements,
    }
  }

  private extractTitle(html: string, problemId: string): string {
    const m = html.match(/<h1[^>]*class="[^"]*problem-title[^"]*"[^>]*>([\s\S]*?)<small/i)
    if (m) {
      return m[1].replace(/<[^>]+>/g, '').trim()
    }
    const h1 = html.match(/<h1>([\s\S]*?)<small/i)
    if (h1) return h1[1].replace(/<[^>]+>/g, '').trim()
    return problemId
  }

  private extractTimeLimit(html: string): number | undefined {
    const m = html.match(/<td[^>]*>(\d+)\s*ms<\/td>/i)
    if (m) return parseInt(m[1])
    return undefined
  }

  private extractMemoryLimit(html: string): number | undefined {
    const matches = Array.from(html.matchAll(/<td[^>]*>(\d+)\s*MiB<\/td>/gi))
    if (matches.length > 0) return parseInt(matches[0][1])
    return undefined
  }

  /**
   * 提取题面描述。对于 PDF 题面，会尝试下载并上传到本地文件服务。
   * @returns description: Markdown 文本; pdfFileUrl: 上传后的本地 PDF URL（如有）
   */
  private async extractDescription(html: string, problemId: string): Promise<{
    description: string
    pdfFileUrl?: string
  }> {
    const statementDiv = html.match(/<div\s+id="statement">([\s\S]*?)<\/div>\s*<\/div>/i)

    if (statementDiv) {
      const content = statementDiv[1]

      // Check for PDF iframe
      const pdfMatch = content.match(/src="([^"]*\.pdf[^"]*)"/i)
      if (pdfMatch && !content.includes('class="problem-statement-html"')) {
        // PDF-based statement — extract actual PDF URL
        let pdfUrl = pdfMatch[1].replace(/&amp;/g, '&')
        const fileParam = pdfUrl.match(/[?&]file=([^&]+)/)
        if (fileParam) {
          pdfUrl = decodeURIComponent(fileParam[1])
        }

        // 尝试下载并上传 PDF 到本地
        const localPdfUrl = await downloadAndSavePdf(pdfUrl, problemId, 'ojuz')

        const description = localPdfUrl
          ? `**题目为 PDF 格式，已下载到本地。**\n\n[查看 PDF 题面](${localPdfUrl})\n\n> 原始链接: ${this.getProblemUrl(problemId)}`
          : `**题目为 PDF 格式。**\n\n[查看 PDF 题面](${pdfUrl})\n\n> 请在原平台查看完整题面: ${this.getProblemUrl(problemId)}`

        return { description, pdfFileUrl: localPdfUrl || undefined }
      }

      // HTML-based statement
      let htmlContent = content.replace(/<div\s+class="problem-statement-pdf[\s\S]*?<\/div>\s*<\/div>/gi, '')
      return { description: convertHtmlToMarkdown(resolveRelativeUrls(htmlContent, BASE_URL)).trim() }
    }

    // Fallback: try to find any PDF link
    const pdfLink = html.match(/file=([^"&]+)/i)
    if (pdfLink) {
      const pdfUrl = decodeURIComponent(pdfLink[1])

      const localPdfUrl = await downloadAndSavePdf(pdfUrl, problemId, 'ojuz')

      const description = localPdfUrl
        ? `**题目为 PDF 格式，已下载到本地。**\n\n[查看 PDF 题面](${localPdfUrl})\n\n> 原始链接: ${this.getProblemUrl(problemId)}`
        : `**题目为 PDF 格式。**\n\n[查看 PDF 题面](${pdfUrl})\n\n> 请在原平台查看完整题面: ${this.getProblemUrl(problemId)}`

      return { description, pdfFileUrl: localPdfUrl || undefined }
    }

    return { description: `> 无法提取题面内容，请在原平台查看: ${this.getProblemUrl(problemId)}` }
  }

  private extractAttachments(html: string): OjAttachment[] {
    const attachments: OjAttachment[] = []
    const matches = Array.from(html.matchAll(/<a\s+href="(https:\/\/static\.oj\.uz\/[^"]+)"\s+download="([^"]*)"[^>]*>/gi))
    for (const m of matches) {
      attachments.push({
        downloadLink: m[1].replace(/&amp;/g, '&'),
        filename: m[2],
      })
    }
    return attachments
  }

  isValidProblemId(problemId: string): boolean {
    return /^[a-zA-Z0-9_]+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem/view/${problemId}`
  }
}
