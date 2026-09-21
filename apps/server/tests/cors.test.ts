import { afterEach, describe, expect, it } from 'vitest'
import { getCorsOptions } from '../src/config/cors'

const originalAppEnv = process.env.APP_ENV

afterEach(() => {
  if (originalAppEnv === undefined) delete process.env.APP_ENV
  else process.env.APP_ENV = originalAppEnv
})

describe('CORS configuration', () => {
  it('allows the organization context header in production', () => {
    process.env.APP_ENV = 'production'
    const options = getCorsOptions()
    expect(options.allowedHeaders).toContain('X-OI-Organization-ID')
  })

  it('allows the organization context header in development', () => {
    process.env.APP_ENV = 'development'
    const options = getCorsOptions()
    expect(options.allowedHeaders).toContain('X-OI-Organization-ID')
  })
})
