import { Router } from 'express'

/** 已停用：学生档案统一由组织成员接口管理。 */
export const studentRouter = Router()
studentRouter.use((_req, res) => res.status(410).json({ success: false, code: 'LEGACY_API_RETIRED', message: '旧学生接口已停用，请使用组织接口。' }))
