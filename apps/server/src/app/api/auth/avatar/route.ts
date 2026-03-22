import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const formData = await request.formData()
    const file = formData.get('avatar') as File

    if (!file) {
      return NextResponse.json(
        { success: false, message: '请上传图片文件' },
        { status: 400 }
      )
    }

    // Convert file to buffer and forward to backend
    const buffer = Buffer.from(await file.arrayBuffer())
    const blob = new Blob([buffer], { type: file.type })

    const backendFormData = new FormData()
    backendFormData.append('avatar', blob, file.name)

    const res = await fetch(`${API_BASE}/api/auth/avatar`, {
      method: 'POST',
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {})
      },
      body: backendFormData
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json(
      { success: false, message: '请求失败' },
      { status: 500 }
    )
  }
}
