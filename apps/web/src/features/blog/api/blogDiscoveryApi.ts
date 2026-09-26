import {
  BlogDiscoveryContracts,
  BlogManagementContracts,
  type BlogDiscoveryDetail,
  type BlogDiscoveryList,
  type BlogPostType,
  type BlogPostStatus,
  type MyBlogList,
  type ProblemRelatedBlogList,
} from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

export function listMyBlogPosts(input: { page: number; pageSize: number; status?: BlogPostStatus }): Promise<MyBlogList> {
  const query = BlogManagementContracts.listMine.query.parse(input)
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.status) params.set('status', query.status)
  return accountClient.queryContract(BlogManagementContracts.listMine, `/api/blogs?${params}`)
}

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

export function listProblemRelatedBlogs(problemId: string, pageSize = 50): Promise<ProblemRelatedBlogList> {
  const query = BlogDiscoveryContracts.relatedByProblem.query.parse({ page: 1, pageSize })
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  return accountClient.queryContract(
    BlogDiscoveryContracts.relatedByProblem,
    `/api/problems/${encodeURIComponent(problemId)}/blogs?${params}`,
  )
}

export function getBlogDiscovery(id: string): Promise<BlogDiscoveryDetail> {
  return accountClient.queryContract(
    BlogDiscoveryContracts.detail,
    `/api/blog-discovery/${encodeURIComponent(id)}`,
  )
}
