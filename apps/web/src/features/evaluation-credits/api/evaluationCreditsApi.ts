import { EvaluationCreditContracts, type EndpointBody } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export const getEvaluationCreditOverview = () =>
  apiClient.queryContract(EvaluationCreditContracts.overview, '/api/resources/evaluation-credits', { accountScoped: true })

export const purchaseEvaluationCreditPackage = (
  body: EndpointBody<typeof EvaluationCreditContracts.purchase>,
  idempotencyKey: string,
) => apiClient.mutateContract(
  EvaluationCreditContracts.purchase,
  '/api/resources/evaluation-credits/purchase',
  body,
  { accountScoped: true, headers: { 'Idempotency-Key': idempotencyKey } },
)
