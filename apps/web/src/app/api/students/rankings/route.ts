import { NextRequest, NextResponse } from 'next/server'
import { ENV } from '@/config/env'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')

    const url = `${ENV.API_URL}/api/students/rankings`

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {})
      }
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
