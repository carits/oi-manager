import type { JwtPayload } from '@oi-manager/shared'
import type { NextFunction, Response } from 'express'
import { prisma } from '../../prisma'
import type { AuthRequest } from '../../middleware/auth'
import { requestHasOrganizationCapability } from '../authorization/capabilities'
import { canCopyProblemToSchool, canUseProblem, canViewProblem, canModifyProblem, type ProblemAccessAction } from './problem.authorization'
import { findPrimaryUsableProblem } from './problem.identity'
export * from './problem.authorization'
const isOrganizationContext = (user: JwtPayload) => Boolean(user.organizationId)

export async function findAccessibleProblem(user: JwtPayload, id: string, action: ProblemAccessAction = 'view') {
  const problem = await prisma.problem.findUnique({ where: { id } })
  if (!problem) return null
  const allowed = action === 'copy' ? canCopyProblemToSchool(user, problem) : action === 'use' ? canUseProblem(user, problem) : action === 'view' ? canViewProblem(user, problem) : canModifyProblem(user, problem)
  return allowed ? problem : null
}

export async function findUsableProblemByExternalId(user: JwtPayload, platform: string, problemId: string) {
  return findPrimaryUsableProblem(user, platform, problemId)
}

export function requireSchoolStaff(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: '未登录' })
  if (!isOrganizationContext(req.user)) return res.status(403).json({ success: false, code: 'ORGANIZATION_REQUIRED', message: '请从校园身份进入' })
  if (!requestHasOrganizationCapability(req.user, 'problem.create')) return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '校内题库仅对教师开放' })
  next()
}
