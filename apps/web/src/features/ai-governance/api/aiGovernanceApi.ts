import { AiGovernanceContracts, type AiTokenUsage, type EvaluationBudgetOverview } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function getAiTokenUsage(signal?: AbortSignal): Promise<AiTokenUsage> {
  return apiClient.queryContract(AiGovernanceContracts.tokenUsage, '/api/platform-admin/ai/token-usage', {
    accountScoped: true,
    signal,
  })
}

export function getEvaluationBudget(signal?: AbortSignal): Promise<EvaluationBudgetOverview> {
  return apiClient.queryContract(AiGovernanceContracts.evaluationBudget, '/api/platform-admin/ai/evaluation-budget', {
    accountScoped: true,
    signal,
  })
}

export function adjustAiTokenPool(input: { amount: number; reason: string; idempotencyKey: string }) {
  return apiClient.mutateContract(
    AiGovernanceContracts.adjustTokenPool,
    '/api/platform-admin/ai/token-pool/adjust',
    input,
    { accountScoped: true },
  )
}
