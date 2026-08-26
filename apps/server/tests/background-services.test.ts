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
vi.mock('../src/routes/oj-accounts', () => ({
  startAutoVerifyScheduler: mocks.startAutoVerify.mockImplementation(() => mocks.stopAutoVerify),
}))
vi.mock('../src/lib/submission-poller', () => ({
  startSubmissionPoller: mocks.startPoller,
  stopSubmissionPoller: mocks.stopPoller,
}))
vi.mock('../src/lib/logger', () => ({ default: { info: vi.fn() } }))

import { startBackgroundServices } from '../src/lib/background-services'

describe('singleton background service orchestration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts each scheduler once and stops them idempotently', async () => {
    const services = startBackgroundServices()
    expect(mocks.startCron).toHaveBeenCalledTimes(1)
    expect(mocks.startAutoVerify).toHaveBeenCalledTimes(1)
    expect(mocks.startPoller).toHaveBeenCalledWith(5000)

    await services.stop()
    await services.stop()
    expect(mocks.stopPoller).toHaveBeenCalledTimes(1)
    expect(mocks.stopAutoVerify).toHaveBeenCalledTimes(1)
    expect(mocks.stopCron).toHaveBeenCalledTimes(1)
  })
})
