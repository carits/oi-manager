import { ProblemSelectionContracts, type EndpointBody } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function resolveProblemSelection(body: EndpointBody<typeof ProblemSelectionContracts.resolve>) {
  return apiClient.mutateContract(ProblemSelectionContracts.resolve, '/api/problem-selection/resolve', body)
}

