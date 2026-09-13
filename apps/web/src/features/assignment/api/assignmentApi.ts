import {
  AssignmentContracts,
  AssignmentProgressQuerySchema,
  type AssignmentProgressData,
  type ManualCompletionBody,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export async function getAssignmentProgress(
  assignmentId: string,
  input: Partial<{ page: number; pageSize: number; q: string; problemId: string; state: string }> = {},
): Promise<AssignmentProgressData> {
  const query = AssignmentProgressQuerySchema.parse(input)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return apiClient.queryContract(
    AssignmentContracts.progress,
    `/api/assignments/${encodeURIComponent(assignmentId)}/progress?${params}`,
  )
}

export function setAssignmentManualCompletion(
  assignmentId: string,
  progressId: string,
  body: ManualCompletionBody,
) {
  return apiClient.mutateContract(
    AssignmentContracts.manualCompletion,
    `/api/assignments/${encodeURIComponent(assignmentId)}/progress/${encodeURIComponent(progressId)}/manual-completion`,
    body,
  )
}
