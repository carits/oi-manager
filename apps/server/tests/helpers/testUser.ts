import { prisma } from '../../src/prisma'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { UserRole, JwtPayload } from '../../../../packages/shared/src'

// 平台学校 ID（用于系统管理员）
const PLATFORM_SCHOOL_ID = 'platform-school-00000000'

interface CreateTestUserOptions {
  role?: UserRole
  username?: string
  password?: string
  schoolId?: string
  status?: 'active' | 'disabled'
  headTeacherId?: string  // 改名：指向 Teacher.id
  rating?: number
}

interface CreatedTestUser {
  user: {
    id: string
    username: string
    passwordHash: string
    role: UserRole
    status: string
    teacherId?: string   // 实际是 teacher.userId
    studentId?: string   // 实际是 student.userId
    adminId?: string     // 实际是 admin.userId
    schoolId?: string
  }
  password: string
  teacherId?: string
  studentId?: string
  adminId?: string
  schoolId?: string
}

/**
 * 创建测试用户
 * 根据 role 自动创建对应的 Teacher/Student/Admin 记录
 * 注意：Teacher/Student/Admin 的主键都是 id（等于 User.id）
 */
export async function createTestUser(options: CreateTestUserOptions = {}): Promise<CreatedTestUser> {
  const { role = 'student', username, password = 'test123456', schoolId, status = 'active', headTeacherId, rating = 1200 } = options
  const uniqueUsername = username || `t_${Math.random().toString(36).slice(2, 8)}`

  const passwordHash = await bcrypt.hash(password, 10)

  // 确定用户的 schoolId
  let effectiveSchoolId = schoolId
  if (!effectiveSchoolId) {
    if (role === 'student') {
      // 学生必须有学校，如果没有提供则创建临时学校
      const tempSchool = await createTestSchool()
      effectiveSchoolId = tempSchool.id
    } else if (role === 'teacher' || role === 'school_principal') {
      // 教师需要学校，如果没有提供则创建临时学校
      const tempSchool = await createTestSchool()
      effectiveSchoolId = tempSchool.id
    } else {
      // 系统管理员绑定到平台学校
      effectiveSchoolId = PLATFORM_SCHOOL_ID
    }
  }

  // 创建 User（必须包含 schoolId）
  const userId = crypto.randomUUID()
  const user = await prisma.user.create({
    data: {
      id: userId,
      username: uniqueUsername,
      passwordHash,
      role,
      schoolId: effectiveSchoolId,
      status
    }
  })

  let teacherId: string | undefined
  let studentId: string | undefined
  let adminId: string | undefined

  // 根据 role 创建对应的关联记录
  // 注意：Teacher/Student/Admin 的主键是 id（等于 User.id）
  if (role === 'teacher' || role === 'school_principal') {
    const teacher = await prisma.teacher.create({
      data: {
        id: user.id,  // 主键 = User.id
        name: `Test ${role}`,
        schoolId: effectiveSchoolId,
        status: 'active'
      }
    })
    teacherId = teacher.id  // 返回 id 作为 "teacherId"
  } else if (role === 'student') {
    const student = await prisma.student.create({
      data: {
        id: user.id,  // 主键 = User.id
        name: `Test ${role}`,
        schoolId: effectiveSchoolId,
        rating,
        headTeacherId: headTeacherId || null
      }
    })
    studentId = student.id  // 返回 id 作为 "studentId"
  } else if (role === 'super_admin' || role === 'platform_admin') {
    const admin = await prisma.admin.create({
      data: {
        id: user.id,  // 主键 = User.id
        name: `Test ${role}`,
        schoolId: PLATFORM_SCHOOL_ID
      }
    })
    adminId = admin.id  // 返回 id 作为 "adminId"
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      passwordHash,
      role: user.role as UserRole,
      status: user.status,
      teacherId,
      studentId,
      adminId,
      schoolId: effectiveSchoolId
    },
    password,
    teacherId,
    studentId,
    adminId,
    schoolId: effectiveSchoolId
  }
}

/**
 * 创建测试学校
 */
