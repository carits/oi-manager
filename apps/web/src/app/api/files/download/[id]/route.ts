import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.BACKEND_URL || 'http://localhost:3002'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = new URL(request.url)

  // 检查是否使用公开访问模式
  const isPublic = url.searchParams.get('public') === 'true'

  // 公开访问不需要 token
  const endpoint = isPublic ? `${API_URL}/api/files/${id}/public` : `${API_URL}/api/files/${id}/download`

  const headers: Record<string, string> = {}

  // Private downloads forward the HttpOnly browser session cookie.
  if (!isPublic) {
    const cookie = request.headers.get('cookie')
    if (!cookie) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      )
    }
    headers.Cookie = cookie
  }

  try {
    const response = await fetch(endpoint, { headers })

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: 'Failed to fetch file' },
        { status: response.status }
      )
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition') || ''
    const data = await response.arrayBuffer()

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (error) {
    console.error('File proxy error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch file' },
      { status: 500 }
    )
  }
}