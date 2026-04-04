/**
 * 代理管理器
 *
 * 支持从环境变量加载代理列表，轮询/随机选择，失败标记
 *
 * 环境变量格式：
 *   BROWSER_PROXY=socks5://user:pass@host:port          (单个代理)
 *   BROWSER_PROXY_LIST=socks5://u:p@h:p,http://u:p@h:p  (多个代理，逗号分隔)
 */

import { ProxyConfig, ProxyHealth } from './types'
import { logger } from '../logger'

export class ProxyManager {
  private proxies: ProxyHealth[] = []
  private currentIndex = 0

  constructor(proxyList?: ProxyConfig[]) {
    if (proxyList && proxyList.length > 0) {
      this.proxies = proxyList.map(p => ({ proxy: p, failCount: 0 }))
    }
  }

  /** 从环境变量加载代理列表 */
  loadFromEnv(): void {
    const single = process.env.BROWSER_PROXY?.trim()
    const list = process.env.BROWSER_PROXY_LIST?.trim()

    if (list) {
      const entries = list.split(',').map(s => s.trim()).filter(Boolean)
      for (const entry of entries) {
        const config = this.parseProxyUrl(entry)
        if (config) this.proxies.push({ proxy: config, failCount: 0 })
      }
    } else if (single) {
      const config = this.parseProxyUrl(single)
      if (config) this.proxies.push({ proxy: config, failCount: 0 })
    }

    logger.info('proxy_loaded', {
      action: 'proxy_load',
      metadata: { count: this.proxies.length }
    })
  }

  /** 获取下一个可用代理（轮询，跳过连续失败 > 3 次的） */
  getNext(): ProxyConfig | undefined {
    if (this.proxies.length === 0) return undefined

    const maxFail = 3
    for (let attempt = 0; attempt < this.proxies.length; attempt++) {
      const entry = this.proxies[this.currentIndex % this.proxies.length]
      this.currentIndex++
      if (entry.failCount <= maxFail) return entry.proxy
    }
    // 全部失败，返回第一个（重置）
    this.proxies.forEach(p => { p.failCount = 0 })
    return this.proxies[0]?.proxy
  }

  /** 随机获取一个可用代理 */
  getRandom(): ProxyConfig | undefined {
    const available = this.proxies.filter(p => p.failCount <= 3)
    if (available.length === 0) {
      this.proxies.forEach(p => { p.failCount = 0 })
      return this.proxies[0]?.proxy
    }
    return available[Math.floor(Math.random() * available.length)].proxy
  }

  /** 标记代理失败 */
  markFailed(proxy: ProxyConfig): void {
    const entry = this.proxies.find(p => p.proxy.url === proxy.url)
    if (entry) {
      entry.failCount++
      entry.lastFailAt = Date.now()
    }
  }

  /** 标记代理成功 */
  markSuccess(proxy: ProxyConfig): void {
    const entry = this.proxies.find(p => p.proxy.url === proxy.url)
    if (entry) {
      entry.failCount = 0
      entry.lastSuccessAt = Date.now()
    }
  }

  /** 可用代理数量 */
  get availableCount(): number {
    return this.proxies.filter(p => p.failCount <= 3).length
  }

  /** 总代理数量 */
  get totalCount(): number {
    return this.proxies.length
  }

  /** 解析代理 URL 为 ProxyConfig */
  private parseProxyUrl(url: string): ProxyConfig | null {
    try {
      const parsed = new URL(url)
      const type = url.startsWith('socks') ? 'socks5' : (parsed.protocol === 'https:' ? 'https' : 'http')
      return {
        url,
        type,
        username: parsed.username || undefined,
        password: parsed.password || undefined,
      }
    } catch {
      logger.info('proxy_parse_error', {
        action: 'proxy_parse',
        metadata: { url: url.substring(0, 30) + '...' }
      })
      return null
    }
  }
}

/** 全局代理管理器单例 */
export const proxyManager = new ProxyManager()
