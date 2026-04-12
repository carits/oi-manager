import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const filePath = path.join('/')
  const apiUrl = process.env.BACKEND_URL || 'http://localhost:3002'

  const response = await fetch(`${apiUrl}/uploads/problems/${filePath}`)

  if (!response.ok) {
    return new NextResponse('PDF not found', { status: 404 })
  }

  const pdfBuffer = await response.arrayBuffer()

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
    }
  })
}