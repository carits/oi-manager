import crypto from 'node:crypto'
import { DataLicenseType, DataProductGrade, DataProductUpdatePolicy, Prisma, type DataEntitlement } from '@prisma/client'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../prisma'
import { findContestForLicense, listContestIdsForLicenseScopes } from '../contest/contest-query.facade'
import { postCaritsTransaction } from '../carits/application/carits-ledger.service'
import { notificationService } from '../notification/notification.service'
import { canModifyProblem, canViewProblem, isPlatformManager } from '../problem/problem.access'
import { acquireTestSetReader, releaseTestSetReader } from '../problem/problem.testset-slot.service'
import { getTestdataBlobStore, problemBlobKey } from '../storage/blob-store'
import { hasOrganizationCapability, resolveOrganizationAuthorizationsForUser } from '../authorization/capabilities'

const LICENSES = Object.values(DataLicenseType)
const UPDATE_POLICIES = Object.values(DataProductUpdatePolicy)
const INCIDENT_SEVERITIES = ['INFO', 'MINOR', 'MAJOR', 'CRITICAL'] as const
const SYSTEM_RESOURCE_SINK = 'RESOURCE_SINK'
const PRICING_VERSION = 1

export class DataMarketError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}
function policyFail(statusCode: number, code: string, message: string): never { throw new DataMarketError(statusCode, code, message) }
function text(value: unknown, max = 2000) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const parsed = String(value || '').toUpperCase() as T
  if (!allowed.includes(parsed)) policyFail(422, 'DATA_MARKET_FIELD_INVALID', `${field} 无效`)
  return parsed
}
const confidenceRank = { VERY_LOW: 0, LOW: 1, MEDIUM: 2, HIGH: 3, VERY_HIGH: 4 } as const
const maturityRank = { EXPERIMENTAL: 0, VALIDATED: 1, PROVEN: 2, MATURE: 3, BATTLE_TESTED: 4 } as const

