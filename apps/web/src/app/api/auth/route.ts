import { NextRequest, NextResponse } from 'next/server'
import { ENV } from '@/config/env'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const res = await fetch(`${ENV.API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')

    const res = await fetch(`${ENV.API_URL}/api/auth/me`, {
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

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const body = await request.json()

    const res = await fetch(`${ENV.API_URL}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {})
      },
      body: JSON.stringify(body)
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
