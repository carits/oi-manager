import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  archiveBlogPost,
  BlogDomainError,
  convertBlogVersionToSolutionContribution,
  createBlogFromContest,
  createBlogFromSolution,
  createBlogPost,
  createBlogSeries,
  createBlogTag,
  getBlogPost,
  getBlogReferences,
  getBlogSeries,
  getBlogVersion,
  listBlogTags,
  listBlogVersions,
  listMyBlogPosts,
  listMyBlogSeries,
  listTagBlogs,
  listContestBlogs,
  listProblemBlogs,
  listSolutionBlogs,
  listUserBlogs,
  publishBlogPost,
  reorderBlogSeries,
  updateBlogSeries,
  updateBlogDraft,
} from './blog.service'

export const blogRouter = Router()

function endpoint(handler: (req: any) => Promise<unknown>, status = 200) {
  return asyncHandler(async (req: any, res: any) => {
    try {
      const data = await handler(req)
      return res.status(status).json({ success: true, data })
    } catch (error) {
      if (error instanceof BlogDomainError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) })
      }
      throw error
    }
  })
}

blogRouter.post('/blogs', authenticate, endpoint(req => createBlogPost(req.user, req.body), 201))
blogRouter.get('/blogs', authenticate, endpoint(req => listMyBlogPosts(req.user, req.query)))
blogRouter.get('/blogs/:id', authenticate, endpoint(req => getBlogPost(req.user, req.params.id)))
blogRouter.patch('/blogs/:id/draft', authenticate, endpoint(req => updateBlogDraft(req.user, req.params.id, req.body)))
blogRouter.post('/blogs/:id/publish', authenticate, endpoint(req => publishBlogPost(req.user, req.params.id, req.body)))
blogRouter.post('/blogs/:id/archive', authenticate, endpoint(req => archiveBlogPost(req.user, req.params.id)))
blogRouter.get('/blogs/:id/versions', authenticate, endpoint(req => listBlogVersions(req.user, req.params.id)))
blogRouter.get('/blogs/:id/versions/:versionId', authenticate, endpoint(req => getBlogVersion(req.user, req.params.id, req.params.versionId)))
blogRouter.get('/blogs/:id/references', authenticate, endpoint(req => getBlogReferences(req.user, req.params.id)))
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

blogRouter.get('/problems/:problemId/blogs', authenticate, endpoint(req => listProblemBlogs(req.user, req.params.problemId, req.query)))
blogRouter.get('/trainings/:trainingId/blogs', authenticate, endpoint(req => {
  if (!/^\d+$/.test(req.params.trainingId)) throw new BlogDomainError(422, 'BLOG_CONTEST_ID_INVALID', '比赛 ID 无效')
  return listContestBlogs(req.user, Number(req.params.trainingId), req.query)
}))
blogRouter.get('/solutions/:solutionId/related-blogs', authenticate, endpoint(req => listSolutionBlogs(req.user, req.params.solutionId, req.query)))
blogRouter.get('/users/:userId/blogs', authenticate, endpoint(req => listUserBlogs(req.user, req.params.userId, req.query)))
