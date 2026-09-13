import request from 'supertest'
import express from 'express'
import { createApplication } from '../../src/app'

/**
 * 创建测试用的 Express 应用
 * 返回一个配置好路由的 Express 实例，用于 supertest 测试
 */
export function createTestApp() {
  return createApplication({
    disableRateLimit: true,
    allowAnyCorsOrigin: true,
  })
}

/**
 * 创建带认证的请求
 */
export function createAuthenticatedRequest(
  app: express.Application,
  token: string,
  options: { organizationId?: string } = {},
) {
  const authenticated = (test: any) => {
    const withToken = test.set('Authorization', `Bearer ${token}`)
    return options.organizationId
      ? withToken.set('X-OI-Organization-ID', options.organizationId)
      : withToken
  }
  return {
    get: (url: string) =>
      authenticated(request(app).get(url)),
    post: (url: string) =>
      authenticated(request(app).post(url)),
    put: (url: string) =>
      authenticated(request(app).put(url)),
    patch: (url: string) =>
      authenticated(request(app).patch(url)),
    delete: (url: string) =>
      authenticated(request(app).delete(url))
  }
}
