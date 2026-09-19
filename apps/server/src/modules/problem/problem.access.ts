import type { JwtPayload, ProblemLibraryScope } from '@oi-manager/shared'
import type { NextFunction, Response } from 'express'
import { prisma } from '../../prisma'
import type { AuthRequest } from '../../middleware/auth'
import { requestHasOrganizationCapability, requestOrganizationCapabilityScope } from '../authorization/capabilities'

export type ProblemAccessAction = 'view' | 'use' | 'edit' | 'publish' | 'archive' | 'copy'

export interface ProblemAccessRecord {
  id: string
  libraryScope: string
  organizationId: string | null
  ownerId: string
  status: string
  visibility: string
}

export const isPlatformManager = (role: string) => role === 'platform_admin' || role === 'super_admin'
const isOrganizationContext = (user: JwtPayload) => Boolean(user.organizationId)
const accountRole = (user: JwtPayload) => user.accountRole

export function problemLibraryKey(scope: ProblemLibraryScope, organizationId?: string | null): string {
  return scope === 'school' ? `organization:${organizationId}` : 'platform'
}

export function canViewProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  if (problem.libraryScope === 'platform') {
    if (isPlatformManager(accountRole(user))) return true
    if (!isOrganizationContext(user)) return problem.status === 'published'
    return requestHasOrganizationCapability(user, 'problem.create') && problem.status === 'published'
  }
  if (!isOrganizationContext(user) || problem.organizationId !== user.organizationId) return false
  if (!requestHasOrganizationCapability(user, 'problem.create')) return false
  const scope = requestOrganizationCapabilityScope(user, 'problem.manage')
  return scope === 'all' || (scope === 'own' && problem.ownerId === user.userId) || problem.status === 'published'
}

export function canUseProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  if (problem.status !== 'published') return false
  if (problem.libraryScope === 'platform') return true
  return isOrganizationContext(user) && requestHasOrganizationCapability(user, 'problem.create') && problem.organizationId === user.organizationId
}

export function canModifyProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  // Platform managers operate in the platform workspace, which intentionally
  // has no organizationId. Requiring a school context here made platform
  // drafts, judge configs, files and checkers impossible to edit.
  if (problem.libraryScope === 'platform') return isPlatformManager(accountRole(user))
  if (!isOrganizationContext(user)) return false
  if (problem.organizationId !== user.organizationId) return false
  const scope = requestOrganizationCapabilityScope(user, 'problem.manage')
  return scope === 'all' || (scope === 'own' && problem.ownerId === user.userId)
}

export function canCopyProblemToSchool(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  return isOrganizationContext(user) && requestHasOrganizationCapability(user, 'problem.create') && problem.libraryScope === 'platform' && problem.status === 'published'
}

export function problemPermissions(user: JwtPayload, problem: ProblemAccessRecord) {
  const canEdit = canModifyProblem(user, problem)
  return { canView: canViewProblem(user, problem), canUse: canUseProblem(user, problem), canEdit, canPublish: canEdit, canArchive: canEdit, canCopyToSchool: canCopyProblemToSchool(user, problem) }
}

export async function findAccessibleProblem(user: JwtPayload, id: string, action: ProblemAccessAction = 'view') {
  const problem = await prisma.problem.findUnique({ where: { id } })
  if (!problem) return null
  const allowed = action === 'copy' ? canCopyProblemToSchool(user, problem) : action === 'use' ? canUseProblem(user, problem) : action === 'view' ? canViewProblem(user, problem) : canModifyProblem(user, problem)
  return allowed ? problem : null
}

export async function findUsableProblemByExternalId(user: JwtPayload, platform: string, problemId: string) {
  if (isOrganizationContext(user) && requestHasOrganizationCapability(user, 'organization.view')) {
    const schoolProblem = await prisma.problem.findUnique({ where: { libraryKey_platform_problemId: { libraryKey: problemLibraryKey('school', user.organizationId), platform, problemId } } })
    if (schoolProblem && canUseProblem(user, schoolProblem)) return schoolProblem
  }
  const platformProblem = await prisma.problem.findUnique({ where: { libraryKey_platform_problemId: { libraryKey: 'platform', platform, problemId } } })
  return platformProblem && canUseProblem(user, platformProblem) ? platformProblem : null
}

export function requireSchoolStaff(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: '未登录' })
  if (!isOrganizationContext(req.user)) return res.status(403).json({ success: false, code: 'ORGANIZATION_REQUIRED', message: '请从校园身份进入' })
  if (!requestHasOrganizationCapability(req.user, 'problem.create')) return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '校内题库仅对教师开放' })
  next()
}
