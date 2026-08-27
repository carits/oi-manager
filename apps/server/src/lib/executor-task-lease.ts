import { Client } from 'pg'

export interface ExecutorTaskLease {
  release(): Promise<void>
}

/**
 * Session advisory leases let multiple Executor processes scan the same
 * legacy/external queue without holding a database transaction during remote
 * network I/O. A task is processed by at most one live Executor; a crashed
 * process releases its lease when PostgreSQL closes the session.
 */
export async function tryAcquireExecutorTaskLease(namespace: string, taskId: string | number): Promise<ExecutorTaskLease | null> {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const key = `${namespace}:${taskId}`
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [key],
    )
    if (!result.rows[0]?.acquired) {
      await client.end()
      return null
    }
  } catch (error) {
    await client.end().catch(() => {})
    throw error
  }

  let released = false
  return {
    async release() {
      if (released) return
      released = true
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]).catch(() => {})
      await client.end()
    },
  }
}
