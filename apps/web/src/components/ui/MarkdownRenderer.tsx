'use client'

import React, { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import remarkDirectiveRehype from 'remark-directive-rehype'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { showToastNotification } from '@/components/ui/Toast'

// 复制按钮组件
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      style={{
        position: 'absolute',
        top: '4px',
        right: '4px',
        padding: '2px 8px',
        fontSize: '12px',
        background: copied ? 'var(--success-light)' : 'var(--border)',
        color: copied ? 'var(--success-text)' : 'var(--text-secondary)',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        opacity: 0.8,
        transition: 'opacity 0.2s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7' }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

interface MarkdownRendererProps {
  content: string
  className?: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

// 处理需要认证的文件下载
const handleFileDownload = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
  if (!href.startsWith('/api/files/')) return

  e.preventDefault()

  const token = localStorage.getItem('token')
  if (!token) {
    showToastNotification('请先登录', 'warning')
    return
  }

  try {
    const response = await fetch(`${API_URL}${href}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!response.ok) {
      throw new Error('下载失败')
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)

    const contentDisposition = response.headers.get('Content-Disposition')
    let filename = 'download'

    if (contentDisposition) {
      const utf8Match = contentDisposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/i)
      if (utf8Match && utf8Match[1]) {
        filename = decodeURIComponent(utf8Match[1].trim())
      } else {
        const asciiMatch = contentDisposition.match(/filename="?([^";\n]+)"?/i)
        if (asciiMatch && asciiMatch[1]) {
          filename = asciiMatch[1].trim()
        }
      }
    }

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Download failed:', error)
    showToastNotification('下载失败，请重试', 'error')
  }
}

/**
 * 预处理 Markdown 中的 LaTeX 转义美元符号
 *
 * 问题：remark-math 把 $...$ 当数学定界符，但 LaTeX 中 \$ 是字面量 $。
 * 例如洛谷题面中的 "$\$1$" 表示渲染为"$1"，
 * 但 remark-math 会把 "$\$" 当成 $$ (display math) 的开始，导致后续解析全部混乱。
 *
 * 解决方案：逐字符扫描，找到数学定界符边界时跳过 \$（不把它当定界符），
 * 然后在数学内容中把 \$ 替换为 \text{\$}（KaTeX 可渲染的字面量 $）。
 */
function preprocessMathEscapes(text: string): string {
  const ESCAPED_DOLLAR = '\\$'
  const SAFE_REPLACEMENT = '\\text{\\$}'

  // Step 1: 保护代码块和行内代码（不处理其中的内容）
  const codeBlocks: string[] = []
  let result = text

  // 保护 fenced code blocks
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `\x00CODE${codeBlocks.length - 1}\x00`
  })

  // 保护 inline code
  result = result.replace(/`[^`]+`/g, (match) => {
    codeBlocks.push(match)
    return `\x00CODE${codeBlocks.length - 1}\x00`
  })

  // Step 2: 逐字符扫描，找到数学区域，处理其中的 \$
  let output = ''
  let i = 0

  while (i < result.length) {
    if (result[i] !== '$') {
      output += result[i]
      i++
      continue
    }

    // 当前字符是 $
    // 检查是否被 \ 转义（前一个字符是 \，且该 \ 没有被再转义）
    const isEscaped = i > 0 && result[i - 1] === '\\'
    if (isEscaped) {
      output += '$'
      i++
      continue
    }

    // 检查是否是 display math $$
    const isDisplay = i + 1 < result.length && result[i + 1] === '$'

    if (isDisplay) {
      // Display math $$...$$
      const start = i
      i += 2 // skip opening $$

      // 找到结束的 $$，过程中跳过 \$
      let content = ''
      while (i < result.length) {
        if (result[i] === '$' && i + 1 < result.length && result[i + 1] === '$') {
          // 检查这个 $ 是否被转义
          const endEscaped = i > 0 && result[i - 1] === '\\'
          if (!endEscaped) {
            // 找到结束的 $$
            break
          }
        }
        content += result[i]
        i++
      }

      if (i < result.length) {
        // 在 display math 内部替换 \$ 为安全表达
        const processed = content.replaceAll(ESCAPED_DOLLAR, SAFE_REPLACEMENT)
        output += '$$' + processed + '$$'
        i += 2 // skip closing $$
      } else {
        // 没找到结束的 $$，回退
        output += result.substring(start)
        break
      }
    } else {
      // Inline math $...$
      const start = i
      i++ // skip opening $

      let content = ''
      while (i < result.length) {
        if (result[i] === '$') {
          // 检查这个 $ 是否被 \$ 转义
          const endEscaped = i > 0 && result[i - 1] === '\\'
          if (!endEscaped) {
            // 检查后面是否紧跟 $（display math），如果是则不应该作为 inline math 结束
            // 这种情况不应该发生，因为 display math 已经在上面处理了
            break
          }
          // \$ 在数学内部 — 这就是我们想替换的
        }
        // 空行表示段落结束，数学不应该跨段
        if (result[i] === '\n' && i + 1 < result.length && result[i + 1] === '\n') {
          break
        }
        content += result[i]
        i++
      }

      if (i < result.length && result[i] === '$') {
        // 在 inline math 内部替换 \$ 为安全表达
        const processed = content.replaceAll(ESCAPED_DOLLAR, SAFE_REPLACEMENT)
        output += '$' + processed + '$'
        i++ // skip closing $
      } else {
        // 没找到结束的 $，回退
        output += result.substring(start)
        break
      }
    }
  }

  // Step 3: 还原代码块
  result = output.replace(/\x00CODE(\d+)\x00/g, (_, idx) => {
    return codeBlocks[parseInt(idx)]
  })

  return result
}

export function MarkdownRenderer({ content, className = 'markdown-content' }: MarkdownRendererProps) {
  // 预处理数学转义美元符号
  const processedContent = preprocessMathEscapes(content)

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkDirective, remarkDirectiveRehype]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // 代码块（pre > code）添加复制按钮
          pre: ({ children }) => {
            // 提取 code 文本
            const codeEl = children as React.ReactElement
            const codeText = codeEl?.props?.children
              ? String(codeEl.props.children).replace(/\n$/, '')
              : ''
            return (
              <pre style={{ position: 'relative' }}>
                {codeText && <CopyButton text={codeText} />}
                {children}
              </pre>
            )
          },
          // 处理图片 URL，添加后端 API 前缀
          img: ({ src, alt, ...props }) => {
            const fullSrc = src?.startsWith('/uploads/')
              ? `${API_URL}${src}`
              : src
            return <img src={fullSrc} alt={alt} {...props} />
          },
          // 处理链接点击，文件下载需要认证
          a: ({ href, children, ...props }) => {
            if (href?.startsWith('/api/files/')) {
              return (
                <a
                  href={href}
                  onClick={(e) => handleFileDownload(e, href)}
                  style={{ cursor: 'pointer' }}
                  {...props}
                >
                  {children}
                </a>
              )
            }
            // 外部链接在新窗口打开
            if (href?.startsWith('http')) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              )
            }
            return <a href={href} {...props}>{children}</a>
          }
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
