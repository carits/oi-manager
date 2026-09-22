import type { AccountRole, OrganizationMembershipRole, WorkspaceContext } from '@oi-manager/contracts'

export * from './oj-platforms'

export type { AccountRole, OrganizationMembershipRole, WorkspaceContext }

export type ResourceScope = 'campus' | 'personal'
export type ProblemLibraryScope = 'platform' | 'school'

export interface SessionJwtPayload {
  userId: string
  /** Incremented whenever all existing sessions must be revoked. */
  sessionVersion?: number
  accountRole: AccountRole
  username: string
  workspaceMode?: 'work' | 'personal'
}

/**
 * Authenticated request identity. Organization facts are resolved from the
 * explicit request header and never persisted in a signed session.
 */
export interface JwtPayload extends SessionJwtPayload {
  /** Canonical organization identity derived from normalized RoleAssignments. */
  organizationRole?: OrganizationMembershipRole
  /** Request-scoped authorization facts derived from roles and explicit grants. */
  organizationCapabilities?: string[]
  organizationId?: string
  organizationMembershipId?: string
}

export * from './judge-program-protocol'


// 年级计算工具
export {
  calculateGrade,
  calculateGradeSimple,
  calculateGradeByEducationSystem,
  getAllGrades,
  getGradeSortValue,
  parseEducationSystem,
  type CalculateGradeParams
} from './utils/grade'
