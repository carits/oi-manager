import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authHeader = request.headers.get('authorization')
    const res = await fetch(`${API_BASE}/api/task-lists/${params.id}`, {
      headers: { ...(authHeader && { Authorization: authHeader }) }
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ success: false, message: '请求失败' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authHeader = request.headers.get('authorization')
    const res = await fetch(`${API_BASE}/api/task-lists/${params.id}`, {
      method: 'DELETE',
      headers: { ...(authHeader && { Authorization: authHeader }) }
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ success: false, message: '请求失败' }, { status: 500 })
  }
}