export async function createTestSchool(options: { name?: string; principalTeacherId?: string } = {}) {
  const { name, principalTeacherId } = options
  const uniqueName = name || `测试学校_${Date.now()}`

  // 如果没有提供 principalTeacherId，创建一个教师作为负责人
  let teacherId = principalTeacherId

  if (!teacherId) {
    // 创建学校时需要先创建负责人用户，再创建学校
    // 循环依赖：User.schoolId → School, School.currentPrincipalTeacherId → Teacher.id (= User.id)
    // 暂时禁用 FK 约束检查

    const tempSchoolId = `school-temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const tempUserId = `user-temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await prisma.$transaction(async (tx) => {
      // 暂时禁用 FK 约束检查（解决循环依赖）
      await tx.$executeRaw`SET session_replication_role = replica`

      // 1. 创建临时用户（绑定到学校）
      await tx.$executeRaw`
        INSERT INTO "User" (id, username, "passwordHash", role, "schoolId", status, "updatedAt")
        VALUES (${tempUserId}, ${`principal_temp_${Math.random().toString(36).slice(2, 8)}`}, 'placeholder', 'teacher', ${tempSchoolId}, 'active', NOW())
      `

      // 2. 创建临时教师（Teacher 主键是 id = User.id）
      await tx.$executeRaw`
        INSERT INTO "Teacher" (id, name, "schoolId", status, "updatedAt")
        VALUES (${tempUserId}, '临时负责人', ${tempSchoolId}, 'active', NOW())
      `

      // 3. 创建学校（currentPrincipalTeacherId 指向 Teacher.id）
      await tx.$executeRaw`
        INSERT INTO "School" (id, name, "currentPrincipalTeacherId", status, "updatedAt")
        VALUES (${tempSchoolId}, ${uniqueName}, ${tempUserId}, 'active', NOW())
      `

      // 重新启用 FK 约束检查
      await tx.$executeRaw`SET session_replication_role = origin`
    })

    const tempSchool = await prisma.school.findUnique({ where: { id: tempSchoolId } })
    return tempSchool!
  }

  const schoolId = `school-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const school = await prisma.school.create({
    data: {
      id: schoolId,
      name: uniqueName,
      currentPrincipalTeacherId: teacherId,
      status: 'active'
    }
  })

  // 更新教师的 schoolId
  await prisma.teacher.update({
    where: { id: teacherId },  // Teacher 主键是 id
    data: { schoolId: school.id }
  })

  // 更新教师用户的 schoolId（Teacher.id = User.id）
  await prisma.user.update({
    where: { id: teacherId },
    data: { schoolId: school.id }
  })

  return school
}

/**
 * 创建完整的测试学校（包含负责人）
 */
export async function createTestSchoolWithPrincipal(schoolName?: string) {
  const uniqueName = schoolName || `测试学校_${Date.now()}`
  const schoolId = `school-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // 先创建临时负责人用户（解决循环外键依赖）
  const tempUserId = `user-temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  await prisma.$transaction(async (tx) => {
    // 暂时禁用 FK 约束检查（解决循环依赖）
    await tx.$executeRaw`SET session_replication_role = replica`

    // 1. 创建临时用户（绑定到学校）
    await tx.$executeRaw`
      INSERT INTO "User" (id, username, "passwordHash", role, "schoolId", status, "updatedAt")
      VALUES (${tempUserId}, ${`principal_temp_${Math.random().toString(36).slice(2, 8)}`}, 'placeholder', 'teacher', ${schoolId}, 'active', NOW())
    `

    // 2. 创建临时教师（Teacher 主键是 id = User.id）
    await tx.$executeRaw`
      INSERT INTO "Teacher" (id, name, "schoolId", status, "updatedAt")
      VALUES (${tempUserId}, '临时负责人', ${schoolId}, 'active', NOW())
    `

    // 3. 创建学校（currentPrincipalTeacherId 指向 Teacher.id）
    await tx.$executeRaw`
      INSERT INTO "School" (id, name, "currentPrincipalTeacherId", status, "updatedAt")
      VALUES (${schoolId}, ${uniqueName}, ${tempUserId}, 'active', NOW())
    `

    // 重新启用 FK 约束检查
    await tx.$executeRaw`SET session_replication_role = origin`
  })

  const school = await prisma.school.findUnique({ where: { id: schoolId } })

  // 创建真正的负责人用户
  const username = `principal_${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await bcrypt.hash('principal123456', 10)
  const userId = crypto.randomUUID()

  const user = await prisma.user.create({
    data: {
      id: userId,
      username,
      passwordHash,
      role: 'school_principal',
      schoolId: school!.id,
      status: 'active'
    }
  })

  // 创建教师档案（Teacher 主键是 id）
  const teacher = await prisma.teacher.create({
    data: {
      id: user.id,  // 主键 = User.id
      name: '学校负责人',
      schoolId: school!.id,
      status: 'active'
    }
  })

  // 更新学校的负责人
  await prisma.school.update({
    where: { id: school!.id },
    data: { currentPrincipalTeacherId: user.id }
  })

  return {
    school: school!,
    principal: {
      userId: user.id,
      teacherId: teacher.id,  // Teacher.id = User.id
      username: user.username
    }
  }
}

/**
 * 创建测试团队
 */
export async function createTestTeam(options: {
  name?: string
  schoolId: string
  ownerId?: string
  isPublic?: boolean
} = { schoolId: '' }) {
  const { name, schoolId, ownerId, isPublic = true } = options
  const uniqueName = name || `测试团队_${Date.now()}`

  const team = await prisma.team.create({
    data: {
      id: `team_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: uniqueName,
      schoolId,
      isPublic
    }
  })

  // 如果提供了 ownerId，创建所有者成员记录
  if (ownerId) {
    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: ownerId,
        userType: 'teacher',
        role: 'owner',
        status: 'active',
        joinedAt: new Date()
      }
    })
  }

  return team
}