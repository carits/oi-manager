import { describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { AiGovernanceContracts, AssignmentContracts, AuthContracts, BlogManagementContracts, CaritsContracts, ChatContracts, ContributionContracts, DataMarketContracts, EvaluationCreditContracts, IdentityContracts, NotificationContracts, OjAccountContracts, OjFetcherContracts, OrganizationContracts, PlatformBindingContracts, ProblemContracts, ProblemListContracts, ProblemQualityContracts, RankingContracts, RatingLeaderboardContracts, SolutionReviewContracts, SubmissionContracts, TeamContracts, TelemetryContracts, TrainingContracts, WorkspaceContracts } from '@oi-manager/contracts'
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
  it('serializes submission detail through the shared runtime contract', () => {
    const { response, json } = responseStub()
    sendContractData(response, SubmissionContracts.detail, {
      id: 3824, username: 'student', result: 'accepted', timeUsed: 4, memoryUsed: 624,
      codeLength: 20, language: 'cpp17', code: null, submitMethod: 'local', ojRemoteId: null,
      submittedAt: new Date('2026-09-16T00:00:00Z'), errorMessage: null,
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: 3824, submittedAt: '2026-09-16T00:00:00.000Z' }),
    }))
    expect(() => sendContractData(response, SubmissionContracts.detail, {
      id: 0, username: 'student', result: null, timeUsed: null, memoryUsed: null,
      codeLength: 0, language: 'cpp17', code: null, submitMethod: 'local', ojRemoteId: null,
      submittedAt: new Date(), errorMessage: null,
    })).toThrowError(ApiContractError)
  })

  it('guards local submission creation through the shared runtime contract', () => {
    expect(parseContractBody(SubmissionContracts.create, {
      problemId: '1041', oj: 'carits', language: 'cpp17', code: 'int main(){}',
      submitMethod: 'local', inputFilename: null, outputFilename: null,
    })).toEqual({
      problemId: '1041', oj: 'carits', language: 'cpp17', code: 'int main(){}',
      submitMethod: 'local', inputFilename: null, outputFilename: null,
    })
    expect(() => parseContractBody(SubmissionContracts.create, {
      problemId: '1041', oj: 'carits', language: 'cpp17', code: '   ',
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, SubmissionContracts.create, { submissionId: 42, replayed: true })
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: { submissionId: 42, replayed: true },
    })
  })

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

  it('guards blog drafts, publishing and series through shared contracts', () => {
    const draft = parseContractBody(BlogManagementContracts.updateDraft, {
      expectedRevision: 2, title: '训练复盘', summary: null, contentMarkdown: '正文',
      references: [], classification: { seriesId: null, tagIds: [], authorTags: [] },
    })
    expect(draft.expectedRevision).toBe(2)
    expect(() => parseContractBody(BlogManagementContracts.publish, {
      expectedDraftRevision: 0, visibility: 'PUBLIC',
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, BlogManagementContracts.versions, [{
      id: 'version-1', version: 1, title: '训练复盘', summary: null, contentHash: 'hash',
      sourceVersionId: null, status: 'CURRENT', visibility: 'PUBLIC',
      classification: { series: null, tags: [] }, publishedAt: new Date('2026-09-16T00:00:00Z'),
    }])
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ publishedAt: '2026-09-16T00:00:00.000Z' })],
    }))
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
      userId: 'user-1', username: 'teacher1', accountRole: 'user',
      organizationId: 'organization-1', organizationRole: 'teacher', workspaceMode: 'work',
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ accountRole: 'user', organizationRole: 'teacher', organizationId: 'organization-1' }),
    }))

    const avatarResponse = responseStub()
    sendContractData(avatarResponse.response, AuthContracts.uploadAvatar, {
      avatar: '/api/files/avatar-1/public', fileId: 'avatar-1', internalPath: '/private/path',
    })
    expect(avatarResponse.json).toHaveBeenCalledWith({
      success: true,
      data: { avatar: '/api/files/avatar-1/public', fileId: 'avatar-1' },
    })
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

  it('guards global user administration and browser telemetry', () => {
    expect(parseContractQuery(IdentityContracts.managedUsers, { page: '1', pageSize: '20', status: 'active', keyword: ' alice ' }))
      .toEqual({ page: 1, pageSize: 20, status: 'active', keyword: 'alice' })
    expect(() => parseContractBody(IdentityContracts.createPlatformAdmin, { username: 'admin2', password: '123', name: '管理员' }))
      .toThrowError(ApiContractError)
    expect(parseContractBody(IdentityContracts.updateManagedUserStatus, { status: 'disabled' }))
      .toEqual({ status: 'disabled', reason: '' })
    expect(parseContractBody(TelemetryContracts.clientError, { type: 'error', message: 'render failed', route: '/personal' }))
      .toEqual({ type: 'error', message: 'render failed', route: '/personal' })
    expect(() => parseContractBody(TelemetryContracts.clientError, { type: 'error', message: 'x', token: 'secret' }))
      .toThrowError(ApiContractError)
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

  it('guards platform AI adjustments and serializes BigInt-backed ledger values', () => {
    expect(parseContractBody(AiGovernanceContracts.adjustTokenPool, {
      amount: '5000', reason: ' 补充平台测试额度 ', idempotencyKey: 'admin:test:12345678',
    })).toEqual({ amount: 5000, reason: '补充平台测试额度', idempotencyKey: 'admin:test:12345678' })
    expect(() => parseContractBody(AiGovernanceContracts.adjustTokenPool, {
      amount: 0, reason: '无效调整', idempotencyKey: 'admin:test:invalid',
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, AiGovernanceContracts.adjustTokenPool, {
      id: 'ledger-1', type: 'adjust', amount: 5000n,
      availableAfter: 9000n, reservedAfter: 100n, consumedAfter: 200n,
      reason: '补充平台测试额度', createdAt: new Date('2026-09-16T00:00:00Z'),
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amount: '5000', availableAfter: '9000', createdAt: '2026-09-16T00:00:00.000Z',
      }),
    }))
  })

  it('guards contribution decisions and serializes immutable reward evidence', () => {
    expect(parseContractBody(ContributionContracts.reject, {
      reason: '该紧急晋升缺少可复现的正式采用证据。',
    })).toEqual({ reason: '该紧急晋升缺少可复现的正式采用证据。' })
    expect(() => parseContractBody(ContributionContracts.revoke, { reason: '太短' }))
      .toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, ContributionContracts.audit, {
      items: [{
        id: 'contribution-1', type: 'candidate_promoted', sourceType: 'candidate', sourceId: 'candidate-1',
        score: 100, status: 'accepted', createdAt: new Date('2026-09-15T00:00:00Z'),
        evidence: { problemId: 'problem-1', candidateId: 'candidate-1', promotedRevisionId: 'revision-2' },
        Actor: { username: 'contributor' },
        RewardDelivery: { status: 'posted', userCarits: '20' },
      }],
      page: 1, pageSize: 20, total: 1, totalPages: 1, pending: 0,
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: [expect.objectContaining({
          createdAt: '2026-09-15T00:00:00.000Z',
          evidence: expect.objectContaining({ promotedRevisionId: 'revision-2' }),
        })],
      }),
    }))
  })

  it('guards OJ platform binding secrets and normalizes verified dates', () => {
    expect(parseContractBody(PlatformBindingContracts.bind, {
      extra: { JSESSIONID: 'session-cookie' },
    })).toEqual({ extra: { JSESSIONID: 'session-cookie' } })
    expect(() => parseContractBody(PlatformBindingContracts.bind, {
      extra: { JSESSIONID: { nested: 'not-supported' } },
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, PlatformBindingContracts.list, [{
      id: 'binding-1', platform: 'codeforces', platformUsername: 'tourist',
      bindingStatus: 'bound', statusMessage: null,
      verifiedAt: new Date('2026-09-15T00:00:00Z'),
    }])
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ verifiedAt: '2026-09-15T00:00:00.000Z' })],
    }))
  })

  it('normalizes all leaderboard filters and preserves ranking metadata', () => {
    expect(parseContractQuery(RankingContracts.organization, {
      page: '2', pageSize: '100', q: ' student ', grade: '初二', includeGraduated: '1', ignored: 'value',
    })).toEqual({ page: 2, pageSize: 100, q: 'student', grade: '初二', includeGraduated: '1' })
    expect(() => parseContractQuery(RankingContracts.organization, { includeGraduated: 'yes' }))
      .toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, RatingLeaderboardContracts.global, {
      items: [{ id: 'user-1', userId: 'user-1', username: 'alice', avatar: null, rating: 1600, rank: 4 }],
      page: 1, pageSize: 20, total: 1, totalPages: 1, track: 'OI', scope: 'GLOBAL', organizationId: null,
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ items: [expect.objectContaining({ rank: 4 })], track: 'OI' }),
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
        kind: 'TRAINING',
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
      participants: [],
      groups: [],
      stages: [],
      stageGroups: [],
      issues: [],
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        statusRevision: 2,
        session: expect.objectContaining({ scheduledStartAt: '2026-09-15T00:00:00.000Z' }),
      }),
    }))

    expect(parseContractBody(TrainingContracts.createTemplate, { name: '分层课堂', scope: 'organization' })).toEqual({ name: '分层课堂', scope: 'organization' })
    expect(() => parseContractBody(TrainingContracts.createTemplate, { name: '', scope: 'organization' })).toThrowError(ApiContractError)
    sendContractData(response, TrainingContracts.listTemplates, [{
      key: 'database:template-1', name: '分层课堂', sessionType: 'GENERAL', description: '', source: 'organization',
      stages: [{ name: '分层', description: '', kind: 'TRAINING', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' }],
    }])
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
      problemId: '1041',
      title: '整数求和',
      platform: 'carits',
      description: '求和',
      statementType: 'markdown',
      statementPdfUrl: null,
      difficulty: null,
      timeLimit: 1000,
      memoryLimit: 256,
      visibility: 'public',
      status: 'draft',
      libraryScope: 'platform',
      ownerId: 'teacher-1',
      ownerType: 'user',
      ownerName: 'teacher',
      allowedLanguages: null,
      ojBindings: null,
      createdAt: new Date('2026-09-16T00:00:00Z'),
      statements: [],
      solutions: [],
      permissions: {
        canEdit: true, canPublish: true, canArchive: true,
        canCopyToSchool: false, canSubmit: false, canView: true,
      },
      hack: { enabled: false, acceptedCount: 0, canHack: false, mode: 'acm' },
      legacyIoSuggestion: null,
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ ownerName: 'teacher' }),
    }))

    expect(parseContractQuery(ProblemContracts.listSubmissions, {
      page: '2', pageSize: '50',
    })).toEqual({ page: 2, pageSize: 50 })
    const submissions = responseStub()
    sendContractData(submissions.response, ProblemContracts.listSubmissions, {
      submissions: [{
        id: 42, username: 'student', result: 'wrong_answer', timeUsed: 12,
        memoryUsed: 1024, codeLength: 80, language: 'cpp17',
        submittedAt: new Date('2026-09-16T01:00:00Z'),
      }],
      page: 1, pageSize: 20, total: 1, totalPages: 1,
    })
    expect(submissions.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        submissions: [expect.objectContaining({ submittedAt: '2026-09-16T01:00:00.000Z' })],
      }),
    }))

    expect(parseContractBody(ProblemContracts.translateStatement, {
      targetLang: 'en', statementId: 'statement-1',
    })).toEqual({ targetLang: 'en', statementId: 'statement-1' })
    expect(() => parseContractBody(ProblemContracts.translateStatement, {
      targetLang: 'fr',
    })).toThrowError(ApiContractError)
    const aiUsage = responseStub()
    sendContractData(aiUsage.response, ProblemContracts.getAiUsage, {
      isAdmin: false,
      translations: { zh: true, en: false },
      formattedStatementIds: [],
      markdownStatements: [{
        id: 'statement-1', language: 'zh',
        createdAt: new Date('2026-09-16T00:00:00Z'), maxReservedTokens: 12000,
      }],
    })
    expect(aiUsage.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ translations: { zh: true, en: false } }),
    }))

    expect(parseContractBody(ProblemContracts.saveMyContent, {
      title: '我的题解', language: 'zh', content: '# 思路',
    })).toEqual({ title: '我的题解', language: 'zh', content: '# 思路' })
    expect(() => parseContractBody(ProblemContracts.saveMyContent, {
      title: '空内容', language: 'zh', content: '',
    })).toThrowError(ApiContractError)

    const personalContent = responseStub()
    sendContractData(personalContent.response, ProblemContracts.getMyContent, {
      contents: [{
        id: 'content-1', kind: 'solution', title: null, format: 'markdown',
        language: 'zh', content: '# 思路', fileUrl: null, revision: 2,
        updatedAt: new Date('2026-09-20T01:02:03Z'), shareKeys: ['platform'],
        fileId: 'must-not-leak',
      }],
      shareTargets: [{ key: 'school-1', label: '学校一' }],
    })
    expect(personalContent.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contents: [expect.objectContaining({
          updatedAt: '2026-09-20T01:02:03.000Z',
        })],
      }),
    }))
    expect(personalContent.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contents: [expect.not.objectContaining({ fileId: expect.anything() })],
      }),
    }))
  })

  it('guards statement-version requests and strips storage internals', () => {
    expect(parseContractQuery(ProblemContracts.listStatementVersions, {
      page: '2', pageSize: '50', ignored: 'drop-me',
    })).toEqual({ page: 2, pageSize: 50 })
    expect(parseContractBody(ProblemContracts.createStatementVersion, {
      name: '自定义题面', language: 'zh', visibility: 'private',
      format: 'markdown', source: { type: 'blank' },
    })).toEqual({
      name: '自定义题面', language: 'zh', visibility: 'private',
      format: 'markdown', source: { type: 'blank' },
    })
    expect(() => parseContractBody(ProblemContracts.createStatementVersion, {
      name: '复制官方题面', visibility: 'private',
      source: { type: 'canonical' },
    })).toThrowError(ApiContractError)
    expect(() => parseContractBody(ProblemContracts.updateStatementVersionContent, {
      content: '   ',
    })).toThrowError(ApiContractError)
    expect(() => parseContractBody(ProblemContracts.updateStatementVersionMetadata, {}))
      .toThrowError(ApiContractError)

    const statementVersions = responseStub()
    sendContractData(statementVersions.response, ProblemContracts.listStatementVersions, {
      official: [{
        id: 'official-1', key: 'canonical:official-1', name: '官方中文',
        title: '整数求和', language: 'zh', format: 'markdown', visibility: 'public',
        content: '# 题面', fileUrl: null, authorUsername: 'System', isOfficial: true,
      }],
      mine: [{
        id: 'version-1', name: '课堂版', title: '整数求和', language: 'zh',
        format: 'markdown', visibility: 'private', content: '# 课堂题面',
        fileUrl: null, authorUsername: 'teacher1', isMine: true,
        createdAt: new Date('2026-09-20T01:02:03Z'),
        updatedAt: new Date('2026-09-20T02:03:04Z'),
        fileId: 'must-not-leak',
      }],
      public: [],
      publicPagination: { page: 1, pageSize: 10, total: 0 },
    })
    expect(statementVersions.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mine: [expect.objectContaining({
          createdAt: '2026-09-20T01:02:03.000Z',
          updatedAt: '2026-09-20T02:03:04.000Z',
        })],
      }),
    }))
    expect(statementVersions.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mine: [expect.not.objectContaining({ fileId: expect.anything() })],
      }),
    }))
  })

  it('guards problem-list CRUD and problem-note payloads', () => {
    expect(parseContractQuery(ProblemListContracts.list, {
      tab: 'mine', page: '2', pageSize: '20', keyword: '基础', ignored: 'drop-me',
    })).toEqual({ tab: 'mine', page: 2, pageSize: 20, keyword: '基础' })
    expect(() => parseContractBody(ProblemListContracts.create, { title: '   ' }))
      .toThrowError(ApiContractError)
    expect(parseContractBody(ProblemContracts.saveNote, { content: '# 思路' }))
      .toEqual({ content: '# 思路' })

    const listResponse = responseStub()
    sendContractData(listResponse.response, ProblemListContracts.list, {
      lists: [{
        id: 'list-1', title: '基础题单', description: null, ownerId: 'user-1',
        createdAt: new Date('2026-09-18T00:00:00Z'), updatedAt: new Date('2026-09-18T01:00:00Z'),
        _count: { Entries: 3 }, _permission: 'admin', organizationId: 'must-not-leak',
      }],
      page: 1, pageSize: 20, total: 1, totalPages: 1,
    })
    expect(listResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lists: [expect.not.objectContaining({ organizationId: expect.anything() })],
      }),
    }))

    const noteResponse = responseStub()
    sendContractData(noteResponse.response, ProblemContracts.getNote, {
      content: '# 思路', updatedAt: new Date('2026-09-18T02:00:00Z'), ownerId: 'must-not-leak',
    })
    expect(noteResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ ownerId: expect.anything() }),
    }))
  })

  it('guards problem quality commands and dashboard projection', () => {
    expect(parseContractBody(ProblemQualityContracts.requestEvaluation, { revisionId: 'revision-1' }))
      .toEqual({ revisionId: 'revision-1' })
    expect(() => parseContractBody(ProblemQualityContracts.submitExpert, {
      algorithmicValueScore: 21, editorialScore: 5, originalityScore: 5, comment: 'a'.repeat(30),
    })).toThrowError(ApiContractError)
    expect(() => parseContractBody(ProblemQualityContracts.createSolutionProfile, {
      key: 'quadratic', name: '暴力', expectedClass: 'wrong', expectedScoreMin: 0, expectedScoreMax: 30,
      expectedSubtaskScores: [], submissionId: 0,
    })).toThrowError(ApiContractError)

    const dashboard = responseStub()
    sendContractData(dashboard.response, ProblemQualityContracts.dashboard, {
      permissions: { canManage: true, canExpertReview: false }, latestTestSetRevisionId: null,
      testSetQuality: null, problemQuality: null, jobs: [], qualityHistory: [], solutionProfiles: [],
      internalCorpusIdentity: 'must-not-leak',
    })
    expect(dashboard.json).toHaveBeenCalledWith({
      success: true,
      data: {
        permissions: { canManage: true, canExpertReview: false }, latestTestSetRevisionId: null,
        testSetQuality: null, problemQuality: null, jobs: [], qualityHistory: [], solutionProfiles: [],
      },
    })

    const profile = responseStub()
    sendContractData(profile.response, ProblemQualityContracts.createSolutionProfile, {
      id: 'profile-1', key: 'quadratic', name: '暴力', expectedClass: 'wrong', expectedComplexity: null,
      expectedScoreMin: 0, expectedScoreMax: 30, expectedSubtaskScores: [], submissionId: 42,
      revision: 1, status: 'active', observed: null, definitionHash: 'must-not-leak',
    })
    expect(profile.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ definitionHash: expect.anything() }),
    }))
  })

  it('guards platform problem management and OJ fetcher payloads', () => {
    expect(parseContractQuery(OjFetcherContracts.listJobs, {
      page: '2', pageSize: '20', platform: 'luogu', status: 'pending', ignored: 'value',
    })).toEqual({ page: 2, pageSize: 20, platform: 'luogu', status: 'pending' })
    expect(() => parseContractQuery(OjFetcherContracts.listJobs, { status: 'unknown' }))
      .toThrowError(ApiContractError)
    expect(parseContractBody(OjFetcherContracts.createBatch, {
      platform: 'luogu', problemIds: ['P1000', 'P1001'],
    })).toEqual({ platform: 'luogu', problemIds: ['P1000', 'P1001'] })
    expect(parseContractBody(OjFetcherContracts.downloadAttachment, {
      problemId: 'problem-1', url: 'https://www.luogu.com.cn/fe/api/problem/downloadAttachment/x', filename: 'data.zip',
    })).toEqual({ problemId: 'problem-1', url: 'https://www.luogu.com.cn/fe/api/problem/downloadAttachment/x', filename: 'data.zip' })
    expect(() => parseContractBody(OjFetcherContracts.downloadAttachment, {
      problemId: 'problem-1', url: 'not-a-url', filename: 'data.zip',
    })).toThrowError(ApiContractError)
    expect(parseContractBody(ProblemContracts.saveHackConfig, {
      enabled: false, standardSource: '', validatorSource: '', classifierSource: '', expectedRevision: 0,
    })).toEqual({ enabled: false, standardSource: '', validatorSource: '', classifierSource: '', expectedRevision: 0 })
    expect(() => parseContractBody(ProblemContracts.saveHackConfig, {
      enabled: false, standardSource: '', validatorSource: '', classifierSource: '', expectedRevision: -1,
    })).toThrowError(ApiContractError)
    expect(parseContractBody(ProblemContracts.deleteChecker, {})).toEqual({})
    expect(parseContractBody(ProblemContracts.deleteTestdata, {})).toEqual({})

    const jobResponse = responseStub()
    sendContractData(jobResponse.response, OjFetcherContracts.listJobs, {
      data: [{
        id: 'job-1', platform: 'luogu', problemId: 'P1000', status: 'pending', message: null,
        hasAttachment: false, attachmentStatus: null, createdProblemId: null,
        createdAt: new Date('2026-09-16T00:00:00Z'),
      }],
      page: 1, pageSize: 20, total: 1, totalPages: 1,
    })
    expect(jobResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        data: [expect.objectContaining({ createdAt: '2026-09-16T00:00:00.000Z' })],
      }),
    }))

    const problemResponse = responseStub()
    sendContractData(problemResponse.response, ProblemContracts.listAdmin, {
      data: [{
        id: 'problem-1', problemId: '1041', platform: 'carits', title: '整数求和',
        difficulty: null, status: 'published', ojBindings: null, ownerName: 'teacher1',
        createdAt: new Date('2026-09-16T00:00:00Z'),
      }],
      page: 1, pageSize: 10, total: 1, totalPages: 1,
    })
    expect(problemResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ data: [expect.objectContaining({ problemId: '1041' })] }),
    }))

    const fetched = responseStub()
    sendContractData(fetched.response, OjFetcherContracts.fetchProblem, {
      title: 'A+B Problem', description: '计算两个整数之和。', timeLimit: 1000, memoryLimit: 128,
      source: { platform: 'luogu', problemId: 'P1001', url: 'https://www.luogu.com.cn/problem/P1001' },
      attachments: [{ filename: 'data.zip', downloadLink: 'https://www.luogu.com.cn/file/data.zip' }],
    })
    expect(fetched.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: 'A+B Problem' }),
    }))

    const downloaded = responseStub()
    sendContractData(downloaded.response, OjFetcherContracts.downloadAttachment, {
      id: 'file-1', fileName: 'data.zip', fileSize: 1024, fileUrl: '/api/files/file-1/download',
      storageInternalPath: 'must-not-leak',
    })
    expect(downloaded.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ storageInternalPath: expect.anything() }),
    }))

    const attachments = responseStub()
    sendContractData(attachments.response, ProblemContracts.listAttachments, [{
      id: 'attachment-1', problemId: 'problem-1', fileName: 'data.zip', fileSize: 1024,
      fileUrl: '/api/files/file-1/download', description: null, uploadedAt: new Date('2026-09-17T00:00:00Z'),
      storageInternalPath: 'must-not-leak',
    }])
    expect(attachments.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.not.objectContaining({ storageInternalPath: expect.anything() })],
    }))

    const hackConfig = responseStub()
    sendContractData(hackConfig.response, ProblemContracts.getHackConfig, {
      enabled: false, mode: 'oi', standardSource: '', standardLanguage: 'cpp17',
      validatorSource: '', validatorLanguage: 'cpp17', classifierSource: '', classifierLanguage: 'cpp17',
      revision: 0, updatedBy: 'must-not-leak',
    })
    expect(hackConfig.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ updatedBy: expect.anything() }),
    }))

    const deletion = responseStub()
    sendContractData(deletion.response, ProblemContracts.deleteTestdata, {})
    expect(deletion.json).toHaveBeenCalledWith({ success: true, data: {} })
  })

  it('guards OJ account secrets, configuration and operation results', () => {
    expect(parseContractBody(OjAccountContracts.create, {
      platform: 'hdu', username: 'submit-bot', loginMethod: 'cookie', cookie: 'session=value',
    })).toEqual({ platform: 'hdu', username: 'submit-bot', loginMethod: 'cookie', cookie: 'session=value' })
    expect(() => parseContractBody(OjAccountContracts.update, { priority: 'high' }))
      .toThrowError(ApiContractError)

    const accountResponse = responseStub()
    sendContractData(accountResponse.response, OjAccountContracts.list, [{
      id: 'oj-account-1', platform: 'hdu', username: 'submit-bot', loginMethod: 'cookie',
      status: 'active', lastLoginAt: null, lastErrorMessage: null, hasPassword: false,
      hasCookie: true, createdAt: new Date('2026-09-16T00:00:00Z'),
      enabled: true, priority: 1, maxConsecutiveFailures: 3, freezeDurationMinutes: 30,
      submitMaxRetries: 1, retryIntervalSeconds: 10, loginFailureCooldownMinutes: 15,
      cookieValidMinutes: 3600, reverifyIntervalMinutes: 30, renewLoginThresholdMinutes: 10,
      minSubmitIntervalSeconds: 30, minRequestIntervalSeconds: 3,
      maxConcurrentSubmissions: 1, maxConcurrentRequests: 2, firstPollDelaySeconds: 5,
      pollIntervalSeconds: 5, maxWaitDurationMinutes: 10, rateLimitThreshold: 2,
      banSuspicionCooldownHours: 6, autoVerifyIntervalMinutes: 1440,
      password: 'must-not-leak', cookie: 'must-not-leak',
    }])
    expect(accountResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        createdAt: '2026-09-16T00:00:00.000Z', hasCookie: true,
      })],
    }))
    expect(accountResponse.json.mock.calls[0][0].data[0]).not.toHaveProperty('password')
    expect(accountResponse.json.mock.calls[0][0].data[0]).not.toHaveProperty('cookie')

    const loginResponse = responseStub()
    sendContractData(loginResponse.response, OjAccountContracts.login, {
      success: false, status: 'error', message: '登录失败',
    })
    expect(loginResponse.json).toHaveBeenCalledWith({
      success: true,
      data: { success: false, status: 'error', message: '登录失败' },
    })
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


  it('guards judge program drafts and verification jobs through shared contracts', () => {
    const body = parseContractBody(ProblemContracts.saveJudgeProgramDraft, {
      kind: 'validator',
      name: '严格校验器',
      language: 'cpp17',
      protocol: 'oj.validator/v1',
      source: 'int main() { return 0; }',
      fixtures: [{ name: '合法输入', stdin: '1\\n', expectedExitCode: 0 }],
    })
    expect(body.kind).toBe('validator')
    expect(() => parseContractBody(ProblemContracts.createJudgeProgram, {
      kind: 'standard', language: 'cpp17', protocol: 'oj.standard/v1', source: '',
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, ProblemContracts.getJudgeProgramVerification, [{
      id: 'job-1', problemId: 'problem-1', programId: 'program-1', versionId: 'version-1',
      fixtureSetId: 'fixtures-1', mode: 'compile', status: 'completed', judgeId: null,
      fencingToken: null, leaseExpiresAt: null, attemptCount: 1, report: { warnings: [] },
      errorCode: null, errorMessage: null, createdBy: 'user-1', startedAt: new Date('2026-09-16T00:00:00Z'),
      finishedAt: new Date('2026-09-16T00:00:01Z'), createdAt: new Date('2026-09-16T00:00:00Z'),
      updatedAt: new Date('2026-09-16T00:00:01Z'),
    }])
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ startedAt: '2026-09-16T00:00:00.000Z' })],
    }))
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

    expect(parseContractQuery(OrganizationContracts.managedJoinApplications, { page: '1', pageSize: '50' }))
      .toEqual({ page: 1, pageSize: 50 })
    expect(() => parseContractBody(OrganizationContracts.createManagedInvitation, {
      username: '', memberRole: 'teacher', relationType: 'employee', message: '',
    })).toThrowError(ApiContractError)
    expect(parseContractBody(OrganizationContracts.updateJoinPolicy, { joinPolicy: 'approval' }))
      .toEqual({ joinPolicy: 'approval' })
    expect(parseContractBody(OrganizationContracts.updateCampus, {
      name: '第一中学', educationSystem: '6-3-3', educationSystemDetail: { primaryYears: 6, middleYears: 3, highYears: 3 },
    })).toEqual({
      name: '第一中学', educationSystem: '6-3-3', educationSystemDetail: { primaryYears: 6, middleYears: 3, highYears: 3 },
    })
    expect(() => parseContractBody(OrganizationContracts.updateCampus, {
      name: '', educationSystem: 'invalid',
    })).toThrowError(ApiContractError)
    expect(parseContractBody(OrganizationContracts.updateCampusAnnouncement, { announcement: '校园公告' }))
      .toEqual({ announcement: '校园公告' })
    expect(parseContractBody(OrganizationContracts.createTeacher, {
      username: 'teacher2', password: 'secure-password', name: '教师乙', email: 'teacher2@example.com',
    })).toEqual({ username: 'teacher2', password: 'secure-password', name: '教师乙', email: 'teacher2@example.com' })
    expect(() => parseContractBody(OrganizationContracts.createTeacher, {
      username: 'teacher2', password: '123', name: '教师乙',
    })).toThrowError(ApiContractError)
    expect(parseContractBody(OrganizationContracts.updateTeacherStatus, { status: 'disabled' }))
      .toEqual({ status: 'disabled' })
    expect(parseContractBody(OrganizationContracts.transferPrincipal, { newPrincipalMembershipId: 'membership-2' }))
      .toEqual({ newPrincipalMembershipId: 'membership-2' })
    expect(parseContractBody(OrganizationContracts.createStudent, {
      username: 'student2', password: 'secure-password', name: '学生乙', enrollmentYear: 2026,
    })).toEqual({ username: 'student2', password: 'secure-password', name: '学生乙', enrollmentYear: 2026 })
    expect(() => parseContractBody(OrganizationContracts.createStudent, {
      username: 'student2', password: '123', name: '学生乙',
    })).toThrowError(ApiContractError)
    expect(parseContractBody(OrganizationContracts.updateStudentStatus, { status: 'active' }))
      .toEqual({ status: 'active' })

    expect(parseContractQuery(OrganizationContracts.platformSchools, {
      page: '2', pageSize: '50', directoryStatus: 'legacy', q: ' School 1 ',
    })).toEqual({ page: 2, pageSize: 50, directoryStatus: 'legacy', q: 'School 1' })
    expect(() => parseContractQuery(OrganizationContracts.platformSchools, {
      directoryStatus: 'deleted',
    })).toThrowError(ApiContractError)
    expect(parseContractBody(OrganizationContracts.updatePlatformSchoolDirectoryStatus, {
      status: 'hidden', reason: '仅供平台内部教学使用', expectedUpdatedAt: '2026-09-15T00:00:00.000Z',
    })).toEqual({ status: 'hidden', reason: '仅供平台内部教学使用', expectedUpdatedAt: '2026-09-15T00:00:00.000Z' })
    expect(() => parseContractBody(OrganizationContracts.createPlatformSchool, {
      name: '第一中学', username: 'principal1', password: '', teacherName: '负责人',
    })).toThrowError(ApiContractError)

    const platformSchool = responseStub()
    sendContractData(platformSchool.response, OrganizationContracts.platformSchool, {
      id: 'organization-1', schoolId: 'school-1', organizationId: 'organization-1', name: '第一中学',
      shortName: null, region: '湖南省/长沙市', schoolType: '高中', schoolNature: '公办', educationSystem: '6-3-3',
      contactPerson: null, contactPhone: null, contactEmail: null, status: 'active', directoryStatus: 'verified',
      updatedAt: new Date('2026-09-15T00:00:00Z'), createdAt: new Date('2026-09-14T00:00:00Z'),
      principal: null, _count: { students: 0 }, internalDatabaseField: 'removed',
    })
    expect(platformSchool.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: 'organization-1', updatedAt: '2026-09-15T00:00:00.000Z' }),
    }))

    const campus = responseStub()
    sendContractData(campus.response, OrganizationContracts.campusSummary, {
      id: 'school-1', name: '第一中学', shortName: null, description: null, announcement: '校园公告', region: null,
      schoolType: null, schoolNature: null, educationSystem: null, educationSystemDetail: null,
      contactPerson: null, contactPhone: null, contactEmail: null, contactMasked: false,
      status: 'active', joinPolicy: 'invite_only', principal: { name: '负责人', title: null },
      internalDatabaseField: 'removed',
    })
    expect(campus.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: 'school-1', announcement: '校园公告' }),
    }))

    const managed = responseStub()
    sendContractData(managed.response, OrganizationContracts.managedJoinApplications, {
      items: [{
        id: 'application-1', realName: '学生甲', requestedRole: 'student', requestedRelationType: 'enrolled',
        status: 'pending', createdAt: new Date('2026-09-15T00:00:00Z'), User: { username: 'student1' },
        internalDatabaseField: 'removed',
      }],
      total: 1, pending: 1, page: 1, pageSize: 50,
    })
    expect(managed.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: [expect.objectContaining({ createdAt: '2026-09-15T00:00:00.000Z' })],
      }),
    }))

    const managedUser = responseStub()
    sendContractData(managedUser.response, IdentityContracts.managedUser, {
      id: 'user-1', username: 'teacher1', name: '教师甲', accountRole: 'user', status: 'active',
      createdAt: new Date('2026-09-15T00:00:00Z'), passwordHash: 'must-not-leak', sessionVersion: 7,
    })
    expect(managedUser.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ passwordHash: expect.anything(), sessionVersion: expect.anything() }),
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
  it('guards Candidate contribution and Generator protocol inputs', () => {
    expect(parseContractBody(ProblemContracts.contributeCandidateData, {
      name: ' 边界数据 ', inputData: '1\n', contributionOrganizationId: 'organization-1',
    })).toEqual({
      name: '边界数据', inputData: '1\n', contributionOrganizationId: 'organization-1',
    })
    expect(parseContractBody(ProblemContracts.contributeCandidateGenerator, {
      language: 'python3', source: 'print(1)',
      manifest: {
        apiVersion: 'oj.generator/v1', protocol: 'oj.generator/v1',
        language: 'python3', entry: 'main.py', parameterSchema: {},
        profiles: [{ id: 'default', label: '默认', params: {} }],
      },
    }).manifest.entry).toBe('main.py')
    expect(() => parseContractBody(ProblemContracts.contributeCandidateGenerator, {
      language: 'ruby3', source: 'puts 1',
      manifest: {
        apiVersion: 'oj.generator/v1', protocol: 'oj.generator/v1',
        language: 'ruby3', entry: 'main.rb', parameterSchema: {},
        profiles: [{ id: 'default', params: {} }],
      },
    })).toThrowError(ApiContractError)
  })

  it('guards contribution readiness and Hack attempt wire data', () => {
    const readiness = responseStub()
    sendContractData(readiness.response, ProblemContracts.getContributionReadiness, {
      canContribute: true, canHack: true, canManage: false, mode: 'oi',
      standard: { status: 'active', versionId: 'std-v1' },
      validator: { status: 'active', source: 'dsl', versionId: 'validator-v1' },
      classifier: { status: 'active', versionId: 'classifier-v1', requiredForHack: true, requiredForPromotion: true },
      wrongCorpus: { status: 'ready', mode: 'open' },
      blockers: [], warnings: [],
    })
    expect(readiness.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ canContribute: true, validator: expect.objectContaining({ source: 'dsl' }) }),
    }))

    expect(parseContractBody(ProblemContracts.createHackAttempt, {
      inputMode: 'data', inputData: '1\n', hackSource: 'int main(){}', hackLanguage: 'cpp17',
      inputFilename: null, outputFilename: null, contributionOrganizationId: null,
    }).inputMode).toBe('data')
    expect(() => parseContractBody(ProblemContracts.createHackAttempt, {
      inputMode: 'generator', hackSource: 'int main(){}', hackLanguage: 'cpp17',
    })).toThrowError(ApiContractError)

    const list = responseStub()
    sendContractData(list.response, ProblemContracts.listHackAttempts, {
      attempts: [{
        id: 'hack-1', problemId: 'problem-1', userId: 'user-1',
        contributionOrganizationId: null, contributionOrganizationName: null,
        status: 'accepted', inputMode: 'data', hackLanguage: 'cpp17',
        affectedSubtaskIds: [1], createdAt: new Date('2026-09-16T00:00:00Z'),
        updatedAt: new Date('2026-09-16T00:01:00Z'),
      }],
      total: 1, page: 1, pageSize: 50, acceptedCount: 1, canManage: false,
    })
    expect(list.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        attempts: [expect.objectContaining({ createdAt: '2026-09-16T00:00:00.000Z' })],
      }),
    }))
  })


  it('guards solution editorial drafts, corrections and review responses', () => {
    const draft = parseContractBody(SolutionReviewContracts.createContribution, {
      type: 'COMMUNITY_EDITORIAL',
      title: '动态规划题解',
      contentMarkdown: '# 思路',
      sourceType: 'ORIGINAL',
      licenseAccepted: true,
    })
    expect(draft.type).toBe('COMMUNITY_EDITORIAL')
    expect(() => parseContractBody(SolutionReviewContracts.createContribution, {
      type: 'COMMUNITY_EDITORIAL',
      title: '缺少授权声明',
      contentMarkdown: '# 思路',
      sourceType: 'ORIGINAL',
    })).toThrowError(ApiContractError)

    const correction = parseContractBody(SolutionReviewContracts.createCorrection, {
      title: '纠错说明',
      contentMarkdown: '修正复杂度分析。',
      sourceType: 'ORIGINAL',
      licenseAccepted: true,
    })
    expect(correction).not.toHaveProperty('type')
    expect(() => parseContractBody(SolutionReviewContracts.createCorrection, {
      type: 'COMMUNITY_EDITORIAL',
      licenseAccepted: true,
    })).toThrowError(ApiContractError)

    const { response, json } = responseStub()
    sendContractData(response, SolutionReviewContracts.recordReview, {
      id: 'review-1',
      reviewType: 'CONTENT',
      decision: 'APPROVE',
      comment: '已核验',
      createdAt: new Date('2026-09-26T00:00:00Z'),
    })
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ createdAt: '2026-09-26T00:00:00.000Z' }),
    }))
  })

})
