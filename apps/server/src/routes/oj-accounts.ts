/**
 * OJ 平台账号池管理 API
 * 用于 VJudge 代理提交的账号管理
 */

import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'
import { encrypt, decrypt } from '../lib/crypto'
import { logger } from '../lib/logger'

export const ojAccountsRouter = Router()

// 所有接口需要认证
ojAccountsRouter.use(authenticate)

// 仅 platform_admin 和 super_admin 可访问
ojAccountsRouter.use((req: any, res, next) => {
  const role = req.user?.role
  if (role !== 'platform_admin' && role !== 'super_admin') {
    return res.status(403).json({ success: false, message: '无权限访问' })
  }
  next()
})

// ==================== 查询 ====================

/** GET /api/oj-accounts — 获取所有账号列表 */
ojAccountsRouter.get('/', async (req: any, res) => {
  try {
    const { platform, status } = req.query

    const where: any = {}
    if (platform) where.platform = platform
    if (status) where.status = status

    const accounts = await prisma.ojAccount.findMany({
      where,
      orderBy: [{ platform: 'asc' }, { createdAt: 'desc' }],
    })

    // 不返回 password 字段
    const safe = accounts.map(({ password, passwordIV, cookie, cookieRaw, ...rest }) => ({
      ...rest,
      hasPassword: !!password,
      hasCookie: !!(cookie || cookieRaw),
    }))

    res.json({ success: true, data: safe })
  } catch (error) {
    logger.error('oj_accounts_list_error', { action: 'oj_accounts', metadata: { error } })
    res.status(500).json({ success: false, message: '获取账号列表失败' })
  }
})

/** GET /api/oj-accounts/stats — 获取各平台账号统计 */
ojAccountsRouter.get('/stats', async (_req, res) => {
  try {
    const accounts = await prisma.ojAccount.findMany({
      select: {
        platform: true,
        status: true,
        updatedAt: true,
        totalSubmissions: true,
        totalSubmissionErrors: true
      },
    })

    // 按平台分组统计
    const platformStats: Record<string, {
      platform: string
      total: number
      active: number
      expired: number
      error: number
      unverified: number
      lastExpiredAt: string | null
      totalSubmissions: number
      totalSubmissionErrors: number
    }> = {}

    for (const acc of accounts) {
      if (!platformStats[acc.platform]) {
        platformStats[acc.platform] = {
          platform: acc.platform,
          total: 0, active: 0, expired: 0, error: 0, unverified: 0,
          lastExpiredAt: null,
          totalSubmissions: 0,
          totalSubmissionErrors: 0,
        }
      }
      const s = platformStats[acc.platform]
      s.total++
      s.totalSubmissions += acc.totalSubmissions
      s.totalSubmissionErrors += acc.totalSubmissionErrors
      if (acc.status === 'active') s.active++
      else if (acc.status === 'expired') {
        s.expired++
        if (acc.updatedAt) {
          if (!s.lastExpiredAt || acc.updatedAt > new Date(s.lastExpiredAt)) {
            s.lastExpiredAt = acc.updatedAt.toISOString()
          }
        }
      }
      else if (acc.status === 'error') s.error++
      else if (acc.status === 'unverified') s.unverified++
    }

    res.json({ success: true, data: Object.values(platformStats) })
  } catch (error) {
    logger.error('oj_accounts_stats_error', { action: 'oj_accounts', metadata: { error } })
    res.status(500).json({ success: false, message: '获取统计失败' })
  }
})

// ==================== 增删改 ====================

/** POST /api/oj-accounts — 添加账号 */
ojAccountsRouter.post('/', async (req: any, res) => {
  try {
    const { platform, username, cookie: cookieRaw, password, loginMethod } = req.body

    if (!platform || !username) {
      return res.status(400).json({ success: false, message: '平台和用户名必填' })
    }

    if (!cookieRaw && !password) {
      return res.status(400).json({ success: false, message: 'Cookie 或密码至少填一项' })
    }

    // 检查重复
    const existing = await prisma.ojAccount.findUnique({
      where: { platform_username: { platform, username } },
    })
    if (existing) {
      return res.status(409).json({ success: false, message: `平台 ${platform} 已存在用户 ${username}` })
    }

    // 加密密码
    let encryptedPassword: string | null = null
    let encryptedIV: string | null = null
    if (password) {
      const enc = encrypt(password)
      encryptedPassword = enc.encrypted
      encryptedIV = enc.iv
    }

    const method = loginMethod || (password ? 'password' : 'cookie')

    const account = await prisma.ojAccount.create({
      data: {
        platform,
        username,
        password: encryptedPassword,
        passwordIV: encryptedIV,
        cookieRaw: cookieRaw || null,
        cookie: cookieRaw || null,
        loginMethod: method,
        status: 'unverified',
        addedBy: req.user.userId,
      },
    })

    logger.info('oj_account_created', {
      action: 'oj_accounts',
      metadata: { platform, username, loginMethod: method },
    })

    // 不返回密码
    const { password: _pw, passwordIV: _iv, cookie: _ck, cookieRaw: _cr, ...safe } = account
    res.json({
      success: true,
      data: { ...safe, hasPassword: !!encryptedPassword, hasCookie: !!cookieRaw },
    })
  } catch (error) {
    logger.error('oj_account_create_error', { action: 'oj_accounts', metadata: { error } })
    res.status(500).json({ success: false, message: '添加账号失败' })
  }
})

