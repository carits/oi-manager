import { Router } from 'express'

/** 已停用：教师档案统一由组织成员接口管理。 */
export const teacherRouter = Router()
teacherRouter.use((_req, res) => res.status(410).json({ success: false, code: 'LEGACY_API_RETIRED', message: '旧教师接口已停用，请使用组织接口。' }))
