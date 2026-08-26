import { Client } from 'pg'

const WORKER_LOCK_NAME = 'oi-manager-background-worker-v1'

export interface BackgroundWorkerLock {
  release(): Promise<void>
}

export async function acquireBackgroundWorkerLock(): Promise<BackgroundWorkerLock> {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [WORKER_LOCK_NAME],
    )
    if (!result.rows[0]?.acquired) throw new Error('Another background worker already holds the singleton lock')
  } catch (error) {
    await client.end().catch(() => {})
    throw error
  }

  let released = false
  return {
    async release() {
      if (released) return
      released = true
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [WORKER_LOCK_NAME]).catch(() => {})
      await client.end()
    },
  }
}
