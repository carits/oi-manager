import crypto from 'crypto'
import { decrypt, encrypt } from '../../../lib/crypto'
import { logger } from '../../../lib/logger'
import { prisma } from '../../../prisma'

export class OjAccountServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'OjAccountServiceError'
  }
}

const CONFIG_FIELDS = [
  'enabled', 'priority', 'maxConsecutiveFailures', 'freezeDurationMinutes',
  'submitMaxRetries', 'retryIntervalSeconds', 'loginFailureCooldownMinutes',
  'reverifyIntervalMinutes', 'renewLoginThresholdMinutes', 'minSubmitIntervalSeconds',
  'minRequestIntervalSeconds', 'maxConcurrentSubmissions', 'maxConcurrentRequests',
  'firstPollDelaySeconds', 'pollIntervalSeconds', 'maxWaitDurationMinutes',
  'rateLimitThreshold', 'banSuspicionCooldownHours', 'autoVerifyIntervalMinutes',
] as const

function safeAccount(account: any) {
  const { password, passwordIV, cookie, cookieRaw, ...safe } = account
  return { ...safe, hasPassword: !!password, hasCookie: !!(cookie || cookieRaw) }
}

export async function listOjAccounts(filters: { platform?: unknown; status?: unknown }) {
  const where: Record<string, string> = {}
  if (typeof filters.platform === 'string' && filters.platform) where.platform = filters.platform
  if (typeof filters.status === 'string' && filters.status) where.status = filters.status
  const accounts = await prisma.ojAccount.findMany({ where, orderBy: [{ platform: 'asc' }, { createdAt: 'desc' }] })
  return accounts.map(safeAccount)
}

export async function getOjAccountStats() {
  const accounts = await prisma.ojAccount.findMany({
    select: { platform: true, status: true, updatedAt: true, totalSubmissions: true, totalSubmissionErrors: true },
  })
  const stats: Record<string, any> = {}
  for (const account of accounts) {
    const item = stats[account.platform] ||= {
      platform: account.platform, total: 0, active: 0, expired: 0, error: 0, unverified: 0,
      lastExpiredAt: null, totalSubmissions: 0, totalSubmissionErrors: 0,
    }
    item.total++
    item.totalSubmissions += account.totalSubmissions
    item.totalSubmissionErrors += account.totalSubmissionErrors
    if (account.status === 'active') item.active++
    else if (account.status === 'expired') {
      item.expired++
      if (!item.lastExpiredAt || account.updatedAt > new Date(item.lastExpiredAt)) item.lastExpiredAt = account.updatedAt.toISOString()
    } else if (account.status === 'error') item.error++
    else if (account.status === 'unverified') item.unverified++
  }
  return Object.values(stats)
}

export async function createOjAccount(addedBy: string, input: any) {
  const platform = typeof input.platform === 'string' ? input.platform.trim() : ''
  const username = typeof input.username === 'string' ? input.username.trim() : ''
  const cookieRaw = typeof input.cookie === 'string' ? input.cookie : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!platform || !username) throw new OjAccountServiceError(400, '平台和用户名必填')
  if (!cookieRaw && !password) throw new OjAccountServiceError(400, 'Cookie 或密码至少填一项')
  if (await prisma.ojAccount.findUnique({ where: { platform_username: { platform, username } } })) {
    throw new OjAccountServiceError(409, `平台 ${platform} 已存在用户 ${username}`)
  }
  const encrypted = password ? encrypt(password) : null
  const loginMethod = typeof input.loginMethod === 'string' && input.loginMethod ? input.loginMethod : password ? 'password' : 'cookie'
  const account = await prisma.ojAccount.create({ data: {
    id: crypto.randomUUID(), platform, username,
    password: encrypted?.encrypted || null, passwordIV: encrypted?.iv || null,
    cookieRaw: cookieRaw || null, cookie: cookieRaw || null,
    loginMethod, status: 'unverified', addedBy,
  } })
  logger.info('oj_account_created', { action: 'oj_accounts', metadata: { platform, username, loginMethod } })
  return safeAccount(account)
}

export async function updateOjAccount(id: string, input: any) {
  const account = await prisma.ojAccount.findUnique({ where: { id } })
  if (!account) throw new OjAccountServiceError(404, '账号不存在')
  const data: Record<string, any> = {}
  if (input.cookie !== undefined) {
    data.cookieRaw = data.cookie = input.cookie
    data.status = 'unverified'
    data.lastVerifiedAt = null
    data.lastErrorMessage = null
  }
  if (input.password !== undefined) {
    const encrypted = encrypt(String(input.password))
    data.password = encrypted.encrypted
    data.passwordIV = encrypted.iv
    if (!account.loginMethod || account.loginMethod === 'cookie') data.loginMethod = 'password'
    data.status = 'unverified'
    data.lastVerifiedAt = null
    data.lastErrorMessage = null
  }
  for (const field of CONFIG_FIELDS) if (input[field] !== undefined) data[field] = input[field]
  return safeAccount(await prisma.ojAccount.update({ where: { id }, data }))
}

