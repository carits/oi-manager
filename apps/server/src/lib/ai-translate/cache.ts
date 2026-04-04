/**
 * cache.ts — 翻译缓存
 *
 * 应用侧缓存，避免相同题面重复调用 API。
 * 缓存键 = hash(原文 + 源语言 + 目标语言 + 平台 + 术语表版本 + 模型名)
 */

import { createHash } from 'crypto'
import type { CacheEntry } from './types'

const DEFAULT_TTL = 24 * 60 * 60 * 1000 // 24 小时

/**
 * 内存翻译缓存
 */
export class TranslationCache {
  private cache = new Map<string, CacheEntry>()
  private enabled: boolean

  constructor(enabled?: boolean) {
    this.enabled = enabled ?? (process.env.TRANSLATION_ENABLE_CACHE !== 'false')
  }

  /**
   * 生成缓存键
   */
  static makeKey(params: {
    text: string
    sourceLang: string
    targetLang: string
    platform?: string
    glossaryHash?: string
    model?: string
    promptVersion?: string
  }): string {
    const raw = [
      params.text,
      params.sourceLang,
      params.targetLang,
      params.platform || '',
      params.glossaryHash || '',
      params.model || '',
      params.promptVersion || 'v1',
    ].join('\x00')

    return createHash('sha256').update(raw).digest('hex').substring(0, 32)
  }

  /**
   * 查询缓存
   */
  get(key: string): CacheEntry | null {
    if (!this.enabled) return null

    const entry = this.cache.get(key)
    if (!entry) return null

    // 过期检查
    if (Date.now() - entry.timestamp > DEFAULT_TTL) {
      this.cache.delete(key)
      return null
    }

    return entry
  }

  /**
   * 写入缓存
   */
  set(key: string, translated: string, metadata: CacheEntry['metadata']): void {
    if (!this.enabled) return

    this.cache.set(key, {
      translated,
      timestamp: Date.now(),
      metadata,
    })
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * 缓存条目数
   */
  get size(): number {
    return this.cache.size
  }
}

// 全局单例
let _instance: TranslationCache | null = null

export function getTranslationCache(): TranslationCache {
  if (!_instance) {
    _instance = new TranslationCache()
  }
  return _instance
}

/** 重置缓存实例（测试用） */
export function resetCache(): void {
  _instance = null
}
