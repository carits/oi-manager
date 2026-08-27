import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalBlobStore } from '../src/modules/storage/blob-store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.promises.rm(root, { recursive: true, force: true })))
})

describe('LocalBlobStore', () => {
  it('stores immutable content and materializes it without a second implementation path', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oi-blob-'))
    roots.push(root)
    const store = new LocalBlobStore(root)
    const key = `problem/objects/${crypto.randomUUID()}`
    await store.put(key, Buffer.from('first'), { ifAbsent: true })
    await store.put(key, Buffer.from('second'), { ifAbsent: true })
    expect((await store.get(key)).toString()).toBe('first')
    expect(await store.exists(key)).toBe(true)

    const target = path.join(root, 'revision', '1.in')
    await store.materialize(key, target)
    expect(await fs.promises.readFile(target, 'utf8')).toBe('first')
    await store.delete(key)
    expect(await store.exists(key)).toBe(false)
  })

  it('rejects traversal and absolute keys', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oi-blob-'))
    roots.push(root)
    const store = new LocalBlobStore(root)
    await expect(store.put('../outside', 'x')).rejects.toThrow(/Invalid blob key/)
    await expect(store.put('/absolute', 'x')).rejects.toThrow(/Invalid blob key/)
    await expect(store.put('a\\..\\outside', 'x')).rejects.toThrow(/Invalid blob key/)
  })
})
