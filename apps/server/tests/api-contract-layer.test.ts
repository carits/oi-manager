import { describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { AssignmentContracts, AuthContracts, CaritsContracts, ChatContracts, DataMarketContracts, EvaluationCreditContracts, IdentityContracts, NotificationContracts, OrganizationContracts, ProblemContracts, TeamContracts, TrainingContracts, WorkspaceContracts } from '@oi-manager/contracts'
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

  it('guards account authentication requests and context responses', () => {
    expect(parseContractBody(AuthContracts.login, {
      username: 'teacher1', password: '123456',
    })).toEqual({ username: 'teacher1', password: '123456' })
    expect(() => parseContractBody(AuthContracts.changePassword, {
      currentPassword: '123456', newPassword: '123',
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, AuthContracts.me, {
      userId: 'user-1', username: 'teacher1', accountRole: 'user', role: 'teacher',
      organizationId: 'organization-1', organizationRole: 'teacher', schoolId: 'school-1', workspaceMode: 'work',
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ accountRole: 'user', organizationRole: 'teacher', schoolId: 'school-1' }),
    }))
  })

  it('guards public profile type and organization projection', () => {
    expect(parseContractQuery(IdentityContracts.publicProfile, { userType: 'student' }))
      .toEqual({ userType: 'student' })
    expect(() => parseContractQuery(IdentityContracts.publicProfile, { userType: 'principal' }))
      .toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, IdentityContracts.publicProfile, {
      id: 'user-1', profileId: 'profile-1', name: '张同学', username: 'student1',
      avatar: null, bio: null, userType: 'student',
      school: { id: 'organization-1', name: '测试学校' },
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ userType: 'student', school: { id: 'organization-1', name: '测试学校' } }),
    }))
  })

  it('guards Team membership commands and normalizes the detail wire format', () => {
    expect(parseContractBody(TeamContracts.inviteMembers, {
      members: [{ userId: 'user-2', userType: 'student' }],
    })).toEqual({ members: [{ userId: 'user-2', userType: 'student' }] })
    expect(() => parseContractBody(TeamContracts.inviteMembers, {
      members: [{ id: 'user-2', type: 'student' }],
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, TeamContracts.detail, {
      id: 'team-1', name: '顺序训练队', avatar: null, description: null,
      scope: 'campus', isPublic: true, createdAt: new Date('2026-09-15T00:00:00Z'),
      school: { id: 'school-1', name: '测试学校' }, owner: null,
      admins: [], teachers: [], students: [], pendingRequests: [],
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ createdAt: '2026-09-15T00:00:00.000Z' }),
    }))
  })

  it('guards data market prices and quality incident commands', () => {
    expect(parseContractBody(DataMarketContracts.purchase, { license: 'PERSONAL' })).toEqual({ license: 'PERSONAL' })
    expect(parseContractBody(DataMarketContracts.purchase, { license: 'PERSONAL', amountCarits: 1 })).toEqual({ license: 'PERSONAL', amountCarits: 1 })
    expect(parseContractBody(DataMarketContracts.createIncident, {
      revisionId: 'revision-1', severity: 'MAJOR', type: '答案错误',
      description: '该版本包含可以稳定复现的错误答案数据。',
    }).severity).toBe('MAJOR')
  })

  it('keeps Carits ledger values separate from Evaluation Credit resource contracts', () => {
    const purchase = parseContractBody(EvaluationCreditContracts.purchase, {
      packageCode: 'EVAL_5K', userId: 'ignored-by-authenticated-service',
    })
    expect(purchase).toEqual({ packageCode: 'EVAL_5K', userId: 'ignored-by-authenticated-service' })
    expect(() => parseContractBody(EvaluationCreditContracts.purchase, { packageCode: '' }))
      .toThrowError(ApiContractError)

    const accountResponse = responseStub()
    sendContractData(accountResponse.response, CaritsContracts.personalTransactions, {
      currency: 'Carits币', accountStatus: 'active', accountId: 'account-1',
      balance: '20', availableBalance: '20', debtBalance: '0',
      createdAt: new Date('2026-09-15T00:00:00Z'), updatedAt: new Date('2026-09-15T00:00:00Z'),
      items: [{ id: 'entry-1', type: 'contribution_reward', source: 'contribution_event', referenceId: null, amount: '20', balanceAfter: '20', createdAt: new Date('2026-09-15T00:00:00Z') }],
    })
    expect(accountResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ balance: '20', items: [expect.objectContaining({ amount: '20' })] }),
    }))

    const creditResponse = responseStub()
    sendContractData(creditResponse.response, EvaluationCreditContracts.overview, {
      periodStart: new Date('2026-09-15T00:00:00Z'), resetsAt: new Date('2026-09-16T00:00:00Z'),
      level: 'L1', contributionScore: 100, dailyLimit: 20_000,
      free: { limit: 10_000, available: 9_000, reserved: 500, consumed: 500 },
      purchased: { available: 5_000, reserved: 0, consumed: '0' },
      today: { reserved: 500, consumed: 500 },
      packages: [{ packageCode: 'EVAL_5K', carits: '10', credits: 5_000, exchangeRate: 500, policyCode: 'evaluation_credit_exchange', policyVersion: 1 }],
      recentPurchases: [],
    })
    expect(creditResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ dailyLimit: 20_000, purchased: expect.objectContaining({ available: 5_000 }) }),
    }))
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

  it('guards OI Test Graph edits and normalizes workspace dates', () => {
    const body = parseContractBody(ProblemContracts.saveTestGraph, {
      revision: 3,
      expectedLatestRevisionId: 'revision-3',
      subtasks: [{
        id: 1, score: 100, if: [], groups: [
          { key: 'official-1', name: '官方测试组', kind: 'official', score: 100, type: 'min', cases: [] },
          { key: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
        ],
      }],
    })
    expect(body.revision).toBe(3)
    expect(() => parseContractBody(ProblemContracts.registerTestGraphTestcases, { pairs: [] })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, ProblemContracts.getTestGraph, {
      revision: 3,
      revisionId: 'revision-3',
      createdAt: new Date('2026-09-14T00:00:00Z'),
      migrated: true,
      subtasks: body.subtasks,
      files: [], pairs: [], unmatchedFiles: [], testcases: [],
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ createdAt: '2026-09-14T00:00:00.000Z' }),
    }))
  })

  it('rejects incomplete judge template responses at the shared boundary', () => {
    const { response, json } = responseStub()
    sendContractData(response, ProblemContracts.getJudgeProgramTemplate, {
      id: 'validator-cpp17', version: 1, kind: 'validator', language: 'cpp17',
      protocol: 'oj.validator/v1', title: 'Validator', description: '输入校验', recommended: true,
      protocolHelp: ['严格 EOF'], source: 'int main() {}',
      examples: [{ name: '合法', stdin: '1\n', expectedExitCode: 0 }],
      learningNotes: ['输入来自 stdin'], requiredChanges: ['修改约束'],
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    expect(() => sendContractData(response, ProblemContracts.getJudgeProgramTemplate, {
      id: 'broken', kind: 'validator', source: '', examples: [],
    })).toThrowError(ApiContractError)
  })

  it('guards chat message payloads and serializes dates at the account boundary', () => {
    const body = parseContractBody(ChatContracts.sendMessage, {
      type: 'text', content: '你好', clientMessageId: '12345678-1234-1234-1234-123456789012',
    })
    expect(body.type).toBe('text')
    expect(() => parseContractBody(ChatContracts.sendMessage, {
      type: 'sticker', stickerId: '', clientMessageId: 'invalid',
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, ChatContracts.listMessagesV2, {
      items: [{
        id: 'message-1', conversationId: 'conversation-1', senderUserId: 'user-1',
        seq: 1, content: '你好', type: 'text', createdAt: new Date('2026-09-15T00:00:00Z'),
      }],
      page: { hasMoreBefore: false, hasMoreAfter: false, oldestSeq: 1, newestSeq: 1 },
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        items: [expect.objectContaining({ createdAt: '2026-09-15T00:00:00.000Z' })],
      }),
    }))
  })

  it('guards organization applications and serializes directory relations', () => {
    expect(parseContractBody(OrganizationContracts.createJoinApplication, {
      organizationId: 'organization-1', requestedRole: 'student', requestedRelationType: 'enrolled', realName: '学生甲',
    }).requestedRole).toBe('student')
    expect(() => parseContractBody(OrganizationContracts.createJoinApplication, {
      organizationId: 'organization-1', requestedRole: 'principal', requestedRelationType: 'employee', realName: '越权身份',
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, OrganizationContracts.mine, {
      memberships: [{
        id: 'membership-1', status: 'active', memberRole: 'student', createdAt: new Date('2026-09-15T00:00:00Z'),
        Organization: { id: 'organization-1', name: '第一中学', ignoredInternalField: true },
      }],
      applications: [], invitations: [],
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ memberships: [expect.objectContaining({ createdAt: '2026-09-15T00:00:00.000Z' })] }),
    }))
  })

  it('guards notification queries and serializes notification dates', () => {
    expect(parseContractQuery(NotificationContracts.list, {
      page: '2', pageSize: '50', filter: 'unread', view: 'account',
    })).toEqual({ page: 2, pageSize: 50, filter: 'unread', view: 'account' })
    expect(() => parseContractQuery(NotificationContracts.list, { pageSize: '51' })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, NotificationContracts.list, {
      notifications: [{
        id: 'notification-1', type: 'account', title: '通知', body: '正文', sourceType: 'test', sourceId: 'source-1',
        actionable: false, actions: [], readAt: null, createdAt: new Date('2026-09-15T00:00:00Z'),
      }],
      unreadCount: 1, page: 1, pageSize: 20, hasMore: false,
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notifications: [expect.objectContaining({ createdAt: '2026-09-15T00:00:00.000Z' })] }),
    }))
  })

  it('guards account workspace summaries at the shared boundary', () => {
    const { response, json } = responseStub()
    sendContractData(response, WorkspaceContracts.list, {
      workspaces: [
        {
          type: 'organization', organizationId: 'organization-1', organizationName: '第一中学',
          organizationType: 'school', organizationMembershipId: 'membership-1', memberRole: 'teacher',
          relationType: 'employee', relationLabel: '本校教师', shortName: null,
          availableModules: ['overview', 'teams'],
        },
        { type: 'personal', availableModules: ['overview'] },
      ],
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workspaces: expect.arrayContaining([expect.objectContaining({ type: 'personal' })]) }),
    }))
    expect(() => sendContractData(response, WorkspaceContracts.list, {
      workspaces: [{ type: 'organization', organizationId: 'organization-1', availableModules: [] }],
    })).toThrowError(ApiContractError)
  })
})
