import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './concurrency'

describe('mapWithConcurrency', () => {
  it('preserves result order while limiting active workers', async () => {
    let active = 0
    let maxActive = 0
    const resolvers: Array<() => void> = []

    const promise = mapWithConcurrency([1, 2, 3, 4], 2, async value => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>(resolve => resolvers.push(resolve))
      active -= 1
      return value * 10
    })

    await Promise.resolve()
    expect(active).toBe(2)
    resolvers.shift()?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(active).toBe(2)
    while (resolvers.length) {
      resolvers.shift()?.()
      await Promise.resolve()
      await Promise.resolve()
    }

    await expect(promise).resolves.toEqual([10, 20, 30, 40])
    expect(maxActive).toBe(2)
  })

  it('rejects invalid concurrency values', async () => {
    await expect(mapWithConcurrency([1], 0, async value => value)).rejects.toThrow(/positive integer/)
  })
})
