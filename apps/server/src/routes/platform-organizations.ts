import { Router, type Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { authenticate, authorize, type AuthRequest } from '../middleware/auth'
import { parsePagination } from '../lib/pagination'
import {
  createPlatformOrganization,
  changePlatformOrganizationDirectoryStatus,
  createPlatformOrganizationPrincipal,
  getPlatformOrganization,
  listPlatformOrganizationStudents,
  listPlatformOrganizationTeachers,
  listPlatformOrganizations,
  PlatformOrganizationError,
  transferPlatformOrganizationPrincipal,
  updatePlatformOrganization,
} from '../modules/organization/application/platform-organization.service'

export const platformOrganizationRouter = Router()

// School and principal lifecycle is a global governance operation. Platform
// admins manage platform problems/OJ operations, but must not create, edit or
// enumerate school organizations through this route.
const superAdminOnly = [authenticate, authorize('super_admin')]

function endpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof PlatformOrganizationError) {
        return res.status(error.statusCode).json({
          success: false,
          ...(error.code ? { code: error.code } : {}),
          message: error.message,
        })
      }
      throw error
    }
  }, label)
}

platformOrganizationRouter.get('/', ...superAdminOnly, endpoint('获取学校列表失败', async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  res.json({ success: true, data: await listPlatformOrganizations(page, pageSize, skip, req.query) })
}))

platformOrganizationRouter.get('/:organizationId', ...superAdminOnly, endpoint('获取学校详情失败', async (req, res) => {
  res.json({ success: true, data: await getPlatformOrganization(req.params.organizationId) })
}))

platformOrganizationRouter.post('/', ...superAdminOnly, endpoint('创建学校失败', async (req, res) => {
  res.status(201).json({ success: true, data: await createPlatformOrganization(req.body, req.user!.userId) })
}))

platformOrganizationRouter.post('/:organizationId/principal', ...superAdminOnly, endpoint('创建学校负责人失败', async (req, res) => {
  const teacher = await createPlatformOrganizationPrincipal(req.params.organizationId, req.body)
  res.status(201).json({ success: true, data: { teacher } })
}))

platformOrganizationRouter.put('/:organizationId', ...superAdminOnly, endpoint('更新学校失败', async (req, res) => {
  await updatePlatformOrganization(req.params.organizationId, req.body)
  res.json({ success: true })
}))

platformOrganizationRouter.patch('/:organizationId/directory-status', ...superAdminOnly, endpoint('更新学校目录状态失败', async (req, res) => {
  res.json({ success: true, data: await changePlatformOrganizationDirectoryStatus(req.params.organizationId, req.body, req.user!.userId) })
}))

platformOrganizationRouter.get('/:organizationId/students', ...superAdminOnly, endpoint('获取学校学生失败', async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  res.json({ success: true, data: await listPlatformOrganizationStudents(req.params.organizationId, page, pageSize, skip) })
}))

platformOrganizationRouter.get('/:organizationId/teachers', ...superAdminOnly, endpoint('获取学校教师失败', async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  res.json({ success: true, data: await listPlatformOrganizationTeachers(req.params.organizationId, page, pageSize, skip) })
}))

platformOrganizationRouter.put('/:organizationId/principal', ...superAdminOnly, endpoint('转移学校负责人失败', async (req, res) => {
  const principal = await transferPlatformOrganizationPrincipal(req.params.organizationId, req.body.membershipId)
  res.json({ success: true, data: { principal } })
}))
