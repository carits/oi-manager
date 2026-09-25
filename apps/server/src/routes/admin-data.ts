import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import {
  AdminDataError,
  fixCaritsRemoteIds,
  fixHduMemory,
  fixSubmissionVisibility,
  getSubmissionMaintenanceStats,
  rejudgeAllLocalSubmissions,
  resetUserPassword,
} from '../modules/admin-data/application/admin-data.service'

export const adminDataRouter = Router()

adminDataRouter.use(authenticate)
adminDataRouter.use((req: any, res, next) => {
  if (!['super_admin', 'platform_admin'].includes(req.user?.accountRole)) {
    return res.status(403).json({ success: false, message: '需要管理员权限' })
  }
  next()
})

function endpoint(handler: (req: any) => Promise<unknown>) {
  return async (req: any, res: any) => {
    try {
      return res.json({ success: true, data: await handler(req) })
    } catch (error: any) {
      if (error instanceof AdminDataError) return res.status(error.statusCode).json({ success: false, message: error.message })
      return res.status(500).json({ success: false, message: error?.message || '操作失败' })
    }
  }
}

const rejudgeAll = endpoint(req => rejudgeAllLocalSubmissions(req.user.userId))
adminDataRouter.post('/rejudge-all-local', rejudgeAll)
adminDataRouter.post('/rejudge-all-carits', rejudgeAll)
adminDataRouter.get('/submission-stats', endpoint(() => getSubmissionMaintenanceStats()))
adminDataRouter.post('/fix-carits-remote-id', endpoint(() => fixCaritsRemoteIds()))
adminDataRouter.post('/fix-hdu-memory', endpoint(req => fixHduMemory(req.body?.defaultKB)))
adminDataRouter.post('/reset-user-password', endpoint(req => resetUserPassword(req.body?.userId, req.body?.newPassword)))
adminDataRouter.post('/fix-submission-visibility', endpoint(() => fixSubmissionVisibility()))
