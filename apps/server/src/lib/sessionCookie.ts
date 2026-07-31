import type { Request, Response } from 'express'

export const SESSION_COOKIE_NAME = 'oi_session'
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {}

  return header.split(';').reduce<Record<string, string>>((cookies, item) => {
    const separator = item.indexOf('=')
    if (separator < 0) return cookies

    const name = item.slice(0, separator).trim()
    const value = item.slice(separator + 1).trim()
    if (!name) return cookies

    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
    return cookies
  }, {})
}

export function getSessionToken(req: Request): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] || null
}

function shouldUseSecureCookie(): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true
  if (process.env.COOKIE_SECURE === 'false') return false
  return process.env.APP_ENV === 'production'
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(),
    path: '/',
  })
}
