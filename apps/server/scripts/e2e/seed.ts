import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const accountPassword = process.env.E2E_ACCOUNT_PASSWORD
if (!accountPassword) throw new Error('E2E_ACCOUNT_PASSWORD is required')
const testdataRoot = process.env.TESTDATA_DIR
if (!testdataRoot) throw new Error('TESTDATA_DIR is required for the isolated E2E seed')

const parsedUrl = new URL(databaseUrl)
if (parsedUrl.searchParams.get('schema') !== 'e2e') {
  throw new Error('Refusing to seed a database without schema=e2e')
}

const ids = {
  platformSchool: 'platform-school-00000000',
  school: 'school-default',
  superAdmin: 'e2e-super-admin',
  platformAdmin: 'e2e-platform-admin',
  principal: 'e2e-principal',
  teacher: 'e2e-teacher',
  campusStudent: 'e2e-campus-student',
  personalStudent: 'e2e-personal-student',
  chatSender: 'e2e-chat-sender',
  chatReceiver: 'e2e-chat-receiver',
  chatOutsider: 'e2e-chat-outsider',
  team: 'e2e-team',
  personalTeam: 'e2e-personal-team',
  browseTeam: 'e2e-browse-team',
  problem: 'e2e-problem',
  secondProblem: 'e2e-problem-2',
  thirdProblem: 'e2e-problem-3',
  personalProblem: 'e2e-personal-problem',
  problemList: 'e2e-problem-list',
  problemListSection: 'e2e-problem-list-section',
  personalProblemList: 'e2e-personal-problem-list',
  personalProblemListSection: 'e2e-personal-problem-list-section',
  platformOrganization: 'org_platform-school-00000000',
  organization: 'org_school-default',
  stickerPack: 'e2e-sticker-pack',
  sticker: 'e2e-sticker-happy',
  trainingSession: 'e2e-training-session',
}

async function seedChatSticker(prisma: PrismaClient) {
  const webp = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 72, g: 99, b: 235, alpha: 1 } } }).webp().toBuffer()
  const sha256 = createHash('sha256').update(webp).digest('hex')
  const storageKey = `global/objects/${sha256}`
  const blobId = 'e2e-sticker-blob'
  const target = path.join(testdataRoot!, ...storageKey.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, webp)
  await prisma.blobObject.create({ data: { id: blobId, sha256, size: webp.length, storageKey, contentType: 'image/webp' } })
  await prisma.chatStickerPack.create({ data: { id: ids.stickerPack, key: 'e2e-default', name: 'E2E 表情', version: 1, status: 'active', createdByUserId: ids.superAdmin, publishedAt: new Date() } })
  await prisma.chatSticker.create({ data: { id: ids.sticker, packId: ids.stickerPack, key: 'happy', label: '测试开心', assetBlobId: blobId, posterBlobId: blobId, mimeType: 'image/webp', width: 64, height: 64, sha256 } })
  await prisma.blobReference.createMany({ data: [
    { id: 'e2e-sticker-asset-ref', blobId, ownerType: 'chat_sticker', ownerId: ids.sticker, role: 'asset' },
    { id: 'e2e-sticker-poster-ref', blobId, ownerType: 'chat_sticker', ownerId: ids.sticker, role: 'poster' },
  ] })
}

