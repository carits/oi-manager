/**
 * Team Router - Re-export Entry Point
 * 团队路由重导出入口
 *
 * This file serves as a backward-compatible entry point.
 * The actual implementation has been moved to src/modules/team/
 *
 * Architecture:
 * - team.routes.ts    → Route definitions (this file re-exports)
 * - team.service.ts   → Business logic
 * - team.repository.ts → Data access
 * - team.utils.ts     → Utility functions
 * - team.types.ts     → Type definitions
 */

// Re-export the router from the modular structure
export { teamRouter } from '../modules/team/team.routes'

// Re-export commonly used types and utilities for backward compatibility
export type {
  MemberType,
  MemberRole,
  MemberStatus,
  TeamListItem,
  TeamDetail,
  CreateTeamDTO,
  UpdateTeamDTO
} from '../modules/team/team.types'

// Re-export service for direct use if needed
export { teamService } from '../modules/team/team.service'

// Re-export repository for direct use if needed
export { teamRepository, TeamRepository } from '../modules/team/team.repository'
