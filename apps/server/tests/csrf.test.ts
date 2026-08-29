import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyCookieOrigin } from '../src/middleware/csrf'

const originalEnvironment = {
  APP_ENV: process.env.APP_ENV,
  CSRF_REQUIRE_ORIGIN: process.env.CSRF_REQUIRE_ORIGIN,
  CSRF_TRUSTED_ORIGINS: process.env.CSRF_TRUSTED_ORIGINS,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  FRONTEND_URL: process.env.FRONTEND_URL,
}

function createApp() {
  const app = express()
  app.use(verifyCookieOrigin)
  app.all('/mutation', (_request, response) => response.status(204).end())
  return app
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('cookie Origin verification', () => {
  it('allows safe methods and requests without session cookies', async () => {
    process.env.APP_ENV = 'production'

    const safe = await request(createApp()).get('/mutation').set('Cookie', 'oi_session=token')
    const bearerStyle = await request(createApp()).post('/mutation')

    expect(safe.status).toBe(204)
    expect(bearerStyle.status).toBe(204)
  })

  it('requires Origin for unsafe cookie requests in production by default', async () => {
    process.env.APP_ENV = 'production'
    delete process.env.CSRF_REQUIRE_ORIGIN

    const response = await request(createApp())
      .post('/mutation')
      .set('Cookie', 'oi_session=token')

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('CSRF_ORIGIN_REQUIRED')
  })

  it('supports explicit compatibility mode for the current HTTP deployment', async () => {
    process.env.APP_ENV = 'development'
    process.env.CSRF_REQUIRE_ORIGIN = 'false'

    const response = await request(createApp())
      .post('/mutation')
      .set('Cookie', 'oi_session=token')

    expect(response.status).toBe(204)
  })

  it('accepts only configured origins in strict mode', async () => {
    process.env.APP_ENV = 'production'
    process.env.CSRF_REQUIRE_ORIGIN = 'true'
    process.env.CSRF_TRUSTED_ORIGINS = 'https://oj.example.edu.cn'

    const accepted = await request(createApp())
      .post('/mutation')
      .set('Cookie', 'oi_session=token')
      .set('Origin', 'https://oj.example.edu.cn')
    const rejected = await request(createApp())
      .post('/mutation')
      .set('Cookie', 'oi_session=token')
      .set('Origin', 'https://evil.example')

    expect(accepted.status).toBe(204)
    expect(rejected.status).toBe(403)
    expect(rejected.body.code).toBe('CSRF_ORIGIN_REJECTED')
  })
})