async function seedIdentityGraph(prisma: PrismaClient, passwordHash: string) {
  await prisma.user.createMany({
    data: [
      { id: ids.superAdmin, username: 'admin', passwordHash, role: 'super_admin', status: 'active', email: 'admin@e2e.test' },
      { id: ids.platformAdmin, username: 'platform_admin', passwordHash, role: 'platform_admin', status: 'active', email: 'platform@e2e.test' },
      { id: ids.principal, username: 'teacher1', passwordHash, role: 'school_principal', status: 'active', email: 'principal@e2e.test' },
      { id: ids.teacher, username: 'teacher2', passwordHash, role: 'teacher', status: 'active', email: 'teacher@e2e.test' },
      { id: ids.campusStudent, username: 'student1', passwordHash, role: 'student', status: 'active', email: 'student@e2e.test' },
      { id: ids.personalStudent, username: 'personal_student1', passwordHash, role: 'student', status: 'active', email: 'personal@e2e.test' },
      { id: ids.chatSender, username: 'chat_sender', passwordHash, role: 'user', status: 'active', email: 'chat-sender@e2e.test' },
      { id: ids.chatReceiver, username: 'chat_receiver', passwordHash, role: 'user', status: 'active', email: 'chat-receiver@e2e.test' },
      { id: ids.chatOutsider, username: 'chat_outsider', passwordHash, role: 'user', status: 'active', email: 'chat-outsider@e2e.test' },
    ],
  })
  await prisma.organization.createMany({
    data: [
      { id: ids.platformOrganization, name: 'E2E Platform', type: 'platform', status: 'active' },
      { id: ids.organization, name: 'E2E School', type: 'school', status: 'active' },
    ],
  })
  await prisma.school.createMany({
    data: [
      { id: ids.platformSchool, name: 'E2E Platform', region: 'system', schoolType: 'platform', educationSystem: '6-3-3', status: 'active', directoryStatus: 'hidden', organizationId: ids.platformOrganization },
      { id: ids.school, name: 'E2E School', region: 'Zhejiang/Hangzhou', schoolType: 'middle', educationSystem: '6-3-3', status: 'active', directoryStatus: 'verified', organizationId: ids.organization },
    ],
  })
  await prisma.organizationMembership.createMany({
    data: [
      { id: 'e2e-membership-principal', organizationId: ids.organization, userId: ids.principal, memberRole: 'school_principal', relationType: 'employee', status: 'active', joinedAt: new Date() },
      { id: 'e2e-membership-teacher', organizationId: ids.organization, userId: ids.teacher, memberRole: 'teacher', relationType: 'employee', status: 'active', joinedAt: new Date() },
      { id: 'e2e-membership-student', organizationId: ids.organization, userId: ids.campusStudent, memberRole: 'student', relationType: 'student', status: 'active', joinedAt: new Date() },
      { id: 'e2e-membership-personal-student', organizationId: ids.organization, userId: ids.personalStudent, memberRole: 'student', relationType: 'student', status: 'active', joinedAt: new Date() },
    ],
  })
  await prisma.organizationTeacherProfile.createMany({
    data: [
      { id: 'e2e-teacher-profile-principal', membershipId: 'e2e-membership-principal', name: 'E2E Principal', title: 'Head Coach', status: 'active' },
      { id: 'e2e-teacher-profile-teacher', membershipId: 'e2e-membership-teacher', name: 'E2E Teacher', title: 'Coach', status: 'active' },
    ],
  })
  await prisma.organizationStudentProfile.createMany({
    data: [
      { id: 'e2e-student-profile-campus', membershipId: 'e2e-membership-student', name: 'E2E Campus Student', gender: 'male', headTeacherMembershipId: 'e2e-membership-principal', enrollmentYear: 2024, targetContest: 'NOIP', rating: 1280, status: 'active' },
      { id: 'e2e-student-profile-personal', membershipId: 'e2e-membership-personal-student', name: 'E2E Personal Student', gender: 'female', headTeacherMembershipId: 'e2e-membership-teacher', enrollmentYear: 2023, targetContest: 'CSP', rating: 1350, status: 'active' },
    ],
  })
  await prisma.school.update({ where: { id: ids.school }, data: { currentPrincipalMembershipId: 'e2e-membership-principal' } })
}

