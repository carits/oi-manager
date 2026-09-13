import { describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { AssignmentContracts } from '@oi-manager/contracts'
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
})
