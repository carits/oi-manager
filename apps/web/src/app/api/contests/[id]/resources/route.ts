import { NextRequest, NextResponse } from 'next/server'
import { ENV } from '@/config/env'

// POST /api/contests/[id]/resources - 上传资料
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authHeader = request.headers.get('authorization')
    const formData = await request.formData()

    const res = await fetch(`${ENV.API_URL}/api/contests/${params.id}/resources`, {
      method: 'POST',
      headers: {
        ...(authHeader && { Authorization: authHeader })
      },
      body: formData
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ success: false, message: '请求失败' }, { status: 500 })
  }
}