export async function deleteOjAccount(id: string) {
  const account = await prisma.ojAccount.findUnique({ where: { id } })
  if (!account) throw new OjAccountServiceError(404, '账号不存在')
  await prisma.ojAccount.delete({ where: { id } })
  logger.info('oj_account_deleted', { action: 'oj_accounts', metadata: { platform: account.platform, username: account.username } })
}

interface VerifyResult {
  status: 'valid' | 'invalid' | 'unsupported'
  message: string
}

async function verifyHdu(username: string, cookie: string): Promise<VerifyResult> {
  const response = await fetch(`https://acm.hdu.edu.cn/userstatus.php?user=${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Cookie: cookie },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return { status: 'invalid', message: `HTTP ${response.status}` }
  const html = new TextDecoder('gb2312').decode(await response.arrayBuffer())
  return html.includes('Sign Out')
    ? { status: 'valid', message: 'Cookie 有效' }
    : { status: 'invalid', message: 'Cookie 已失效（未检测到登录态）' }
}

async function verifyAccount(platform: string, username: string, cookie: string): Promise<VerifyResult> {
  try {
    return platform === 'hdu'
      ? await verifyHdu(username, cookie)
      : { status: 'unsupported', message: `平台 ${platform} 暂不支持自动验证` }
  } catch (error: any) {
    return { status: 'invalid', message: `验证异常: ${error.message}` }
  }
}

async function loginHdu(username: string, password: string) {
  const response = await fetch('https://acm.hdu.edu.cn/userloginex.php?action=login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://acm.hdu.edu.cn/',
    },
    body: `username=${encodeURIComponent(username)}&userpass=${encodeURIComponent(password)}&login=Sign+In`,
    redirect: 'manual', signal: AbortSignal.timeout(15_000),
  })
  if (response.status !== 302) return { success: false, message: `登录失败: HTTP ${response.status}` }
  const cookies = (response.headers.getSetCookie?.() || []).map(item => item.match(/^([^;]+)/)?.[1]).filter(Boolean) as string[]
  return cookies.length
    ? { success: true, cookie: cookies.join('; '), message: '登录成功' }
    : { success: false, message: '登录重定向但未获取到 Cookie' }
}

async function loginAccount(platform: string, username: string, password: string) {
  try {
    return platform === 'hdu' ? await loginHdu(username, password) : { success: false, message: `平台 ${platform} 暂不支持自动登录` }
  } catch (error: any) {
    return { success: false, message: `登录异常: ${error.message}` }
  }
}

export async function verifyOjAccount(id: string) {
  const account = await prisma.ojAccount.findUnique({ where: { id } })
  if (!account) throw new OjAccountServiceError(404, '账号不存在')
  const cookie = account.cookie || account.cookieRaw
  if (!cookie) {
    await prisma.ojAccount.update({ where: { id }, data: { status: 'error', lastErrorMessage: '无 Cookie', lastVerifiedAt: new Date() } })
    return { status: 'error', message: '无 Cookie' }
  }
  const result = await verifyAccount(account.platform, account.username, cookie)
  const lastVerifiedAt = new Date()
  if (result.status === 'unsupported') {
    await prisma.ojAccount.update({
      where: { id },
      data: { status: 'unverified', lastVerifiedAt, lastErrorMessage: result.message },
    })
    return { status: 'unverified', message: result.message, lastVerifiedAt: lastVerifiedAt.toISOString() }
  }
  const status = result.status === 'valid' ? 'active' : 'expired'
  await prisma.ojAccount.update({
    where: { id },
    data: { status, lastVerifiedAt, lastErrorMessage: result.status === 'valid' ? null : result.message },
  })
  return { status, message: result.message, lastVerifiedAt: lastVerifiedAt.toISOString() }
}

export async function loginOjAccount(id: string) {
  const account = await prisma.ojAccount.findUnique({ where: { id } })
  if (!account) throw new OjAccountServiceError(404, '账号不存在')
  if (!account.password || !account.passwordIV) throw new OjAccountServiceError(400, '该账号未存储密码，无法自动登录')
  const result = await loginAccount(account.platform, account.username, decrypt(account.password, account.passwordIV))
  const now = new Date()
  await prisma.ojAccount.update({ where: { id }, data: result.success && result.cookie ? {
    cookie: result.cookie, cookieRaw: result.cookie, status: 'active', lastVerifiedAt: now,
    lastErrorMessage: null, loginMethod: 'password',
  } : { status: 'error', lastVerifiedAt: now, lastErrorMessage: result.message || '登录失败' } })
  return { success: !!result.success, status: result.success ? 'active' : 'error', message: result.message }
}

export async function batchVerifyOjAccounts() {
  const accounts = await prisma.ojAccount.findMany({
    where: { cookie: { not: null } },
    select: { id: true, platform: true, username: true, cookie: true, cookieRaw: true },
  })
  const results = []
  for (const account of accounts) {
    const cookie = account.cookie || account.cookieRaw
    if (!cookie) {
      results.push({ id: account.id, platform: account.platform, username: account.username, valid: false, message: '无 Cookie' })
      continue
    }
    const result = await verifyAccount(account.platform, account.username, cookie)
    await prisma.ojAccount.update({ where: { id: account.id }, data: {
      status: result.status === 'valid' ? 'active' : result.status === 'invalid' ? 'expired' : 'unverified',
      lastVerifiedAt: new Date(),
      lastErrorMessage: result.status === 'valid' ? null : result.message,
    } })
    results.push({
      id: account.id,
      platform: account.platform,
      username: account.username,
      valid: result.status === 'valid',
      message: result.message,
    })
  }
  return results
}

let autoVerifyStartTimer: NodeJS.Timeout | null = null
let autoVerifyInterval: NodeJS.Timeout | null = null
let autoVerifyInFlight: Promise<void> | null = null

async function autoVerifyTick() {
  try {
    const accounts = await prisma.ojAccount.findMany({ where: { enabled: true, status: 'active', cookie: { not: null } }, select: {
      id: true, platform: true, username: true, cookie: true, cookieRaw: true, password: true, passwordIV: true,
      lastVerifiedAt: true, autoVerifyIntervalMinutes: true,
    } })
    const now = Date.now()
    for (const account of accounts) {
      const intervalMs = (account.autoVerifyIntervalMinutes || 1440) * 60_000
      if (now - (account.lastVerifiedAt?.getTime() || 0) < intervalMs) continue
      const cookie = account.cookie || account.cookieRaw
      if (!cookie) continue
      logger.info('oj_auto_verify_start', { action: 'oj_auto_verify', metadata: { platform: account.platform, username: account.username } })
      const result = await verifyAccount(account.platform, account.username, cookie)
      if (result.status === 'unsupported') {
        await prisma.ojAccount.update({
          where: { id: account.id },
          data: { status: 'unverified', lastVerifiedAt: new Date(), lastErrorMessage: result.message },
        })
        logger.info('oj_auto_verify_unsupported', {
          action: 'oj_auto_verify',
          metadata: { platform: account.platform, username: account.username, message: result.message },
        })
        continue
      }
      if (result.status === 'valid') {
        await prisma.ojAccount.update({ where: { id: account.id }, data: { lastVerifiedAt: new Date(), lastErrorMessage: null } })
        logger.info('oj_auto_verify_ok', { action: 'oj_auto_verify', metadata: { platform: account.platform, username: account.username, message: result.message } })
        continue
      }
      if (account.password && account.passwordIV) {
        const login = await loginAccount(account.platform, account.username, decrypt(account.password, account.passwordIV))
        if (login.success && login.cookie) {
          await prisma.ojAccount.update({ where: { id: account.id }, data: { cookie: login.cookie, cookieRaw: login.cookie, lastVerifiedAt: new Date(), lastErrorMessage: null } })
          logger.info('oj_auto_verify_relogin_ok', { action: 'oj_auto_verify', metadata: { platform: account.platform, username: account.username } })
          continue
        }
      }
      await prisma.ojAccount.update({ where: { id: account.id }, data: { status: 'expired', lastVerifiedAt: new Date(), lastErrorMessage: result.message } })
      logger.warn('oj_auto_verify_expired', { action: 'oj_auto_verify', metadata: { platform: account.platform, username: account.username, message: result.message } })
    }
  } catch (error) {
    logger.error('oj_auto_verify_error', { action: 'oj_auto_verify', metadata: { error } })
  }
}

function runAutoVerifyTick() {
  if (autoVerifyInFlight) return autoVerifyInFlight
  autoVerifyInFlight = autoVerifyTick().finally(() => {
    autoVerifyInFlight = null
  })
  return autoVerifyInFlight
}

export function startAutoVerifyScheduler() {
  if (autoVerifyStartTimer || autoVerifyInterval) {
    logger.warn('oj_auto_verify_scheduler_already_running', { action: 'oj_auto_verify' })
    return stopAutoVerifyScheduler
  }
  autoVerifyStartTimer = setTimeout(() => {
    autoVerifyStartTimer = null
    void runAutoVerifyTick()
    autoVerifyInterval = setInterval(() => void runAutoVerifyTick(), 5 * 60_000)
  }, 30_000)
  logger.info('oj_auto_verify_scheduler_started', { action: 'oj_auto_verify', metadata: { intervalMinutes: 5 } })
  return stopAutoVerifyScheduler
}

export async function stopAutoVerifyScheduler() {
  if (autoVerifyStartTimer) clearTimeout(autoVerifyStartTimer)
  if (autoVerifyInterval) clearInterval(autoVerifyInterval)
  autoVerifyStartTimer = null
  autoVerifyInterval = null
  await autoVerifyInFlight
  logger.info('oj_auto_verify_scheduler_stopped', { action: 'oj_auto_verify' })
}
