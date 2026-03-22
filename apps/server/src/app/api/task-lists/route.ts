import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const res = await fetch(`${API_BASE}/api/task-lists`, {
      headers: { ...(authHeader && { Authorization: authHeader }) }
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ success: false, message: '请求失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const body = await request.json()
    const res = await fetch(`${API_BASE}/api/task-lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authHeader && { Authorization: authHeader }) },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ success: false, message: '请求失败' }, { status: 500 })
  }
}
