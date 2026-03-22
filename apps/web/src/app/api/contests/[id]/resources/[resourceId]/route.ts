import { NextRequest, NextResponse } from 'next/server'
import { ENV } from '@/config/env'

// DELETE /api/contests/[id]/resources/[resourceId] - 删除资料
export async function DELETE(request: NextRequest, { params }: { params: { id: string; resourceId: string } }) {
  try {
    const authHeader = request.headers.get('authorization')
    const res = await fetch(`${ENV.API_URL}/api/contests/${params.id}/resources/${params.resourceId}`, {
      method: 'DELETE',
      headers: { ...(authHeader && { Authorization: authHeader }) }
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ success: false, message: '请求失败' }, { status: 500 })
  }
}