export type GradeInput = {
  qualityStatus: string
  overallScore: number | null
  correctnessScore: number
  confidenceLevel: keyof typeof confidenceRank
  maturityLevel: keyof typeof maturityRank
  holdoutClusterCount: number
  criticalIssueCount: number
}
export function determineDataProductGrade(snapshot: GradeInput): DataProductGrade | null {
  if (snapshot.qualityStatus !== 'READY' || snapshot.overallScore == null || snapshot.correctnessScore < 30 || snapshot.criticalIssueCount > 0) return null
  if (snapshot.overallScore >= 92 && confidenceRank[snapshot.confidenceLevel] >= confidenceRank.VERY_HIGH && maturityRank[snapshot.maturityLevel] >= maturityRank.MATURE && snapshot.holdoutClusterCount > 0) return 'COMPETITION_GRADE'
  if (snapshot.overallScore >= 85 && confidenceRank[snapshot.confidenceLevel] >= confidenceRank.HIGH && maturityRank[snapshot.maturityLevel] >= maturityRank.PROVEN && snapshot.holdoutClusterCount > 0) return 'VERIFIED'
  if (snapshot.overallScore >= 70 && confidenceRank[snapshot.confidenceLevel] >= confidenceRank.MEDIUM) return 'COMMUNITY'
  return null
}
export function automaticPriceCarits(grade: DataProductGrade, license: DataLicenseType) {
  const base = grade === 'COMMUNITY' ? 50n : grade === 'VERIFIED' ? 90n : 150n
  return base * (license === 'PERSONAL' ? 1n : license === 'ORGANIZATION' ? 2n : 3n)
}
function publicSnapshot(snapshot: any) {
  if (!snapshot) return undefined
  return {
    id: snapshot.id, slot: snapshot.slot, graphHash: snapshot.graphHash, qualityRuleVersion: snapshot.qualityRuleVersion,
    correctnessScore: snapshot.correctnessScore, discriminationScore: snapshot.discriminationScore,
    coverageScore: snapshot.coverageScore, diversityScore: snapshot.diversityScore, subtaskQualityScore: snapshot.subtaskQualityScore,
    stabilityScore: snapshot.stabilityScore, overallScore: snapshot.overallScore, confidenceScore: snapshot.confidenceScore,
    confidenceLevel: snapshot.confidenceLevel, maturityLevel: snapshot.maturityLevel, qualityStatus: snapshot.qualityStatus,
    criticalIssueCount: snapshot.criticalIssueCount, warningCount: snapshot.warningCount, createdAt: snapshot.createdAt,
  }
}
function publicProblem(problem: any) {
  return problem ? { id: problem.id, platform: problem.platform, problemId: problem.problemId, title: problem.title, sourceProblemId: problem.sourceProblemId } : undefined
}
function publicQualityCertificate(certificate: any) {
  if (!certificate || typeof certificate !== 'object' || Array.isArray(certificate)) return undefined
  return {
    certificateVersion: certificate.certificateVersion, generatedAt: certificate.generatedAt, productId: certificate.productId,
    problem: publicProblem(certificate.problem), testSet: certificate.testSet, grade: certificate.grade,
    quality: certificate.quality ? publicSnapshot(certificate.quality) : undefined,
  }
}
function productDto(product: any) {
  return {
    id: product.id, problemId: product.problemId, slot: product.slot, graphHash: product.graphHash,
    qualitySnapshotId: product.qualitySnapshotId, grade: product.grade, updatePolicy: product.updatePolicy,
    status: product.status, includes: product.includes, publishedAt: product.publishedAt, suspendedAt: product.suspendedAt,
    suspensionReason: product.suspensionReason, Problem: publicProblem(product.Problem),
    Prices: product.Prices?.map((price: any) => ({ id: price.id, licenseType: price.licenseType, amountCarits: price.amountCarits.toString(), pricingVersion: price.pricingVersion })),
    QualitySnapshot: publicSnapshot(product.QualitySnapshot),
  }
}
function purchaseDto(purchase: any): any {
  return {
    id: purchase.id, dataProductId: purchase.dataProductId, priceId: purchase.priceId,
    buyerOrganizationId: purchase.buyerOrganizationId, contestId: purchase.contestId, licenseType: purchase.licenseType,
    purchasedGraphHash: purchase.purchasedGraphHash, qualitySnapshotId: purchase.qualitySnapshotId,
    amountCarits: purchase.amountCarits.toString(), status: purchase.status, caritsTransactionId: purchase.caritsTransactionId,
    qualityCertificateSnapshot: publicQualityCertificate(purchase.qualityCertificateSnapshot), createdAt: purchase.createdAt,
    Product: purchase.Product ? productDto(purchase.Product) : undefined,
    Entitlement: purchase.Entitlement ? entitlementDto(purchase.Entitlement) : undefined,
  }
}
function entitlementDto(entitlement: any): any {
  return {
    id: entitlement.id, purchaseId: entitlement.purchaseId, problemId: entitlement.problemId,
    buyerOrganizationId: entitlement.buyerOrganizationId, contestId: entitlement.contestId, licenseType: entitlement.licenseType,
    downloadAllowed: entitlement.downloadAllowed, importAllowed: entitlement.importAllowed, updatesUntil: entitlement.updatesUntil,
    revokedAt: entitlement.revokedAt, revokeReason: entitlement.revokeReason, createdAt: entitlement.createdAt,
    Purchase: entitlement.Purchase ? purchaseDto({ ...entitlement.Purchase, Entitlement: undefined }) : undefined,
  }
}
const productInclude = {
  Problem: { select: { id: true, platform: true, problemId: true, title: true, sourceProblemId: true, libraryScope: true, organizationId: true, ownerId: true, status: true, visibility: true } },
  QualitySnapshot: true,
  Prices: { orderBy: { licenseType: 'asc' as const } },
} as const
async function includeProduct(id: string) { return prisma.dataProduct.findUnique({ where: { id }, include: productInclude }) }
function normalizeIncludes(value: unknown) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const unsupported = ['validator', 'generator', 'std', 'editorial'].filter(key => input[key] === true)
  if (unsupported.length) policyFail(422, 'DATA_PRODUCT_INCLUDE_UNSUPPORTED', `V1 暂不支持交付：${unsupported.join(', ')}`)
  if (input.testdata === false) policyFail(422, 'DATA_PRODUCT_TESTDATA_REQUIRED', '数据商品必须包含 testdata')
  return { testdata: true, checker: input.checker === true }
}

