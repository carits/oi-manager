import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { Client } from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const accountPassword = process.env.E2E_ACCOUNT_PASSWORD
if (!accountPassword) throw new Error('E2E_ACCOUNT_PASSWORD is required')

const parsedUrl = new URL(databaseUrl)
if (parsedUrl.searchParams.get('schema') !== 'e2e') {
  throw new Error('Refusing to seed a database without schema=e2e')
}

const adminUrl = new URL(databaseUrl)
adminUrl.searchParams.delete('schema')

const ids = {
  platformSchool: 'platform-school-00000000',
  school: 'school-default',
  superAdmin: 'e2e-super-admin',
  platformAdmin: 'e2e-platform-admin',
  principal: 'e2e-principal',
  teacher: 'e2e-teacher',
  campusStudent: 'e2e-campus-student',
  personalStudent: 'e2e-personal-student',
  team: 'e2e-team',
  personalTeam: 'e2e-personal-team',
  browseTeam: 'e2e-browse-team',
  problem: 'e2e-problem',
  secondProblem: 'e2e-problem-2',
  personalProblem: 'e2e-personal-problem',
  problemList: 'e2e-problem-list',
  problemListSection: 'e2e-problem-list-section',
  personalProblemList: 'e2e-personal-problem-list',
  personalProblemListSection: 'e2e-personal-problem-list-section',
}

async function seedIdentityGraph(passwordHash: string) {
  const client = new Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET session_replication_role = replica')
    await client.query(`
      INSERT INTO e2e."School"
        (id, name, region, "schoolType", "educationSystem", status, "currentPrincipalTeacherId", "updatedAt")
      VALUES
        ('${ids.platformSchool}', 'E2E Platform', 'system', 'platform', '6-3-3', 'active', '${ids.superAdmin}', NOW()),
        ('${ids.school}', 'E2E School', 'Zhejiang/Hangzhou', 'middle', '6-3-3', 'active', '${ids.principal}', NOW())
    `)
    await client.query(`
      INSERT INTO e2e."User"
        (id, username, "passwordHash", role, "schoolId", status, email, "updatedAt")
      VALUES
        ('${ids.superAdmin}', 'admin', $1, 'super_admin', '${ids.platformSchool}', 'active', 'admin@e2e.test', NOW()),
        ('${ids.platformAdmin}', 'platform_admin', $1, 'platform_admin', '${ids.platformSchool}', 'active', 'platform@e2e.test', NOW()),
        ('${ids.principal}', 'teacher1', $1, 'school_principal', '${ids.school}', 'active', 'principal@e2e.test', NOW()),
        ('${ids.teacher}', 'teacher2', $1, 'teacher', '${ids.school}', 'active', 'teacher@e2e.test', NOW()),
        ('${ids.campusStudent}', 'student1', $1, 'student', '${ids.school}', 'active', 'student@e2e.test', NOW()),
        ('${ids.personalStudent}', 'personal_student1', $1, 'student', '${ids.school}', 'active', 'personal@e2e.test', NOW())
    `, [passwordHash])
    await client.query(`
      INSERT INTO e2e."Teacher"
        (id, name, title, "schoolId", status, "updatedAt")
      VALUES
        ('${ids.superAdmin}', 'E2E Super Admin', 'Administrator', '${ids.platformSchool}', 'active', NOW()),
        ('${ids.principal}', 'E2E Principal', 'Head Coach', '${ids.school}', 'active', NOW()),
        ('${ids.teacher}', 'E2E Teacher', 'Coach', '${ids.school}', 'active', NOW())
    `)
    await client.query(`
      INSERT INTO e2e."Admin" (id, name, "schoolId", "updatedAt")
      VALUES ('${ids.platformAdmin}', 'E2E Platform Admin', '${ids.platformSchool}', NOW())
    `)
    await client.query(`
      INSERT INTO e2e."Student"
        (id, name, gender, "schoolId", "headTeacherId", "enrollmentYear", "targetContest", rating, "updatedAt")
      VALUES
        ('${ids.campusStudent}', 'E2E Campus Student', 'male', '${ids.school}', '${ids.principal}', 2024, 'NOIP', 1280, NOW()),
        ('${ids.personalStudent}', 'E2E Personal Student', 'female', '${ids.school}', '${ids.teacher}', 2023, 'CSP', 1350, NOW())
    `)
    await client.query('SET session_replication_role = origin')
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(accountPassword, 4)
  await seedIdentityGraph(passwordHash)

  const prisma = new PrismaClient()
  try {
    await prisma.personalProfile.createMany({
      data: [
        ids.superAdmin,
        ids.platformAdmin,
        ids.principal,
        ids.teacher,
        ids.campusStudent,
        ids.personalStudent,
      ].map(userId => ({ userId })),
    })
    await prisma.team.createMany({
      data: [
        {
          id: ids.team,
          name: 'E2E Training Team',
          description: 'Deterministic team for UI workflows',
          schoolId: ids.school,
          isPublic: true,
        },
        {
          id: ids.browseTeam,
          name: 'E2E Public Team',
          description: 'Joinable team for student workflows',
          schoolId: ids.school,
          isPublic: true,
        },
        {
          id: ids.personalTeam,
          name: 'E2E Personal Team',
          description: 'Personal-mode team for scope isolation checks',
          schoolId: null,
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
          schoolId: null,
          ownerType: 'teacher',
          ownerId: ids.principal,
          status: 'published',
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
          libraryKey: `school:${ids.school}`,
          schoolId: ids.school,
          ownerType: 'teacher',
          ownerId: ids.teacher,
          status: 'published',
        },
        {
          id: ids.personalProblem,
          platform: 'carits',
          problemId: '1002',
          title: 'E2E Personal Problem',
          description: 'Problem owned by the personal-mode student.',
          statementType: 'markdown',
          difficulty: 'easy',
          timeLimit: 1000,
          memoryLimit: 256,
          visibility: 'private',
          libraryScope: 'platform',
          libraryKey: 'platform',
          schoolId: null,
          ownerType: 'student',
          ownerId: ids.personalStudent,
          status: 'published',
        },
      ],
    })
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

    await prisma.problemList.create({
      data: {
        id: ids.problemList,
        title: 'E2E Basic Problem List',
        description: 'Deterministic list for UI workflows',
        schoolId: ids.school,
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
        schoolId: null,
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
        schoolId: ids.school,
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
    const homework = await prisma.training.create({
      data: {
        teamId: ids.team,
        schoolId: ids.school,
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
    const contest = await prisma.training.create({
      data: {
        teamId: ids.team,
        schoolId: ids.school,
        title: 'E2E Finished Contest',
        description: 'Finished contest for ranking and makeup flows',
        format: 'icpc',
        startTime: new Date(now - 48 * 60 * 60 * 1000),
        endTime: new Date(now - 24 * 60 * 60 * 1000),
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
        schoolId: null,
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
        oj: 'carits',
        problemId: '1002',
        problemInternalId: ids.personalProblem,
        language: 'cpp',
        code: 'int main(){return 0;}',
        codeLength: 21,
        result: 'accepted',
        timeUsed: 1,
        memoryUsed: 512,
        score: 100,
        submitMethod: 'judge',
        submitScope: 'problem',
        isGlobalVisible: true,
      },
    })
    await prisma.submission.create({
      data: {
        userId: ids.campusStudent,
        oj: 'carits',
        problemId: 'E2E-1000',
        problemInternalId: ids.problem,
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
        trainingProblemId: 'e2e-contest-problem',
        contestId: contest.id,
        contestProblemId: 'e2e-contest-problem',
        isGlobalVisible: true,
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
