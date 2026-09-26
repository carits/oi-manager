import { Router } from 'express'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { compileJudgeProgramVersion, createJudgeProgram, createJudgeProgramFixtureSet, createJudgeProgramVersion, deleteJudgeProgramDraft, getJudgeProgramCapabilities, getJudgeProgramVerification, JudgeProgramError, listJudgeProgramAuditLogs, listJudgeProgramDrafts, listJudgeProgramFixtureSets, listJudgePrograms, listJudgeProgramTemplates, preflightJudgeProgramVersion, readJudgeProgramTemplate, saveJudgeProgramDraft, updateJudgeProgram } from './problem.judge-program.service'

export const problemJudgeProgramRouter = Router()
export const judgeProgramTemplateRouter = Router()

function send(error: unknown, res: any) {
  if (sendContractError(error, res)) return res
  if (!(error instanceof JudgeProgramError)) throw error
  return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) })
}

problemJudgeProgramRouter.get('/judge-program-templates', authenticate, asyncHandler(async (_req, res) => {
  sendContractData(res, ProblemContracts.listJudgeProgramTemplates, { ...getJudgeProgramCapabilities(), templates: listJudgeProgramTemplates() })
}))
problemJudgeProgramRouter.get('/judge-program-templates/:templateId', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.getJudgeProgramTemplate, readJudgeProgramTemplate(req.params.templateId)) }
  catch (error) { return send(error, res) }
}))
judgeProgramTemplateRouter.get('/judge-program-templates', authenticate, asyncHandler(async (_req, res) => {
  sendContractData(res, ProblemContracts.listJudgeProgramTemplates, { ...getJudgeProgramCapabilities(), templates: listJudgeProgramTemplates() })
}))
judgeProgramTemplateRouter.get('/judge-program-templates/:templateId', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.getJudgeProgramTemplate, readJudgeProgramTemplate(req.params.templateId)) }
  catch (error) { return send(error, res) }
}))

problemJudgeProgramRouter.get('/:id/judge-program-drafts', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.listJudgeProgramDrafts, await listJudgeProgramDrafts(req.user!, req.params.id)) }
  catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.post('/:id/judge-program-drafts', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.saveJudgeProgramDraft, req.body)
    sendContractData(res, ProblemContracts.saveJudgeProgramDraft, await saveJudgeProgramDraft({ user: req.user!, problemId: req.params.id, ...body }), 201)
  } catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.patch('/:id/judge-program-drafts/:draftId', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.updateJudgeProgramDraft, req.body)
    sendContractData(res, ProblemContracts.updateJudgeProgramDraft, await saveJudgeProgramDraft({ user: req.user!, problemId: req.params.id, draftId: req.params.draftId, ...body }))
  } catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.delete('/:id/judge-program-drafts/:draftId', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.deleteJudgeProgramDraft, req.body || {})
    sendContractData(res, ProblemContracts.deleteJudgeProgramDraft, await deleteJudgeProgramDraft(req.user!, req.params.id, req.params.draftId))
  } catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.get('/:id/judge-programs', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.listJudgePrograms, await listJudgePrograms(req.user!, req.params.id)) }
  catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.get('/:id/judge-program-audit-logs', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.listJudgeProgramAuditLogs, await listJudgeProgramAuditLogs(req.user!, req.params.id)) }
  catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.post('/:id/judge-programs', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.createJudgeProgram, req.body)
    sendContractData(res, ProblemContracts.createJudgeProgram, await createJudgeProgram({ user: req.user!, problemId: req.params.id, ...body }), 201)
  } catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.post('/:id/judge-programs/:programId/versions', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.createJudgeProgramVersion, req.body)
    sendContractData(res, ProblemContracts.createJudgeProgramVersion, await createJudgeProgramVersion({ user: req.user!, problemId: req.params.id, programId: req.params.programId, ...body }), 201)
  } catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.post('/:id/judge-programs/:programId/fixture-sets', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.createJudgeProgramFixtureSet, req.body)
    sendContractData(res, ProblemContracts.createJudgeProgramFixtureSet, await createJudgeProgramFixtureSet({ user: req.user!, problemId: req.params.id, programId: req.params.programId, fixtures: body.fixtures }), 201)
  } catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.get('/:id/judge-programs/:programId/fixture-sets', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.listJudgeProgramFixtureSets, await listJudgeProgramFixtureSets(req.user!, req.params.id, req.params.programId)) }
  catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.post('/:id/judge-programs/:programId/versions/:versionId/compile', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.compileJudgeProgramVersion, req.body || {})
    sendContractData(res, ProblemContracts.compileJudgeProgramVersion, await compileJudgeProgramVersion({ user: req.user!, problemId: req.params.id, programId: req.params.programId, versionId: req.params.versionId }), 202)
  } catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.post('/:id/judge-programs/:programId/versions/:versionId/preflight', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.preflightJudgeProgramVersion, req.body)
    sendContractData(res, ProblemContracts.preflightJudgeProgramVersion, await preflightJudgeProgramVersion({ user: req.user!, problemId: req.params.id, programId: req.params.programId, versionId: req.params.versionId, ...body }), 202)
  } catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.get('/:id/judge-programs/:programId/versions/:versionId/verification', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.getJudgeProgramVerification, await getJudgeProgramVerification(req.user!, req.params.id, req.params.programId, req.params.versionId)) }
  catch (error) { return send(error, res) }
}))
problemJudgeProgramRouter.patch('/:id/judge-programs/:programId', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.updateJudgeProgram, req.body)
    sendContractData(res, ProblemContracts.updateJudgeProgram, await updateJudgeProgram({ user: req.user!, problemId: req.params.id, programId: req.params.programId, ...body }))
  } catch (error) { return send(error, res) }
}))
