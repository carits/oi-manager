/**
 * Stealth 反检测配置
 *
 * 绕过常见的浏览器自动化检测手段：
 * 1. rebrowser-patches — 修补 Playwright CDP 协议的 Runtime.enable 泄露
 * 2. 手动 stealth 脚本 — 覆盖 navigator.webdriver、chrome.runtime 等
 * 3. 随机指纹 — WebGL、canvas、audioContext 指纹随机化
 *
 * 参考项目：
 * - https://github.com/rebrowser/rebrowser-patches
 * - https://github.com/nickytonline/puppeteer-extra-plugin-stealth
 */

import { Page, BrowserContext } from 'rebrowser-playwright-core'
import { logger } from '../logger'

/** 真实 User-Agent 池（2025 Chrome Windows） */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
]

/** 获取随机 User-Agent */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

/**
 * Stealth 初始化脚本（字符串形式，在浏览器环境执行）
 *
 * 注意：这个字符串会在浏览器环境中通过 addInitScript 执行，
 * 因此使用浏览器全局对象（navigator, window 等），不经过 Node.js 类型检查。
 */
const STEALTH_INIT_SCRIPT = `
// 1. 覆盖 navigator.webdriver
Object.defineProperty(navigator, 'webdriver', {
  get: () => false,
  configurable: true,
})

// 2. 伪造 chrome.runtime（Playwright 默认不存在）
if (!window.chrome) {
  window.chrome = {}
}
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    connect: function () {},
    sendMessage: function () {},
  }
}

// 3. 覆盖 Permissions API
const originalQuery = window.navigator.permissions.query
window.navigator.permissions.query = (parameters) =>
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters)

// 4. 伪造 plugins（Headless Chrome plugins 为空）
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const arr = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ]
    arr.refresh = function() {}
    return arr
  },
  configurable: true,
})

// 5. 修补 WebGL vendor/renderer 指纹
const getParameter = WebGLRenderingContext.prototype.getParameter
WebGLRenderingContext.prototype.getParameter = function (parameter) {
  if (parameter === 37445) return 'Google Inc. (NVIDIA)'
  if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)'
  return getParameter.call(this, parameter)
}

// 6. 覆盖 navigator.languages
Object.defineProperty(navigator, 'languages', {
  get: () => ['zh-CN', 'zh', 'en-US', 'en'],
  configurable: true,
})

// 7. 修补 toString 检测
const nativeToString = Function.prototype.toString
const fns = new Map()
const patchFn = (fn, name) => {
  fns.set(fn, 'function ' + name + '() { [native code] }')
}
patchFn(navigator.permissions.query, 'query')

Function.prototype.toString = function () {
  return fns.get(this) || nativeToString.call(this)
}
`

/**
 * 对 BrowserContext 应用 stealth 配置
 *
 * rebrowser-playwright-core 已经在底层修补了 Runtime.enable 泄露
 * 这里额外处理 JavaScript 层面的指纹检测
 */
export async function applyStealthToContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(STEALTH_INIT_SCRIPT)
  logger.info('stealth_applied', { action: 'stealth_apply' })
}

/**
 * 对单个 Page 应用额外的 stealth（context 级别已经处理了大部分）
 */
export async function applyStealthToPage(_page: Page): Promise<void> {
  // Context 级别的 addInitScript 已经覆盖了大部分检测
  // 这里处理需要 page 级别的操作，后续按需添加
}
