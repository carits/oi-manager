import { BlogModerationContracts, type EndpointBody } from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

const encode = encodeURIComponent

export function listBlogReports(status: 'pending' | 'resolved' | 'dismissed', page = 1, pageSize = 20) {
  const query = BlogModerationContracts.listReports.query.parse({ status, page, pageSize })
  const params = new URLSearchParams({ status: query.status || '', page: String(query.page), pageSize: String(query.pageSize) })
  return accountClient.queryContract(BlogModerationContracts.listReports, '/api/platform/blog-reports?' + params)
}

export function getBlogReport(reportId: string, reason: string) {
  const query = BlogModerationContracts.reportDetail.query.parse({ reason })
  return accountClient.queryContract(BlogModerationContracts.reportDetail, '/api/platform/blog-reports/' + encode(reportId) + '?reason=' + encode(query.reason))
}

export function decideBlogReport(reportId: string, body: EndpointBody<typeof BlogModerationContracts.decideReport>) {
  return accountClient.mutateContract(BlogModerationContracts.decideReport, '/api/platform/blog-reports/' + encode(reportId) + '/decision', body)
}

export function setBlogFeatured(postId: string, body: EndpointBody<typeof BlogModerationContracts.setFeatured>) {
  return accountClient.mutateContract(BlogModerationContracts.setFeatured, '/api/platform/blogs/' + encode(postId) + '/featured', body)
}
