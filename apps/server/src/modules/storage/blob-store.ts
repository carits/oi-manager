import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

export type BlobContent = Buffer | Uint8Array | string

export interface PutBlobOptions {
  ifAbsent?: boolean
  contentType?: string
}

export interface BlobStore {
  put(key: string, content: BlobContent, options?: PutBlobOptions): Promise<void>
  get(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  materialize(key: string, target: string): Promise<void>
}

function normalizedKey(key: string) {
  const value = String(key || '').replace(/\\/g, '/')
  const parts = value.split('/')
  if (!value || value.startsWith('/') || parts.some((part: string) => !part || part === '.' || part === '..') || value.includes('\0')) {
    throw new Error(`Invalid blob key: ${key}`)
  }
  return parts.join('/')
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const root = path.resolve(this.root)
    const target = path.resolve(root, ...normalizedKey(key).split('/'))
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Blob key escapes store root: ${key}`)
    return target
  }

  async put(key: string, content: BlobContent, options: PutBlobOptions = {}) {
    const target = this.resolve(key)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    try {
      await fs.promises.writeFile(target, content, options.ifAbsent ? { flag: 'wx' } : undefined)
    } catch (error: any) {
      if (!(options.ifAbsent && error?.code === 'EEXIST')) throw error
    }
  }

  get(key: string) {
    return fs.promises.readFile(this.resolve(key))
  }

  async exists(key: string) {
    try {
      await fs.promises.access(this.resolve(key), fs.constants.R_OK)
      return true
    } catch {
      return false
    }
  }

  async delete(key: string) {
    await fs.promises.rm(this.resolve(key), { force: true })
  }

  async materialize(key: string, target: string) {
    const source = this.resolve(key)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    try {
      await fs.promises.link(source, target)
    } catch (error: any) {
      if (error?.code === 'EEXIST') return
      await fs.promises.copyFile(source, target)
    }
  }
}

/** Minimal adapter contract shared by the S3 and Aliyun OSS implementations.
 * SDK-specific clients are injected at composition time, keeping the problem
 * domain independent from a cloud vendor package.
 */
export interface ObjectStorageAdapter {
  putObject(key: string, content: BlobContent, options?: PutBlobOptions): Promise<void>
  getObject(key: string): Promise<Buffer | Uint8Array | Readable>
  headObject(key: string): Promise<boolean>
  deleteObject(key: string): Promise<void>
}

async function toBuffer(value: Buffer | Uint8Array | Readable) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  const chunks: Buffer[] = []
  for await (const chunk of value) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

abstract class RemoteBlobStore implements BlobStore {
  constructor(private readonly prefix: string, private readonly adapter: ObjectStorageAdapter) {}

  private key(key: string) {
    const suffix = normalizedKey(key)
    return this.prefix ? `${normalizedKey(this.prefix)}/${suffix}` : suffix
  }

  put(key: string, content: BlobContent, options?: PutBlobOptions) {
    return this.adapter.putObject(this.key(key), content, options)
  }

  async get(key: string) {
    return toBuffer(await this.adapter.getObject(this.key(key)))
  }

  exists(key: string) {
    return this.adapter.headObject(this.key(key))
  }

  delete(key: string) {
    return this.adapter.deleteObject(this.key(key))
  }

  async materialize(key: string, target: string) {
    const content = await this.get(key)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, content, { flag: 'wx' })
  }
}

export class S3BlobStore extends RemoteBlobStore {}
export class AliyunOssBlobStore extends RemoteBlobStore {}

let singleton: BlobStore | null = null

export function getTestdataBlobStore(): BlobStore {
  if (singleton) return singleton
  const root = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
  singleton = new LocalBlobStore(root)
  return singleton
}

export function setTestdataBlobStoreForTests(store: BlobStore | null) {
  singleton = store
}

export function problemBlobKey(problemId: string, storageKey: string) {
  return `${normalizedKey(problemId)}/${normalizedKey(storageKey)}`
}
