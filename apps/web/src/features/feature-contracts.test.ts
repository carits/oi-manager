import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AssignmentProgressDataSchema,
  AuthContracts,
  BlogDiscoveryDetailSchema,
  ChatContracts,
  ChatMessagePageSchema,
  MyOrganizationsSchema,
  NotificationContracts,
  NotificationPageSchema,
  OrganizationContracts,
  OrganizationDirectoryPageSchema,
  ContestRatingDataSchema,
  ProblemJudgeModeTransitionInputSchema,
  ProblemJudgeSettingsSchema,
  ProblemEditorMutationSchema,
  ProblemTestdataSchema,
  ProblemTestGraphSaveInputSchema,
  ProblemTestGraphWorkspaceSchema,
  JudgeProgramCatalogSchema,
  JudgeProgramTemplateSchema,
  SimilarityComparisonSchema,
  TrainingDesignSchema,
  TrainingStructureInputSchema,
  WorkspaceContracts,
  WorkspaceListSchema,
  CurrentAccountSchema,
  IdentityContracts,
} from '@oi-manager/contracts'

describe('feature slice contracts', () => {
  it('accepts explicit empty assignment progress and rejects malformed pagination', () => {
    expect(AssignmentProgressDataSchema.safeParse({
      recipients: [],
      problems: [],
      pagination: { page: 1, pageSize: 40, total: 0, totalPages: 0 },
    }).success).toBe(true)
    expect(AssignmentProgressDataSchema.safeParse({
      recipients: [],
      problems: [],
      pagination: { page: 0, pageSize: 40, total: 0, totalPages: 0 },
    }).success).toBe(false)
  })

  it('shares account authentication contracts and rejects malformed identities', () => {
    expect(CurrentAccountSchema.safeParse({
      userId: 'user-1', username: 'teacher1', accountRole: 'user', role: 'teacher',
      organizationRole: 'teacher', organizationId: 'organization-1', schoolId: 'school-1',
    }).success).toBe(true)
    expect(CurrentAccountSchema.safeParse({
      userId: 'user-1', username: 'teacher1', accountRole: 'teacher', role: 'teacher',
    }).success).toBe(false)
    expect(AuthContracts.updateProfile.body.safeParse({ email: 'teacher@example.com' }).success).toBe(true)
  })

  it('shares the public profile query and response contract', () => {
    expect(IdentityContracts.publicProfile.query.safeParse({ userType: 'teacher' }).success).toBe(true)
    expect(IdentityContracts.publicProfile.query.safeParse({ userType: 'principal' }).success).toBe(false)
    expect(IdentityContracts.publicProfile.data.safeParse({
      id: 'user-1', username: 'teacher1', avatar: null, bio: '简介', userType: 'teacher',
      school: { id: 'organization-1', name: '测试学校' },
    }).success).toBe(true)
  })

  it('accepts the assignment matrix projection returned by the application service', () => {
    expect(AssignmentProgressDataSchema.safeParse({
      problems: [{
        id: 'assignment-problem-1',
        orderIndex: 0,
        category: 'REQUIRED',
        maxScore: 100,
        targetScore: 100,
        weight: 100,
        completionPolicy: 'MANUAL',
        problem: { id: 'problem-1', platform: 'carits', problemId: '1041', title: '整数求和' },
      }],
      recipients: [{
        id: 'recipient-1',
        user: { id: 'user-1', username: 'student' },
        score: 0,
        rawScore: 0,
        adjustment: 0,
        completedProblems: 0,
        lateProblems: 0,
        correctionProblems: 0,
        progress: [],
        cells: [{
          id: null,
          assignmentProblemId: 'assignment-problem-1',
          learningStatus: 'NOT_STARTED',
          timelinessStatus: 'ON_TIME',
          correctionStatus: 'NONE',
          attemptCount: 0,
          manualCompletionVersion: 0,
        }],
      }],
      pagination: { page: 1, pageSize: 40, total: 1, totalPages: 1 },
    }).success).toBe(true)
  })

  it('keeps public blog metadata and review excerpts in shared runtime schemas', () => {
    expect(BlogDiscoveryDetailSchema.safeParse({
      id: 'post-1',
      type: 'ARTICLE',
      visibility: 'PUBLIC',
      author: { username: 'author' },
      currentVersion: {
        title: '文章',
        version: 1,
        contentMarkdown: '正文',
        references: [],
      },
    }).success).toBe(true)
    expect(SimilarityComparisonSchema.safeParse({
      riskLevel: 'LOW',
      textSimilarityBasisPoints: 100,
      codeSimilarityBasisPoints: 200,
      maximumSimilarityBasisPoints: 200,
      source: null,
      matches: [],
    }).success).toBe(true)
  })

  it('normalizes server Date objects at the Rating response boundary', () => {
    const parsed = ContestRatingDataSchema.parse({
      finalizationStatus: 'FINALIZED',
      config: { scope: 'GLOBAL', track: 'OI', weight: 1, lockedAt: new Date('2026-09-14T00:00:00Z') },
      standing: { revision: 1, finalizedAt: new Date('2026-09-14T00:01:00Z'), entries: [] },
      batches: [],
      myChanges: [],
    })
    expect(parsed.config.lockedAt).toBe('2026-09-14T00:00:00.000Z')
    expect(parsed.standing?.finalizedAt).toBe('2026-09-14T00:01:00.000Z')
  })

  it('shares the Training design and mutation contract at runtime', () => {
    expect(TrainingDesignSchema.safeParse({
      editable: true,
      statusRevision: 3,
      session: {
        id: 'session-1',
        title: '顺序训练',
        description: null,
        sessionType: 'GENERAL',
        status: 'DRAFT',
        organizationId: 'organization-1',
        teamId: null,
        scheduledStartAt: new Date('2026-09-15T00:00:00Z'),
      },
      stages: [{
        id: 'stage-1',
        clientKey: 'stage-1',
        name: '热身',
        mode: 'SEQUENTIAL',
        advanceMode: 'MANUAL',
        problemAccessMode: 'SEQUENTIAL',
        submissionMode: 'NORMAL',
        Problems: [],
      }],
      issues: [],
    }).success).toBe(true)

    expect(TrainingStructureInputSchema.safeParse({
      expectedRevision: 3,
      title: '顺序训练',
      description: '',
      stages: [{
        clientKey: 'draft-stage-1',
        name: '热身',
        mode: 'SEQUENTIAL',
        advanceMode: 'MANUAL',
        problemAccessMode: 'SEQUENTIAL',
        submissionMode: 'NORMAL',
        problems: [],
      }],
    }).success).toBe(true)
  })

  it('shares Problem judge settings, testdata and mode transition contracts', () => {
    const settings = ProblemJudgeSettingsSchema.parse({
      problemType: 'default',
      timeLimit: 1000,
      memoryLimit: 256,
      config: {
        mode: 'oi',
        type: 'default',
        checker_type: 'default',
        subtasks: [{
          id: 1,
          score: 100,
          type: 'min',
          cases: [{ input: '1.in', output: '1.out' }],
        }],
      },
    })
    expect(settings.config?.mode).toBe('oi')

    const testdata = ProblemTestdataSchema.parse({
      files: [{
        id: 'file-1',
        filename: '1.in',
        size: 12,
        md5: null,
        sha256: null,
        uploadedAt: new Date('2026-09-14T00:00:00Z'),
      }],
      pairs: [{ input: '1.in', output: '1.out' }],
    })
    expect(testdata.files[0].uploadedAt).toBe('2026-09-14T00:00:00.000Z')
    expect(ProblemJudgeModeTransitionInputSchema.safeParse({
      targetMode: 'ioi',
      expectedLatestRevisionId: 'revision-1',
    }).success).toBe(false)
  })

  it('shares the Problem editor mutation contract instead of accepting arbitrary payloads', () => {
    expect(ProblemEditorMutationSchema.safeParse({
      title: '整数求和',
      status: 'draft',
      statements: [],
      solutions: [],
    }).success).toBe(true)
    expect(ProblemEditorMutationSchema.safeParse({ status: 'visible' }).success).toBe(false)
    expect(ProblemEditorMutationSchema.safeParse({ timeLimit: -1 }).success).toBe(false)
  })

  it('shares the complete OI Test Graph workspace and mutation contract', () => {
    const testcase = {
      id: 'testcase-1', inputFileId: 'input-1', outputFileId: 'output-1',
      input: '1.in', output: '1.out', source: 'official', enabled: true,
      isProtected: false, assignments: [],
    }
    expect(ProblemTestGraphWorkspaceSchema.safeParse({
      revision: 2,
      revisionId: 'revision-2',
      source: 'admin_edit',
      createdAt: new Date('2026-09-14T00:00:00Z'),
      migrated: true,
      canMigrate: false,
      migrationIssues: [],
      subtasks: [{
        id: 1, score: 100, if: [], groups: [
          { key: 'official-1', name: '官方测试组', kind: 'official', score: 100, type: 'min', cases: [{ testcaseId: testcase.id, input: testcase.input, output: testcase.output, source: testcase.source }] },
          { key: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
        ],
      }],
      files: [], pairs: [], unmatchedFiles: [], testcases: [testcase],
    }).success).toBe(true)

    expect(ProblemTestGraphSaveInputSchema.safeParse({
      revision: 2,
      expectedLatestRevisionId: 'revision-2',
      subtasks: [{
        id: 1, score: 100, if: [], groups: [
          { key: 'official-1', name: '官方测试组', kind: 'official', score: 100, type: 'min', cases: [] },
          { key: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
        ],
      }],
    }).success).toBe(true)
  })

  it('shares judge program template summaries and complete examples', () => {
    const summary = {
      id: 'standard-cpp17-sum', version: 1, kind: 'standard', language: 'cpp17',
      protocol: 'oj.standard/v1', title: 'STD 示例', description: '整数求和', recommended: true,
      protocolHelp: ['stdin 读取'], fixtureCount: 2, profileCount: 0,
      hasProtocolConfig: false, learningNoteCount: 1, requiredChangeCount: 1,
    }
    expect(JudgeProgramCatalogSchema.safeParse({
      capabilities: {
        standard: { title: 'STD', description: '标准程序', defaultLanguage: 'cpp17', languages: { cpp17: ['oj.standard/v1'] }, quickProtocol: [] },
        validator: { title: 'Validator', description: '校验器', defaultLanguage: 'cpp17', languages: { cpp17: ['oj.validator/v1'] }, quickProtocol: [] },
        classifier: { title: 'Classifier', description: '分类器', defaultLanguage: 'cpp17', languages: { cpp17: ['oj.classifier/v1'] }, quickProtocol: [] },
        generator: { title: 'Generator', description: '生成器', defaultLanguage: 'cpp17', languages: { cpp17: ['oj.generator/v1'] }, quickProtocol: [] },
      },
      templates: [summary],
    }).success).toBe(true)
    expect(JudgeProgramTemplateSchema.safeParse({
      ...summary,
      fixtureCount: undefined,
      profileCount: undefined,
      hasProtocolConfig: undefined,
      learningNoteCount: undefined,
      requiredChangeCount: undefined,
      source: 'int main() {}',
      examples: [{ name: '普通输入', stdin: '1\n', expectedStdout: '1\n' }],
      learningNotes: ['读取标准输入'],
      requiredChanges: ['替换求解逻辑'],
    }).success).toBe(true)
  })

  it('shares account chat messages and validates send payloads at runtime', () => {
    const page = ChatMessagePageSchema.parse({
      items: [{
        id: 'message-1',
        conversationId: 'conversation-1',
        senderUserId: 'user-1',
        seq: 1,
        content: '你好',
        type: 'text',
        createdAt: new Date('2026-09-15T00:00:00Z'),
      }],
      page: { hasMoreBefore: false, hasMoreAfter: false, oldestSeq: 1, newestSeq: 1 },
    })
    expect(page.items[0].createdAt).toBe('2026-09-15T00:00:00.000Z')
    expect(ChatContracts.sendMessage.body.safeParse({
      type: 'text', content: '你好', clientMessageId: '12345678-1234-1234-1234-123456789abc',
    }).success).toBe(true)
    expect(ChatContracts.sendMessage.body.safeParse({
      type: 'sticker', stickerId: '', clientMessageId: 'not-a-client-id',
    }).success).toBe(false)
  })

  it('shares organization directory and personal application contracts', () => {
    expect(OrganizationDirectoryPageSchema.safeParse({
      items: [{ id: 'organization-1', name: '第一中学', type: 'school', joinPolicy: 'approval', relationship: null }],
      total: 1, page: 1, pageSize: 20,
    }).success).toBe(true)
    expect(MyOrganizationsSchema.safeParse({ memberships: [], applications: [], invitations: [] }).success).toBe(true)
    expect(OrganizationContracts.createJoinApplication.body.safeParse({
      organizationId: 'organization-1', requestedRole: 'student', requestedRelationType: 'enrolled', realName: '学生甲',
    }).success).toBe(true)
    expect(OrganizationContracts.createOrganizationApplication.body.safeParse({
      organizationType: 'school', name: '第一中学', schoolType: '高中', region: '湖南省/长沙市/雨花区',
      educationSystem: '6-3-3', applicantRealName: '教师甲', description: '申请创建学校用于开展信息学竞赛教学和训练管理。',
    }).success).toBe(true)
  })

  it('shares notification pagination, actions and ISO dates', () => {
    const page = NotificationPageSchema.parse({
      notifications: [{
        id: 'notification-1', type: 'organization_invitation', title: '学校邀请', body: '邀请你加入学校',
        sourceType: 'organization_invitation', sourceId: 'invitation-1', actionable: true,
        actions: [{ key: 'accept', label: '接受', style: 'primary' }], createdAt: new Date('2026-09-15T00:00:00Z'),
      }],
      unreadCount: 1, page: 1, pageSize: 20, hasMore: false,
    })
    expect(page.notifications[0].createdAt).toBe('2026-09-15T00:00:00.000Z')
    expect(NotificationContracts.list.query.safeParse({ page: '1', pageSize: '51' }).success).toBe(false)
  })

  it('shares the account workspace list contract', () => {
    expect(WorkspaceListSchema.safeParse({ workspaces: [
      { type: 'personal', availableModules: ['overview'] },
      {
        type: 'organization', organizationId: 'organization-1', organizationName: '第一中学',
        organizationType: 'school', organizationMembershipId: 'membership-1', memberRole: 'student',
        relationType: 'enrolled', relationLabel: '本校学生', availableModules: ['overview'],
      },
    ] }).success).toBe(true)
    expect(WorkspaceContracts.list.scope).toBe('account')
    expect(WorkspaceListSchema.safeParse({ workspaces: [
      { type: 'organization', organizationId: 'organization-1', availableModules: [] },
    ] }).success).toBe(false)
  })

  it('routes pages through feature public APIs instead of component internals', () => {
    const page = fs.readFileSync(new URL('../app/blog/page.tsx', import.meta.url), 'utf8')
    const messages = fs.readFileSync(new URL('../app/account/messages/page.tsx', import.meta.url), 'utf8')
    const organizations = fs.readFileSync(new URL('../app/personal/organizations/page.tsx', import.meta.url), 'utf8')
    const notifications = fs.readFileSync(new URL('../app/account/notifications/page.tsx', import.meta.url), 'utf8')
    const identity = fs.readFileSync(new URL('../app/identity/page.tsx', import.meta.url), 'utf8')
    const organization = fs.readFileSync(new URL('../app/org/[organizationId]/[module]/[...segments]/page.tsx', import.meta.url), 'utf8')
    const login = fs.readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8')
    expect(page).toContain("from '@/features/blog'")
    expect(messages).toContain("from '@/features/chat'")
    expect(organizations).toContain("from '@/features/organization-account'")
    expect(notifications).toContain("from '@/features/notification'")
    expect(identity).toContain("from '@/features/workspace'")
    expect(login).toContain("from '@/features/auth'")
    expect(organization).toContain("from '@/features/assignment'")
    expect(organization).toContain("from '@/features/training-session/TrainingSessionWorkspace'")
    expect(organization).not.toMatch(/@\/components\/(?:assignment|blog|chat|submission|problem|training|training-engine)\//)
    expect(organization).not.toMatch(/@\/features\/(?:assignment|blog|chat|organization-account|submission|problem|contest|training-session)\/(?:api|model|ui)\//)
  })
})
