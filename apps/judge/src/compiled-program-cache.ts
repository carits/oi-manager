import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { compile, deleteFile, type CompileResult } from './sandbox/client'

type CompileInput = {
  language: string
  code: string
  extraCopyIn?: Record<string, string>
}

type CacheEntry = {
  key: string
  promise: Promise<CompileResult>
  result?: CompileResult
  refs: number
  lastUsed: number
  disposed: boolean
}

export type CompiledProgramLease = {
  result: CompileResult
  release: () => Promise<void>
}

const CACHE_TTL_MS = Math.max(1_000, Number(process.env.HACK_COMPILE_CACHE_TTL_MS) || 30 * 60_000)
const CACHE_MAX_ENTRIES = Math.max(1, Number(process.env.HACK_COMPILE_CACHE_MAX_ENTRIES) || 64)
const TOOLCHAIN_VERSION = process.env.JUDGE_TOOLCHAIN_VERSION || 'default'

const entries = new Map<string, CacheEntry>()
const stats = { hits: 0, misses: 0, evictions: 0, cleanupErrors: 0 }

function cacheKey(input: CompileInput) {
  const extras = Object.entries(input.extraCopyIn || {}).sort(([left], [right]) => left.localeCompare(right))
  return crypto.createHash('sha256').update(JSON.stringify({
    language: input.language,
    code: input.code,
    extras,
    toolchain: TOOLCHAIN_VERSION,
    compileProfile: 'hack-system-v1',
  })).digest('hex')
}

export async function disposeCompileResult(result: CompileResult) {
  const tasks: Promise<unknown>[] = []
  if (result.fileId) tasks.push(deleteFile(result.fileId))
  if (result.workDir) {
    const tempRoot = path.resolve(os.tmpdir())
    const target = path.resolve(result.workDir)
    if (target !== tempRoot && target.startsWith(`${tempRoot}${path.sep}`)) {
      tasks.push(fs.promises.rm(target, { recursive: true, force: true }))
    } else {
      stats.cleanupErrors++
      console.warn('[HackCompileCache] Refusing to remove workDir outside the OS temp directory:', target)
    }
  }
  const settled = await Promise.allSettled(tasks)
  stats.cleanupErrors += settled.filter(item => item.status === 'rejected').length
}

async function disposeEntry(entry: CacheEntry) {
  if (entry.disposed || entry.refs > 0) return false
  entry.disposed = true
  entries.delete(entry.key)
  try {
    const result = entry.result || await entry.promise
    await disposeCompileResult(result)
  } catch {
    stats.cleanupErrors++
  }
  stats.evictions++
  return true
}

async function enforceLimits(now = Date.now()) {
  const idle = [...entries.values()].filter(entry => entry.refs === 0)
    .sort((left, right) => left.lastUsed - right.lastUsed)
  for (const entry of idle) {
    if (now - entry.lastUsed >= CACHE_TTL_MS) await disposeEntry(entry)
  }
  const remaining = [...entries.values()].filter(entry => entry.refs === 0)
    .sort((left, right) => left.lastUsed - right.lastUsed)
  while (entries.size > CACHE_MAX_ENTRIES && remaining.length > 0) await disposeEntry(remaining.shift()!)
}

export async function acquireCompiledProgram(input: CompileInput, cacheable: boolean): Promise<CompiledProgramLease> {
  if (!cacheable) {
    stats.misses++
    const result = await compile({ ...input, timeLimit: 60_000, memoryLimit: 524_288 })
    if (!result.success) {
      await disposeCompileResult(result)
      throw new Error(result.error || '编译失败')
    }
    let released = false
    return { result, release: async () => { if (!released) { released = true; await disposeCompileResult(result) } } }
  }

  const key = cacheKey(input)
  let entry = entries.get(key)
  if (entry && !entry.disposed) {
    stats.hits++
  } else {
    stats.misses++
    const promise = compile({ ...input, timeLimit: 60_000, memoryLimit: 524_288 })
    entry = { key, promise, refs: 0, lastUsed: Date.now(), disposed: false }
    entries.set(key, entry)
    promise.then(result => { entry!.result = result }, () => { entries.delete(key) })
  }
  entry.refs++
  entry.lastUsed = Date.now()
  let result: CompileResult
  try {
    result = await entry.promise
    if (!result.success) throw new Error(result.error || '编译失败')
  } catch (error) {
    entry.refs--
    entries.delete(key)
    if (entry.result) await disposeCompileResult(entry.result)
    throw error
  }
  let released = false
  return {
    result,
    release: async () => {
      if (released) return
      released = true
      entry!.refs = Math.max(0, entry!.refs - 1)
      entry!.lastUsed = Date.now()
      await enforceLimits()
    },
  }
}

export function getHackCompileCacheStats() {
  return { ...stats, entries: entries.size, activeReferences: [...entries.values()].reduce((sum, entry) => sum + entry.refs, 0) }
}

export async function disposeHackCompileCache() {
  for (const entry of [...entries.values()]) {
    entry.refs = 0
    await disposeEntry(entry)
  }
}

const sweepTimer = setInterval(() => { enforceLimits().catch(error => console.warn('[HackCompileCache] sweep failed:', error)) }, 60_000)
sweepTimer.unref()
