import { Router, type Response } from 'express'
import { BlogDiscoveryContracts, BlogManagementContracts } from '@oi-manager/contracts'
import { authenticate, optionalAuthenticate, type AuthRequest } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
import type { JwtPayload } from '@oi-manager/shared'
import {
  archiveBlogPost,
  BlogDomainError,
  convertBlogVersionToSolutionContribution,
  createBlogFromContest,
  createBlogFromSolution,
  createBlogPost,
  createBlogComment,
  createBlogSeries,
  createBlogTag,
  getBlogPost,
  getPublicBlogPost,
  getPublicBlogCommunity,
  getBlogReport,
  getBlogCommunity,
  getBlogReferences,
  getBlogSeries,
  getBlogVersion,
  listBlogTags,
  listBlogComments,
  listBlogCommentReplies,
  listBlogReports,
  listBlogVersions,
  listPublicBlogs,
  listMyBlogPosts,
  listMyBlogSeries,
  listTagBlogs,
  listContestBlogs,
  listProblemBlogs,
  listSolutionBlogs,
  listUserBlogs,
  publishBlogPost,
  moderateBlogReport,
  removeBlogComment,
  reorderBlogSeries,
  updateBlogSeries,
  updateBlogDraft,
  reportBlogContent,
  setBlogBookmark,
  setBlogFeatured,
  setBlogReaction,
} from './blog.service'

export const blogRouter = Router()

type AuthenticatedRequest = AuthRequest & { user: JwtPayload }

function endpoint(handler: (req: AuthenticatedRequest) => Promise<unknown>, status = 200) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const data = await handler(req as AuthenticatedRequest)
      return res.status(status).json({ success: true, data })
    } catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof BlogDomainError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) })
      }
      throw error
    }
  })
}

function publicEndpoint(handler: (req: AuthRequest) => Promise<unknown>, status = 200) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const data = await handler(req)
      return res.status(status).json({ success: true, data })
    } catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof BlogDomainError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) })
      }
      throw error
    }
  })
}

blogRouter.post('/blogs', authenticate, endpoint(req => createBlogPost(req.user, req.body), 201))
blogRouter.get('/blog-discovery', optionalAuthenticate, publicEndpoint(async req => {
  const query = parseContractQuery(BlogDiscoveryContracts.list, req.query)
  return BlogDiscoveryContracts.list.data.parse(await listPublicBlogs(req.user, query))
}))
blogRouter.get('/blog-discovery/:id', optionalAuthenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    return sendContractData(res, BlogDiscoveryContracts.detail, await getPublicBlogPost(req.user, req.params.id))
  } catch (error) {
    if (sendContractError(error, res)) return
    if (error instanceof BlogDomainError) {
      return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
    }
    throw error
  }
}))
blogRouter.get('/blog-discovery/:id/community', optionalAuthenticate, publicEndpoint(req => getPublicBlogCommunity(req.user, req.params.id)))
blogRouter.get('/blog-discovery/:id/comments', optionalAuthenticate, publicEndpoint(req => listBlogComments(req.user, req.params.id, req.query)))
blogRouter.get('/blog-discovery/:id/comments/:commentId/replies', optionalAuthenticate, publicEndpoint(req => listBlogCommentReplies(req.user, req.params.id, req.params.commentId, req.query)))
blogRouter.get('/blogs', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const query = parseContractQuery(BlogManagementContracts.listMine, req.query)
    return sendContractData(res, BlogManagementContracts.listMine, await listMyBlogPosts(req.user!, query))
  } catch (error) {
    if (sendContractError(error, res)) return
    if (error instanceof BlogDomainError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
    throw error
  }
}))
blogRouter.get('/blogs/:id', authenticate, endpoint(req => getBlogPost(req.user, req.params.id)))
blogRouter.patch('/blogs/:id/draft', authenticate, endpoint(req => updateBlogDraft(req.user, req.params.id, req.body)))
blogRouter.post('/blogs/:id/publish', authenticate, endpoint(req => publishBlogPost(req.user, req.params.id, req.body)))
blogRouter.post('/blogs/:id/archive', authenticate, endpoint(req => archiveBlogPost(req.user, req.params.id)))
blogRouter.get('/blogs/:id/versions', authenticate, endpoint(req => listBlogVersions(req.user, req.params.id)))
blogRouter.get('/blogs/:id/versions/:versionId', authenticate, endpoint(req => getBlogVersion(req.user, req.params.id, req.params.versionId)))
blogRouter.get('/blogs/:id/references', authenticate, endpoint(req => getBlogReferences(req.user, req.params.id)))
blogRouter.get('/blogs/:id/community', authenticate, endpoint(req => getBlogCommunity(req.user, req.params.id)))
blogRouter.get('/blogs/:id/comments', authenticate, endpoint(req => listBlogComments(req.user, req.params.id, req.query)))
blogRouter.get('/blogs/:id/comments/:commentId/replies', authenticate, endpoint(req => listBlogCommentReplies(req.user, req.params.id, req.params.commentId, req.query)))
blogRouter.post('/blogs/:id/comments', authenticate, endpoint(req => createBlogComment(req.user, req.params.id, req.body), 201))
blogRouter.delete('/blogs/:id/comments/:commentId', authenticate, endpoint(req => removeBlogComment(req.user, req.params.id, req.params.commentId)))
blogRouter.put('/blogs/:id/reactions/:type', authenticate, endpoint(req => setBlogReaction(req.user, req.params.id, req.params.type, true)))
blogRouter.delete('/blogs/:id/reactions/:type', authenticate, endpoint(req => setBlogReaction(req.user, req.params.id, req.params.type, false)))
blogRouter.put('/blogs/:id/bookmark', authenticate, endpoint(req => setBlogBookmark(req.user, req.params.id, true)))
blogRouter.delete('/blogs/:id/bookmark', authenticate, endpoint(req => setBlogBookmark(req.user, req.params.id, false)))
blogRouter.post('/blogs/:id/reports', authenticate, endpoint(req => reportBlogContent(req.user, req.params.id, req.body), 201))
blogRouter.put('/platform/blogs/:id/featured', authenticate, endpoint(req => setBlogFeatured(req.user, req.params.id, req.body)))
blogRouter.get('/platform/blog-reports', authenticate, endpoint(req => listBlogReports(req.user, req.query)))
blogRouter.get('/platform/blog-reports/:id', authenticate, endpoint(req => getBlogReport(req.user, req.params.id, req.query)))
blogRouter.post('/platform/blog-reports/:id/decision', authenticate, endpoint(req => moderateBlogReport(req.user, req.params.id, req.body)))
blogRouter.post('/blogs/:id/versions/:versionId/convert-to-solution-contribution', authenticate, endpoint(
  req => convertBlogVersionToSolutionContribution(req.user, req.params.id, req.params.versionId, req.body), 201,
))

