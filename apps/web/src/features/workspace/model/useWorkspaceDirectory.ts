'use client'

import { useFeatureResource } from '@/hooks/data/useFeatureResource'
import { listWorkspaces } from '../api/workspaceApi'

/** Account-scoped directory only. A catalog entry never changes or grants authorization. */
export function useWorkspaceDirectory(userId: string | undefined, enabled = true) {
  return useFeatureResource('workspace:directory', userId ? `account:${userId}` : null, listWorkspaces, {
    enabled,
    keepPreviousData: false,
  })
}
