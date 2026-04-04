/**
 * 浏览器自动化基础设施 — 类型定义
 *
 * 供 Playwright + Stealth + 代理基础设施使用的公共类型
 */

/** 代理配置 */
export interface ProxyConfig {
  /** 代理服务器 URL，如 socks5://user:pass@host:port 或 http://... */
  url: string
  /** 代理类型 */
  type: 'http' | 'socks5' | 'https'
  /** 用户名（可选，也从 url 中解析） */
  username?: string
  /** 密码（可选，也从 url 中解析） */
  password?: string
}

/** 浏览器会话配置 */
export interface BrowserSessionOptions {
  /** 代理配置（undefined = 不使用代理） */
  proxy?: ProxyConfig
  /** 是否启用 stealth 反检测（默认 true） */
  stealth?: boolean
  /** User-Agent（默认随机真实 UA） */
  userAgent?: string
  /** 视口大小 */
  viewport?: { width: number; height: number }
  /** 语言 */
  locale?: string
  /** 时区 */
  timezoneId?: string
  /** 会话标识（用于 cookie 持久化） */
  sessionId?: string
  /** 是否 headless（默认 true） */
  headless?: boolean
  /** 页面超时（毫秒，默认 60000） */
  timeout?: number
}

/** 页面操作结果 */
export interface PageResult<T = any> {
  data: T
  finalUrl: string
  cookies: Array<{ name: string; value: string; domain: string }>
}

/** 代理健康状态 */
export interface ProxyHealth {
  proxy: ProxyConfig
  failCount: number
  lastFailAt?: number
  lastSuccessAt?: number
}

/** 默认会话配置 */
export const DEFAULT_SESSION_OPTIONS: Required<Omit<BrowserSessionOptions, 'proxy' | 'sessionId'>> = {
  stealth: true,
  userAgent: '',
  viewport: { width: 1400, height: 1000 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  headless: true,
  timeout: 60000,
}
