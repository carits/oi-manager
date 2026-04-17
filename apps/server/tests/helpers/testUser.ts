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
  headTeacherId?: string
  rating?: number
}

interface CreatedTestUser {
  user: {
    id: string
    username: string
    passwordHash: string
    role: UserRole
    status: string
    teacherId?: string
    studentId?: string
    adminId?: string
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
  if (role === 'teacher' || role === 'school_principal') {
    const teacher = await prisma.teacher.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        name: `Test ${role}`,
        schoolId: effectiveSchoolId,
        status: 'active'
      }
    })
    teacherId = teacher.id
  } else if (role === 'student') {
    const student = await prisma.student.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        name: `Test ${role}`,
        schoolId: effectiveSchoolId,
        rating,
        headTeacherId: headTeacherId || null
      }
    })
    studentId = student.id
  } else if (role === 'super_admin' || role === 'platform_admin') {
    const admin = await prisma.admin.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        name: `Test ${role}`,
        schoolId: PLATFORM_SCHOOL_ID
      }
    })
    adminId = admin.id
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
  let teacherUserId: string | undefined

  if (!teacherId) {
    // 创建学校时需要先创建学校（临时负责人），再创建教师
    // 这里需要特殊处理以解决循环依赖

    // 临时方案：创建学校时使用占位 ID，然后创建教师并更新
    const tempSchoolId = `school-temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const tempSchool = await prisma.school.create({
      data: {
        id: tempSchoolId,
        name: uniqueName,
        currentPrincipalTeacherId: 'temp-placeholder',
        status: 'active'
      }
    })

    // 创建教师用户
    const tempUsername = `principal_${Math.random().toString(36).slice(2, 8)}`
    const tempPasswordHash = await bcrypt.hash('temp123456', 10)
    const tempUserId = crypto.randomUUID()
    const tempUser = await prisma.user.create({
      data: {
        id: tempUserId,
        username: tempUsername,
        passwordHash: tempPasswordHash,
        role: 'teacher',
        schoolId: tempSchool.id,
        status: 'active'
      }
    })

    const tempTeacherId = crypto.randomUUID()
    const tempTeacher = await prisma.teacher.create({
      data: {
        id: tempTeacherId,
        userId: tempUser.id,
        name: '临时负责人',
        schoolId: tempSchool.id,
        status: 'active'
      }
    })

    // 更新学校的负责人
    await prisma.school.update({
      where: { id: tempSchool.id },
      data: { currentPrincipalTeacherId: tempTeacher.id }
    })

    return tempSchool
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
    where: { id: teacherId },
    data: { schoolId: school.id }
  })

  // 更新教师用户的 schoolId
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } })
  if (teacher) {
    await prisma.user.update({
      where: { id: teacher.userId },
      data: { schoolId: school.id }
    })
  }

  return school
}

/**
 * 创建完整的测试学校（包含负责人）
 */
export async function createTestSchoolWithPrincipal(schoolName?: string) {
  const uniqueName = schoolName || `测试学校_${Date.now()}`
  const schoolId = `school-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // 先创建学校（临时负责人）
  const school = await prisma.school.create({
    data: {
      id: schoolId,
      name: uniqueName,
      currentPrincipalTeacherId: 'temp-placeholder',
      status: 'active'
    }
  })

  // 创建负责人用户（绑定到学校）
  const username = `principal_${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await bcrypt.hash('principal123456', 10)
  const userId = crypto.randomUUID()

  const user = await prisma.user.create({
    data: {
      id: userId,
      username,
      passwordHash,
      role: 'school_principal',
      schoolId: school.id,
      status: 'active'
    }
  })

  // 创建教师档案
  const teacherId = crypto.randomUUID()
  const teacher = await prisma.teacher.create({
    data: {
      id: teacherId,
      userId: user.id,
      name: '学校负责人',
      schoolId: school.id,
      status: 'active'
    }
  })

  // 更新学校的负责人
  await prisma.school.update({
    where: { id: school.id },
    data: { currentPrincipalTeacherId: teacher.id }
  })

  return {
    school,
    principal: {
      userId: user.id,
      teacherId: teacher.id,
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