export async function createDataProduct(user: JwtPayload, problemId: string, body: any) {
  const slot = body?.slot === 'EVOLVING' ? 'EVOLVING' : 'STABLE'
  const snapshotId = text(body?.qualitySnapshotId, 100)
  const updatePolicy = enumValue(body?.updatePolicy || 'LIFETIME', UPDATE_POLICIES, 'updatePolicy')
  const requestedLicenses: DataLicenseType[] = body?.allowedLicenses === undefined ? [...LICENSES] : Array.isArray(body.allowedLicenses)
    ? [...new Set<DataLicenseType>(body.allowedLicenses.map((item: unknown) => enumValue(item, LICENSES, 'allowedLicenses')))] : []
  if (!snapshotId) policyFail(422, 'DATA_PRODUCT_BINDING_REQUIRED', '必须绑定当前数据槽的质量快照')
  if (!requestedLicenses.length) policyFail(422, 'DATA_PRODUCT_LICENSE_REQUIRED', '至少开放一种许可证')
  const [problem, current, snapshot] = await Promise.all([
    prisma.problem.findUnique({ where: { id: problemId } }),
    prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId, slot } } }),
    prisma.testSetQualitySnapshot.findFirst({ where: { id: snapshotId, problemId, slot } }),
  ])
  if (!problem || !canModifyProblem(user, problem)) policyFail(403, 'DATA_PRODUCT_FORBIDDEN', '只有题目管理员可以发布数据商品')
  if (!current || !snapshot || snapshot.graphHash !== current.graphHash) policyFail(422, 'DATA_PRODUCT_BINDING_INVALID', '质量快照不属于当前数据槽')
  const critical = await prisma.testSetQualityIncident.count({ where: { problemId, slot, affectedGraphHash: current.graphHash, severity: 'CRITICAL', status: { not: 'RESOLVED' } } })
  if (critical) policyFail(409, 'DATA_PRODUCT_CRITICAL_INCIDENT', '当前数据槽存在未解决的严重质量事故')
  const grade = determineDataProductGrade(snapshot as GradeInput)
  if (!grade) policyFail(409, 'DATA_PRODUCT_QUALITY_INELIGIBLE', '质量快照尚未达到出售门槛')
  const sellerOrganizationId = problem.libraryScope === 'school' ? problem.organizationId : null
  const product = await prisma.dataProduct.create({ data: {
    id: crypto.randomUUID(), problemId, slot, graphHash: current.graphHash, qualitySnapshotId: snapshotId,
    sellerType: sellerOrganizationId ? 'ORGANIZATION' : 'USER', sellerUserId: user.userId, sellerOrganizationId,
    grade, updatePolicy, includes: normalizeIncludes(body?.includes),
    Prices: { create: requestedLicenses.map(licenseType => {
      const amountCarits = automaticPriceCarits(grade, licenseType)
      return { id: crypto.randomUUID(), licenseType, amountCarits, pricingVersion: PRICING_VERSION, pricingEvidence: { grade, licenseType, policyVersion: PRICING_VERSION, formula: 'grade_base_x_license_factor' } }
    }) },
  } })
  return productDto(await includeProduct(product.id))
}
export async function listDataProducts(user: JwtPayload, query: Record<string, unknown> = {}) {
  const problemId = text(query.problemId, 100) || undefined
  const rows = await prisma.dataProduct.findMany({ where: { status: 'ACTIVE', ...(problemId ? { problemId } : {}) }, orderBy: { publishedAt: 'desc' }, include: productInclude })
  return rows.filter(row => canViewProblem(user, row.Problem)).map(productDto)
}
export async function getDataProduct(user: JwtPayload, id: string) {
  const product = await includeProduct(id)
  if (!product || !canViewProblem(user, product.Problem)) policyFail(404, 'DATA_PRODUCT_NOT_FOUND', '数据商品不存在')
  return productDto(product)
}
async function purchaseScope(user: JwtPayload, licenseType: DataLicenseType, body: any) {
  if (licenseType === 'PERSONAL') return { buyerOrganizationId: null, contestId: null, payer: { ownerType: 'USER' as const, userId: user.userId } }
  if (licenseType === 'ORGANIZATION') {
    const organizationId = text(body?.organizationId, 100)
    if (!organizationId) policyFail(422, 'DATA_LICENSE_SCOPE_REQUIRED', '组织许可证必须指定 organizationId')
    if (!await hasOrganizationCapability(user.userId, organizationId, 'contest.manage')) policyFail(403, 'DATA_LICENSE_SCOPE_FORBIDDEN', '当前身份无权购买组织许可证')
    return { buyerOrganizationId: organizationId, contestId: null, payer: { ownerType: 'ORGANIZATION' as const, organizationId } }
  }
  const publicContestId = String(body?.contestId ?? '')
  if (!/^\d+$/.test(publicContestId)) policyFail(422, 'DATA_LICENSE_SCOPE_REQUIRED', '比赛许可证必须指定有效的 contestId')
  const resolved = await findContestForLicense(Number(publicContestId))
  const contest = resolved?.contest || null
  const teamManager = contest?.Team?.TeamMember.some((member: any) => member.userId === user.userId && member.status === 'active' && ['owner', 'admin'].includes(member.role))
  const organizationManager = contest?.organizationId ? await hasOrganizationCapability(user.userId, contest.organizationId, 'contest.manage') : false
  if (!contest || (!isPlatformManager(user.accountRole) && !teamManager && !organizationManager)) policyFail(403, 'DATA_LICENSE_SCOPE_FORBIDDEN', '只有比赛所属团队或组织管理员可以购买比赛许可证')
  return { buyerOrganizationId: contest.organizationId || contest.Team?.organizationId || null, contestId: resolved!.canonical.id, payer: { ownerType: 'USER' as const, userId: user.userId } }
}
function requestFingerprint(input: Record<string, unknown>) { return crypto.createHash('sha256').update(JSON.stringify(input, Object.keys(input).sort())).digest('hex') }
function qualityCertificate(product: any) {
  return { certificateVersion: 2, generatedAt: new Date().toISOString(), productId: product.id, problem: publicProblem(product.Problem), testSet: { slot: product.slot, graphHash: product.graphHash }, grade: product.grade, quality: publicSnapshot(product.QualitySnapshot) }
}
export async function purchaseDataProduct(user: JwtPayload, productId: string, body: any, idempotencyKey: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) policyFail(400, 'IDEMPOTENCY_KEY_REQUIRED', '购买请求需要 UUID 格式的 Idempotency-Key')
  if (body && ['price', 'amount', 'amountCarits', 'priceId'].some(key => Object.prototype.hasOwnProperty.call(body, key))) policyFail(422, 'CLIENT_PRICE_FORBIDDEN', '购买价格只能由服务端读取')
  const licenseType = enumValue(body?.license, LICENSES, 'license')
  const scope = await purchaseScope(user, licenseType, body)
  const fingerprint = requestFingerprint({ productId, licenseType, buyerUserId: user.userId, buyerOrganizationId: scope.buyerOrganizationId, contestId: scope.contestId })
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`data-purchase:${idempotencyKey}`}, 0)) IS NULL AS locked`
    const existing = await tx.dataPurchase.findUnique({ where: { idempotencyKey }, include: { Entitlement: true } })
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) policyFail(409, 'IDEMPOTENCY_KEY_REUSED', '同一幂等键不能用于不同购买请求')
      return purchaseDto(existing)
    }
    const product = await tx.dataProduct.findUnique({ where: { id: productId }, include: productInclude })
    if (!product || !canViewProblem(user, product.Problem)) policyFail(404, 'DATA_PRODUCT_NOT_FOUND', '数据商品不存在')
    if (product.status !== 'ACTIVE') policyFail(409, 'DATA_PRODUCT_NOT_AVAILABLE', '数据商品当前不可购买')
    const current = await tx.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: product.problemId, slot: product.slot } } })
    if (!current || current.graphHash !== product.graphHash) policyFail(409, 'DATA_PRODUCT_TEST_SET_CHANGED', '商品对应的数据槽已更新，请由发布者重新认证并发布')
    if (product.QualitySnapshot.qualityStatus !== 'READY' || product.QualitySnapshot.criticalIssueCount > 0) policyFail(409, 'DATA_PRODUCT_CERTIFICATE_INVALID', '商品质量证书当前不可用于购买')
    const price = product.Prices.find(item => item.licenseType === licenseType)
    if (!price) policyFail(422, 'DATA_PRODUCT_LICENSE_UNAVAILABLE', '该商品未开放所选许可证')
    const duplicate = await tx.dataEntitlement.findFirst({ where: { revokedAt: null, problemId: product.problemId, buyerUserId: user.userId, buyerOrganizationId: scope.buyerOrganizationId, contestId: scope.contestId, licenseType } })
    if (duplicate) policyFail(409, 'DATA_PRODUCT_ALREADY_OWNED', '当前授权范围已拥有该题数据访问权')
    const purchaseId = crypto.randomUUID()
    const transaction = await postCaritsTransaction(tx, {
      type: 'data_product_purchase', idempotencyKey: `data-purchase:${idempotencyKey}`, referenceType: 'data_purchase', referenceId: purchaseId,
      operatorUserId: user.userId, organizationId: scope.buyerOrganizationId || undefined,
      metadata: { productId, licenseType, slot: product.slot, graphHash: product.graphHash, priceId: price.id, pricingVersion: price.pricingVersion },
      entries: [{ owner: scope.payer, amount: -price.amountCarits }, { owner: { ownerType: 'SYSTEM', systemKey: SYSTEM_RESOURCE_SINK }, amount: price.amountCarits, allowNegative: true }],
    })
    const purchase = await tx.dataPurchase.create({ data: {
      id: purchaseId, dataProductId: product.id, priceId: price.id, buyerUserId: user.userId, buyerOrganizationId: scope.buyerOrganizationId,
      contestId: scope.contestId, licenseType, purchasedGraphHash: product.graphHash, qualitySnapshotId: product.qualitySnapshotId,
      amountCarits: price.amountCarits, idempotencyKey, requestFingerprint: fingerprint, caritsTransactionId: transaction.id,
      qualityCertificateSnapshot: qualityCertificate(product),
    } })
    const entitlement = await tx.dataEntitlement.create({ data: {
      id: crypto.randomUUID(), purchaseId, problemId: product.problemId, buyerUserId: user.userId, buyerOrganizationId: scope.buyerOrganizationId,
      contestId: scope.contestId, licenseType, updatesUntil: product.updatePolicy === 'UPDATE_90D' ? new Date(Date.now() + 90 * 86400_000) : null,
    } })
    return purchaseDto({ ...purchase, Entitlement: entitlement })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

async function accessibleScopeIds(user: JwtPayload) {
  const [authorizations, teamMemberships] = await Promise.all([
    resolveOrganizationAuthorizationsForUser(user.userId),
    prisma.teamMember.findMany({ where: { userId: user.userId, status: 'active', role: { in: ['owner', 'admin'] } }, select: { teamId: true } }),
  ])
  const organizationIds = authorizations.filter(item => item.capabilities.has('contest.manage')).map(item => item.organizationId)
  const contests = (await listContestIdsForLicenseScopes({ organizationIds, teamIds: teamMemberships.map(item => item.teamId) })).map(String)
  return { organizations: organizationIds, contests }
}
function entitlementVisible(user: JwtPayload, entitlement: DataEntitlement, scopes: { organizations: string[]; contests: string[] }) {
  if (isPlatformManager(user.accountRole)) return true
  if (entitlement.licenseType === 'PERSONAL') return entitlement.buyerUserId === user.userId
  if (entitlement.licenseType === 'ORGANIZATION') return Boolean(entitlement.buyerOrganizationId && scopes.organizations.includes(entitlement.buyerOrganizationId))
  return Boolean(entitlement.contestId && scopes.contests.includes(entitlement.contestId))
}
function entitlementVisibilityWhere(user: JwtPayload, scopes: { organizations: string[]; contests: string[] }) {
  return isPlatformManager(user.accountRole) ? {} : { OR: [
    { licenseType: 'PERSONAL' as const, buyerUserId: user.userId },
    { licenseType: 'ORGANIZATION' as const, buyerOrganizationId: { in: scopes.organizations } },
    { licenseType: 'CONTEST' as const, contestId: { in: scopes.contests } },
  ] }
}
const purchaseInclude = { Entitlement: true, Product: { include: productInclude } } as const
export async function listDataPurchases(user: JwtPayload) {
  const scopes = await accessibleScopeIds(user)
  return (await prisma.dataPurchase.findMany({ where: entitlementVisibilityWhere(user, scopes), orderBy: { createdAt: 'desc' }, include: purchaseInclude })).map(purchaseDto)
}
export async function listDataEntitlements(user: JwtPayload) {
  const scopes = await accessibleScopeIds(user)
  return (await prisma.dataEntitlement.findMany({ where: entitlementVisibilityWhere(user, scopes), orderBy: { createdAt: 'desc' }, include: { Purchase: { include: { Product: { include: productInclude } } } } })).map(entitlementDto)
}
export async function getDataEntitlement(user: JwtPayload, id: string) {
  const [entitlement, scopes] = await Promise.all([
    prisma.dataEntitlement.findUnique({ where: { id }, include: { Purchase: { include: { Product: { include: productInclude } } } } }),
    accessibleScopeIds(user),
  ])
  if (!entitlement || !entitlementVisible(user, entitlement, scopes)) policyFail(404, 'DATA_ENTITLEMENT_NOT_FOUND', '数据授权不存在')
  return entitlementDto(entitlement)
}
async function requireEntitlement(user: JwtPayload, entitlementId: string) {
  const [entitlement, scopes] = await Promise.all([
    prisma.dataEntitlement.findUnique({ where: { id: entitlementId }, include: { Purchase: { include: { Product: { include: { Problem: true } } } } } }),
    accessibleScopeIds(user),
  ])
  if (!entitlement || !entitlementVisible(user, entitlement, scopes) || entitlement.revokedAt) policyFail(404, 'DATA_ENTITLEMENT_NOT_FOUND', '数据授权不存在')
  return { entitlement, product: entitlement.Purchase.Product }
}
export async function getEntitlementManifest(user: JwtPayload, entitlementId: string) {
  const { entitlement, product } = await requireEntitlement(user, entitlementId)
  const held = await acquireTestSetReader({ problemId: product.problemId, slot: product.slot, ownerType: 'DATA_EXPORT', ownerId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 5 * 60_000) })
  try {
    const includes = product.includes as Record<string, boolean>
    const [cases, groupCases, quality] = await Promise.all([
      prisma.problemTestSetSlotCase.findMany({ where: { problemId: product.problemId, slot: product.slot }, orderBy: { orderIndex: 'asc' }, include: { InputObject: true, OutputObject: true } }),
      prisma.problemTestSetSlotGroupCase.findMany({ where: { problemId: product.problemId, slot: product.slot }, orderBy: [{ groupId: 'asc' }, { orderIndex: 'asc' }], include: { InputObject: true, OutputObject: true, Group: { include: { Subtask: true } } } }),
      prisma.testSetQualitySnapshot.findFirst({ where: { problemId: product.problemId, slot: product.slot, graphHash: held.slot.graphHash, qualityStatus: 'READY' }, orderBy: { createdAt: 'desc' } }),
    ])
    const objectRef = (object: { id: string; sha256: string; size: number }) => ({ id: object.id, sha256: object.sha256, size: object.size, downloadHref: `/api/data-entitlements/${entitlementId}/objects/${object.id}` })
    const manifestCases = cases.length
      ? cases.map(item => ({ orderIndex: item.orderIndex, inputName: item.inputName, outputName: item.outputName, input: objectRef(item.InputObject), output: objectRef(item.OutputObject) }))
      : groupCases.map(item => ({ subtaskId: item.Group.Subtask.subtaskId, groupKey: item.Group.key, orderIndex: item.orderIndex, inputName: item.inputName, outputName: item.outputName, input: objectRef(item.InputObject), output: objectRef(item.OutputObject) }))
    return {
      manifestVersion: 2, entitlementId, licenseType: entitlement.licenseType,
      problem: { id: product.Problem.id, problemId: product.Problem.problemId, title: product.Problem.title },
      testSet: { slot: product.slot, graphHash: held.slot.graphHash, mode: held.slot.mode, judgeConfigHash: held.slot.judgeConfigHash, fencingToken: held.slot.fencingToken },
      qualityCertificate: publicSnapshot(quality), includes, judgeConfig: includes.checker ? held.slot.judgeConfig : undefined,
      cases: includes.testdata ? manifestCases : [],
    }
  } finally { await releaseTestSetReader(held.reader.id) }
}
export async function readEntitlementObject(user: JwtPayload, entitlementId: string, objectId: string) {
  const { entitlement, product } = await requireEntitlement(user, entitlementId)
  const includes = product.includes as Record<string, boolean>
  if (!entitlement.downloadAllowed || !includes.testdata) policyFail(403, 'DATA_ENTITLEMENT_DOWNLOAD_FORBIDDEN', '当前授权不允许下载测试数据')
  const held = await acquireTestSetReader({ problemId: product.problemId, slot: product.slot, ownerType: 'DATA_EXPORT_OBJECT', ownerId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 5 * 60_000) })
  try {
    const object = await prisma.testdataObject.findFirst({ where: { id: objectId, problemId: product.problemId } })
    if (!object) policyFail(404, 'DATA_OBJECT_NOT_FOUND', '数据对象不存在')
    const [acmUse, groupUse] = await Promise.all([
      prisma.problemTestSetSlotCase.count({ where: { problemId: product.problemId, slot: product.slot, OR: [{ inputObjectId: objectId }, { outputObjectId: objectId }] } }),
      prisma.problemTestSetSlotGroupCase.count({ where: { problemId: product.problemId, slot: product.slot, OR: [{ inputObjectId: objectId }, { outputObjectId: objectId }] } }),
    ])
    if (!acmUse && !groupUse) policyFail(404, 'DATA_OBJECT_NOT_ENTITLED', '该对象不属于当前授权数据槽')
    return { content: await getTestdataBlobStore().get(problemBlobKey(product.problemId, object.storageKey)), sha256: object.sha256, fileName: `${object.id}.bin` }
  } finally { await releaseTestSetReader(held.reader.id) }
}
export async function upgradeDataEntitlement(user: JwtPayload, id: string, _body: any) {
  await getDataEntitlement(user, id)
  policyFail(410, 'DATA_ENTITLEMENT_UPGRADE_RETIRED', '双槽模型下授权始终读取当前数据，不再存在版本升级')
}

async function suspendForCriticalIncident(tx: Prisma.TransactionClient, incident: { id: string; problemId: string; slot: 'STABLE' | 'EVOLVING'; affectedGraphHash: string; description: string }) {
  await tx.dataProduct.updateMany({ where: { problemId: incident.problemId, slot: incident.slot, graphHash: incident.affectedGraphHash, status: 'ACTIVE' }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: incident.description, suspensionIncidentId: incident.id } })
  const affected = await tx.dataEntitlement.findMany({ where: { revokedAt: null, problemId: incident.problemId }, select: { buyerUserId: true } })
  for (const entitlement of affected) await notificationService.create({ userId: entitlement.buyerUserId, type: 'data_quality_critical_incident', title: '已购数据发现严重质量问题', body: incident.description, href: '/personal/data-market', sourceType: 'test_set_quality_incident', sourceId: incident.id }, tx)
}
export async function createQualityIncident(user: JwtPayload, body: any) {
  const problemId = text(body?.problemId, 100)
  const slot = body?.slot === 'EVOLVING' ? 'EVOLVING' : 'STABLE'
  const severity = enumValue(body?.severity, INCIDENT_SEVERITIES, 'severity')
  const type = text(body?.type, 100), description = text(body?.description, 10_000)
  const [problem, current] = await Promise.all([prisma.problem.findUnique({ where: { id: problemId } }), prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId, slot } } })])
  if (!problem || !current || !canModifyProblem(user, problem)) policyFail(403, 'QUALITY_INCIDENT_FORBIDDEN', '只有题目管理员可以登记当前数据槽的质量事故')
  if (!type || description.length < 10) policyFail(422, 'QUALITY_INCIDENT_DETAILS_REQUIRED', '事故类型和至少 10 个字符的说明为必填项')
  const evidence = body?.evidence && typeof body.evidence === 'object' ? body.evidence : {}
  const incident = await prisma.$transaction(async tx => {
    const critical = severity === 'CRITICAL'
    const created = await tx.testSetQualityIncident.create({ data: { id: crypto.randomUUID(), problemId, slot, affectedGraphHash: current.graphHash, severity, type, description, evidence, status: critical ? 'CONFIRMED' : 'OPEN', discoveredByUserId: user.userId, confirmedByUserId: critical ? user.userId : null, confirmedAt: critical ? new Date() : null } })
    if (critical) await suspendForCriticalIncident(tx, created)
    return created
  })
  if (incident.severity === 'CRITICAL') await enqueueQualityAfterIncident(incident.problemId, user.userId)
  return incident
}
export async function listQualityIncidents(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canModifyProblem(user, problem)) policyFail(403, 'QUALITY_INCIDENT_FORBIDDEN', '只有题目管理员可以读取质量事故')
  return prisma.testSetQualityIncident.findMany({ where: { problemId }, orderBy: { discoveredAt: 'desc' } })
}
export async function confirmQualityIncident(user: JwtPayload, id: string) {
  const incident = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`quality-incident:${id}`}, 0)) IS NULL AS locked`
    const found = await tx.testSetQualityIncident.findUnique({ where: { id }, include: { Problem: true } })
    if (!found || !canModifyProblem(user, found.Problem)) policyFail(403, 'QUALITY_INCIDENT_FORBIDDEN', '只有题目管理员可以确认质量事故')
    if (found.status !== 'OPEN') return found
    const updated = await tx.testSetQualityIncident.update({ where: { id }, data: { status: 'CONFIRMED', confirmedByUserId: user.userId, confirmedAt: new Date() } })
    if (updated.severity === 'CRITICAL') await suspendForCriticalIncident(tx, updated)
    return updated
  })
  await enqueueQualityAfterIncident(incident.problemId, user.userId)
  return incident
}
async function enqueueQualityAfterIncident(problemId: string, userId: string) {
  await import('../problem/problem.quality.service').then(({ enqueueLatestQualityAfterEvidenceChange }) => enqueueLatestQualityAfterEvidenceChange(problemId, userId))
    .catch(error => console.warn('[quality-evaluation] incident change enqueue skipped', { problemId, error: (error as Error).message }))
}
export async function resolveQualityIncident(user: JwtPayload, id: string, body: any) {
  const fixedByGraphHash = text(body?.fixedByGraphHash, 100)
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`quality-incident:${id}`}, 0)) IS NULL AS locked`
    const incident = await tx.testSetQualityIncident.findUnique({ where: { id }, include: { Problem: true } })
    if (!incident || !canModifyProblem(user, incident.Problem)) policyFail(403, 'QUALITY_INCIDENT_FORBIDDEN', '只有题目管理员可以解决质量事故')
    if (incident.status === 'RESOLVED') return incident
    if (incident.severity === 'CRITICAL') {
      const current = await tx.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: incident.problemId, slot: incident.slot } } })
      if (!current || !fixedByGraphHash || fixedByGraphHash === incident.affectedGraphHash || current.graphHash !== fixedByGraphHash) policyFail(422, 'QUALITY_INCIDENT_FIX_REQUIRED', '严重质量事故必须由当前数据槽的新图哈希修复')
      const certificate = await tx.testSetQualitySnapshot.findFirst({ where: { problemId: incident.problemId, slot: incident.slot, graphHash: fixedByGraphHash, qualityStatus: 'READY', criticalIssueCount: 0 } })
      if (!certificate) policyFail(422, 'QUALITY_INCIDENT_FIX_INVALID', '当前修复数据尚无可用质量证书')
    }
    return tx.testSetQualityIncident.update({ where: { id }, data: { status: 'RESOLVED', resolvedByUserId: user.userId, resolvedAt: new Date(), fixedByGraphHash: fixedByGraphHash || null } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  await enqueueQualityAfterIncident(result.problemId, user.userId)
  return result
}
