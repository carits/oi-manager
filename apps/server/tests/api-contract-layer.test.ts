import { describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { AssignmentContracts, TrainingContracts } from '@oi-manager/contracts'
import {
  ApiContractError,
  parseContractBody,
  parseContractQuery,
  sendContractData,
} from '../src/lib/api-contract'

function responseStub() {
  const json = vi.fn()
  const response = { status: vi.fn(() => ({ json })) } as unknown as Response
  return { response, json }
}

describe('shared API contract adapter', () => {
  it('normalizes bounded pagination at the server boundary', () => {
    expect(parseContractQuery(AssignmentContracts.progress, {
      page: '2',
      pageSize: '40',
      q: ' student ',
    })).toEqual({ page: 2, pageSize: 40, q: 'student' })
  })

  it('rejects invalid mutation bodies before the service runs', () => {
    expect(() => parseContractBody(AssignmentContracts.manualCompletion, {
      completed: true,
      reason: '',
      expectedVersion: 0,
    })).toThrowError(ApiContractError)
  })

  it('serializes only data that satisfies the shared response schema', () => {
    const { response, json } = responseStub()
    sendContractData(response, AssignmentContracts.validate, { valid: true, issues: [] })
    expect(json).toHaveBeenCalledWith({ success: true, data: { valid: true, issues: [] } })
    expect(() => sendContractData(response, AssignmentContracts.validate, {
      valid: true,
      issues: [{ path: 'problems', code: 7, message: 'invalid' }],
    })).toThrowError(ApiContractError)
  })

  it('guards Training structure mutations and design responses with one contract', () => {
    const body = parseContractBody(TrainingContracts.replaceStructure, {
      expectedRevision: 2,
      title: '顺序训练',
      description: '',
      stages: [{
        clientKey: 'stage-draft-1',
        name: '热身',
        mode: 'SEQUENTIAL',
        advanceMode: 'MANUAL',
        problemAccessMode: 'SEQUENTIAL',
        submissionMode: 'NORMAL',
        problems: [],
      }],
    })
    expect(body.expectedRevision).toBe(2)

    const { response, json } = responseStub()
    sendContractData(response, TrainingContracts.getDesign, {
      editable: true,
      statusRevision: 2,
      session: {
        id: 'training-1',
        title: '顺序训练',
        sessionType: 'GENERAL',
        status: 'DRAFT',
        scheduledStartAt: new Date('2026-09-15T00:00:00Z'),
      },
      stages: [],
      issues: [],
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        statusRevision: 2,
        session: expect.objectContaining({ scheduledStartAt: '2026-09-15T00:00:00.000Z' }),
      }),
    }))
  })
})
