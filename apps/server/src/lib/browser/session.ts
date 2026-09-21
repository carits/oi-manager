/**
 * 会话管理器
 *
 * 管理浏览器登录态（Cookie 持久化），支持：
 * - 保存 cookies 到文件系统
 * - 加载 cookies 到新的 BrowserContext
 * - 清理过期会话
 *
 * 存储位置：apps/server/data/sessions/{sessionId}.json
 */

import * as fs from 'fs'
import * as path from 'path'
import { Cookie } from 'rebrowser-playwright-core'
import { logger } from '../logger'

const SESSIONS_DIR = path.join(process.cwd(), 'data', 'sessions')

export class SessionManager {
  private sessionsDir: string

  constructor(dir?: string) {
    this.sessionsDir = dir || SESSIONS_DIR
  }

  /** 确保存储目录存在 */
  private ensureDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 })
    }
  }

  /** 获取会话文件路径 */
  private getFilePath(sessionId: string): string {
    // 防止路径穿越
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.sessionsDir, `${safeId}.json`)
  }

  /** 保存 cookies 到文件 */
  async saveCookies(sessionId: string, cookies: Cookie[]): Promise<void> {
    if (!sessionId || !cookies.length) return

    this.ensureDir()
    const filePath = this.getFilePath(sessionId)
    const data = {
      sessionId,
      cookies,
      savedAt: new Date().toISOString(),
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
    fs.chmodSync(filePath, 0o600)
    logger.info('session_cookies_saved', {
      action: 'session_save',
      metadata: { sessionId, cookieCount: cookies.length }
    })
  }

  /** 加载 cookies */
  async loadCookies(sessionId: string): Promise<Cookie[]> {
    if (!sessionId) return []

    const filePath = this.getFilePath(sessionId)
    if (!fs.existsSync(filePath)) return []

    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw)
      return data.cookies || []
    } catch (e) {
      logger.warn('session_load_error', {
        action: 'session_load',
        metadata: { sessionId, error: (e as Error).message }
      })
      return []
    }
  }

  /** 清理会话 */
  async clearSession(sessionId: string): Promise<void> {
    const filePath = this.getFilePath(sessionId)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      logger.info('session_cleared', {
        action: 'session_clear',
        metadata: { sessionId }
      })
    }
  }

  /** 清理所有过期会话（超过 maxAge 毫秒） */
  async clearExpired(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    if (!fs.existsSync(this.sessionsDir)) return 0

    const files = fs.readdirSync(this.sessionsDir)
    const now = Date.now()
    let cleared = 0

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const filePath = path.join(this.sessionsDir, file)
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(raw)
        const savedAt = new Date(data.savedAt).getTime()
        if (now - savedAt > maxAgeMs) {
          fs.unlinkSync(filePath)
          cleared++
        }
      } catch {}
    }

    if (cleared > 0) {
      logger.info('session_expired_cleared', {
        action: 'session_clear_expired',
        metadata: { cleared }
      })
    }
    return cleared
  }
}

/** 全局会话管理器单例 */
export const sessionManager = new SessionManager()
