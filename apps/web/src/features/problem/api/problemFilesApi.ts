import { OjFetcherContracts, ProblemContracts, type EndpointBody } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const encoded = (value: string) => encodeURIComponent(value)
const problemPath = (problemId: string) => `/api/problems/${encoded(problemId)}`

export const listProblemAttachments = (problemId: string) =>
  apiClient.queryContract(ProblemContracts.listAttachments, `${problemPath(problemId)}/attachments`)

export const deleteProblemAttachment = (problemId: string, attachmentId: string) =>
  apiClient.mutateContract(ProblemContracts.deleteAttachment, `${problemPath(problemId)}/attachments/${encoded(attachmentId)}`, {})

export const deleteProblemStatement = (problemId: string, statementId: string) =>
  apiClient.mutateContract(ProblemContracts.deleteStatement, `${problemPath(problemId)}/statements/${encoded(statementId)}`, {})

export const fetchOjProblem = (platform: string, problemId: string) =>
  apiClient.queryContract(OjFetcherContracts.fetchProblem, `/api/oj-fetcher/${encoded(platform)}/${encoded(problemId)}`)

export const downloadOjProblemAttachment = (body: EndpointBody<typeof OjFetcherContracts.downloadAttachment>) =>
  apiClient.mutateContract(OjFetcherContracts.downloadAttachment, '/api/oj-fetcher/download-attachment', body)

// Registered raw transports: multipart bodies are validated by the server's upload boundary.
export const uploadProblemStatementPdf = (problemId: string, type: 'statement' | 'solution', file: File) => {
  const form = new FormData(); form.append('file', file); form.append('type', type)
  return apiClient.postFile<{ id: string; fileUrl: string }>(`${problemPath(problemId)}/statements/pdf`, form)
}

export const uploadProblemAttachment = (problemId: string, file: File) => {
  const form = new FormData(); form.append('file', file); form.append('description', '')
  return apiClient.postFile(`${problemPath(problemId)}/attachments`, form)
}

export const uploadProblemTestdata = (problemId: string, files: File[], replace = false) => {
  const form = new FormData(); for (const file of files) form.append('files', file)
  if (replace) form.append('replace', 'true')
  return apiClient.postFile(`/api/problems/${encoded(problemId)}/testdata`, form, { timeout: 120_000 })
}

export const deleteProblemTestdata = (problemId: string, fileId: string) =>
  apiClient.mutateContract(
    ProblemContracts.deleteTestdata,
    `${problemPath(problemId)}/testdata/${encoded(fileId)}`,
    {},
  )

export const downloadProblemTestdata = (problemId: string, fileId: string, timeout = 60_000) =>
  apiClient.download(`${problemPath(problemId)}/testdata/files/${encoded(fileId)}/download`, { timeout })

export const downloadProblemTestdataExport = (problemId: string) =>
  apiClient.download(`${problemPath(problemId)}/testdata/export`, { timeout: 120_000 })
