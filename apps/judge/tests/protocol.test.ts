import { describe, expect, it } from 'vitest'
import { getClientHeartbeatReply } from '../src/protocol'
import { buildJudgeRequest } from '../src/client'

describe('judge client heartbeat protocol', () => {
  it('responds to ping and accepts pong', () => {
    expect(getClientHeartbeatReply('ping')).toBe('pong')
    expect(getClientHeartbeatReply('pong')).toBeNull()
  })

  it('leaves application messages to the client dispatcher', () => {
    expect(getClientHeartbeatReply('judge')).toBeUndefined()
  })

  it('preserves submission IO when mapping a WebSocket task to the Judge', () => {
    const request = buildJudgeRequest({
      submissionId: '1', problemId: 'p', language: 'cpp17', code: 'int main(){}',
      testdataPath: '/tmp/data', config: {}, ioAdapterVersion: 1,
      io: { inputFile: 'travel.in', outputFile: 'travel.out' },
    })
    expect(request).toMatchObject({
      ioAdapterVersion: 1,
      io: { inputFile: 'travel.in', outputFile: 'travel.out' },
    })
  })
})
