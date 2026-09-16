import {
  OjAccountContracts,
  type OjAccountCreateInput,
  type OjAccountUpdateInput,
} from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

const accountPath = (accountId: string) =>
  `/api/oj-accounts/${encodeURIComponent(accountId)}`

function listPath(platform?: string, status?: string) {
  const params = new URLSearchParams()
  if (platform) params.set('platform', platform)
  if (status) params.set('status', status)
  const query = params.toString()
  return query ? `/api/oj-accounts?${query}` : '/api/oj-accounts'
}

export const listOjAccounts = (platform?: string, status?: string) =>
  apiClient.queryContract(OjAccountContracts.list, listPath(platform, status))

export const getOjAccountStats = () =>
  apiClient.queryContract(OjAccountContracts.stats, '/api/oj-accounts/stats')

export const createOjAccount = (body: OjAccountCreateInput) =>
  apiClient.mutateContract(OjAccountContracts.create, '/api/oj-accounts', body)

export const updateOjAccount = (accountId: string, body: OjAccountUpdateInput) =>
  apiClient.mutateContract(OjAccountContracts.update, accountPath(accountId), body)

export const deleteOjAccount = (accountId: string) =>
  apiClient.mutateContract(OjAccountContracts.delete, accountPath(accountId), {})

export const verifyOjAccount = (accountId: string) =>
  apiClient.mutateContract(OjAccountContracts.verify, `${accountPath(accountId)}/verify`, {})

export const loginOjAccount = (accountId: string) =>
  apiClient.mutateContract(OjAccountContracts.login, `${accountPath(accountId)}/login`, {})

export const batchVerifyOjAccounts = () =>
  apiClient.mutateContract(OjAccountContracts.batchVerify, '/api/oj-accounts/batch-verify', {})
