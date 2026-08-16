import { Router } from 'express'

/** 已停用：校园题单通过组织题单接口管理。 */
export const schoolProblemListsRouter = Router()
schoolProblemListsRouter.use((_req, res) => res.status(410).json({ success: false, code: 'LEGACY_API_RETIRED', message: '旧校园题单接口已停用，请使用组织接口。' }))
