import type { JwtPayload, ProblemLibraryScope } from '@oi-manager/shared'
import type { NextFunction, Response } from 'express'
import { prisma } from '../../prisma'
import { getWorkspaceMode, type AuthRequest } from '../../middleware/auth'

export type ProblemAccessAction = 'view' | 'use' | 'edit' | 'publish' | 'archive' | 'copy'

export interface ProblemAccessRecord {
  id: string
  libraryScope: string
  schoolId: string | null
  ownerId: string
  status: string
  visibility: string
}

export const isSchoolStaff = (role: string) => role === 'teacher' || role === 'school_principal'
export const isPlatformManager = (role: string) => role === 'platform_admin' || role === 'super_admin'

export function problemLibraryKey(scope: ProblemLibraryScope, schoolId?: string | null): string {
  return scope === 'school' ? `school:${schoolId}` : 'platform'
}

export function canViewProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  if (problem.libraryScope === 'platform') {
    if (getWorkspaceMode(user) === 'personal') return problem.status === 'published'
    if (user.role === 'student') return false
    return isPlatformManager(user.role) || problem.status === 'published'
  }

  if (getWorkspaceMode(user) !== 'work' || !isSchoolStaff(user.role)) return false
  if (!user.schoolId || problem.schoolId !== user.schoolId) return false
  if (user.role === 'school_principal' || problem.ownerId === user.userId) return true
  return problem.status === 'published'
}

export function canUseProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  if (problem.status !== 'published') return false
  if (problem.libraryScope === 'platform') return true
  return getWorkspaceMode(user) === 'work'
    && isSchoolStaff(user.role)
    && !!user.schoolId
    && problem.schoolId === user.schoolId
}

export function canModifyProblem(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  if (getWorkspaceMode(user) !== 'work') return false
  if (problem.libraryScope === 'platform') return isPlatformManager(user.role)
  if (!isSchoolStaff(user.role) || !user.schoolId || problem.schoolId !== user.schoolId) return false
  return user.role === 'school_principal' || problem.ownerId === user.userId
}

export function canCopyProblemToSchool(user: JwtPayload, problem: ProblemAccessRecord): boolean {
  return getWorkspaceMode(user) === 'work'
    && isSchoolStaff(user.role)
    && !!user.schoolId
    && problem.libraryScope === 'platform'
    && problem.status === 'published'
}

export function problemPermissions(user: JwtPayload, problem: ProblemAccessRecord) {
  const canEdit = canModifyProblem(user, problem)
  return {
    canView: canViewProblem(user, problem),
    canUse: canUseProblem(user, problem),
    canEdit,
    canPublish: canEdit,
    canArchive: canEdit,
    canCopyToSchool: canCopyProblemToSchool(user, problem),
  }
}

export async function findAccessibleProblem(user: JwtPayload, id: string, action: ProblemAccessAction = 'view') {
  const problem = await prisma.problem.findUnique({ where: { id } })
  if (!problem) return null
  const allowed = action === 'copy'
    ? canCopyProblemToSchool(user, problem)
    : action === 'use'
      ? canUseProblem(user, problem)
      : action === 'view'
        ? canViewProblem(user, problem)
        : canModifyProblem(user, problem)
  return allowed ? problem : null
}

export async function findUsableProblemByExternalId(user: JwtPayload, platform: string, problemId: string) {
  if (getWorkspaceMode(user) === 'work' && isSchoolStaff(user.role) && user.schoolId) {
    const schoolProblem = await prisma.problem.findUnique({
      where: {
        libraryKey_platform_problemId: {
          libraryKey: problemLibraryKey('school', user.schoolId),
          platform,
          problemId,
        },
      },
    })
    if (schoolProblem && canUseProblem(user, schoolProblem)) return schoolProblem
  }
  const platformProblem = await prisma.problem.findUnique({
    where: { libraryKey_platform_problemId: { libraryKey: 'platform', platform, problemId } },
  })
  return platformProblem && canUseProblem(user, platformProblem) ? platformProblem : null
}

export function requireSchoolStaff(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: '未登录' })
  if (getWorkspaceMode(req.user) !== 'work') {
    return res.status(403).json({ success: false, code: 'WORKSPACE_MODE_REQUIRED', message: '请先切换到工作模式' })
  }
  if (!isSchoolStaff(req.user.role)) {
    return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '校内题库仅对教师开放' })
  }
  if (!req.user.schoolId) {
    return res.status(403).json({ success: false, code: 'SCHOOL_MEMBERSHIP_REQUIRED', message: '当前账号未关联学校' })
  }
  next()
}
