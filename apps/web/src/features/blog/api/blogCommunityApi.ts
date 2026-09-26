import { BlogCommunityContracts, type EndpointBody } from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

function readBase(postId: string, publicRead: boolean) {
  return (publicRead ? '/api/blog-discovery/' : '/api/blogs/') + encodeURIComponent(postId)
}

export function getBlogCommunity(postId: string, publicRead: boolean) {
  return accountClient.queryContract(BlogCommunityContracts.summary, readBase(postId, publicRead) + '/community')
}

export function listBlogComments(postId: string, publicRead: boolean, pageSize = 100) {
  const query = BlogCommunityContracts.comments.query.parse({ page: 1, pageSize })
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  return accountClient.queryContract(BlogCommunityContracts.comments, readBase(postId, publicRead) + '/comments?' + params)
}

export function listBlogReplies(postId: string, commentId: string, publicRead: boolean, cursor?: string) {
  const query = BlogCommunityContracts.replies.query.parse({ pageSize: 20, cursor })
  const params = new URLSearchParams({ pageSize: String(query.pageSize) })
  if (query.cursor) params.set('cursor', query.cursor)
  return accountClient.queryContract(
    BlogCommunityContracts.replies,
    readBase(postId, publicRead) + '/comments/' + encodeURIComponent(commentId) + '/replies?' + params,
  )
}

export function createBlogComment(postId: string, body: EndpointBody<typeof BlogCommunityContracts.createComment>) {
  return accountClient.mutateContract(BlogCommunityContracts.createComment, '/api/blogs/' + encodeURIComponent(postId) + '/comments', body)
}

export function removeBlogComment(postId: string, commentId: string) {
  return accountClient.mutateContract(
    BlogCommunityContracts.removeComment,
    '/api/blogs/' + encodeURIComponent(postId) + '/comments/' + encodeURIComponent(commentId),
    undefined,
  )
}

export function setBlogReaction(postId: string, type: 'LIKE' | 'HELPFUL', active: boolean) {
  const contract = active ? BlogCommunityContracts.addReaction : BlogCommunityContracts.removeReaction
  return accountClient.mutateContract(
    contract,
    '/api/blogs/' + encodeURIComponent(postId) + '/reactions/' + type,
    active ? {} : undefined,
  )
}

export function setBlogBookmark(postId: string, active: boolean) {
  const contract = active ? BlogCommunityContracts.addBookmark : BlogCommunityContracts.removeBookmark
  return accountClient.mutateContract(contract, '/api/blogs/' + encodeURIComponent(postId) + '/bookmark', active ? {} : undefined)
}

export function reportBlogContent(postId: string, body: EndpointBody<typeof BlogCommunityContracts.report>) {
  return accountClient.mutateContract(BlogCommunityContracts.report, '/api/blogs/' + encodeURIComponent(postId) + '/reports', body)
}