/** PUT /api/oj-accounts/:id — 更新账号 */
ojAccountsRouter.put('/:id', async (req: any, res) => {
  try {
    const { id } = req.params
    const { cookie: cookieRaw, password, ...configFields } = req.body

    const account = await prisma.ojAccount.findUnique({ where: { id } })
    if (!account) {
      return res.status(404).json({ success: false, message: '账号不存在' })
    }

    const updateData: any = {}

    if (cookieRaw !== undefined) {
      updateData.cookieRaw = cookieRaw
      updateData.cookie = cookieRaw
    }

    if (password !== undefined) {
      const enc = encrypt(password)
      updateData.password = enc.encrypted
      updateData.passwordIV = enc.iv
      if (!account.loginMethod || account.loginMethod === 'cookie') {
        updateData.loginMethod = 'password'
      }
      updateData.status = 'unverified'
      updateData.lastErrorMessage = null
    }

    // 配置字段白名单
    const allowedConfigFields = [
      'enabled', 'priority',
      'maxConsecutiveFailures', 'freezeDurationMinutes',
      'submitMaxRetries', 'retryIntervalSeconds',
      'loginFailureCooldownMinutes', 'reverifyIntervalMinutes',
      'renewLoginThresholdMinutes',
      'minSubmitIntervalSeconds', 'minRequestIntervalSeconds',
      'maxConcurrentSubmissions', 'maxConcurrentRequests',
      'firstPollDelaySeconds', 'pollIntervalSeconds',
      'maxWaitDurationMinutes', 'rateLimitThreshold',
      'banSuspicionCooldownHours', 'autoVerifyIntervalMinutes',
    ]
    for (const field of allowedConfigFields) {
      if (configFields[field] !== undefined) {
        updateData[field] = configFields[field]
      }
    }

    const updated = await prisma.ojAccount.update({
      where: { id },
      data: updateData,
    })

    const { password: _pw, passwordIV: _iv, cookie: _ck, cookieRaw: _cr, ...safe } = updated
    res.json({
      success: true,
      data: { ...safe, hasPassword: !!updated.password, hasCookie: !!(updated.cookie || updated.cookieRaw) },
    })
  } catch (error) {
    logger.error('oj_account_update_error', { action: 'oj_accounts', metadata: { error } })
    res.status(500).json({ success: false, message: '更新账号失败' })
  }
})

/** DELETE /api/oj-accounts/:id — 删除账号 */
ojAccountsRouter.delete('/:id', async (req: any, res) => {
  try {
    const { id } = req.params

    const account = await prisma.ojAccount.findUnique({ where: { id } })
    if (!account) {
      return res.status(404).json({ success: false, message: '账号不存在' })
    }

    await prisma.ojAccount.delete({ where: { id } })

    logger.info('oj_account_deleted', {
      action: 'oj_accounts',
      metadata: { platform: account.platform, username: account.username },
    })

    res.json({ success: true, message: '已删除' })
  } catch (error) {
    logger.error('oj_account_delete_error', { action: 'oj_accounts', metadata: { error } })
    res.status(500).json({ success: false, message: '删除账号失败' })
  }
})

// ==================== 验证与登录 ====================

