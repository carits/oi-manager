import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

export const DataLicenseSchema = z.enum(['PERSONAL', 'ORGANIZATION', 'CONTEST'])
export type DataLicense = z.infer<typeof DataLicenseSchema>

const QualityCertificateSchema = z.object({
  id: z.string().optional(),
  overallScore: z.number(),
  correctnessScore: z.number(),
  discriminationScore: z.number(),
  coverageScore: z.number(),
  confidenceLevel: z.string(),
  maturityLevel: z.string(),
}).passthrough()

export const DataProductSchema = z.object({
  id: z.string(), problemId: z.string(), revisionId: z.string(), grade: z.string(),
  updatePolicy: z.string(), status: z.string(), publishedAt: DateTimeWireSchema,
  Problem: z.object({ id: z.string().optional(), problemId: z.string(), title: z.string() }).passthrough(),
  Revision: z.object({ id: z.string(), revisionNumber: z.number().int() }).passthrough(),
  QualitySnapshot: QualityCertificateSchema,
  Prices: z.array(z.object({
    id: z.string(), licenseType: DataLicenseSchema, amountCarits: z.string(), pricingVersion: z.number().int().optional(),
  }).passthrough()),
}).passthrough()
export type DataProduct = z.infer<typeof DataProductSchema>

const EntitlementRevisionSchema = z.object({
  id: z.string(), testSetRevisionId: z.string(), grantReason: z.string(),
  TestSetRevision: z.object({ id: z.string().optional(), revisionNumber: z.number().int() }).passthrough(),
  QualitySnapshot: QualityCertificateSchema,
}).passthrough()

export const DataEntitlementSchema = z.object({
  id: z.string(), licenseType: DataLicenseSchema,
  Purchase: z.object({ Product: DataProductSchema.pick({ id: true, updatePolicy: true, Problem: true }) }).passthrough(),
  Revisions: z.array(EntitlementRevisionSchema),
}).passthrough()
export type DataEntitlement = z.infer<typeof DataEntitlementSchema>

export const TestSetQualityIncidentSchema = z.object({
  id: z.string(), problemId: z.string(), revisionId: z.string(), severity: z.string(),
  type: z.string(), description: z.string(), status: z.string(),
}).passthrough()
export type TestSetQualityIncident = z.infer<typeof TestSetQualityIncidentSchema>

const EmptyBody = z.object({}).default({})
const IncidentBody = z.object({
  revisionId: z.string().min(1), severity: z.enum(['INFO', 'MINOR', 'MAJOR', 'CRITICAL']),
  type: z.string().trim().min(1).max(100), description: z.string().trim().min(10).max(10_000),
  evidence: z.record(z.string(), z.unknown()).optional(),
})

export const DataMarketContracts = {
  products: defineApiEndpoint({ key: 'data-market.products', method: 'GET', scope: 'context', query: z.object({ problemId: z.string().optional() }), data: z.array(DataProductSchema) }),
  createProduct: defineApiEndpoint({ key: 'data-market.product.create', method: 'POST', scope: 'context', data: DataProductSchema, body: z.object({
    revisionId: z.string().min(1), qualitySnapshotId: z.string().min(1),
    updatePolicy: z.enum(['SNAPSHOT', 'UPDATE_90D', 'LIFETIME_UPDATES']),
    allowedLicenses: z.array(DataLicenseSchema).min(1),
    includes: z.object({ testdata: z.boolean(), checker: z.boolean() }),
  }) }),
  purchase: defineApiEndpoint({ key: 'data-market.purchase', method: 'POST', scope: 'context', data: z.object({ id: z.string() }).passthrough(), body: z.object({
    license: DataLicenseSchema, organizationId: z.string().optional(), contestId: z.number().int().positive().optional(),
  }).strict() }),
  entitlements: defineApiEndpoint({ key: 'data-market.entitlements', method: 'GET', scope: 'context', data: z.array(DataEntitlementSchema) }),
  manifest: defineApiEndpoint({ key: 'data-market.manifest', method: 'GET', scope: 'context', data: z.record(z.string(), z.unknown()) }),
  upgrade: defineApiEndpoint({ key: 'data-market.entitlement.upgrade', method: 'POST', scope: 'context', data: z.object({ id: z.string() }).passthrough(), body: z.object({ dataProductId: z.string().min(1) }) }),
  incidents: defineApiEndpoint({ key: 'data-market.incidents', method: 'GET', scope: 'context', data: z.array(TestSetQualityIncidentSchema) }),
  createIncident: defineApiEndpoint({ key: 'data-market.incident.create', method: 'POST', scope: 'context', data: TestSetQualityIncidentSchema, body: IncidentBody }),
  confirmIncident: defineApiEndpoint({ key: 'data-market.incident.confirm', method: 'POST', scope: 'context', data: TestSetQualityIncidentSchema, body: EmptyBody }),
  resolveIncident: defineApiEndpoint({ key: 'data-market.incident.resolve', method: 'POST', scope: 'context', data: TestSetQualityIncidentSchema, body: z.object({ fixedByRevisionId: z.string().min(1).optional() }) }),
} as const
