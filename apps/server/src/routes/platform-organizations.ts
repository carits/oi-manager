import { Router, type Response } from 'express'
import { OrganizationContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../lib/asyncHandler'
import { authenticate, authorize, type AuthRequest } from '../middleware/auth'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../lib/api-contract'
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
      if (sendContractError(error, res)) return
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
  const query = parseContractQuery(OrganizationContracts.platformSchools, req.query)
  sendContractData(res, OrganizationContracts.platformSchools, await listPlatformOrganizations(query.page, query.pageSize, (query.page - 1) * query.pageSize, query))
}))

platformOrganizationRouter.get('/:organizationId', ...superAdminOnly, endpoint('获取学校详情失败', async (req, res) => {
  sendContractData(res, OrganizationContracts.platformSchool, await getPlatformOrganization(req.params.organizationId))
}))

platformOrganizationRouter.post('/', ...superAdminOnly, endpoint('创建学校失败', async (req, res) => {
  const body = parseContractBody(OrganizationContracts.createPlatformSchool, req.body)
  sendContractData(res, OrganizationContracts.createPlatformSchool, await createPlatformOrganization(body, req.user!.userId), 201)
}))

platformOrganizationRouter.post('/:organizationId/principal', ...superAdminOnly, endpoint('创建学校负责人失败', async (req, res) => {
  const body = parseContractBody(OrganizationContracts.createPlatformSchoolPrincipal, req.body)
  const teacher = await createPlatformOrganizationPrincipal(req.params.organizationId, body)
  sendContractData(res, OrganizationContracts.createPlatformSchoolPrincipal, { teacher }, 201)
}))

platformOrganizationRouter.put('/:organizationId', ...superAdminOnly, endpoint('更新学校失败', async (req, res) => {
  const body = parseContractBody(OrganizationContracts.updatePlatformSchool, req.body)
  await updatePlatformOrganization(req.params.organizationId, body)
  sendContractData(res, OrganizationContracts.updatePlatformSchool, { updated: true })
}))

platformOrganizationRouter.patch('/:organizationId/directory-status', ...superAdminOnly, endpoint('更新学校目录状态失败', async (req, res) => {
  const body = parseContractBody(OrganizationContracts.updatePlatformSchoolDirectoryStatus, req.body)
  sendContractData(res, OrganizationContracts.updatePlatformSchoolDirectoryStatus, await changePlatformOrganizationDirectoryStatus(req.params.organizationId, body, req.user!.userId))
}))

platformOrganizationRouter.get('/:organizationId/students', ...superAdminOnly, endpoint('获取学校学生失败', async (req, res) => {
  const query = parseContractQuery(OrganizationContracts.platformSchoolStudents, req.query)
  sendContractData(res, OrganizationContracts.platformSchoolStudents, await listPlatformOrganizationStudents(req.params.organizationId, query.page, query.pageSize, (query.page - 1) * query.pageSize))
}))

platformOrganizationRouter.get('/:organizationId/teachers', ...superAdminOnly, endpoint('获取学校教师失败', async (req, res) => {
  const query = parseContractQuery(OrganizationContracts.platformSchoolTeachers, req.query)
  sendContractData(res, OrganizationContracts.platformSchoolTeachers, await listPlatformOrganizationTeachers(req.params.organizationId, query.page, query.pageSize, (query.page - 1) * query.pageSize))
}))

platformOrganizationRouter.put('/:organizationId/principal', ...superAdminOnly, endpoint('转移学校负责人失败', async (req, res) => {
  const body = parseContractBody(OrganizationContracts.transferPlatformSchoolPrincipal, req.body)
  const principal = await transferPlatformOrganizationPrincipal(req.params.organizationId, body.membershipId)
  sendContractData(res, OrganizationContracts.transferPlatformSchoolPrincipal, { principal })
}))
