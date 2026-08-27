import { beforeEach, describe, expect, it, vi } from 'vitest'

const compileMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('./sandbox/client', () => ({
  compile: compileMock,
  deleteFile: deleteMock,
}))

describe('Hack system compile cache', () => {
  beforeEach(() => {
    compileMock.mockReset()
    deleteMock.mockReset()
    compileMock.mockImplementation(async () => ({ success: true, fileId: `file-${compileMock.mock.calls.length}` }))
  })

  it('shares one compiled artifact and releases it on disposal', async () => {
    const cache = await import('./compiled-program-cache.js')
    const first = await cache.acquireCompiledProgram({ language: 'cpp17', code: 'int main(){}' }, true)
    const second = await cache.acquireCompiledProgram({ language: 'cpp17', code: 'int main(){}' }, true)
    expect(compileMock).toHaveBeenCalledTimes(1)
    await first.release()
    await second.release()
    expect(deleteMock).not.toHaveBeenCalled()
    await cache.disposeHackCompileCache()
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })

  it('deduplicates 500 concurrent leases and returns to zero references', async () => {
    const cache = await import('./compiled-program-cache.js')
    await cache.disposeHackCompileCache()
    deleteMock.mockClear()

    const leases = await Promise.all(Array.from({ length: 500 }, () =>
      cache.acquireCompiledProgram({ language: 'cpp17', code: 'int main(){return 0;}' }, true),
    ))

    expect(compileMock).toHaveBeenCalledTimes(1)
    expect(cache.getHackCompileCacheStats()).toMatchObject({ entries: 1, activeReferences: 500 })

    await Promise.all(leases.map(lease => lease.release()))
    expect(cache.getHackCompileCacheStats()).toMatchObject({ entries: 1, activeReferences: 0 })

    await cache.disposeHackCompileCache()
    expect(cache.getHackCompileCacheStats()).toMatchObject({ entries: 0, activeReferences: 0 })
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })

  it('always disposes non-cacheable generator artifacts', async () => {
    const cache = await import('./compiled-program-cache.js')
    const lease = await cache.acquireCompiledProgram({ language: 'cpp17', code: 'int main(){}' }, false)
    await lease.release()
    await lease.release()
    expect(compileMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })
})
