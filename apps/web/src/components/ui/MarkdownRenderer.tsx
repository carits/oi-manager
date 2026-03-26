'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import remarkDirectiveRehype from 'remark-directive-rehype'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

interface MarkdownRendererProps {
  content: string
  className?: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// 处理需要认证的文件下载
const handleFileDownload = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
  if (!href.startsWith('/api/files/')) return // 不是文件 API，正常导航

  e.preventDefault()

  const token = localStorage.getItem('token')
  if (!token) {
    alert('请先登录')
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

    // 从响应头获取文件名
    const contentDisposition = response.headers.get('Content-Disposition')
    let filename = 'download'

    if (contentDisposition) {
      // 尝试解析 filename*=UTF-8''encoded_name 格式 (RFC 5987)
      const utf8Match = contentDisposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/i)
      if (utf8Match && utf8Match[1]) {
        filename = decodeURIComponent(utf8Match[1].trim())
      } else {
        // 尝试解析 filename="name" 或 filename=name 格式
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
    alert('下载失败，请重试')
  }
}

export function MarkdownRenderer({ content, className = 'markdown-content' }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkDirective, remarkDirectiveRehype]}
        rehypePlugins={[rehypeKatex]}
        components={{
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
        {content}
      </ReactMarkdown>
    </div>
  )
}