/** POST /api/oj-accounts/:id/verify — 验证单个账号 */
ojAccountsRouter.post('/:id/verify', async (req: any, res) => {
  try {
    const { id } = req.params

    const account = await prisma.ojAccount.findUnique({ where: { id } })
    if (!account) {
      return res.status(404).json({ success: false, message: '账号不存在' })
    }

    const cookie = account.cookie || account.cookieRaw
    if (!cookie) {
      await prisma.ojAccount.update({
        where: { id },
        data: { status: 'error', lastErrorMessage: '无 Cookie', lastVerifiedAt: new Date() },
      })
      return res.json({ success: true, data: { status: 'error', message: '无 Cookie' } })
    }

    const result = await verifyAccount(account.platform, account.username, cookie)

    await prisma.ojAccount.update({
      where: { id },
      data: {
        status: result.valid ? 'active' : 'expired',
        lastVerifiedAt: new Date(),
        lastErrorMessage: result.valid ? null : result.message,
      },
    })

    res.json({
      success: true,
      data: {
        status: result.valid ? 'active' : 'expired',
        message: result.message,
        lastVerifiedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('oj_account_verify_error', { action: 'oj_accounts', metadata: { error } })
    res.status(500).json({ success: false, message: '验证失败' })
  }
})

/** POST /api/oj-accounts/:id/login — 用账号密码重新登录获取 Cookie */
ojAccountsRouter.post('/:id/login', async (req: any, res) => {
  try {
    const { id } = req.params

    const account = await prisma.ojAccount.findUnique({ where: { id } })
    if (!account) {
      return res.status(404).json({ success: false, message: '账号不存在' })
    }

    if (!account.password || !account.passwordIV) {
      return res.status(400).json({ success: false, message: '该账号未存储密码，无法自动登录' })
    }

    const plainPassword = decrypt(account.password, account.passwordIV)
    const result = await loginAccount(account.platform, account.username, plainPassword)

    if (result.success && result.cookie) {
      await prisma.ojAccount.update({
        where: { id },
        data: {
          cookie: result.cookie,
          cookieRaw: result.cookie,
          status: 'active',
          lastVerifiedAt: new Date(),
          lastErrorMessage: null,
          loginMethod: 'password',
        },
      })
    } else {
      await prisma.ojAccount.update({
        where: { id },
        data: {
          status: 'error',
          lastVerifiedAt: new Date(),
          lastErrorMessage: result.message || '登录失败',
        },
      })
    }

    res.json({
      success: result.success,
      data: {
        status: result.success ? 'active' : 'error',
        message: result.message,
      },
    })
  } catch (error) {
    logger.error('oj_account_login_error', { action: 'oj_accounts', metadata: { error } })
    res.status(500).json({ success: false, message: '登录失败' })
  }
})

/** POST /api/oj-accounts/batch-verify — 批量验证所有账号 */
ojAccountsRouter.post('/batch-verify', async (_req, res) => {
  try {
    const accounts = await prisma.ojAccount.findMany({
      where: { cookie: { not: null } },
      select: { id: true, platform: true, username: true, cookie: true, cookieRaw: true },
    })

    const results: Array<{ id: string; platform: string; username: string; valid: boolean; message: string }> = []

    for (const account of accounts) {
      const cookie = account.cookie || account.cookieRaw
      if (!cookie) {
        results.push({ id: account.id, platform: account.platform, username: account.username, valid: false, message: '无 Cookie' })
        continue
      }

      const result = await verifyAccount(account.platform, account.username, cookie)

      await prisma.ojAccount.update({
        where: { id: account.id },
        data: {
          status: result.valid ? 'active' : 'expired',
          lastVerifiedAt: new Date(),
          lastErrorMessage: result.valid ? null : result.message,
        },
      })

      results.push({
        id: account.id,
        platform: account.platform,
        username: account.username,
        valid: result.valid,
        message: result.message,
      })
    }

    res.json({ success: true, data: results })
  } catch (error) {
    logger.error('oj_accounts_batch_verify_error', { action: 'oj_accounts', metadata: { error } })
    res.status(500).json({ success: false, message: '批量验证失败' })
  }
})

// ==================== 平台验证与登录逻辑 ====================

interface VerifyResult {
  valid: boolean
  message: string
}

async function verifyAccount(platform: string, username: string, cookie: string): Promise<VerifyResult> {
  try {
    switch (platform) {
      case 'hdu':
        return await verifyHdu(username, cookie)
      default:
        // 其他平台暂不支持自动验证
        return { valid: true, message: '暂不支持自动验证，标记为有效' }
    }
  } catch (error: any) {
    return { valid: false, message: `验证异常: ${error.message}` }
  }
}

/** HDU 验证: 带 Cookie 请求用户状态页，检查 "Sign Out" */
async function verifyHdu(username: string, cookie: string): Promise<VerifyResult> {
  const resp = await fetch(`https://acm.hdu.edu.cn/userstatus.php?user=${encodeURIComponent(username)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookie,
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!resp.ok) {
    return { valid: false, message: `HTTP ${resp.status}` }
  }

  const buffer = await resp.arrayBuffer()
  const html = new TextDecoder('gb2312').decode(buffer)

  if (html.includes('Sign Out')) {
    return { valid: true, message: 'Cookie 有效' }
  }

  return { valid: false, message: 'Cookie 已失效（未检测到登录态）' }
}

/**
 * 平台登录获取 Cookie
 */
async function loginAccount(platform: string, username: string, password: string): Promise<{ success: boolean; cookie?: string; message?: string }> {
  try {
    switch (platform) {
      case 'hdu':
        return await loginHdu(username, password)
      default:
        return { success: false, message: `平台 ${platform} 暂不支持自动登录` }
    }
  } catch (error: any) {
    return { success: false, message: `登录异常: ${error.message}` }
  }
}

/** HDU 登录: POST userloginex.php */
async function loginHdu(username: string, password: string): Promise<{ success: boolean; cookie?: string; message?: string }> {
  const resp = await fetch('https://acm.hdu.edu.cn/userloginex.php?action=login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://acm.hdu.edu.cn/',
    },
    body: `username=${encodeURIComponent(username)}&userpass=${encodeURIComponent(password)}&login=Sign+In`,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })

  if (resp.status === 302) {
    // 登录成功，从 Set-Cookie 提取 PHPSESSID
    const setCookies = resp.headers.getSetCookie?.() || []
    const cookies: string[] = []
    for (const sc of setCookies) {
      const match = sc.match(/^([^;]+)/)
      if (match) cookies.push(match[1])
    }

    if (cookies.length > 0) {
      return { success: true, cookie: cookies.join('; '), message: '登录成功' }
    }
    return { success: false, message: '登录重定向但未获取到 Cookie' }
  }

  return { success: false, message: `登录失败: HTTP ${resp.status}` }
}

// ==================== 自动验证定时任务 ====================

/**
 * 启动自动验证定时任务
 * 每 5 分钟检查一次，对超过 autoVerifyIntervalMinutes 未验证的账号执行验证
 */
export function startAutoVerifyScheduler() {
  const CHECK_INTERVAL = 5 * 60 * 1000 // 5 分钟

  const tick = async () => {
    try {
      const accounts = await prisma.ojAccount.findMany({
        where: {
          enabled: true,
          status: 'active',
          cookie: { not: null },
        },
        select: {
          id: true,
          platform: true,
          username: true,
          cookie: true,
          cookieRaw: true,
          password: true,
          passwordIV: true,
          lastVerifiedAt: true,
          autoVerifyIntervalMinutes: true,
        },
      })

      const now = Date.now()

      for (const account of accounts) {
        const intervalMs = (account.autoVerifyIntervalMinutes || 1440) * 60 * 1000
        const lastVerified = account.lastVerifiedAt ? new Date(account.lastVerifiedAt).getTime() : 0

        if (now - lastVerified < intervalMs) continue

        const cookie = account.cookie || account.cookieRaw
        if (!cookie) continue

        logger.info('oj_auto_verify_start', {
          action: 'oj_auto_verify',
          metadata: { platform: account.platform, username: account.username },
        })

        const result = await verifyAccount(account.platform, account.username, cookie)

        if (result.valid) {
          await prisma.ojAccount.update({
            where: { id: account.id },
            data: { lastVerifiedAt: new Date(), lastErrorMessage: null },
          })
          logger.info('oj_auto_verify_ok', {
            action: 'oj_auto_verify',
            metadata: { platform: account.platform, username: account.username, message: result.message },
          })
        } else {
          // 验证失败，如果有密码则尝试自动登录
          if (account.password && account.passwordIV) {
            const { decrypt } = await import('../lib/crypto')
            const plainPassword = decrypt(account.password, account.passwordIV)
            const loginResult = await loginAccount(account.platform, account.username, plainPassword)

            if (loginResult.success && loginResult.cookie) {
              await prisma.ojAccount.update({
                where: { id: account.id },
                data: {
                  cookie: loginResult.cookie,
                  cookieRaw: loginResult.cookie,
                  lastVerifiedAt: new Date(),
                  lastErrorMessage: null,
                },
              })
              logger.info('oj_auto_verify_relogin_ok', {
                action: 'oj_auto_verify',
                metadata: { platform: account.platform, username: account.username },
              })
              continue
            }
          }

          await prisma.ojAccount.update({
            where: { id: account.id },
            data: {
              status: 'expired',
              lastVerifiedAt: new Date(),
              lastErrorMessage: result.message,
            },
          })
          logger.warn('oj_auto_verify_expired', {
            action: 'oj_auto_verify',
            metadata: { platform: account.platform, username: account.username, message: result.message },
          })
        }
      }
    } catch (error) {
      logger.error('oj_auto_verify_error', { action: 'oj_auto_verify', metadata: { error } })
    }
  }

  // 启动后延迟 30 秒执行第一次，避免和启动流程冲突
  setTimeout(() => {
    tick()
    setInterval(tick, CHECK_INTERVAL)
  }, 30_000)

  logger.info('oj_auto_verify_scheduler_started', { action: 'oj_auto_verify', metadata: { intervalMinutes: 5 } })
}
