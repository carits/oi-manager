import { Router, type Response } from 'express'
import { OrganizationContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../lib/asyncHandler'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../lib/api-contract'
import { parsePagination } from '../lib/pagination'
import { authenticate, type AuthRequest } from '../middleware/auth'
import {
  resolveOrganizationAuthorization,
  type OrganizationCapability,
} from '../modules/authorization/capabilities'
import {
  archiveOrganizationStudent,
  archiveOrganizationTeacher,
  createOrganizationContest,
  createOrganizationStudent,
  createOrganizationTeacher,
  getCampus,
  listOrganizationActivities,
  listOrganizationStudents,
  listOrganizationTeachers,
  OrganizationActor,
  OrganizationMemberError,
  setOrganizationStudentStatus,
  setOrganizationTeacherStatus,
  transferOrganizationPrincipal,
  updateCampus,
  updateCampusAnnouncement,
  updateOrganizationStudent,
  updateOrganizationTeacher,
} from '../modules/organization/application/organization-member.service'

export const organizationMemberRouter = Router({ mergeParams: true })

async function actor(req: AuthRequest, res: Response, capability: OrganizationCapability): Promise<OrganizationActor | null> {
  const organizationId = req.params.organizationId
  if (!organizationId || !req.user || req.user.organizationId !== organizationId) {
    res.status(403).json({ success: false, code: 'ORGANIZATION_CONTEXT_REQUIRED', message: '当前组织上下文无效' })
    return null
  }
  const authorization = await resolveOrganizationAuthorization(req.user.userId, organizationId)
  if (!authorization?.capabilities.has(capability)) {
    res.status(403).json({ success: false, code: 'ORGANIZATION_CAPABILITY_REQUIRED', message: '当前组织身份缺少所需权限' })
    return null
  }
  return { organizationId, userId: req.user.userId, organizationMembershipId: authorization.membershipId, capabilities: authorization.capabilities }
}

function endpoint(label: string, capability: OrganizationCapability, handler: (req: AuthRequest, res: Response, actor: OrganizationActor) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    const context = await actor(req, res, capability)
    if (!context) return
    try {
      await handler(req, res, context)
    } catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof OrganizationMemberError) {
        return res.status(error.statusCode).json({ success: false, ...(error.code ? { code: error.code } : {}), message: error.message })
      }
      throw error
    }
  }, label)
}

organizationMemberRouter.get('/campus', authenticate, endpoint('查看校园资料', 'organization.view', async (_req, res, context) => {
  sendContractData(res, OrganizationContracts.campusSummary, await getCampus(context))
}))

organizationMemberRouter.put('/campus', authenticate, endpoint('编辑校园资料', 'organization.settings', async (req, res, context) => {
  await updateCampus(context, parseContractBody(OrganizationContracts.updateCampus, req.body))
  sendContractData(res, OrganizationContracts.updateCampus, { updated: true })
}))

organizationMemberRouter.put('/campus/announcement', authenticate, endpoint('编辑校园公告', 'organization.settings', async (req, res, context) => {
  const body = parseContractBody(OrganizationContracts.updateCampusAnnouncement, req.body)
  await updateCampusAnnouncement(context, body.announcement)
  sendContractData(res, OrganizationContracts.updateCampusAnnouncement, { updated: true })
}))

organizationMemberRouter.get('/activities/homeworks', authenticate, endpoint('获取作业列表失败', 'organization.view', async (_req, res, context) => {
  res.json({ success: true, data: await listOrganizationActivities(context, 'homework') })
}))

organizationMemberRouter.get('/activities/contests', authenticate, endpoint('获取比赛列表失败', 'organization.view', async (_req, res, context) => {
  res.json({ success: true, data: await listOrganizationActivities(context, 'contest') })
}))

organizationMemberRouter.post('/activities/contests', authenticate, endpoint('创建比赛失败', 'contest.manage', async (req, res, context) => {
  res.status(201).json({ success: true, data: await createOrganizationContest(context, req.body) })
}))

organizationMemberRouter.get('/students', authenticate, endpoint('获取学生列表失败', 'membership.view.students', async (req, res, context) => {
  const query = parseContractQuery(OrganizationContracts.studentOptions, req.query)
  const { page, pageSize } = parsePagination(query)
  sendContractData(res, OrganizationContracts.studentOptions, await listOrganizationStudents(context, query, page, pageSize))
}))

organizationMemberRouter.get('/teachers', authenticate, endpoint('获取教师列表失败', 'membership.view.teachers', async (req, res, context) => {
  const query = parseContractQuery(OrganizationContracts.teacherOptions, req.query)
  const { page, pageSize } = parsePagination(query)
  sendContractData(res, OrganizationContracts.teacherOptions, await listOrganizationTeachers(context, query, page, pageSize))
}))

organizationMemberRouter.post('/students', authenticate, endpoint('创建学生失败', 'membership.manage.students', async (req, res, context) => {
  res.status(201).json({ success: true, data: await createOrganizationStudent(context, req.body) })
}))

organizationMemberRouter.put('/students/:profileId', authenticate, endpoint('更新学生失败', 'membership.manage.students', async (req, res, context) => {
  await updateOrganizationStudent(context, req.params.profileId, req.body); res.json({ success: true })
}))

organizationMemberRouter.put('/students/:profileId/status', authenticate, endpoint('更新学生状态失败', 'membership.manage.students', async (req, res, context) => {
  await setOrganizationStudentStatus(context, req.params.profileId, req.body.status); res.json({ success: true })
}))

organizationMemberRouter.delete('/students/:profileId', authenticate, endpoint('移出学生失败', 'membership.manage.students', async (req, res, context) => {
  await archiveOrganizationStudent(context, req.params.profileId); res.json({ success: true, message: '学生已移出校园' })
}))

organizationMemberRouter.post('/principal-transfer', authenticate, endpoint('转移学校负责人失败', 'membership.manage.teachers', async (req, res, context) => {
  res.json({ success: true, data: await transferOrganizationPrincipal(context, req.body.newPrincipalMembershipId) })
}))

organizationMemberRouter.post('/teachers', authenticate, endpoint('创建教师失败', 'membership.manage.teachers', async (req, res, context) => {
  res.status(201).json({ success: true, data: await createOrganizationTeacher(context, req.body) })
}))

organizationMemberRouter.put('/teachers/:profileId', authenticate, endpoint('更新教师失败', 'membership.manage.teachers', async (req, res, context) => {
  await updateOrganizationTeacher(context, req.params.profileId, req.body); res.json({ success: true })
}))

organizationMemberRouter.put('/teachers/:profileId/status', authenticate, endpoint('更新教师状态失败', 'membership.manage.teachers', async (req, res, context) => {
  await setOrganizationTeacherStatus(context, req.params.profileId, req.body.status); res.json({ success: true })
}))

organizationMemberRouter.delete('/teachers/:profileId', authenticate, endpoint('移出教师失败', 'membership.manage.teachers', async (req, res, context) => {
  await archiveOrganizationTeacher(context, req.params.profileId); res.json({ success: true, message: '教师已移出校园' })
}))
