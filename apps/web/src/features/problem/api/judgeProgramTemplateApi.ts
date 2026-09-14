import { ProblemContracts } from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

export const listJudgeProgramTemplates = () =>
  apiClient.queryContract(
    ProblemContracts.listJudgeProgramTemplates,
    '/api/judge-program-templates',
    { accountScoped: true },
  )

export const getJudgeProgramTemplate = (templateId: string) =>
  apiClient.queryContract(
    ProblemContracts.getJudgeProgramTemplate,
    `/api/judge-program-templates/${encodeURIComponent(templateId)}`,
    { accountScoped: true },
  )
