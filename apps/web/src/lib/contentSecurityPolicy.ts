export type ContentSecurityPolicyMode = 'off' | 'report-only' | 'enforce'

export function parseContentSecurityPolicyMode(value?: string): ContentSecurityPolicyMode {
  if (value === 'report-only' || value === 'enforce') return value
  return 'off'
}

export function contentSecurityPolicyHeader(mode: ContentSecurityPolicyMode): string | null {
  if (mode === 'off') return null
  return mode === 'enforce'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only'
}

export function buildContentSecurityPolicy(nonce: string): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new Error('CSP nonce contains invalid characters')
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    'upgrade-insecure-requests',
  ].join('; ')
}
