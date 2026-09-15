import {
  ContributionContracts,
  type EndpointBody,
  type EndpointQuery,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

function queryString(value: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, item] of Object.entries(value)) if (item !== undefined && item !== '') query.set(key, String(item))
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

export const getContributionSummary = () =>
  apiClient.queryContract(ContributionContracts.summary, '/api/contributions/me/summary', { accountScoped: true })

export const listMyContributionEvents = (query: EndpointQuery<typeof ContributionContracts.mine>) =>
  apiClient.queryContract(ContributionContracts.mine, `/api/contributions/me/events${queryString(query)}`, { accountScoped: true })

export const listContributionAudit = (query: EndpointQuery<typeof ContributionContracts.audit>) =>
  apiClient.queryContract(ContributionContracts.audit, `/api/platform/contributions${queryString(query)}`, { accountScoped: true })

export const getContributionEvidence = (id: string, kind: 'candidate' | 'revision') =>
  apiClient.queryContract(ContributionContracts.evidence, `/api/platform/contributions/${encodeURIComponent(id)}/evidence?kind=${kind}`, { accountScoped: true })

export const acceptContribution = (id: string) =>
  apiClient.mutateContract(ContributionContracts.accept, `/api/platform/contributions/${encodeURIComponent(id)}/accept`, {}, { accountScoped: true })

export const rejectContribution = (id: string, body: EndpointBody<typeof ContributionContracts.reject>) =>
  apiClient.mutateContract(ContributionContracts.reject, `/api/platform/contributions/${encodeURIComponent(id)}/reject`, body, { accountScoped: true })

export const revokeContribution = (id: string, body: EndpointBody<typeof ContributionContracts.revoke>) =>
  apiClient.mutateContract(ContributionContracts.revoke, `/api/platform/contributions/${encodeURIComponent(id)}/revoke`, body, { accountScoped: true })

export const retryContributionReward = (id: string) =>
  apiClient.mutateContract(ContributionContracts.retryReward, `/api/platform/contributions/${encodeURIComponent(id)}/retry-reward`, {}, { accountScoped: true })
