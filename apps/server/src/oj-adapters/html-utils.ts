/**
 * OJ 适配器通用 HTML→Markdown 转换工具
 * @description 从 HDU 适配器提取的公共方法，供多个适配器复用
 */

/** 去除 HTML 标签 */
export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

/** 解码 HTML 实体 */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#0?3;/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => {
      const num = parseInt(code)
      if (num < 32 && num !== 10) return ''
      return String.fromCharCode(num)
    })
}

/** 检测语言（中文占比 > 5% 判定为中文） */
export function detectLanguage(text: string): 'zh' | 'en' {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)
  const ratio = chineseChars ? chineseChars.length / text.length : 0
  return ratio > 0.05 ? 'zh' : 'en'
}

/**
 * 将 HTML 中的相对 URL 转为绝对 URL
 * 处理 <img src="..."> 和 <a href="...">
 */
export function resolveRelativeUrls(html: string, baseUrl: string): string {
  const base = new URL(baseUrl)
  const origin = base.origin
  const pathDir = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1)

  return html
    .replace(/(src=")([^"]*)(")/gi, (_m, prefix, url, suffix) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('//')) {
        return _m
      }
      if (url.startsWith('/')) {
        return `${prefix}${origin}${url}${suffix}`
      }
      return `${prefix}${origin}${pathDir}${url}${suffix}`
    })
    .replace(/(href=")([^"]*)(")/gi, (_m, prefix, url, suffix) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:') || url.startsWith('#') || url.startsWith('//')) {
        return _m
      }
      if (url.startsWith('/')) {
        return `${prefix}${origin}${url}${suffix}`
      }
      return `${prefix}${origin}${pathDir}${url}${suffix}`
    })
}

/** 转换普通 HTML 内容为 Markdown */
export function convertHtmlToMarkdown(html: string): string {
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

  // 处理 <pre> 块（含 <pre><code> 模式）→ 代码块
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, content) => {
    // 移除内部 <code> 标签
    let code = content.replace(/<code[^>]*>/gi, '').replace(/<\/code>/gi, '')
    code = unescapeHtml(stripTags(code)).trim()
    return `\n\`\`\`\n${code}\n\`\`\`\n`
  })

  // 表格：在 stripTags 之前，将 <table> 转为 Markdown 表格
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, content) => {
    return convertHtmlTable(content)
  })

  // 引用块
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, content) => {
    // 先将 <br> 转为换行（因为 <br> 转换在后面）
    content = content.replace(/<br\s*\/?>/gi, '\n')
    const lines = content.trim().split('\n')
    return lines.map((line: string) => `> ${line.trim()}`).join('\n')
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

  // 图片 — <img src="..." alt="..."> → ![alt](src)
  // 需要在链接处理之后、stripTags 之前
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*(?:\s+alt="([^"]*)")?[^>]*\/?>/gi, (_match, src, alt) => {
    const altText = alt || ''
    return `![${altText}](${src})`
  })
  // 也匹配 alt 在 src 前面的情况
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*\s+src="([^"]*)"[^>]*\/?>/gi, (_match, alt, src) => {
    return `![${alt}](${src})`
  })

  // 标题
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n')
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n')
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n')
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n')
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n')
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n')

  // 换行
  md = md.replace(/<br\s*\/?>/gi, '\n')
  md = md.replace(/<\/p>/gi, '\n\n')
  md = md.replace(/<p[^>]*>/gi, '')

  // 段落 div → 换行
  md = md.replace(/<\/div>/gi, '\n')
  md = md.replace(/<div[^>]*>/gi, '\n')

  // 清理剩余标签
  md = stripTags(md)

  // HTML 实体解码
  md = unescapeHtml(md)

  // 还原数学公式
  md = md.replace(/\x00MATH(\d+)\x00/g, (_, idx) => {
    return mathPlaceholders[parseInt(idx)]
  })

  // 清理多余空行
  md = md.replace(/\r\n/g, '\n')
  md = md.replace(/\n{3,}/g, '\n\n')

  // 二次 HTML 实体解码：防止 stripTags 后残留 &amp;lt; 这类双重编码
  md = unescapeHtml(md)

  return md.trim()
}

/** 转换样例内容（提取 pre 内文本，转为代码块） */
export function convertSampleToCodeBlock(content: string): string {
  let text = content

  const preMatch = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
  if (preMatch) {
    text = preMatch[1]
  }

  text = stripTags(text)
  text = unescapeHtml(text).trim()

  return `\`\`\`\n${text}\n\`\`\``
}

/**
 * 将 HTML <table> 内容转为 Markdown 表格
 * @param tableHtml - <table> 标签内部的内容（不含 <table> 标签本身）
 * @returns Markdown 表格字符串
 */
function convertHtmlTable(tableHtml: string): string {
  const rows: string[][] = []

  // 提取所有 <tr> 行
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch: RegExpExecArray | null
  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    const trContent = trMatch[1]
    const cells: string[] = []

    // 提取 <th> 和 <td> 单元格
    const cellRegex = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRegex.exec(trContent)) !== null) {
      let cellText = cellMatch[1]
      // 清理标签和实体
      cellText = stripTags(cellText).trim()
      cellText = unescapeHtml(cellText)
      // 转义 Markdown 表格分隔符
      cellText = cellText.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      cells.push(cellText)
    }

    if (cells.length > 0) {
      rows.push(cells)
    }
  }

  if (rows.length === 0) return ''

  // 统一列数（取最大值，短的行补空格）
  const maxCols = Math.max(...rows.map(r => r.length))
  for (const row of rows) {
    while (row.length < maxCols) row.push('')
  }

  const lines: string[] = []

  // 表头行
  lines.push('| ' + rows[0].join(' | ') + ' |')

  // 分隔行
  lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |')

  // 数据行（跳过表头）
  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + rows[i].join(' | ') + ' |')
  }

  return '\n' + lines.join('\n') + '\n'
}

/**
 * 下载远程 PDF 并上传到本地文件服务
 * @param pdfUrl - 远程 PDF 的完整 URL
 * @param problemId - 题号（用于文件命名和 owner）
 * @param platform - 平台标识（用于 owner）
 * @returns 上传后的本地文件 URL（/api/files/:id/public），失败返回 null
 */
export async function downloadAndSavePdf(
  pdfUrl: string,
  problemId: string,
  platform: string,
): Promise<string | null> {
  try {
    const { fileService } = await import('../lib/storage')

    const parsedUrl = new URL(pdfUrl)
    const referer = `${parsedUrl.protocol}//${parsedUrl.host}/`

    const response = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
        'Referer': referer,
      },
      signal: AbortSignal.timeout(60000),
      redirect: 'follow',
    })

    if (!response.ok) {
      console.error(`[PDF Download] HTTP ${response.status} for ${pdfUrl}`)
      return null
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('pdf') && !pdfUrl.includes('.pdf')) {
      console.error(`[PDF Download] Not a PDF: ${contentType} for ${pdfUrl}`)
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    const result = await fileService.upload(buffer, {
      category: 'pdf',
      ownerType: 'problem',
      ownerId: `${platform}-${problemId}`,
      originalName: `${platform}-${problemId}-statement.pdf`,
      mimeType: 'application/pdf',
      isPublic: true,
    })

    const fileUrl = `/api/files/${result.id}/public`
    console.log(`[PDF Download] Saved: ${pdfUrl} -> ${fileUrl} (${buffer.length} bytes)`)
    return fileUrl
  } catch (error) {
    console.error(`[PDF Download] Failed: ${pdfUrl}`, error)
    return null
  }
}
