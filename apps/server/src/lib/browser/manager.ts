/**
 * 浏览器管理器
 *
 * 单例模式管理 Playwright 浏览器实例：
 * - 懒加载启动 Chromium
 * - 创建带 stealth + proxy 的 BrowserContext
 * - withPage() 快捷方法：自动创建 context + page，用完关闭
 * - 服务关闭时自动清理
 *
 * 使用 rebrowser-playwright-core 替代原生 playwright-core，
 * 底层已修补 Runtime.enable 泄露，绕过 Cloudflare/DataDome 检测
 */

import { chromium, Browser, BrowserContext, Page } from 'rebrowser-playwright-core'
import { BrowserSessionOptions, DEFAULT_SESSION_OPTIONS } from './types'
import { applyStealthToContext, getRandomUserAgent as getRandomUA } from './stealth'
import { proxyManager } from './proxy'
import { sessionManager } from './session'
import { logger } from '../logger'

export class BrowserManager {
  private browser: Browser | null = null
  private headlessBrowser: Browser | null = null
  private activeContexts = new Set<BrowserContext>()
  private initialized = false

  /** 初始化浏览器（懒加载），QOJ 等 CF 严格保护的站点需要 headed 模式 */
  async init(headless = true): Promise<void> {
    if (headless) {
      if (this.headlessBrowser?.isConnected()) return
    } else {
      if (this.browser?.isConnected()) return
    }

    const mode = headless ? 'headless' : 'headed'
    logger.info('browser_launching', { action: 'browser_launch', metadata: { mode } })

    const launchOpts: any = {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
        '--window-size=1400,1000',
      ],
    }

    if (headless) {
      launchOpts.headless = true
    }
    // headed 模式不设置 headless 字段，默认为 false

    const instance = await chromium.launch(launchOpts)

    if (headless) {
      this.headlessBrowser = instance
    } else {
      this.browser = instance
    }

    this.initialized = true
    logger.info('browser_launched', { action: 'browser_launch', metadata: { mode } })
  }

  /** 确保浏览器已启动 */
  private async ensureBrowser(headless = true): Promise<Browser> {
    const target = headless ? this.headlessBrowser : this.browser
    if (!target || !target.isConnected()) {
      await this.init(headless)
    }
    return headless ? this.headlessBrowser! : this.browser!
  }

  /** 创建一个带 stealth + proxy 的 BrowserContext */
  async createContext(options: BrowserSessionOptions = {}): Promise<BrowserContext> {
    const headless = options.headless !== false
    const browser = await this.ensureBrowser(headless)
    const opts = { ...DEFAULT_SESSION_OPTIONS, ...options }

    // 解析代理
    const proxy = opts.proxy || proxyManager.getNext()
    const userAgent = opts.userAgent || getRandomUA()

    const contextOpts: any = {
      viewport: opts.viewport,
      locale: opts.locale,
      timezoneId: opts.timezoneId,
      userAgent,
    }

    if (proxy) {
      contextOpts.proxy = {
        server: proxy.url,
        username: proxy.username,
        password: proxy.password,
      }
    }

    const context = await browser.newContext(contextOpts)

    // 应用 stealth
    if (opts.stealth) {
      await applyStealthToContext(context)
    }

    // 恢复会话 cookies
    if (opts.sessionId) {
      const cookies = await sessionManager.loadCookies(opts.sessionId)
      if (cookies.length > 0) {
        await context.addCookies(cookies)
        logger.info('session_cookies_restored', {
          action: 'session_restore',
          metadata: { sessionId: opts.sessionId, cookieCount: cookies.length }
        })
      }
    }

    // 设置默认超时
    context.setDefaultTimeout(opts.timeout)
    context.setDefaultNavigationTimeout(opts.timeout)

    this.activeContexts.add(context)
    return context
  }

  /**
   * 快捷方法：创建 context + page，执行操作，自动清理
   *
   * @example
   * const html = await manager.withPage({ stealth: true }, async (page) => {
   *   await page.goto('https://example.com')
   *   return await page.content()
   * })
   */
  async withPage<T>(
    options: BrowserSessionOptions,
    fn: (page: Page) => Promise<T>
  ): Promise<T> {
    const context = await this.createContext(options)
    const page = await context.newPage()

    try {
      const result = await fn(page)

      // 保存 cookies
      if (options.sessionId) {
        const cookies = await context.cookies()
        await sessionManager.saveCookies(options.sessionId, cookies)
      }

      return result
    } finally {
      await page.close().catch(() => {})
      await context.close().catch(() => {})
      this.activeContexts.delete(context)
    }
  }

  /** 关闭所有活跃 context */
  async closeAll(): Promise<void> {
    const contexts = [...this.activeContexts]
    this.activeContexts.clear()

    await Promise.all(
      contexts.map(ctx => ctx.close().catch(() => {}))
    )

    logger.info('browser_contexts_closed', {
      action: 'browser_close_all',
      metadata: { count: contexts.length }
    })
  }

  /** 关闭浏览器 */
  async close(): Promise<void> {
    await this.closeAll()

    for (const b of [this.headlessBrowser, this.browser]) {
      if (b) {
        await b.close().catch(() => {})
      }
    }
    this.headlessBrowser = null
    this.browser = null
    logger.info('browser_closed', { action: 'browser_close' })
  }

  /** 浏览器是否运行中 */
  get isRunning(): boolean {
    return (this.headlessBrowser?.isConnected() ?? false) || (this.browser?.isConnected() ?? false)
  }

  /** 活跃 context 数量 */
  get activeContextCount(): number {
    return this.activeContexts.size
  }
}

/** 全局浏览器管理器单例 */
export const browserManager = new BrowserManager()
