import { createHash } from 'node:crypto'
import type { Request } from 'express'

const ENTRY_TTL_MS = 10 * 60 * 1000

interface Entry<T> {
  fingerprint: string
  expiresAt: number
  promise: Promise<T>
}

const entries = new Map<string, Entry<unknown>>()

export class IdempotencyConflictError extends Error {
  constructor() {
    super('同一幂等键不能用于不同的请求内容')
    this.name = 'IdempotencyConflictError'
  }
}

export function readIdempotencyKey(req: Request): string | null {
  const value = req.header('Idempotency-Key')?.trim()
  if (!value || value.length > 128) return null
  return value
}

export function requestFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function runIdempotent<T>(
  scope: string,
  key: string | null,
  fingerprint: string,
  operation: () => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  if (!key) return { value: await operation(), replayed: false }

  const now = Date.now()
  for (const [entryKey, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(entryKey)
  }

  const scopedKey = `${scope}:${key}`
  const existing = entries.get(scopedKey) as Entry<T> | undefined
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError()
    return { value: await existing.promise, replayed: true }
  }

  const promise = operation()
  entries.set(scopedKey, {
    fingerprint,
    expiresAt: now + ENTRY_TTL_MS,
    promise,
  })

  try {
    return { value: await promise, replayed: false }
  } catch (error) {
    entries.delete(scopedKey)
    throw error
  }
}
