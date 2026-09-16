import { Router } from 'express'
import { OjAccountContracts } from '@oi-manager/contracts'
import { authenticate } from '../middleware/auth'
import { logger } from '../lib/logger'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../lib/api-contract'
import {
  batchVerifyOjAccounts,
  createOjAccount,
  deleteOjAccount,
  getOjAccountStats,
  listOjAccounts,
  loginOjAccount,
  OjAccountServiceError,
  updateOjAccount,
  verifyOjAccount,
} from '../modules/oj-account/application/oj-account.service'

export const ojAccountsRouter = Router()

ojAccountsRouter.use(authenticate)
ojAccountsRouter.use((req: any, res, next) => {
  if (!['platform_admin', 'super_admin'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: '无权限访问' })
  }
  next()
})

function handleError(res: any, event: string, fallback: string, error: unknown) {
  if (sendContractError(error, res)) return res
  if (error instanceof OjAccountServiceError) {
    return res.status(error.statusCode).json({ success: false, message: error.message })
  }
  logger.error(event, { action: 'oj_accounts', metadata: { error } })
  return res.status(500).json({ success: false, message: fallback })
}

ojAccountsRouter.get('/', async (req, res) => {
  try {
    const query = parseContractQuery(OjAccountContracts.list, req.query)
    return sendContractData(res, OjAccountContracts.list, await listOjAccounts(query))
  } catch (error) {
    return handleError(res, 'oj_accounts_list_error', '获取账号列表失败', error)
  }
})

ojAccountsRouter.get('/stats', async (_req, res) => {
  try {
    return sendContractData(res, OjAccountContracts.stats, await getOjAccountStats())
  } catch (error) {
    return handleError(res, 'oj_accounts_stats_error', '获取统计失败', error)
  }
})

ojAccountsRouter.post('/', async (req: any, res) => {
  try {
    const body = parseContractBody(OjAccountContracts.create, req.body)
    return sendContractData(res, OjAccountContracts.create, await createOjAccount(req.user.userId, body))
  } catch (error) {
    return handleError(res, 'oj_account_create_error', '添加账号失败', error)
  }
})

ojAccountsRouter.put('/:id', async (req, res) => {
  try {
    const body = parseContractBody(OjAccountContracts.update, req.body)
    return sendContractData(res, OjAccountContracts.update, await updateOjAccount(req.params.id, body))
  } catch (error) {
    return handleError(res, 'oj_account_update_error', '更新账号失败', error)
  }
})

ojAccountsRouter.delete('/:id', async (req, res) => {
  try {
    parseContractBody(OjAccountContracts.delete, req.body || {})
    await deleteOjAccount(req.params.id)
    return sendContractData(res, OjAccountContracts.delete, {})
  } catch (error) {
    return handleError(res, 'oj_account_delete_error', '删除账号失败', error)
  }
})

ojAccountsRouter.post('/:id/verify', async (req, res) => {
  try {
    parseContractBody(OjAccountContracts.verify, req.body || {})
    return sendContractData(res, OjAccountContracts.verify, await verifyOjAccount(req.params.id))
  } catch (error) {
    return handleError(res, 'oj_account_verify_error', '验证失败', error)
  }
})

ojAccountsRouter.post('/:id/login', async (req, res) => {
  try {
    parseContractBody(OjAccountContracts.login, req.body || {})
    const result = await loginOjAccount(req.params.id)
    return sendContractData(res, OjAccountContracts.login, result)
  } catch (error) {
    return handleError(res, 'oj_account_login_error', '登录失败', error)
  }
})

ojAccountsRouter.post('/batch-verify', async (_req, res) => {
  try {
    parseContractBody(OjAccountContracts.batchVerify, _req.body || {})
    return sendContractData(res, OjAccountContracts.batchVerify, await batchVerifyOjAccounts())
  } catch (error) {
    return handleError(res, 'oj_accounts_batch_verify_error', '批量验证失败', error)
  }
})
