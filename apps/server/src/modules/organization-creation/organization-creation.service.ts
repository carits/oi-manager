import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { paginatedResponse } from '../../lib/pagination'
import { prisma } from '../../prisma'
import { notificationService } from '../notification/notification.service'
import { createSchoolOrganizationCore, normalizeSchoolName, SchoolNameConflictError } from '../organization/application/school-creation.service'

const DAY_MS = 24 * 60 * 60 * 1000
const SCHOOL_TYPES = new Set(['小学', '初中', '高中', '小学+初中', '初中+高中', '小学+初中+高中'])
const SCHOOL_NATURES = new Set(['公办', '民办', '其他'])
const EDUCATION_SYSTEMS = new Set(['6-3-3', '5-4-3'])

export type CreationActor = { userId: string; role: string }

export class OrganizationCreationError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'OrganizationCreationError'
  }
}

const fail = (status: number, code: string, message: string): never => { throw new OrganizationCreationError(status, code, message) }
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''

function validateInput(body: Record<string, unknown>) {
  const lengthLimits: Array<[string, number]> = [['name', 100], ['shortName', 30], ['schoolType', 30], ['schoolNature', 20], ['region', 120], ['educationSystem', 20], ['applicantRealName', 80], ['applicantTitle', 80], ['contactPerson', 80], ['contactPhone', 30], ['contactEmail', 160], ['description', 2000], ['evidenceNote', 2000]]
  for (const [field, limit] of lengthLimits) if (typeof body[field] === 'string' && body[field].trim().length > limit) fail(422, 'ORGANIZATION_CREATION_APPLICATION_INVALID', `${field} 超过 ${limit} 字符限制`)
  if (body.organizationType && body.organizationType !== 'school') fail(422, 'ORGANIZATION_CREATION_APPLICATION_INVALID', '第一版仅支持申请创建学校')
  const name = text(body.name, 100)
  const shortName = text(body.shortName, 30) || null
  const schoolType = text(body.schoolType, 30)
  const schoolNature = text(body.schoolNature, 20) || null
  const region = text(body.region, 120)
  const educationSystem = text(body.educationSystem, 20) || '6-3-3'
  const applicantRealName = text(body.applicantRealName, 80)
  const applicantTitle = text(body.applicantTitle, 80) || null
  const contactPerson = text(body.contactPerson, 80) || null
  const contactPhone = text(body.contactPhone, 30) || null
  const contactEmail = text(body.contactEmail, 160) || null
  const description = text(body.description, 2000)
  const evidenceNote = text(body.evidenceNote, 2000) || null
  const regionParts = region.split('/').filter(Boolean)
  if (name.length < 2 || !SCHOOL_TYPES.has(schoolType) || regionParts.length !== 3 || applicantRealName.length < 2 || description.length < 20) {
    fail(422, 'ORGANIZATION_CREATION_APPLICATION_INVALID', '请完整填写学校名称、类型、省市区、负责人姓名和不少于 20 字的申请说明')
  }
  if (schoolNature && !SCHOOL_NATURES.has(schoolNature)) fail(422, 'ORGANIZATION_CREATION_APPLICATION_INVALID', '学校性质无效')
  if (!EDUCATION_SYSTEMS.has(educationSystem)) fail(422, 'ORGANIZATION_CREATION_APPLICATION_INVALID', '学制无效')
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) fail(422, 'ORGANIZATION_CREATION_APPLICATION_INVALID', '联系邮箱格式无效')
  if (contactPhone && !/^[0-9+()\s-]{6,30}$/.test(contactPhone)) fail(422, 'ORGANIZATION_CREATION_APPLICATION_INVALID', '联系电话格式无效')
  return {
    organizationType: 'school', name, nameKey: normalizeSchoolName(name), shortName, schoolType, schoolNature,
    region, educationSystem, applicantRealName, applicantTitle, contactPerson, contactPhone, contactEmail,
    description, evidenceData: evidenceNote ? { note: evidenceNote } : Prisma.JsonNull,
  }
}

function publicSelection() {
  return {
    id: true, organizationType: true, name: true, shortName: true, region: true, schoolType: true,
    schoolNature: true, educationSystem: true, applicantRealName: true, applicantTitle: true,
    contactPerson: true, contactPhone: true, contactEmail: true, description: true, evidenceData: true,
    status: true, reviewedAt: true, decisionMessage: true, createdOrganizationId: true, createdAt: true, updatedAt: true,
  } satisfies Prisma.OrganizationCreationApplicationSelect
}

async function writePlatformAudit(tx: Prisma.TransactionClient, actorUserId: string | null, action: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  await tx.platformAuditLog.create({ data: { id: crypto.randomUUID(), actorUserId, action, targetType: 'organization_creation_application', targetId, metadata } })
}

