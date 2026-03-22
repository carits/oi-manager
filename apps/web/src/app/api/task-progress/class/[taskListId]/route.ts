import { NextRequest, NextResponse } from 'next/server'
import { ENV } from '@/config/env'

export async function GET(
  request: NextRequest,
  { params }: { params: { taskListId: string } }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const { searchParams } = new URL(request.url)

    const res = await fetch(
      `${ENV.API_URL}/api/task-progress/class/${params.taskListId}?${searchParams.toString()}`,
      {
        headers: { ...(authHeader && { Authorization: authHeader }) }
      }
    )
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ success: false, message: '请求失败' }, { status: 500 })
  }
}
