import { WorkspaceContracts } from '@oi-manager/contracts'
import { accountClient } from '@/lib/apiClient'

export function listWorkspaces() {
  return accountClient.queryContract(WorkspaceContracts.list, '/api/workspaces')
}