export async function createOrganizationApplication(actor: CreationActor, body: Record<string, unknown>) {
  if (actor.role !== 'user') fail(403, 'ORGANIZATION_CREATION_APPLICATION_FORBIDDEN', '平台管理员不能使用个人组织创建申请')
  const input = validateInput(body)
  const now = new Date()
  const since = new Date(now.getTime() - DAY_MS)
  try {
    return await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { status: true, role: true } })
      if (!user || user.status !== 'active' || user.role !== 'user') fail(409, 'ORGANIZATION_CREATION_APPLICANT_INVALID', '当前账号不能申请创建学校')
      if (await tx.school.findUnique({ where: { nameKey: input.nameKey }, select: { organizationId: true } })) {
        fail(409, 'ORGANIZATION_NAME_CONFLICT', '该学校已存在，请在学校目录中申请加入')
      }
      if (await tx.organizationCreationApplication.findFirst({ where: { applicantUserId: actor.userId, status: 'pending' }, select: { id: true } })) {
        fail(409, 'ORGANIZATION_CREATION_APPLICATION_EXISTS', '你已有一条待审核的组织创建申请')
      }
      if (await tx.organizationCreationApplication.findFirst({ where: { nameKey: input.nameKey, status: 'pending' }, select: { id: true } })) {
        fail(409, 'ORGANIZATION_CREATION_APPLICATION_EXISTS', '该学校已有待审核的创建申请')
      }
      if (await tx.organizationCreationApplication.count({ where: { applicantUserId: actor.userId, createdAt: { gte: since } } }) >= 3) {
        fail(429, 'ORGANIZATION_CREATION_RATE_LIMITED', '24 小时内最多提交 3 次组织创建申请')
      }
      if (await tx.organizationCreationApplication.findFirst({ where: { applicantUserId: actor.userId, nameKey: input.nameKey, status: 'rejected', reviewedAt: { gte: since } }, select: { id: true } })) {
        fail(429, 'ORGANIZATION_CREATION_NAME_COOLDOWN', '该学校名称被拒绝后 24 小时内不能重复申请')
      }
      const application = await tx.organizationCreationApplication.create({ data: { id: crypto.randomUUID(), applicantUserId: actor.userId, ...input }, select: publicSelection() })
      await writePlatformAudit(tx, actor.userId, 'organization_creation_application_submitted', application.id, { nameKey: input.nameKey })
      const reviewers = await tx.user.findMany({ where: { role: 'super_admin', status: 'active' }, select: { id: true } })
      for (const reviewer of reviewers) await notificationService.create({
        userId: reviewer.id, contextType: 'account', type: 'organization_creation_application_received',
        title: '收到组织创建申请', body: `${input.applicantRealName} 申请创建「${input.name}」`,
        href: `/admin/schools?tab=applications&applicationId=${application.id}`,
        sourceType: 'organization_creation_application', sourceId: application.id,
      }, tx)
      return application
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail(409, 'ORGANIZATION_CREATION_APPLICATION_EXISTS', '已有相同的待审核申请')
    throw error
  }
}

