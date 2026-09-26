import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination } from '../../lib/pagination'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
import {
  archiveProblem,
  copyProblemIntoSchool,
  createProblem,
  getProblemDetail,
  listProblems,
  listSchoolProblemCreators,
  ProblemCrudError,
  updateProblem,
} from './application/problem-crud.service'

export const problemCrudRouter = Router()

function sendProblemCrudError(error: unknown, res: any) {
  if (sendContractError(error, res)) return res
  if (!(error instanceof ProblemCrudError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.data !== undefined ? { data: error.data } : {}),
  })
}

problemCrudRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  try {
    const query = parseContractQuery(ProblemContracts.listAdmin, req.query)
    const data = await listProblems({
      user: req.user!,
      query,
      pagination: parsePagination(query),
    })
    return sendContractData(res, ProblemContracts.listAdmin, data)
  } catch (error) {
    return sendProblemCrudError(error, res)
  }
}))

problemCrudRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.create, req.body)
    const data = await createProblem(req.user!, body)
    return sendContractData(res, ProblemContracts.create, data, 201)
  } catch (error) {
    return sendProblemCrudError(error, res)
  }
}))

problemCrudRouter.post('/:id/copy-to-school', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await copyProblemIntoSchool(req.user!, req.params.id)
    return sendContractData(res, ProblemContracts.copyToSchool, data, 201)
  } catch (error) {
    return sendProblemCrudError(error, res)
  }
}))

problemCrudRouter.get('/library/creators', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await listSchoolProblemCreators(req.user!)
    return res.json({ success: true, data })
  } catch (error) {
    return sendProblemCrudError(error, res)
  }
}))

problemCrudRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemDetail(req.user!, req.params.id)
    return sendContractData(res, ProblemContracts.getEditorDetail, data)
  } catch (error) {
    return sendProblemCrudError(error, res)
  }
}))

problemCrudRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.update, req.body)
    const data = await updateProblem(req.user!, req.params.id, body)
    return sendContractData(res, ProblemContracts.update, data)
  } catch (error) {
    return sendProblemCrudError(error, res)
  }
}))

problemCrudRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.archive, req.body || {})
    const result = await archiveProblem(req.user!, req.params.id)
    return sendContractData(res, ProblemContracts.archive, {})
  } catch (error) {
    return sendProblemCrudError(error, res)
  }
}))
