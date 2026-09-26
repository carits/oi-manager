import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination } from '../../lib/pagination'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractQuery, sendContractData } from '../../lib/api-contract'
import logger from '../../lib/logger'
import { listOwnProblemSubmissions } from './application/problem-route.service'

export const problemSubmissionsRouter = Router()

problemSubmissionsRouter.get('/:id/submissions', authenticate, asyncHandler(async (req, res) => {
  const query = parseContractQuery(ProblemContracts.listSubmissions, req.query)
  const pagination = parsePagination(query, { defaultPageSize: 20, maxPageSize: 100 })
  const result = await listOwnProblemSubmissions(req.user!, req.params.id, pagination)
  if (!result) return res.status(404).json({ success: false, message: '题目不存在' })
  logger.info('problem_submissions_query', {
    action: 'problems',
    metadata: {
      problemInternalId: req.params.id,
      platform: result.problem.platform,
      problemId: result.problem.problemId,
      currentUser: req.user!.username,
      returnedCount: result.submissions.length,
      total: result.pagination.total,
    },
  })
  return sendContractData(res, ProblemContracts.listSubmissions, {
    submissions: result.submissions,
    page: result.pagination.page,
    pageSize: result.pagination.pageSize,
    total: result.pagination.total,
    totalPages: result.pagination.totalPages,
  })
}, '查询失败'))
