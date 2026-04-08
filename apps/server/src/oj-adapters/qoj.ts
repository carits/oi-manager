/// <reference lib="dom" />
/**
 * QOJ (qoj.ac) 题目拉取适配器
 *
 * 基于 Playwright + Stealth + headed 模式，因为 QOJ 需要 JS 渲染 + MathJax，
 * 且 Cloudflare 对 /problem/* 和 /download.php 有严格的 JS Challenge 保护。
 *
 * 关键发现：
 * - CF challenge 在 headless 模式下无法通过，必须用 headed 模式
 * - download.php?type=statement&id={题目编号} 直接返回 PDF，id 就是题目编号
 * - 需要配置 QOJ_SESSION 环境变量（UOJSESSID cookie 值）
 *
 * QOJ 页面结构：
 * - 标题: <h1 class="page-header text-center">#60. Chinese Elephant Chess</h1>
 * - 时限/内存: <span class="badge badge-secondary mr-1">Time Limit: 1 s</span>
 * - 题面: <article class="uoj-article"> 内含 HTML + MathJax 渲染后的 SVG
 * - MathJax: <script type="math/tex" id="MathJax-Element-N">latex source</script>
 * - PDF 题面: iframe 嵌入 download.php?type=statement&id={题目编号}
 * - Cloudflare: headed 模式下约 3 秒自动通过 JS Challenge
 */

import { Page } from 'rebrowser-playwright-core'
import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjPlatform } from './types'
import { browserManager } from '../lib/browser/manager'
import { logger } from '../lib/logger'

const BASE_URL = 'https://qoj.ac'

// 动态导入 chromium 用于 PDF 下载的独立浏览器实例
let chromiumModule: any = null
async function getChromium() {
  if (!chromiumModule) {
    chromiumModule = await import('rebrowser-playwright-core')
  }
  return chromiumModule.chromium
}

export class QojAdapter implements OjAdapter {
  name = 'QOJ'
  platform: OjPlatform = 'qoj'

