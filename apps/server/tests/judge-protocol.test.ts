import { describe, expect, it } from 'vitest'
import { getHeartbeatAction } from '../src/ws/judge-protocol'

describe('judge heartbeat protocol', () => {
  it('refreshes liveness for both ping and pong frames', () => {
    expect(getHeartbeatAction('ping')).toEqual({
      handled: true,
      reply: 'pong',
    })
    expect(getHeartbeatAction('pong')).toEqual({ handled: true })
  })

  it('does not consume application messages', () => {
    expect(getHeartbeatAction('judge')).toEqual({ handled: false })
  })
})
