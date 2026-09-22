import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stopCron: vi.fn(),
  stopAutoVerify: vi.fn(),
  startCron: vi.fn(),
  startAutoVerify: vi.fn(),
  listPendingPlatforms: vi.fn(),
  recoverStaleJobs: vi.fn(),
}))

vi.mock('../src/lib/cron-tasks', () => ({
  startCronTasks: mocks.startCron.mockImplementation(() => mocks.stopCron),
}))
vi.mock('../src/modules/oj-account/application/oj-account.service', () => ({
  startAutoVerifyScheduler: mocks.startAutoVerify.mockImplementation(() => mocks.stopAutoVerify),
}))
vi.mock('../src/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../src/modules/oj-fetcher/application/oj-fetcher-queue.service', () => ({
  listPendingOjFetchPlatforms: mocks.listPendingPlatforms.mockResolvedValue([]),
  recoverStaleOjFetchJobs: mocks.recoverStaleJobs.mockResolvedValue(0),
}))

import { startExecutorServices, startSchedulerServices } from '../src/lib/background-services'

describe('singleton background service orchestration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps leader-only schedulers out of parallel executors', async () => {
    const services = startSchedulerServices()
    expect(mocks.startCron).toHaveBeenCalledTimes(1)
    expect(mocks.startAutoVerify).toHaveBeenCalledTimes(1)

    await services.stop()
    await services.stop()
    expect(mocks.stopAutoVerify).toHaveBeenCalledTimes(1)
    expect(mocks.stopCron).toHaveBeenCalledTimes(1)
  })

  it('waits for the auto verifier to finish during scheduler shutdown', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    mocks.stopAutoVerify.mockReturnValueOnce(pending)

    const services = startSchedulerServices()
    let stopped = false
    const stopping = services.stop().then(() => { stopped = true })

    await Promise.resolve()
    expect(stopped).toBe(false)

    release()
    await stopping
    expect(stopped).toBe(true)
  })

  it('starts only parallel-safe work in an executor', async () => {
    const services = startExecutorServices()
    expect(mocks.startCron).not.toHaveBeenCalled()
    expect(mocks.startAutoVerify).not.toHaveBeenCalled()
    await services.stop()
    await services.stop()
  })
})
