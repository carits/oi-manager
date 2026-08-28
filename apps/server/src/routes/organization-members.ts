import { Router, type Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { parsePagination } from '../lib/pagination'
import { authenticate, authorize, type AuthRequest } from '../middleware/auth'
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

function actor(req: AuthRequest, res: Response): OrganizationActor | null {
  const organizationId = req.params.organizationId
  if (!organizationId || req.user?.organizationId !== organizationId) {
    res.status(403).json({ success: false, code: 'ORGANIZATION_CONTEXT_REQUIRED', message: '当前组织上下文无效' })
    return null
  }
  return {
    organizationId, userId: req.user.userId, role: req.user.role,
    organizationMembershipId: req.user.organizationMembershipId,
  }
}

function endpoint(label: string, handler: (req: AuthRequest, res: Response, actor: OrganizationActor) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    const context = actor(req, res)
    if (!context) return
    try {
      await handler(req, res, context)
    } catch (error) {
      if (error instanceof OrganizationMemberError) {
        return res.status(error.statusCode).json({ success: false, ...(error.code ? { code: error.code } : {}), message: error.message })
      }
      throw error
    }
  }, label)
}

organizationMemberRouter.get('/campus', authenticate, endpoint('查看校园资料', async (_req, res, context) => {
  res.json({ success: true, data: await getCampus(context) })
}))

organizationMemberRouter.put('/campus', authenticate, authorize('school_principal'), endpoint('编辑校园资料', async (req, res, context) => {
  await updateCampus(context, req.body); res.json({ success: true })
}))

organizationMemberRouter.put('/campus/announcement', authenticate, authorize('school_principal'), endpoint('编辑校园公告', async (req, res, context) => {
  await updateCampusAnnouncement(context, req.body.announcement); res.json({ success: true })
}))

organizationMemberRouter.get('/activities/homeworks', authenticate, authorize('student', 'teacher', 'school_principal'), endpoint('获取作业列表失败', async (_req, res, context) => {
  res.json({ success: true, data: await listOrganizationActivities(context, 'homework') })
}))

organizationMemberRouter.get('/activities/contests', authenticate, authorize('student', 'teacher', 'school_principal'), endpoint('获取比赛列表失败', async (_req, res, context) => {
  res.json({ success: true, data: await listOrganizationActivities(context, 'contest') })
}))

organizationMemberRouter.post('/activities/contests', authenticate, authorize('teacher', 'school_principal'), endpoint('创建比赛失败', async (req, res, context) => {
  res.status(201).json({ success: true, data: await createOrganizationContest(context, req.body) })
}))

organizationMemberRouter.get('/students', authenticate, authorize('teacher', 'school_principal'), endpoint('获取学生列表失败', async (req, res, context) => {
  const { page, pageSize } = parsePagination(req.query)
  res.json({ success: true, data: await listOrganizationStudents(context, req.query, page, pageSize) })
}))

organizationMemberRouter.get('/teachers', authenticate, authorize('school_principal'), endpoint('获取教师列表失败', async (req, res, context) => {
  const { page, pageSize } = parsePagination(req.query)
  res.json({ success: true, data: await listOrganizationTeachers(context, req.query, page, pageSize) })
}))

organizationMemberRouter.post('/students', authenticate, authorize('teacher', 'school_principal'), endpoint('创建学生失败', async (req, res, context) => {
  res.status(201).json({ success: true, data: await createOrganizationStudent(context, req.body) })
}))

organizationMemberRouter.put('/students/:profileId', authenticate, authorize('teacher', 'school_principal'), endpoint('更新学生失败', async (req, res, context) => {
  await updateOrganizationStudent(context, req.params.profileId, req.body); res.json({ success: true })
}))

organizationMemberRouter.put('/students/:profileId/status', authenticate, authorize('teacher', 'school_principal'), endpoint('更新学生状态失败', async (req, res, context) => {
  await setOrganizationStudentStatus(context, req.params.profileId, req.body.status); res.json({ success: true })
}))

organizationMemberRouter.delete('/students/:profileId', authenticate, authorize('teacher', 'school_principal'), endpoint('移出学生失败', async (req, res, context) => {
  await archiveOrganizationStudent(context, req.params.profileId); res.json({ success: true, message: '学生已移出校园' })
}))

organizationMemberRouter.post('/principal-transfer', authenticate, authorize('school_principal'), endpoint('转移学校负责人失败', async (req, res, context) => {
  res.json({ success: true, data: await transferOrganizationPrincipal(context, req.body.newPrincipalMembershipId) })
}))

organizationMemberRouter.post('/teachers', authenticate, authorize('school_principal'), endpoint('创建教师失败', async (req, res, context) => {
  res.status(201).json({ success: true, data: await createOrganizationTeacher(context, req.body) })
}))

organizationMemberRouter.put('/teachers/:profileId', authenticate, authorize('school_principal'), endpoint('更新教师失败', async (req, res, context) => {
  await updateOrganizationTeacher(context, req.params.profileId, req.body); res.json({ success: true })
}))

organizationMemberRouter.put('/teachers/:profileId/status', authenticate, authorize('school_principal'), endpoint('更新教师状态失败', async (req, res, context) => {
  await setOrganizationTeacherStatus(context, req.params.profileId, req.body.status); res.json({ success: true })
}))

organizationMemberRouter.delete('/teachers/:profileId', authenticate, authorize('school_principal'), endpoint('移出教师失败', async (req, res, context) => {
  await archiveOrganizationTeacher(context, req.params.profileId); res.json({ success: true, message: '教师已移出校园' })
}))
