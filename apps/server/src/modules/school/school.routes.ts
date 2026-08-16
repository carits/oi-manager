import { Router } from 'express'

// Campus APIs have moved to /api/organizations/:organizationId/members.
export const schoolRouter = Router()
schoolRouter.use((_req, res) => res.status(410).json({ success: false, code: 'LEGACY_SCHOOL_API_RETIRED', message: '旧校园接口已停用，请使用组织接口。' }))
