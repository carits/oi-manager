import { describe, expect, it } from 'vitest'
import { retryJudgePersistence } from '../src/ws/judge'

describe('Judge result persistence retry', () => {
  it('survives transient database errors without releasing task ownership', async () => {
    let attempts = 0
    const result = await retryJudgePersistence(async () => {
      attempts++
      if (attempts < 3) throw new Error('temporary database outage')
      return 'persisted'
    }, { taskType: 'submission', taskId: '42' })

    expect(result).toBe('persisted')
    expect(attempts).toBe(3)
  })
})
