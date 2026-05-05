/**
 * Playwright Helper
 * Playwright 无头浏览器工具函数，用于绕过 Cloudflare 保护
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { logger } from './logger'

/**
 * Playwright 配置选项
 */
export interface PlaywrightOptions {
  /** 超时时间（毫秒），默认 15000 */
  timeout?: number
  /** 是否启用代理 */
  proxy?: string
  /** 是否启用调试日志 */
  debug?: boolean
}

/**
 * Cookie 定义
 */
export interface PlaywrightCookie {
  name: string
  value: string
  domain: string
  path?: string
}

/**
 * 使用 Playwright 执行操作
 * @param url - 目标 URL
 * @param cookies - 要设置的 Cookie
 * @param action - 在页面上执行的操作
 * @param options - 配置选项
 * @returns 操作结果
 */
export async function withPlaywright<T>(
  url: string,
  cookies: PlaywrightCookie[],
  action: (page: Page) => Promise<T>,
  options: PlaywrightOptions = {}
): Promise<T> {
  const { timeout = 15000, proxy, debug = false } = options

  const browserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ]

  // 配置代理
  if (proxy) {
    browserArgs.push(`--proxy-server=${proxy}`)
    if (debug) {
      logger.info('[Playwright] Using proxy', { proxy })
    }
  }

  let browser: Browser | null = null

  try {
    if (debug) {
      logger.info('[Playwright] Launching browser', { url, cookieCount: cookies.length })
    }

    browser = await chromium.launch({
      headless: true,
      args: browserArgs,
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    })

    // 设置 Cookie
    if (cookies.length > 0) {
      await context.addCookies(cookies)
      if (debug) {
        logger.info('[Playwright] Cookies set', { cookies: cookies.map(c => c.name) })
      }
    }

    const page = await context.newPage()

    // 访问页面
    if (debug) {
      logger.info('[Playwright] Navigating to URL', { url })
    }

    await page.goto(url, {
      timeout,
      waitUntil: 'domcontentloaded',
    })

    // 等待 Cloudflare challenge 完成（如果存在）
    // Cloudflare challenge 通常在 networkidle 后消失
    await page.waitForLoadState('networkidle', { timeout }).catch(() => {
      // networkidle 可能超时，但不影响后续操作
      if (debug) {
        logger.warn('[Playwright] networkidle timeout, continuing anyway')
      }
    })

    // 检查是否仍在 Cloudflare challenge 页
    const title = await page.title()
    if (title.includes('Just a moment') || title.includes('Cloudflare')) {
      // 等待更多时间让 challenge 自动完成
      await page.waitForTimeout(3000)
    }

    if (debug) {
      logger.info('[Playwright] Page loaded', { title })
    }

    // 执行操作
    const result = await action(page)

    return result

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('[Playwright] Error', { error: errorMessage })
    throw error

  } finally {
    if (browser) {
      await browser.close()
      if (debug) {
        logger.info('[Playwright] Browser closed')
      }
    }
  }
}

/**
 * 获取页面 HTML 内容
 * @param url - 目标 URL
 * @param cookies - 要设置的 Cookie
 * @param options - 配置选项
 * @returns HTML 内容
 */
export async function fetchPageHtml(
  url: string,
  cookies: PlaywrightCookie[],
  options: PlaywrightOptions = {}
): Promise<string> {
  return withPlaywright(url, cookies, async (page) => {
    return await page.content()
  }, options)
}

/**
 * 获取页面文本内容（用于检查登录状态）
 * @param url - 目标 URL
 * @param cookies - 要设置的 Cookie
 * @param selector - 要获取的元素选择器
 * @param options - 配置选项
 * @returns 元素文本内容
 */
export async function fetchPageText(
  url: string,
  cookies: PlaywrightCookie[],
  selector: string,
  options: PlaywrightOptions = {}
): Promise<string | null> {
  return withPlaywright(url, cookies, async (page) => {
    const element = await page.$(selector)
    if (!element) return null
    return await element.textContent()
  }, options)
}

/**
 * 检查页面是否包含特定元素
 * @param url - 目标 URL
 * @param cookies - 要设置的 Cookie
 * @param selector - 要检查的元素选择器
 * @param options - 配置选项
 * @returns 是否存在
 */
export async function pageHasElement(
  url: string,
  cookies: PlaywrightCookie[],
  selector: string,
  options: PlaywrightOptions = {}
): Promise<boolean> {
  return withPlaywright(url, cookies, async (page) => {
    const element = await page.$(selector)
    return element !== null
  }, options)
}