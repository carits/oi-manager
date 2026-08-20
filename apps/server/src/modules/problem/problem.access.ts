import type { JwtPayload, ProblemLibraryScope } from '@oi-manager/shared'
import type { NextFunction, Response } from 'express'
import { prisma } from '../../prisma'
import type { AuthRequest } from '../../middleware/auth'

export type ProblemAccessAction = 'view' | 'use' | 'edit' | 'publish' | 'archive' | 'copy'

export interface ProblemAccessRecord {
  id: string
  libraryScope: string
  organizationId: string | null
  ownerId: string
  status: string
  visibility: string
}

export const isSchoolStaff = (role: string) => role === 'teacher' || role === 'school_principal'
export const isPlatformManager = (role: string) => role === 'platform_admin' || role === 'super_admin'
const isOrganizationContext = (user: JwtPayload) => Boolean(user.organizationId)

export function problemLibraryKey(scope: ProblemLibraryScope, organizationId?: string | null): string {
  return scope === 'school' ? `organization:${organizationId}` : 'platform'
}

export function canViewProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  if (problem.libraryScope === 'platform') {
    if (isPlatformManager(user.role)) return true
    if (!isOrganizationContext(user)) return problem.status === 'published'
    if (user.role === 'student') return false
    return problem.status === 'published'
  }
  if (!isOrganizationContext(user) || !isSchoolStaff(user.role) || problem.organizationId !== user.organizationId) return false
  return user.role === 'school_principal' || problem.ownerId === user.userId || problem.status === 'published'
}

export function canUseProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  if (problem.status !== 'published') return false
  if (problem.libraryScope === 'platform') return true
  return isOrganizationContext(user) && isSchoolStaff(user.role) && problem.organizationId === user.organizationId
}

export function canModifyProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  // Platform managers operate in the platform workspace, which intentionally
  // has no organizationId. Requiring a school context here made platform
  // drafts, judge configs, files and checkers impossible to edit.
  if (problem.libraryScope === 'platform') return isPlatformManager(user.role)
  if (!isOrganizationContext(user)) return false
  if (!isSchoolStaff(user.role) || problem.organizationId !== user.organizationId) return false
  return user.role === 'school_principal' || problem.ownerId === user.userId
}

export function canCopyProblemToSchool(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  return isOrganizationContext(user) && isSchoolStaff(user.role) && problem.libraryScope === 'platform' && problem.status === 'published'
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
  if (isOrganizationContext(user) && isSchoolStaff(user.role)) {
    const schoolProblem = await prisma.problem.findUnique({ where: { libraryKey_platform_problemId: { libraryKey: problemLibraryKey('school', user.organizationId), platform, problemId } } })
    if (schoolProblem && canUseProblem(user, schoolProblem)) return schoolProblem
  }
  const platformProblem = await prisma.problem.findUnique({ where: { libraryKey_platform_problemId: { libraryKey: 'platform', platform, problemId } } })
  return platformProblem && canUseProblem(user, platformProblem) ? platformProblem : null
}

export function requireSchoolStaff(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: '未登录' })
  if (!isOrganizationContext(req.user)) return res.status(403).json({ success: false, code: 'ORGANIZATION_REQUIRED', message: '请从校园身份进入' })
  if (!isSchoolStaff(req.user.role)) return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '校内题库仅对教师开放' })
  next()
}
