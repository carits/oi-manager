import { DataMarketContracts, type EndpointBody } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export type DataMarketProblem = { id: string; problemId: string; title: string; platform: string }
export type DataMarketRevision = { id: string; revisionNumber: number; mode: string }
export type DataMarketQuality = { id: string; overallScore: number | null; qualityStatus: string; criticalIssueCount: number }
export type DataMarketContest = { id: string | number; title?: string; name?: string; status?: string }

export const listDataProducts = () => apiClient.queryContract(DataMarketContracts.products, '/api/data-products')
export const listDataEntitlements = () => apiClient.queryContract(DataMarketContracts.entitlements, '/api/data-entitlements')
export const createDataProduct = (problemId: string, body: EndpointBody<typeof DataMarketContracts.createProduct>) =>
  apiClient.mutateContract(DataMarketContracts.createProduct, `/api/problems/${encodeURIComponent(problemId)}/data-products`, body)
export const purchaseDataProduct = (productId: string, body: EndpointBody<typeof DataMarketContracts.purchase>, idempotencyKey: string) =>
  apiClient.mutateContract(DataMarketContracts.purchase, `/api/data-products/${encodeURIComponent(productId)}/purchase`, body, { headers: { 'Idempotency-Key': idempotencyKey } })
export const listQualityIncidents = (problemId: string) => apiClient.queryContract(DataMarketContracts.incidents, `/api/problems/${encodeURIComponent(problemId)}/test-set-quality-incidents`)
export const createQualityIncident = (body: EndpointBody<typeof DataMarketContracts.createIncident>) => apiClient.mutateContract(DataMarketContracts.createIncident, '/api/test-set-quality-incidents', body)
export const confirmQualityIncident = (id: string) => apiClient.mutateContract(DataMarketContracts.confirmIncident, `/api/test-set-quality-incidents/${encodeURIComponent(id)}/confirm`, {})
export const resolveQualityIncident = (id: string, body: EndpointBody<typeof DataMarketContracts.resolveIncident>) => apiClient.mutateContract(DataMarketContracts.resolveIncident, `/api/test-set-quality-incidents/${encodeURIComponent(id)}/resolve`, body)
export const getEntitlementManifest = (entitlementId: string, revisionId: string) => apiClient.queryContract(DataMarketContracts.manifest, `/api/data-entitlements/${encodeURIComponent(entitlementId)}/revisions/${encodeURIComponent(revisionId)}/manifest`)
export const upgradeDataEntitlement = (id: string, dataProductId: string) => apiClient.mutateContract(DataMarketContracts.upgrade, `/api/data-entitlements/${encodeURIComponent(id)}/upgrades`, { dataProductId })

// Cross-domain picker reads remain centralized here until their owning contracts expose these projections.
export const listDataMarketProblems = async () => (await apiClient.query<{ data: DataMarketProblem[] }>('/api/problems?library=platform&pageSize=100')).data
export const listDataMarketRevisions = async (problemId: string) => (await apiClient.query<{ revisions: DataMarketRevision[] }>(`/api/problems/${encodeURIComponent(problemId)}/test-set-revisions`)).revisions
export const getDataMarketQuality = (problemId: string, revisionId: string) => apiClient.query<DataMarketQuality>(`/api/problems/${encodeURIComponent(problemId)}/test-set-revisions/${encodeURIComponent(revisionId)}/quality`)
export const listDataMarketContests = (organizationId: string) => apiClient.query<DataMarketContest[]>(`/api/organizations/${encodeURIComponent(organizationId)}/members/activities/contests`)
