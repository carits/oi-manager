import { describe, expect, it } from 'vitest'
import { tryAcquireExecutorTaskLease } from '../src/lib/executor-task-lease'

describe('executor task lease', () => {
  it('allows many executors but only one owner for the same task', async () => {
    const first = await tryAcquireExecutorTaskLease('test-executor', 'same-task')
    expect(first).not.toBeNull()
    const duplicate = await tryAcquireExecutorTaskLease('test-executor', 'same-task')
    expect(duplicate).toBeNull()
    const independent = await tryAcquireExecutorTaskLease('test-executor', 'other-task')
    expect(independent).not.toBeNull()
    await independent!.release()
    await first!.release()
    const afterRelease = await tryAcquireExecutorTaskLease('test-executor', 'same-task')
    expect(afterRelease).not.toBeNull()
    await afterRelease!.release()
  })
})
