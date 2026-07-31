import { describe, expect, it, vi } from 'vitest'
import {
  IdempotencyConflictError,
  requestFingerprint,
  runIdempotent,
} from '../src/lib/idempotency'

describe('submission idempotency', () => {
  it('shares one in-flight operation for the same scoped key', async () => {
    const operation = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return { submissionId: 42 }
    })
    const fingerprint = requestFingerprint({ code: 'return 0;' })

    const [first, replay] = await Promise.all([
      runIdempotent('test-user', 'same-key', fingerprint, operation),
      runIdempotent('test-user', 'same-key', fingerprint, operation),
    ])

    expect(operation).toHaveBeenCalledTimes(1)
    expect(first.value).toEqual({ submissionId: 42 })
    expect(replay.value).toEqual({ submissionId: 42 })
    expect([first.replayed, replay.replayed]).toContain(true)
  })

  it('rejects reuse of a key with different request content', async () => {
    await runIdempotent(
      'test-conflict',
      'same-key',
      requestFingerprint({ code: 'a' }),
      async () => 1,
    )

    await expect(
      runIdempotent(
        'test-conflict',
        'same-key',
        requestFingerprint({ code: 'b' }),
        async () => 2,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
  })
})
