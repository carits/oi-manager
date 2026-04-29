import { beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../src/prisma'

// 注意：DATABASE_URL 已在 setup-env.ts 中设置（必须在 prisma import 之前）

// 平台学校 ID（用于系统管理员）
const PLATFORM_SCHOOL_ID = 'platform-school-00000000'
// 平台负责人占位用户 ID
const PLATFORM_PRINCIPAL_USER_ID = 'platform-principal-user-placeholder'

beforeAll(async () => {
  // 确保数据库连接
  await prisma.$connect()

  // 处理循环外键依赖：
  // User.schoolId → School.id
  // School.currentPrincipalTeacherId → Teacher.id (= User.id)
  // Teacher.schoolId → School.id
  //
  // 由于 Prisma 创建的 FK 是 NOT DEFERRABLE，需要暂时禁用 FK 约束
  await prisma.$transaction(async (tx) => {
    // 暂时禁用 FK 约束检查
    await tx.$executeRaw`SET session_replication_role = replica`

    // 1. 创建平台负责人占位用户
    await tx.$executeRaw`
      INSERT INTO "User" (id, username, "passwordHash", role, "schoolId", "updatedAt")
      VALUES (${PLATFORM_PRINCIPAL_USER_ID}, 'platform_principal_placeholder', 'placeholder', 'teacher', ${PLATFORM_SCHOOL_ID}, NOW())
      ON CONFLICT (id) DO NOTHING
    `

    // 2. 创建平台负责人占位教师（Teacher.id = User.id）
    await tx.$executeRaw`
      INSERT INTO "Teacher" (id, name, "schoolId", "updatedAt")
      VALUES (${PLATFORM_PRINCIPAL_USER_ID}, '平台负责人', ${PLATFORM_SCHOOL_ID}, NOW())
      ON CONFLICT (id) DO NOTHING
    `

    // 3. 创建平台学校
    await tx.$executeRaw`
      INSERT INTO "School" (id, name, "currentPrincipalTeacherId", "updatedAt")
      VALUES (${PLATFORM_SCHOOL_ID}, '平台学校', ${PLATFORM_PRINCIPAL_USER_ID}, NOW())
      ON CONFLICT (id) DO NOTHING
    `

    // 重新启用 FK 约束检查
    await tx.$executeRaw`SET session_replication_role = origin`
  })
})

afterEach(async () => {
  // 每个测试后清理数据（按依赖顺序删除）
  // 注意：不清理 Problem 表，因为题目数据是共享的公共数据
  // 注意：不清理平台学校和平台负责人占位记录，因为系统管理员需要绑定学校
  try {
    await prisma.problemListEntry.deleteMany()
    await prisma.problemListSection.deleteMany()
    await prisma.problemListShare.deleteMany()
    await prisma.schoolProblemList.deleteMany()
    await prisma.teamProblemList.deleteMany()
    await prisma.ojAccount.deleteMany()
    await prisma.problemList.deleteMany()
    await prisma.teamOperationLog.deleteMany()
    await prisma.loginLog.deleteMany()
    await prisma.taskItem.deleteMany()
    await prisma.contestProblemScore.deleteMany()
    await prisma.contestResult.deleteMany()
    await prisma.contestProblem.deleteMany()
    await prisma.contestResource.deleteMany()
    await prisma.contest.deleteMany()
    await prisma.teamMember.deleteMany()
    await prisma.teamJoinRequest.deleteMany()
    await prisma.team.deleteMany()
    await prisma.milestone.deleteMany()
    await prisma.student.deleteMany()
    // Teacher 主键是 id，保留平台负责人占位教师
    await prisma.teacher.deleteMany({ where: { id: { not: PLATFORM_PRINCIPAL_USER_ID } } })
    await prisma.principalTransferLog.deleteMany()
    await prisma.admin.deleteMany()
    await prisma.school.deleteMany({ where: { id: { not: PLATFORM_SCHOOL_ID } } })
    await prisma.user.deleteMany({ where: { id: { not: PLATFORM_PRINCIPAL_USER_ID } } })
  } catch (error) {
    // 忽略清理错误，某些表可能为空
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})
