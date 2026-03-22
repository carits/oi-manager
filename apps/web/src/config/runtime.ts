/**
 * 运行时配置
 * 可在浏览器端动态读取/修改
 */

import { ENV } from './env'

class RuntimeConfig {
  private _apiUrl: string

  constructor() {
    this._apiUrl = ENV.API_URL
  }

  get apiUrl(): string {
    return this._apiUrl
  }

  /** 运行时切换 API 地址（用于测试或特殊场景） */
  setApiUrl(url: string) {
    this._apiUrl = url
  }
}

export const runtimeConfig = new RuntimeConfig()
