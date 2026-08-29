import crypto from 'node:crypto'
import logger from '../../lib/logger'

export interface ClientErrorReport {
  type: 'error' | 'unhandledrejection' | 'resource'
  message: string
  stack?: string
  route?: string
  source?: string
  line?: number
  column?: number
  buildId?: string
}

function sanitize(value: string | undefined, maximum: number): string | undefined {
  if (!value) return undefined
  return value
    .replace(/([?&](?:token|key|code|password|signature|session)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/(?:bearer|basic)\s+[a-z0-9._~+\/-]+=*/gi, '[authorization redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, maximum)
}

export function recordClientError(report: ClientErrorReport, context: { requestId?: string; userAgent?: string; ip?: string }) {
  const fingerprint = crypto.createHash('sha256')
    .update(`${report.type}\0${report.message}\0${report.stack || ''}\0${report.source || ''}`)
    .digest('hex')

  logger.warn('client_runtime_error', {
    requestId: context.requestId,
    action: 'client_telemetry',
    metadata: {
      type: report.type,
      fingerprint,
      message: sanitize(report.message, 500),
      route: sanitize(report.route, 300),
      source: sanitize(report.source, 300),
      line: report.line,
      column: report.column,
      buildId: sanitize(report.buildId, 120),
      userAgent: sanitize(context.userAgent, 300),
      ip: context.ip,
    },
  })

  return { fingerprint }
}
