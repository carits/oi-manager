import { describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { AssignmentContracts, ProblemContracts, TrainingContracts } from '@oi-manager/contracts'
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

  it('guards Problem judge mutations and normalizes judge asset dates', () => {
    const body = parseContractBody(ProblemContracts.saveJudgeSettings, {
      problemType: 'default',
      timeLimit: 1000,
      memoryLimit: 256,
      config: { mode: 'acm', type: 'default', checker_type: 'default' },
    })
    expect(body.config?.mode).toBe('acm')

    const { response, json } = responseStub()
    sendContractData(response, ProblemContracts.listTestdata, {
      files: [{
        id: 'file-1',
        filename: '1.in',
        size: 2,
        md5: null,
        uploadedAt: new Date('2026-09-14T00:00:00Z'),
      }],
      pairs: [{ input: '1.in', output: '1.out' }],
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        files: [expect.objectContaining({
          uploadedAt: '2026-09-14T00:00:00.000Z',
        })],
      }),
    }))
  })

  it('guards Problem editor requests and preserves the complete detail projection', () => {
    const body = parseContractBody(ProblemContracts.update, {
      title: '整数求和',
      status: 'published',
      timeLimit: 1000,
      memoryLimit: 256,
      statements: [{
        format: 'markdown',
        language: 'zh',
        content: '题面',
        fileUrl: null,
        isVisible: true,
      }],
      solutions: [],
    })
    expect(body.status).toBe('published')
    expect(() => parseContractBody(ProblemContracts.update, {
      title: '整数求和',
      status: 'public',
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, ProblemContracts.getEditorDetail, {
      id: 'problem-1',
      title: '整数求和',
      platform: 'carits',
      status: 'draft',
      statements: [],
      solutions: [],
      permissions: { canEdit: true, canView: true },
      ownerName: 'teacher',
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ ownerName: 'teacher' }),
    }))
  })
})