blogRouter.post('/blog-drafts/from-contest/:trainingId', authenticate, endpoint(req => {
  if (!/^\d+$/.test(req.params.trainingId)) throw new BlogDomainError(422, 'BLOG_CONTEST_ID_INVALID', '比赛 ID 无效')
  return createBlogFromContest(req.user, Number(req.params.trainingId))
}, 201))
blogRouter.post('/blog-drafts/from-solution/:solutionVersionId', authenticate, endpoint(
  req => createBlogFromSolution(req.user, req.params.solutionVersionId), 201,
))

blogRouter.post('/blog-series', authenticate, endpoint(req => createBlogSeries(req.user, req.body), 201))
blogRouter.get('/blog-series', authenticate, endpoint(req => listMyBlogSeries(req.user, req.query)))
blogRouter.get('/blog-series/:seriesId', authenticate, endpoint(req => getBlogSeries(req.user, req.params.seriesId)))
blogRouter.patch('/blog-series/:seriesId', authenticate, endpoint(req => updateBlogSeries(req.user, req.params.seriesId, req.body)))
blogRouter.put('/blog-series/:seriesId/entries', authenticate, endpoint(req => reorderBlogSeries(req.user, req.params.seriesId, req.body)))

blogRouter.get('/blog-tags', authenticate, endpoint(req => listBlogTags(req.user, req.query)))
blogRouter.post('/blog-tags', authenticate, endpoint(req => createBlogTag(req.user, req.body), 201))
blogRouter.post('/platform/blog-tags', authenticate, endpoint(req => createBlogTag(req.user, req.body, true), 201))
blogRouter.get('/blog-tags/:tagId/blogs', authenticate, endpoint(req => listTagBlogs(req.user, req.params.tagId, req.query)))

blogRouter.get('/problems/:problemId/blogs', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const query = parseContractQuery(BlogDiscoveryContracts.relatedByProblem, req.query)
    return sendContractData(res, BlogDiscoveryContracts.relatedByProblem, await listProblemBlogs(req.user!, req.params.problemId, query))
  } catch (error) {
    if (sendContractError(error, res)) return
    if (error instanceof BlogDomainError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
    throw error
  }
}))
blogRouter.get('/contests/:trainingId/blogs', authenticate, endpoint(req => {
  if (!/^\d+$/.test(req.params.trainingId)) throw new BlogDomainError(422, 'BLOG_CONTEST_ID_INVALID', '比赛 ID 无效')
  return listContestBlogs(req.user, Number(req.params.trainingId), req.query)
}))
blogRouter.get('/solutions/:solutionId/related-blogs', authenticate, endpoint(req => listSolutionBlogs(req.user, req.params.solutionId, req.query)))
blogRouter.get('/users/:userId/blogs', authenticate, endpoint(req => listUserBlogs(req.user, req.params.userId, req.query)))