  /** 获取 QOJ Session Cookie (UOJSESSID) */
  private getSessionCookie(): string | undefined {
    return process.env.QOJ_SESSION?.trim() || undefined
  }

  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(OjErrorCode.INVALID_PROBLEM_ID, `无效的 QOJ 题号: ${problemId}`)
    }

    const sessionCookie = this.getSessionCookie()
    logger.info('qoj_fetch_start', {
      action: 'qoj_fetch',
      metadata: { problemId, hasSession: !!sessionCookie }
    })

    try {
      return await browserManager.withPage(
        { stealth: true, timeout: 90000, headless: false },
        (page) => this.fetchWithPage(page, problemId, sessionCookie)
      )
    } catch (e: any) {
      if (e.message?.includes('Timeout')) {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `QOJ 请求超时: ${problemId}`, e)
      }
      if (e instanceof OjFetchError) throw e
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `QOJ 拉取失败: ${e.message}`, e)
    }
  }

  /** 等待 Cloudflare JS Challenge 通过 */
  private async waitForCloudflare(page: Page, maxWaitMs = 30000): Promise<boolean> {
    const startTime = Date.now()
    const checkInterval = 3000

    while (Date.now() - startTime < maxWaitMs) {
      await page.waitForTimeout(checkInterval)
      // PDF 页面没有 title，但 contentType 会变成 application/pdf
      const ct = await page.evaluate(() => document.contentType).catch(() => '')
      if (ct === 'application/pdf') return true

      const title = await page.title().catch(() => '')
      if (title && !title.includes('Just a moment') && !title.includes('请稍候') && title.length > 0) {
        return true
      }
    }
    return false
  }

  private async fetchWithPage(page: Page, problemId: string, sessionCookie?: string): Promise<OjProblem> {
    const url = `${BASE_URL}/problem/${problemId}`

    // 注入 UOJSESSID cookie
    if (sessionCookie) {
      await page.context().addCookies([{
        name: 'UOJSESSID',
        value: sessionCookie,
        domain: 'qoj.ac',
        path: '/'
      }])
    }

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (!resp) {
      throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `QOJ 页面加载失败: ${problemId}`)
    }

    // 处理 Cloudflare challenge — headed 模式下约 3 秒自动通过
    if (resp.status() === 403) {
      const passed = await this.waitForCloudflare(page)
      if (!passed) {
        throw new OjFetchError(OjErrorCode.NETWORK_ERROR, `QOJ Cloudflare 拦截: ${problemId}`)
      }
    } else if (resp.status() === 404) {
      throw new OjFetchError(OjErrorCode.PROBLEM_NOT_FOUND, `QOJ 题目不存在: ${problemId}`)
    } else if (resp.status() >= 400) {
      throw new OjFetchError(OjErrorCode.SERVER_ERROR, `QOJ HTTP ${resp.status()}: ${problemId}`)
    }

    // 等待主要内容加载
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})

    // 提取标题 — 用 page-header h1（不是导航栏里的 h1）
    const title = await this.extractTitle(page, problemId)

    // 提取时限和内存限制
    const { timeLimit, memoryLimit } = await this.extractLimits(page)

    // 检查是否有 PDF 题面（iframe/embed 指向 download.php）
    const pdfResult = await this.tryExtractPdf(page, problemId, title, url, timeLimit, memoryLimit)
    if (pdfResult) return pdfResult

    // 提取 HTML 题面内容
    const articleHtml = await this.extractArticleHtml(page)
    if (articleHtml) {
      const markdown = this.convertHtmlToMarkdown(articleHtml)
      logger.info('qoj_fetch_success', {
        action: 'qoj_fetch',
        metadata: { problemId, title, contentLength: markdown.length }
      })

      return {
        title,
        description: markdown,
        timeLimit,
        memoryLimit,
        source: { platform: 'qoj', problemId, url },
        statements: [{
          type: 'statement',
          format: 'markdown',
          language: 'en',
          content: markdown,
          isVisible: true,
        }],
      }
    }

    // 没有找到任何题面内容
    throw new OjFetchError(OjErrorCode.PARSE_ERROR, `QOJ 题面解析失败: ${problemId}`)
  }

  /** 提取标题 */
  private async extractTitle(page: Page, problemId: string): Promise<string> {
    // 优先使用 <h1 class="page-header"> — 格式: "#60. Chinese Elephant Chess"
    try {
      const h1 = await page.locator('h1.page-header').first().innerText({ timeout: 3000 })
      if (h1?.trim()) {
        // 去掉 "#60. " 前缀
        const cleaned = h1.trim().replace(/^#\d+\.\s*/, '')
        if (cleaned) return cleaned
      }
    } catch {}

    // Fallback: 从 <title> 提取 — 格式: "Chinese Elephant Chess - Problem - QOJ.ac"
    try {
      const t = await page.title()
      if (t?.trim()) {
        const cleaned = t.replace(/\s*[-–]\s*(Problem|QOJ\.ac).*$/gi, '').trim()
        if (cleaned) return cleaned
      }
    } catch {}

    return `Problem ${problemId}`
  }

  /** 提取时限和内存限制 */
  private async extractLimits(page: Page): Promise<{ timeLimit?: number; memoryLimit?: number }> {
    try {
      const badges = await page.locator('span.badge.badge-secondary.mr-1').allInnerTexts()
      let timeLimit: number | undefined
      let memoryLimit: number | undefined

      for (const badge of badges) {
        const text = badge.trim()

        // Time Limit: 1 s / 2.5 s / 1000 ms
        const timeMatch = text.match(/Time\s*Limit:\s*([\d.]+)\s*(s|ms)/i)
        if (timeMatch) {
          const val = parseFloat(timeMatch[1])
          timeLimit = timeMatch[2].toLowerCase() === 'ms' ? val : val * 1000
        }

        // Memory Limit: 256 MB / 1024 MB
        const memMatch = text.match(/Memory\s*Limit:\s*(\d+)\s*(MB|KB|GB)/i)
        if (memMatch) {
          const val = parseInt(memMatch[1])
          const unit = memMatch[2].toUpperCase()
          if (unit === 'GB') memoryLimit = val * 1024
          else if (unit === 'KB') memoryLimit = Math.round(val / 1024)
          else memoryLimit = val
        }
      }

      return { timeLimit, memoryLimit }
    } catch {
      return {}
    }
  }

  /** 尝试提取 PDF 题面 — 直接用 download.php 端点 */
  private async tryExtractPdf(
    page: Page,
    problemId: string,
    title: string,
    url: string,
    timeLimit?: number,
    memoryLimit?: number
  ): Promise<OjProblem | null> {
    // 先检查页面是否有 PDF iframe（表示该题有 PDF 题面）
    const selectors = [
      { sel: 'iframe[src*="download.php"]', attr: 'src' },
      { sel: 'embed[src*="download.php"]', attr: 'src' },
      { sel: 'object[data*="download.php"]', attr: 'data' },
    ]

    let hasPdfStatement = false
    for (const { sel } of selectors) {
      try {
        const loc = page.locator(sel)
        if (await loc.count() > 0) {
          hasPdfStatement = true
          break
        }
      } catch {}
    }

    if (!hasPdfStatement) return null

    // 直接用 download.php?type=statement&id={题目编号} 下载
    const pdfUrl = `${BASE_URL}/download.php?type=statement&id=${problemId}`
    logger.info('qoj_pdf_detected', {
      action: 'qoj_fetch',
      metadata: { problemId, pdfUrl }
    })

    const localFileUrl = await this.downloadPdf(page, problemId, pdfUrl)

    return {
      title,
      description: `[${title}](${url}) 题面为 PDF 格式。`,
      timeLimit,
      memoryLimit,
      source: { platform: 'qoj', problemId, url },
      statements: [{
        type: 'statement',
        format: 'pdf',
        language: null,
        content: undefined,
        fileUrl: localFileUrl || pdfUrl,
        isVisible: true,
      }],
    }
  }

  /**
   * PDF 下载策略
   *
   * 用独立的浏览器实例直接导航到 download.php。
   * 不经过 browserManager（避免 stealth/UA 注入被 CF 检测）。
   * headed 模式下 CF challenge 约 3 秒自动通过。
   */
  private async downloadPdf(
    page: Page,
    problemId: string,
    pdfUrl: string
  ): Promise<string | undefined> {
    try {
      logger.info('qoj_pdf_browser_launching', { action: 'qoj_fetch', metadata: { problemId, pdfUrl } })

      // 懒加载 chromium 模块
      if (!chromiumModule) {
        const mod = await import('rebrowser-playwright-core')
        chromiumModule = mod.chromium
      }

      // 启动独立的 headed 浏览器（不经过 browserManager）
      const browser = await chromiumModule.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
      })

      try {
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        })

        // 注入 UOJSESSID
        const sessionCookie = this.getSessionCookie()
        if (sessionCookie) {
          await context.addCookies([{
            name: 'UOJSESSID',
            value: sessionCookie,
            domain: 'qoj.ac',
            path: '/'
          }])
        }

        const pdfPage = await context.newPage()

        logger.info('qoj_pdf_navigating', { action: 'qoj_fetch', metadata: { problemId, pdfUrl } })
        await pdfPage.goto(pdfUrl, { timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {})

        // 等 CF challenge 自动通过
        const passed = await this.waitForCloudflare(pdfPage, 30000)
        if (!passed) {
          logger.warn('qoj_pdf_cf_timeout', { action: 'qoj_fetch', metadata: { problemId } })
          return undefined
        }

        // 浏览器内部 fetch 下载 PDF
        logger.info('qoj_pdf_browser_fetch_start', { action: 'qoj_fetch', metadata: { problemId } })
        const result = await pdfPage.evaluate(async (url: string) => {
          try {
            const resp = await fetch(url)
            if (!resp.ok) return { error: `HTTP ${resp.status}` }
            const buf = await resp.arrayBuffer()
            const bytes = new Uint8Array(buf)
            const isPdf = bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50
            if (!isPdf) return { size: bytes.length, isPdf: false }
            let binary = ''
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
            return { size: bytes.length, isPdf: true, b64: btoa(binary) }
          } catch (e: any) {
            return { error: e.message || 'unknown' }
          }
        }, pdfUrl)

        if ('b64' in result && result.b64) {
          const body = Buffer.from(result.b64, 'base64')
          logger.info('qoj_pdf_download_success', {
            action: 'qoj_fetch',
            metadata: { problemId, size: body.length }
          })
          return await this.savePdfToLocal(body, problemId)
        }

        logger.warn('qoj_pdf_download_failed', {
          action: 'qoj_fetch',
          metadata: { problemId, result: JSON.stringify(result) }
        })
      } finally {
        await browser.close().catch(() => {})
      }
    } catch (e: any) {
      logger.warn('qoj_pdf_download_error', { action: 'qoj_fetch', metadata: { problemId, error: e.message } })
    }

    return undefined
  }

  /** 保存 PDF 到本地存储 */
  private async savePdfToLocal(pdfBuffer: Buffer, problemId: string): Promise<string> {
    const { fileService } = await import('../lib/storage')
    const uploadResult = await fileService.upload(pdfBuffer, {
      category: 'pdf',
      ownerType: 'problem',
      ownerId: `qoj-${problemId}`,
      originalName: `${problemId}-statement.pdf`,
      mimeType: 'application/pdf',
      isPublic: true,
    })
    // 使用 /api/files/:id/public 格式（前端可通过此路径直接访问）
    const fileUrl = `/api/files/${uploadResult.id}/public`
    logger.info('qoj_pdf_saved_local', {
      action: 'qoj_fetch',
      metadata: { problemId, size: pdfBuffer.length, fileId: uploadResult.id, fileUrl }
    })
    return fileUrl
  }

  /** 提取 article.uoj-article 的 innerHTML */
  private async extractArticleHtml(page: Page): Promise<string | null> {
    try {
      const loc = page.locator('article.uoj-article')
      if (await loc.count() > 0) {
        return await loc.first().innerHTML()
      }
    } catch {}
    return null
  }

  /**
   * HTML → Markdown 转换（针对 QOJ 结构优化）
   *
   * 关键处理：
   * 1. MathJax: 提取 <script type="math/tex"> 中的 LaTeX 源码
   * 2. <pre> 代码块: 样例输入输出转为代码块
   * 3. <h4> 子标题: Input/Output 在 Examples 内部
   * 4. 保留表格、列表等结构
   */
  private convertHtmlToMarkdown(html: string): string {
    let md = html

    // 1. 移除非 math 的 <script> 和所有 <style>
    md = md.replace(/<script\b(?![^>]*type\s*=\s*["']math\/tex)[^>]*>[\s\S]*?<\/script>/gi, '')
    md = md.replace(/<style\b[\s\S]*?<\/style>/gi, '')

    // 2. 移除 MathJax SVG 渲染结果（保留 script type="math/tex" 中的 LaTeX）
    //    注意嵌套顺序: MJX_Assistive_MathML 在 MathJax_SVG 内部
    //    所以必须先移除内部的 span，再移除外部的
    //    先移除所有 svg 元素（它们不嵌套 span）
    md = md.replace(/<svg[\s\S]*?<\/svg>/gi, '')
    //    移除内部的 MJX_Assistive_MathML span
    md = md.replace(/<span class="MJX_Assistive_MathML"[^>]*>[\s\S]*?<\/span>/gi, '')
    //    现在移除外部的 MathJax_SVG span（不再有嵌套 span 干扰）
    md = md.replace(/<span class="MathJax_SVG"[^>]*>[\s\S]*?<\/span>/gi, '')
    //    移除 MathJax_Preview span
    md = md.replace(/<span class="MathJax_Preview"[^>]*>[\s\S]*?<\/span>/gi, '')

    // 3. 提取 LaTeX: <script type="math/tex"> → $latex$
    md = md.replace(
      /<script type="math\/tex[^"]*"[^>]*>([\s\S]*?)<\/script>/gi,
      (_, latex) => `$${this.unescapeHtml(latex.trim())}$`
    )

    // 5. 标题转换
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${this.stripTags(c.trim())}`)
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${this.stripTags(c.trim())}`)
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${this.stripTags(c.trim())}`)
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${this.stripTags(c.trim())}`)
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `##### ${this.stripTags(c.trim())}`)
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `###### ${this.stripTags(c.trim())}`)

    // 6. 表格转换
    md = this.convertTables(md)

    // 7. 代码块 — <pre> 内容转为 markdown 代码块
    //    QOJ 的样例通常是 <pre>1 3</pre> 这样的简单格式
    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => {
      const code = this.unescapeHtml(c.trim())
      return `\n\`\`\`\n${code}\n\`\`\`\n`
    })

    // 8. 段落
    md = md.replace(/<\/p>/gi, '\n\n')
    md = md.replace(/<p[^>]*>/gi, '')

    // 9. 换行
    md = md.replace(/<br\s*\/?>/gi, '\n')

    // 10. 列表
    md = md.replace(/<li[^>]*>/gi, '- ')
    md = md.replace(/<\/li>/gi, '\n')
    md = md.replace(/<\/?[ou]l[^>]*>/gi, '\n')

    // 11. 加粗/斜体
    md = md.replace(/<(strong|b)>([\s\S]*?)<\/(strong|b)>/gi, '**$2**')
    md = md.replace(/<(em|i)>([\s\S]*?)<\/(em|i)>/gi, '*$2*')

    // 12. 行内代码
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')

    // 13. 链接
    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')

    // 14. 图片
    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)')

    // 15. 清理残留的 MathJax span（以防万一）

    // 16. 清理其他 HTML 标签
    md = this.stripTags(md)

    // 17. 解码 HTML 实体
    md = this.unescapeHtml(md)

    // 18. 清理多余空行
    md = md.replace(/\r\n/g, '\n')
    md = md.replace(/\n{3,}/g, '\n\n')

    return md.trim() + '\n'
  }

  /** 表格转换 */
  private convertTables(html: string): string {
    // 处理 <table> 结构
    return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
      const rows: string[][] = []

      // 提取所有行
      const trMatches = tableContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []
      for (const tr of trMatches) {
        const cells: string[] = []
        // th 或 td
        const cellMatches = tr.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || []
        for (const cell of cellMatches) {
          const text = cell.replace(/<\/?t[hd][^>]*>/gi, '').trim()
          cells.push(this.stripTags(this.unescapeHtml(text)).replace(/\n/g, ' '))
        }
        rows.push(cells)
      }

      if (rows.length === 0) return ''

      // 转为 markdown 表格
      let result = ''
      // 表头
      const header = rows[0]
      result += '| ' + header.join(' | ') + ' |\n'
      result += '| ' + header.map(() => '---').join(' | ') + ' |\n'
      // 数据行
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        // 补齐列数
        while (row.length < header.length) row.push('')
        result += '| ' + row.join(' | ') + ' |\n'
      }

      return '\n' + result
    })
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
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x2264;/g, '≤')
      .replace(/&#x2265;/g, '≥')
      .replace(/&#x2260;/g, '≠')
      .replace(/&le;/g, '≤')
      .replace(/&ge;/g, '≥')
      .replace(/&times;/g, '×')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&hellip;/g, '…')
      .replace(/&infin;/g, '∞')
  }

  isValidProblemId(problemId: string): boolean {
    return /^\d+$/.test(problemId.trim())
  }

  getProblemUrl(problemId: string): string {
    return `${BASE_URL}/problem/${problemId}`
  }
}
