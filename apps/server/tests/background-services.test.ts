import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stopCron: vi.fn(),
  stopAutoVerify: vi.fn(),
  startCron: vi.fn(),
  startAutoVerify: vi.fn(),
  startPoller: vi.fn(),
  stopPoller: vi.fn(),
}))

vi.mock('../src/lib/cron-tasks', () => ({
  startCronTasks: mocks.startCron.mockImplementation(() => mocks.stopCron),
}))
vi.mock('../src/modules/oj-account/application/oj-account.service', () => ({
  startAutoVerifyScheduler: mocks.startAutoVerify.mockImplementation(() => mocks.stopAutoVerify),
}))
vi.mock('../src/lib/submission-poller', () => ({
  startSubmissionPoller: mocks.startPoller,
  stopSubmissionPoller: mocks.stopPoller,
}))
vi.mock('../src/lib/logger', () => ({ default: { info: vi.fn() } }))

import { startExecutorServices, startSchedulerServices } from '../src/lib/background-services'

describe('singleton background service orchestration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps leader-only schedulers out of parallel executors', async () => {
    const services = startSchedulerServices()
    expect(mocks.startCron).toHaveBeenCalledTimes(1)
    expect(mocks.startAutoVerify).toHaveBeenCalledTimes(1)
    expect(mocks.startPoller).not.toHaveBeenCalled()

    await services.stop()
    await services.stop()
    expect(mocks.stopAutoVerify).toHaveBeenCalledTimes(1)
    expect(mocks.stopCron).toHaveBeenCalledTimes(1)
  })

  it('starts only parallel-safe work in an executor', async () => {
    const services = startExecutorServices()
    expect(mocks.startPoller).toHaveBeenCalledWith(5000)
    expect(mocks.startCron).not.toHaveBeenCalled()
    expect(mocks.startAutoVerify).not.toHaveBeenCalled()
    await services.stop()
    await services.stop()
    expect(mocks.stopPoller).toHaveBeenCalledTimes(1)
  })
})
