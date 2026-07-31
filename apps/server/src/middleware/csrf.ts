import type { NextFunction, Request, Response } from 'express'
import { SESSION_COOKIE_NAME } from '../lib/sessionCookie'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function trustedOrigins(): Set<string> {
  const configured = [
    process.env.CSRF_TRUSTED_ORIGINS,
    process.env.CORS_ORIGINS,
    process.env.FRONTEND_URL,
  ]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

  if (process.env.APP_ENV !== 'production') {
    configured.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
    )
  }

  return new Set(configured)
}

function hasSessionCookie(req: Request): boolean {
  return Boolean(
    req.headers.cookie
      ?.split(';')
      .some(item => item.trim().startsWith(`${SESSION_COOKIE_NAME}=`)),
  )
}

export function verifyCookieOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || !hasSessionCookie(req)) {
    next()
    return
  }

  const origin = req.headers.origin
  if (!origin) {
    // Server-to-server and test clients commonly omit Origin. SameSite protects browser requests.
    next()
    return
  }

  const allowed = trustedOrigins()
  if (allowed.has(origin)) {
    next()
    return
  }

  if (process.env.APP_ENV !== 'production') {
    try {
      const originUrl = new URL(origin)
      const forwardedHost = req.headers['x-forwarded-host']
      const requestHost = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host
      const requestHostname = requestHost?.split(':')[0]
      if (requestHostname && originUrl.hostname === requestHostname) {
        next()
        return
      }
    } catch {
      // Invalid origins are rejected below.
    }
  }

  res.status(403).json({
    success: false,
    code: 'CSRF_ORIGIN_REJECTED',
    message: '请求来源未被允许',
  })
}
