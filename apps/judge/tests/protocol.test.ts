import { describe, expect, it } from 'vitest'
import { getClientHeartbeatReply } from '../src/protocol'

describe('judge client heartbeat protocol', () => {
  it('responds to ping and accepts pong', () => {
    expect(getClientHeartbeatReply('ping')).toBe('pong')
    expect(getClientHeartbeatReply('pong')).toBeNull()
  })

  it('leaves application messages to the client dispatcher', () => {
    expect(getClientHeartbeatReply('judge')).toBeUndefined()
  })
})
