import { Router } from 'express'

/** 已停用：旧里程碑接口不能再使用 Student/Teacher 档案。 */
export const milestoneRouter = Router()
milestoneRouter.use((_req, res) => res.status(410).json({ success: false, code: 'LEGACY_API_RETIRED', message: '旧里程碑接口已停用，组织里程碑接口迁移中。' }))
