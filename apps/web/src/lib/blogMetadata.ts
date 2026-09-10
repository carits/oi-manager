import 'server-only'
import { ENV } from '@/config/env'

export type PublicBlogMetadata = {
  slug?: string
  currentVersion?: { title?: string; summary?: string | null } | null
}

export async function readPublicBlogMetadata(id: string): Promise<PublicBlogMetadata | null> {
  try {
    const response = await fetch(`${ENV.BACKEND_URL}/api/blog-discovery/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    const payload = await response.json()
    return response.ok && payload?.success && payload.data ? payload.data as PublicBlogMetadata : null
  } catch {
    return null
  }
}