export async function listMyOrganizationApplications(actor: CreationActor, query: Record<string, unknown>) {
  if (actor.role !== 'user') fail(403, 'ORGANIZATION_CREATION_APPLICATION_FORBIDDEN', '无权查看个人组织创建申请')
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20))
  const [rows, total] = await Promise.all([
    prisma.organizationCreationApplication.findMany({ where: { applicantUserId: actor.userId }, select: publicSelection(), orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.organizationCreationApplication.count({ where: { applicantUserId: actor.userId } }),
  ])
  return { ...paginatedResponse(rows, total, page, pageSize), items: rows }
}

export async function getMyOrganizationApplication(actor: CreationActor, id: string) {
  if (actor.role !== 'user') fail(403, 'ORGANIZATION_CREATION_APPLICATION_FORBIDDEN', '无权查看个人组织创建申请')
  const row = await prisma.organizationCreationApplication.findFirst({ where: { id, applicantUserId: actor.userId }, select: publicSelection() })
  if (!row) fail(404, 'ORGANIZATION_CREATION_APPLICATION_NOT_FOUND', '创建申请不存在')
  return row
}

export async function cancelOrganizationApplication(actor: CreationActor, id: string) {
  if (actor.role !== 'user') fail(403, 'ORGANIZATION_CREATION_APPLICATION_FORBIDDEN', '无权撤销个人组织创建申请')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "OrganizationCreationApplication" WHERE id = ${id} FOR UPDATE`
    const current = await tx.organizationCreationApplication.findFirst({ where: { id, applicantUserId: actor.userId } })
    if (!current) throw new OrganizationCreationError(404, 'ORGANIZATION_CREATION_APPLICATION_NOT_FOUND', '创建申请不存在')
    if (current.status !== 'pending') fail(409, 'ORGANIZATION_CREATION_APPLICATION_ALREADY_PROCESSED', '该创建申请已经处理')
    const updated = await tx.organizationCreationApplication.update({ where: { id }, data: { status: 'cancelled' }, select: publicSelection() })
    await writePlatformAudit(tx, actor.userId, 'organization_creation_application_cancelled', id)
    return updated
  }, { isolationLevel: 'Serializable' })
}

function requireSuperAdmin(actor: CreationActor) {
  if (actor.role !== 'super_admin') fail(403, 'ORGANIZATION_CREATION_APPLICATION_FORBIDDEN', '仅超级管理员可以审核组织创建申请')
}

export async function listOrganizationApplications(actor: CreationActor, query: Record<string, unknown>) {
  requireSuperAdmin(actor)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(String(query.status)) ? String(query.status) : undefined
  const q = text(query.q, 100)
  const where: Prisma.OrganizationCreationApplicationWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { Applicant: { username: { contains: q, mode: 'insensitive' } } }, { applicantRealName: { contains: q, mode: 'insensitive' } }] } : {}),
  }
  const [rows, total, pending] = await Promise.all([
    prisma.organizationCreationApplication.findMany({ where, include: { Applicant: { select: { username: true, status: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.organizationCreationApplication.count({ where }),
    prisma.organizationCreationApplication.count({ where: { status: 'pending' } }),
  ])
  return { ...paginatedResponse(rows, total, page, pageSize), items: rows, pending }
}

export async function getOrganizationApplication(actor: CreationActor, id: string) {
  requireSuperAdmin(actor)
  const row = await prisma.organizationCreationApplication.findUnique({ where: { id }, include: { Applicant: { select: { username: true, status: true, role: true } }, ReviewedBy: { select: { username: true } } } })
  if (!row) fail(404, 'ORGANIZATION_CREATION_APPLICATION_NOT_FOUND', '创建申请不存在')
  return row
}

export async function decideOrganizationApplication(actor: CreationActor, id: string, decision: 'approve' | 'reject', body: Record<string, unknown>) {
  requireSuperAdmin(actor)
  const decisionMessage = text(body.decisionMessage, 1000) || null
  const internalReviewNote = text(body.internalReviewNote, 2000) || null
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "OrganizationCreationApplication" WHERE id = ${id} FOR UPDATE`
      const current = await tx.organizationCreationApplication.findUnique({ where: { id }, include: { Applicant: { select: { status: true, role: true, username: true } } } })
      if (!current) throw new OrganizationCreationError(404, 'ORGANIZATION_CREATION_APPLICATION_NOT_FOUND', '创建申请不存在')
      if (current.status !== 'pending') fail(409, 'ORGANIZATION_CREATION_APPLICATION_ALREADY_PROCESSED', '该创建申请已经处理')
      if (decision === 'reject') {
        const updated = await tx.organizationCreationApplication.update({ where: { id }, data: { status: 'rejected', reviewedByUserId: actor.userId, reviewedAt: new Date(), decisionMessage, internalReviewNote } })
        await writePlatformAudit(tx, actor.userId, 'organization_creation_application_rejected', id, { applicantUserId: current.applicantUserId })
        await notificationService.create({ userId: current.applicantUserId, contextType: 'account', type: 'organization_creation_application_rejected', title: '组织创建申请未通过', body: decisionMessage ? `「${current.name}」未通过：${decisionMessage}` : `「${current.name}」的创建申请未通过`, href: '/personal/organizations', sourceType: 'organization_creation_application', sourceId: id }, tx)
        return updated
      }
      if (current.Applicant.status !== 'active' || current.Applicant.role !== 'user') fail(409, 'ORGANIZATION_CREATION_APPLICANT_INVALID', '申请人账号状态或角色已变化，不能创建学校')
      const created = await createSchoolOrganizationCore(tx, {
        name: current.name, shortName: current.shortName, region: current.region, schoolType: current.schoolType,
        schoolNature: current.schoolNature, educationSystem: current.educationSystem,
        contactPerson: current.contactPerson, contactPhone: current.contactPhone, contactEmail: current.contactEmail,
        description: current.description, principalName: current.applicantRealName, principalTitle: current.applicantTitle,
      }, { type: 'existing', userId: current.applicantUserId })
      const updated = await tx.organizationCreationApplication.update({ where: { id }, data: { status: 'approved', reviewedByUserId: actor.userId, reviewedAt: new Date(), decisionMessage, internalReviewNote, createdOrganizationId: created.organizationId } })
      await writePlatformAudit(tx, actor.userId, 'organization_creation_application_approved', id, { organizationId: created.organizationId, applicantUserId: current.applicantUserId })
      await tx.organizationAuditLog.create({ data: { id: crypto.randomUUID(), organizationId: created.organizationId, actorUserId: actor.userId, action: 'organization_created_from_application', targetUserId: current.applicantUserId, sourceType: 'organization_creation_application', sourceId: id, metadata: { nameKey: created.nameKey } } })
      await notificationService.create({ userId: current.applicantUserId, contextType: 'account', type: 'organization_creation_application_approved', title: '组织创建申请已通过', body: `「${current.name}」已创建，你已成为学校负责人`, href: `/org/${created.organizationId}/overview`, sourceType: 'organization_creation_application', sourceId: id }, tx)
      return updated
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof SchoolNameConflictError) fail(409, 'ORGANIZATION_NAME_CONFLICT', error.message)
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || (error.code === 'P2010' && String(error.meta?.code) === '40001'))) {
      fail(409, 'ORGANIZATION_CREATION_APPLICATION_ALREADY_PROCESSED', '该创建申请已被其他审核操作处理')
    }
    throw error
  }
}
