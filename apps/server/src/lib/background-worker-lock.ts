import { Client } from 'pg'

const DEFAULT_WORKER_LOCK_NAME = 'oi-manager-background-worker-v1'

function workerLockName(): string {
  const configured = process.env.BACKGROUND_WORKER_LOCK_NAME?.trim()
  return configured || DEFAULT_WORKER_LOCK_NAME
}

export interface BackgroundWorkerLock {
  release(): Promise<void>
}

export async function acquireBackgroundWorkerLock(): Promise<BackgroundWorkerLock> {
  const lockName = workerLockName()
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [lockName],
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
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]).catch(() => {})
      await client.end()
    },
  }
}
