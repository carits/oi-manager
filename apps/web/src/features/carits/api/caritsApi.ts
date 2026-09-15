import { CaritsContracts } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export const getPersonalCaritsTransactions = () =>
  apiClient.queryContract(CaritsContracts.personalTransactions, '/api/carits/me/transactions', { accountScoped: true })

export const getOrganizationCaritsTransactions = (organizationId: string) =>
  apiClient.queryContract(CaritsContracts.organizationTransactions, `/api/carits/organizations/${encodeURIComponent(organizationId)}/transactions`)

export const getPlatformCaritsAudit = () =>
  apiClient.queryContract(CaritsContracts.platformAudit, '/api/carits/platform', { accountScoped: true })
