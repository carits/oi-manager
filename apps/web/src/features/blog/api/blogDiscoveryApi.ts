import {
  BlogDiscoveryContracts,
  type BlogDiscoveryDetail,
  type BlogDiscoveryList,
  type BlogPostType,
} from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

export function listBlogDiscovery(input: {
  page: number
  pageSize: number
  q?: string
  type?: BlogPostType
}): Promise<BlogDiscoveryList> {
  const query = BlogDiscoveryContracts.list.query.parse(input)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return accountClient.queryContract(BlogDiscoveryContracts.list, `/api/blog-discovery?${params}`)
}

export function getBlogDiscovery(id: string): Promise<BlogDiscoveryDetail> {
  return accountClient.queryContract(
    BlogDiscoveryContracts.detail,
    `/api/blog-discovery/${encodeURIComponent(id)}`,
  )
}
