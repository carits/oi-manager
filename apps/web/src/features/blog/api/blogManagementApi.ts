import {
  BlogManagementContracts,
  type EndpointBody,
} from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

function encode(value: string) {
  return encodeURIComponent(value)
}

export function getBlogPost(postId: string) {
  return accountClient.queryContract(BlogManagementContracts.detail, '/api/blogs/' + encode(postId))
}

export function createBlogPost(body: EndpointBody<typeof BlogManagementContracts.create>) {
  return accountClient.mutateContract(BlogManagementContracts.create, '/api/blogs', body)
}

export function updateBlogDraft(postId: string, body: EndpointBody<typeof BlogManagementContracts.updateDraft>) {
  return accountClient.mutateContract(BlogManagementContracts.updateDraft, '/api/blogs/' + encode(postId) + '/draft', body)
}

export function publishBlogPost(postId: string, body: EndpointBody<typeof BlogManagementContracts.publish>) {
  return accountClient.mutateContract(BlogManagementContracts.publish, '/api/blogs/' + encode(postId) + '/publish', body)
}

export function archiveBlogPost(postId: string) {
  return accountClient.mutateContract(BlogManagementContracts.archive, '/api/blogs/' + encode(postId) + '/archive', undefined)
}

export function listBlogVersions(postId: string) {
  return accountClient.queryContract(BlogManagementContracts.versions, '/api/blogs/' + encode(postId) + '/versions')
}

export function getBlogVersion(postId: string, versionId: string) {
  return accountClient.queryContract(
    BlogManagementContracts.versionDetail,
    '/api/blogs/' + encode(postId) + '/versions/' + encode(versionId),
  )
}

export function listBlogSeries(pageSize = 100) {
  const query = BlogManagementContracts.listSeries.query.parse({ page: 1, pageSize })
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  return accountClient.queryContract(BlogManagementContracts.listSeries, '/api/blog-series?' + params)
}

export function getBlogSeries(seriesId: string) {
  return accountClient.queryContract(BlogManagementContracts.seriesDetail, '/api/blog-series/' + encode(seriesId))
}

export function createBlogSeries(body: EndpointBody<typeof BlogManagementContracts.createSeries>) {
  return accountClient.mutateContract(BlogManagementContracts.createSeries, '/api/blog-series', body)
}

export function updateBlogSeries(seriesId: string, body: EndpointBody<typeof BlogManagementContracts.updateSeries>) {
  return accountClient.mutateContract(BlogManagementContracts.updateSeries, '/api/blog-series/' + encode(seriesId), body)
}

export function reorderBlogSeries(seriesId: string, body: EndpointBody<typeof BlogManagementContracts.reorderSeries>) {
  return accountClient.mutateContract(BlogManagementContracts.reorderSeries, '/api/blog-series/' + encode(seriesId) + '/entries', body)
}

export function listBlogTags(q?: string) {
  const query = BlogManagementContracts.listTags.query.parse({ q })
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  const suffix = params.size ? '?' + params : ''
  return accountClient.queryContract(BlogManagementContracts.listTags, '/api/blog-tags' + suffix)
}