async function main() {
  const passwordHash = await bcrypt.hash(accountPassword, 4)
  const prisma = new PrismaClient()
  try {
    await seedIdentityGraph(prisma, passwordHash)
    await prisma.personalProfile.createMany({
      data: [
        ids.superAdmin,
        ids.platformAdmin,
        ids.principal,
        ids.teacher,
        ids.campusStudent,
        ids.personalStudent,
        ids.chatSender,
        ids.chatReceiver,
        ids.chatOutsider,
      ].map(userId => ({ userId })),
    })
    await seedChatSticker(prisma)
    await prisma.team.createMany({
      data: [
        {
          id: ids.team,
          name: 'E2E Training Team',
          description: 'Deterministic team for UI workflows',
          organizationId: ids.organization,
          isPublic: true,
        },
        {
          id: ids.browseTeam,
          name: 'E2E Public Team',
          description: 'Joinable team for student workflows',
          organizationId: ids.organization,
          isPublic: true,
        },
        {
          id: ids.personalTeam,
          name: 'E2E Personal Team',
          description: 'Personal-mode team for scope isolation checks',
          scope: 'personal',
          isPublic: true,
        },
      ],
    })
    await prisma.teamMember.createMany({
      data: [
        {
          id: 'e2e-member-principal',
          teamId: ids.team,
          userId: ids.principal,
          userType: 'teacher',
          role: 'admin',
          invitedBy: ids.principal,
        },
        {
          id: 'e2e-member-teacher',
          teamId: ids.team,
          userId: ids.teacher,
          userType: 'teacher',
          role: 'member',
          invitedBy: ids.principal,
        },
        {
          id: 'e2e-member-student',
          teamId: ids.team,
          userId: ids.campusStudent,
          userType: 'student',
          role: 'member',
          invitedBy: ids.principal,
        },
        {
          id: 'e2e-member-personal-owner',
          teamId: ids.personalTeam,
          userId: ids.personalStudent,
          userType: 'user',
          role: 'owner',
          invitedBy: ids.personalStudent,
        },
        {
          id: 'e2e-member-personal-campus',
          teamId: ids.team,
          userId: ids.personalStudent,
          userType: 'student',
          role: 'member',
          invitedBy: ids.principal,
        },
      ],
    })

    const judgeConfig = JSON.stringify({
      mode: 'acm',
      type: 'default',
      time: '1000ms',
      memory: '256MB',
      cases: [{ input: '1.in', output: '1.out' }],
    })
    await prisma.problem.createMany({
      data: [
        {
          id: ids.problem,
          platform: 'carits',
          problemId: 'E2E-1000',
          title: 'E2E A Plus B',
          description: 'Add two integers.',
          statementType: 'markdown',
          difficulty: 'easy',
          timeLimit: 1000,
          memoryLimit: 256,
          visibility: 'public',
          libraryScope: 'platform',
          libraryKey: 'platform',
          ownerType: 'teacher',
          ownerId: ids.principal,
          status: 'published',
          judgeConfig,
        },
        {
          id: ids.secondProblem,
          platform: 'internal',
          problemId: 'E2E-1001',
          title: 'E2E Sequence',
          description: 'Return the sequence sum.',
          statementType: 'markdown',
          difficulty: 'medium',
          timeLimit: 1000,
          memoryLimit: 256,
          visibility: 'school',
          libraryScope: 'school',
          libraryKey: `organization:${ids.organization}`,
          organizationId: ids.organization,
          ownerType: 'teacher',
          ownerId: ids.teacher,
          status: 'published',
        },
        {
          id: ids.thirdProblem,
          platform: 'internal',
          problemId: 'E2E-1002',
          title: 'E2E Prefix Sum',
          description: 'Return prefix sums.',
          statementType: 'markdown',
          difficulty: 'medium',
          timeLimit: 1000,
          memoryLimit: 256,
          visibility: 'school',
          libraryScope: 'school',
          libraryKey: `organization:${ids.organization}`,
          organizationId: ids.organization,
          ownerType: 'teacher',
          ownerId: ids.teacher,
          status: 'published',
        },
        {
          id: ids.personalProblem,
          platform: 'codeforces',
          problemId: '1000A',
          title: 'E2E Personal Problem',
          description: 'Problem owned by the personal-mode student.',
          statementType: 'markdown',
          difficulty: 'easy',
          timeLimit: 1000,
          memoryLimit: 256,
          visibility: 'private',
          libraryScope: 'platform',
          libraryKey: 'platform',
          ownerType: 'student',
          ownerId: ids.personalStudent,
          status: 'published',
        },
      ],
    })
    const inputData = '1 1\n'
    const outputData = '2\n'
    const problemTestdataDir = path.join(testdataRoot, ids.problem)
    fs.mkdirSync(problemTestdataDir, { recursive: true })
    fs.writeFileSync(path.join(problemTestdataDir, '1.in'), inputData, 'utf8')
    fs.writeFileSync(path.join(problemTestdataDir, '1.out'), outputData, 'utf8')
    await prisma.testdataFile.createMany({
      data: [
        {
          id: 'e2e-testdata-input',
          problemId: ids.problem,
          filename: '1.in',
          size: Buffer.byteLength(inputData),
          md5: createHash('md5').update(inputData).digest('hex'),
          sha256: createHash('sha256').update(inputData).digest('hex'),
        },
        {
          id: 'e2e-testdata-output',
          problemId: ids.problem,
          filename: '1.out',
          size: Buffer.byteLength(outputData),
          md5: createHash('md5').update(outputData).digest('hex'),
          sha256: createHash('sha256').update(outputData).digest('hex'),
        },
      ],
    })
    const judgeConfigHash = createHash('sha256').update(judgeConfig).digest('hex')
    await prisma.problemTestSetRevision.create({ data: {
      id: 'e2e-testset-revision', problemId: ids.problem, revisionNumber: 1, mode: 'acm', source: 'initial',
      judgeConfig, judgeConfigHash, graphHash: createHash('sha256').update('e2e-graph').digest('hex'), testdataPath: '.', createdBy: ids.principal,
    } })
    await prisma.problem.update({ where: { id: ids.problem }, data: { latestTestSetRevisionId: 'e2e-testset-revision' } })
    await prisma.problemTestSetRevision.createMany({ data: [ids.secondProblem, ids.thirdProblem].map((problemId, index) => ({
      id: `e2e-testset-revision-${index + 2}`, problemId, revisionNumber: 1, mode: 'acm', source: 'initial',
      judgeConfig, judgeConfigHash, graphHash: createHash('sha256').update(`e2e-graph-${index + 2}`).digest('hex'), testdataPath: '.', createdBy: ids.principal,
    })) })
    await prisma.problem.update({ where: { id: ids.secondProblem }, data: { judgeConfig, latestTestSetRevisionId: 'e2e-testset-revision-2' } })
    await prisma.problem.update({ where: { id: ids.thirdProblem }, data: { judgeConfig, latestTestSetRevisionId: 'e2e-testset-revision-3' } })
    await prisma.problemStatement.createMany({
      data: [
        {
          id: 'e2e-statement-1',
          problemId: ids.problem,
          type: 'statement',
          format: 'markdown',
          language: 'zh-CN',
          content: '# E2E A Plus B\n\nRead two integers and print their sum.',
        },
        {
          id: 'e2e-solution-1',
          problemId: ids.problem,
          type: 'solution',
          format: 'markdown',
          language: 'zh-CN',
          content: 'Read, add, and print.',
          isVisible: true,
        },
      ],
    })
    await prisma.trainingSession.create({ data: {
      id: ids.trainingSession, title: 'E2E 教练训练', description: '阶段控制与草稿测试', sessionType: 'ACM', status: 'SCHEDULED',
      organizationId: ids.organization, createdBy: ids.principal, scheduledStartAt: new Date(Date.now() + 60 * 60 * 1000), rankingMode: 'PROGRESS_ONLY', peerVisibility: 'PROGRESS',
      Stages: { create: { id: 'e2e-training-stage', name: '顺序训练', orderIndex: 0, mode: 'SEQUENTIAL', advanceMode: 'MANUAL', problemAccessMode: 'SEQUENTIAL', submissionMode: 'ENABLED', Problems: { create: { id: 'e2e-training-stage-problem', problemId: ids.problem, testSetRevisionId: 'e2e-testset-revision', alias: 'A', orderIndex: 0 } } } },
      Participants: { create: { id: 'e2e-training-participant', userId: ids.campusStudent, currentStageId: 'e2e-training-stage' } },
    } })
    await prisma.trainingSession.update({ where: { id: ids.trainingSession }, data: { currentStageId: 'e2e-training-stage' } })

    await prisma.problemList.create({
      data: {
        id: ids.problemList,
        title: 'E2E Basic Problem List',
        description: 'Deterministic list for UI workflows',
        organizationId: ids.organization,
        scope: 'campus',
        ownerId: ids.principal,
        ownerType: 'teacher',
        visibility: 'public',
      },
    })
    await prisma.problemList.create({
      data: {
        id: ids.personalProblemList,
        title: 'E2E Personal Problem List',
        description: 'Personal-scope list for all-role workspace checks',
        scope: 'personal',
        ownerId: ids.personalStudent,
        ownerType: 'user',
        visibility: 'private',
      },
    })
    await prisma.problemListSection.create({
      data: {
        id: ids.personalProblemListSection,
        problemListId: ids.personalProblemList,
        title: 'Personal warmup',
        sortOrder: 0,
      },
    })
    await prisma.problemListEntry.create({
      data: {
        id: 'e2e-personal-list-entry',
        sectionId: ids.personalProblemListSection,
        problemId: ids.problem,
        ojName: 'internal',
        sortOrder: 0,
      },
    })
    await prisma.problemListSection.create({
      data: {
        id: ids.problemListSection,
        problemListId: ids.problemList,
        title: 'Warmup',
        sortOrder: 0,
      },
    })
    await prisma.problemListEntry.createMany({
      data: [
        {
          id: 'e2e-list-entry-1',
          sectionId: ids.problemListSection,
          problemId: ids.problem,
          ojName: 'internal',
          sortOrder: 0,
        },
        {
          id: 'e2e-list-entry-2',
          sectionId: ids.problemListSection,
          problemId: ids.secondProblem,
          ojName: 'internal',
          sortOrder: 1,
        },
      ],
    })
    await prisma.schoolProblemList.create({
      data: {
        id: 'e2e-school-list',
        organizationId: ids.organization,
        problemListId: ids.problemList,
        addedBy: ids.principal,
        addedByRole: 'teacher',
      },
    })
    await prisma.teamProblemList.create({
      data: {
        id: 'e2e-team-list',
        teamId: ids.team,
        problemListId: ids.problemList,
        addedBy: ids.principal,
        addedByRole: 'teacher',
      },
    })

    const now = Date.now()
    const longAcceptedCode = [
      '#include <iostream>',
      'int main() {',
      ...Array.from({ length: 80 }, (_, index) => `  // deterministic line ${index + 1}`),
      '  int a, b;',
      '  std::cin >> a >> b;',
      '  std::cout << a + b;',
      '}',
    ].join('\n')
    const contestStartTime = new Date(now - 48 * 60 * 60 * 1000)
    const contestEndTime = new Date(now - 24 * 60 * 60 * 1000)
    const homework = await prisma.training.create({
      data: {
        teamId: ids.team,
        organizationId: ids.organization,
        title: 'E2E Active Homework',
        description: 'Active homework for the UI suite',
        format: 'ioi',
        startTime: new Date(now - 60 * 60 * 1000),
        endTime: new Date(now + 24 * 60 * 60 * 1000),
        status: 'ongoing',
        createdBy: ids.principal,
        type: 'homework',
        problemIdVisible: true,
        solutionVisible: false,
      },
    })
    await prisma.assignment.create({ data: {
      id: 'e2e-assignment',
      organizationId: ids.organization,
      teamId: ids.team,
      title: 'E2E Active Homework',
      description: 'Active independent assignment for the UI suite',
      status: 'OPEN',
      rosterMode: 'SNAPSHOT',
      gradingPolicy: 'BEST_BEFORE_DUE',
      latePolicy: 'DISALLOW',
      correctionPolicy: 'BELOW_TARGET',
      solutionReleasePolicy: 'AFTER_RELEASE',
      openAt: new Date(now - 60 * 60 * 1000),
      dueAt: new Date(now + 24 * 60 * 60 * 1000),
      closeAt: new Date(now + 48 * 60 * 60 * 1000),
      createdByMembershipId: 'e2e-membership-principal',
      statusRevision: 1,
      eventSeq: 1,
      publishedAt: new Date(now - 60 * 60 * 1000),
      Problems: { create: {
        id: 'e2e-assignment-problem',
        problemId: ids.problem,
        testSetRevisionId: 'e2e-testset-revision',
        orderIndex: 0,
        category: 'REQUIRED',
        required: true,
        maxScore: 100,
        targetScore: 100,
        weight: 100,
        completionPolicy: 'AC',
        judgeConfigSnapshot: judgeConfig,
        judgeConfigHash,
      } },
      Recipients: { create: {
        id: 'e2e-assignment-recipient',
        userId: ids.campusStudent,
        membershipId: 'e2e-membership-student',
        source: 'snapshot',
        status: 'ACTIVE',
        assignedAt: new Date(now - 60 * 60 * 1000),
        startedAt: new Date(now - 30 * 60 * 1000),
        dueAtEffective: new Date(now + 24 * 60 * 60 * 1000),
        closeAtEffective: new Date(now + 48 * 60 * 60 * 1000),
      } },
      Events: { create: { seq: 1, type: 'assignment.published', actorUserId: ids.principal } },
    } })
    await prisma.assignmentProblemProgress.create({ data: {
      assignmentId: 'e2e-assignment', assignmentProblemId: 'e2e-assignment-problem', recipientId: 'e2e-assignment-recipient',
      learningStatus: 'IN_PROGRESS', correctionStatus: 'NONE', attemptCount: 0, originalAttemptCount: 0,
    } })
    const contest = await prisma.training.create({
      data: {
        teamId: ids.team,
        organizationId: ids.organization,
        title: 'E2E Finished Contest',
        description: 'Finished contest for ranking and makeup flows',
        format: 'icpc',
        startTime: contestStartTime,
        endTime: contestEndTime,
        status: 'finished',
        createdBy: ids.principal,
        type: 'contest',
        problemIdVisible: true,
        solutionVisible: true,
      },
    })
    const personalContest = await prisma.training.create({
      data: {
        teamId: ids.personalTeam,
        scope: 'personal',
        title: 'E2E Personal Contest',
        description: 'Personal workspace contest for the UI suite',
        format: 'ioi',
        startTime: new Date(now - 30 * 60 * 1000),
        endTime: new Date(now + 2 * 60 * 60 * 1000),
        status: 'ongoing',
        createdBy: ids.personalStudent,
        type: 'contest',
        problemIdVisible: true,
        solutionVisible: false,
      },
    })
    await prisma.teamProblemList.create({
      data: {
        id: 'e2e-personal-team-list',
        teamId: ids.personalTeam,
        problemListId: ids.personalProblemList,
        addedBy: ids.personalStudent,
        addedByRole: 'user',
      },
    })

    await prisma.trainingProblem.createMany({
      data: [
        {
          id: 'e2e-homework-problem',
          trainingId: homework.id,
          problemId: ids.problem,
          alias: 'A',
          orderIndex: 0,
          points: 100,
          titleSnapshot: 'E2E A Plus B',
          statementSnapshot: 'Read two integers and print their sum.',
          sourcePlatformSnapshot: 'carits',
          sourceProblemIdSnapshot: 'E2E-1000',
        },
        {
          id: 'e2e-contest-problem',
          trainingId: contest.id,
          problemId: ids.problem,
          alias: 'A',
          orderIndex: 0,
          points: 100,
          titleSnapshot: 'E2E A Plus B',
          statementSnapshot: 'Read two integers and print their sum.',
          sourcePlatformSnapshot: 'internal',
          sourceProblemIdSnapshot: 'E2E-1000',
        },
        {
          id: 'e2e-contest-problem-b',
          trainingId: contest.id,
          problemId: ids.secondProblem,
          alias: 'B',
          orderIndex: 1,
          points: 100,
          titleSnapshot: 'E2E Sequence',
          statementSnapshot: 'Return the sequence sum.',
          sourcePlatformSnapshot: 'internal',
          sourceProblemIdSnapshot: 'E2E-1001',
        },
        {
          id: 'e2e-contest-problem-c',
          trainingId: contest.id,
          problemId: ids.thirdProblem,
          alias: 'C',
          orderIndex: 2,
          points: 100,
          titleSnapshot: 'E2E Prefix Sum',
          statementSnapshot: 'Return prefix sums.',
          sourcePlatformSnapshot: 'internal',
          sourceProblemIdSnapshot: 'E2E-1002',
        },
        {
          id: 'e2e-personal-contest-problem',
          trainingId: personalContest.id,
          problemId: ids.problem,
          alias: 'A',
          orderIndex: 0,
          points: 100,
          titleSnapshot: 'E2E A Plus B',
          statementSnapshot: 'Read two integers and print their sum.',
          sourcePlatformSnapshot: 'carits',
          sourceProblemIdSnapshot: 'E2E-1000',
        },
      ],
    })
    await prisma.trainingParticipant.createMany({
      data: [
        {
          id: 'e2e-homework-student',
          trainingId: homework.id,
          userId: ids.campusStudent,
          userType: 'student',
        },
        {
          id: 'e2e-contest-student',
          trainingId: contest.id,
          userId: ids.campusStudent,
          userType: 'student',
        },
        {
          id: 'e2e-contest-second-student',
          trainingId: contest.id,
          userId: ids.personalStudent,
          userType: 'student',
        },
        {
          id: 'e2e-personal-contest-user',
          trainingId: personalContest.id,
          userId: ids.personalStudent,
          userType: 'user',
        },
      ],
    })
    await prisma.trainingUserProblemStatus.create({
      data: {
        id: 'e2e-homework-status',
        trainingId: homework.id,
        userId: ids.campusStudent,
        trainingProblemId: 'e2e-homework-problem',
        bestScore: 100,
        bestResult: 'accepted',
        attemptCount: 1,
        acAt: new Date(now - 30 * 60 * 1000),
      },
    })
    await prisma.contestUserProblemStatus.create({
      data: {
        id: 'e2e-contest-status',
        contestId: contest.id,
        userId: ids.campusStudent,
        contestProblemId: 'e2e-contest-problem',
        bestScore: 100,
        bestResult: 'accepted',
        attemptCount: 1,
        acAt: new Date(now - 25 * 60 * 60 * 1000),
      },
    })
    await prisma.submission.create({
      data: {
        userId: ids.campusStudent,
        organizationId: ids.organization,
        oj: 'carits',
        problemId: 'E2E-1000',
        problemInternalId: ids.problem,
        language: 'cpp',
        code: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}',
        codeLength: 75,
        result: 'accepted',
        timeUsed: 4,
        memoryUsed: 1024,
        score: 100,
        submitMethod: 'judge',
        submitScope: 'training',
        trainingId: homework.id,
        trainingProblemId: 'e2e-homework-problem',
      },
    })
    await prisma.submission.create({
      data: {
        userId: ids.personalStudent,
        workspaceScope: 'personal',
        oj: 'codeforces',
        problemId: '1000A',
        problemInternalId: ids.personalProblem,
        language: 'cpp',
        code: 'int main(){return 0;}',
        codeLength: 21,
        result: 'accepted',
        timeUsed: 1,
        memoryUsed: 512,
        score: 100,
        cases: JSON.stringify([
          { result: 'Accepted', time: 1, memory: 512 },
          { result: 'Accepted', time: 1, memory: 512 },
        ]),
        submitMethod: 'local',
        submitScope: 'problem',
        isGlobalVisible: true,
        ojRemoteId: '123456789',
      },
    })
    await prisma.submission.create({
      data: {
        userId: ids.campusStudent,
        organizationId: ids.organization,
        oj: 'carits',
        problemId: 'E2E-1000',
        problemInternalId: ids.problem,
        language: 'cpp',
        code: longAcceptedCode,
        codeLength: Buffer.byteLength(longAcceptedCode),
        result: 'accepted',
        timeUsed: 2,
        memoryUsed: 768,
        score: 100,
        cases: JSON.stringify([{ result: 'Accepted', time: 2, memory: 768 }]),
        submitMethod: 'judge',
        submitScope: 'contest',
        trainingId: contest.id,
        trainingProblemId: 'e2e-contest-problem',
        contestId: contest.id,
        contestProblemId: 'e2e-contest-problem',
        isGlobalVisible: true,
        createdAt: new Date(contestStartTime.getTime() + 37 * 60 * 1000),
      },
    })
    await prisma.submission.createMany({
      data: [
        {
          userId: ids.personalStudent,
          organizationId: ids.organization,
          oj: 'carits',
          problemId: 'E2E-1001',
          problemInternalId: ids.secondProblem,
          language: 'cpp',
          code: 'int main(){return 0;}',
          codeLength: 21,
          result: 'accepted',
          timeUsed: 2,
          memoryUsed: 768,
          score: 100,
          cases: JSON.stringify([{ result: 'Accepted', time: 2, memory: 768 }]),
          submitMethod: 'judge',
          submitScope: 'contest',
          trainingId: contest.id,
          trainingProblemId: 'e2e-contest-problem-b',
          contestId: contest.id,
          contestProblemId: 'e2e-contest-problem-b',
          isGlobalVisible: true,
          createdAt: new Date(contestStartTime.getTime() + 20 * 60 * 1000),
        },
        {
          userId: ids.campusStudent,
          organizationId: ids.organization,
          oj: 'carits',
          problemId: 'E2E-1001',
          problemInternalId: ids.secondProblem,
          language: 'cpp',
          code: 'int main(){return 0;}',
          codeLength: 21,
          result: 'wrong_answer',
          timeUsed: 2,
          memoryUsed: 768,
          score: 0,
          cases: JSON.stringify([{ result: 'Wrong Answer', time: 2, memory: 768 }]),
          submitMethod: 'judge',
          submitScope: 'contest',
          trainingId: contest.id,
          trainingProblemId: 'e2e-contest-problem-b',
          contestId: contest.id,
          contestProblemId: 'e2e-contest-problem-b',
          isGlobalVisible: true,
          createdAt: new Date(contestStartTime.getTime() + 25 * 60 * 1000),
        },
        {
          userId: ids.campusStudent,
          organizationId: ids.organization,
          oj: 'carits',
          problemId: 'E2E-1001',
          problemInternalId: ids.secondProblem,
          language: 'cpp',
          code: 'int main(){return 0;}',
          codeLength: 21,
          result: 'accepted',
          timeUsed: 2,
          memoryUsed: 768,
          score: 100,
          cases: JSON.stringify([{ result: 'Accepted', time: 2, memory: 768 }]),
          submitMethod: 'judge',
          submitScope: 'contest',
          trainingId: contest.id,
          trainingProblemId: 'e2e-contest-problem-b',
          contestId: contest.id,
          contestProblemId: 'e2e-contest-problem-b',
          isGlobalVisible: true,
          createdAt: new Date(contestStartTime.getTime() + 50 * 60 * 1000),
        },
        {
          userId: ids.campusStudent,
          organizationId: ids.organization,
          oj: 'carits',
          problemId: 'E2E-1002',
          problemInternalId: ids.thirdProblem,
          language: 'cpp',
          code: 'int main(){return 0;}',
          codeLength: 21,
          result: 'wrong_answer',
          timeUsed: 2,
          memoryUsed: 768,
          score: 0,
          cases: JSON.stringify([{ result: 'Wrong Answer', time: 2, memory: 768 }]),
          submitMethod: 'judge',
          submitScope: 'contest',
          trainingId: contest.id,
          trainingProblemId: 'e2e-contest-problem-c',
          contestId: contest.id,
          contestProblemId: 'e2e-contest-problem-c',
          isGlobalVisible: true,
          createdAt: new Date(contestStartTime.getTime() + 15 * 60 * 1000),
        },
        {
          userId: ids.campusStudent,
          organizationId: ids.organization,
          oj: 'carits',
          problemId: 'E2E-1002',
          problemInternalId: ids.thirdProblem,
          language: 'cpp',
          code: 'int main(){return 0;}',
          codeLength: 21,
          result: 'wrong_answer',
          timeUsed: 2,
          memoryUsed: 768,
          score: 0,
          cases: JSON.stringify([{ result: 'Wrong Answer', time: 2, memory: 768 }]),
          submitMethod: 'judge',
          submitScope: 'contest',
          trainingId: contest.id,
          trainingProblemId: 'e2e-contest-problem-c',
          contestId: contest.id,
          contestProblemId: 'e2e-contest-problem-c',
          isGlobalVisible: true,
          createdAt: new Date(contestStartTime.getTime() + 30 * 60 * 1000),
        },
      ],
    })
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
