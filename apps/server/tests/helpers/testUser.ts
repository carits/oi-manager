import { prisma } from '../../src/prisma'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { UserRole, JwtPayload } from '../../../../packages/shared/src'

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
  }
  password: string
  teacherId?: string
  studentId?: string
  adminId?: string
}

/**
 * 创建测试用户
 * 根据 role 自动创建对应的 Teacher/Student 记录
 */
export async function createTestUser(options: CreateTestUserOptions = {}): Promise<CreatedTestUser> {
  const { role = 'student', username, password = 'test123456', schoolId, status = 'active', headTeacherId, rating = 1200 } = options
  const uniqueUsername = username || `test_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  const passwordHash = await bcrypt.hash(password, 10)

  // 先创建 User
  const user = await prisma.user.create({
    data: {
      username: uniqueUsername,
      passwordHash,
      role,
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
        userId: user.id,
        name: `Test ${role}`,
        schoolId: schoolId || null,
        status: 'active'
      }
    })
    teacherId = teacher.id
  } else if (role === 'student') {
    const student = await prisma.student.create({
      data: {
        userId: user.id,
        name: `Test ${role}`,
        schoolId: schoolId || '',
        rating,
        headTeacherId: headTeacherId || null
      }
    })
    studentId = student.id
  } else if (role === 'super_admin' || role === 'platform_admin') {
    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        name: `Test ${role}`
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
      adminId
    },
    password,
    teacherId,
    studentId,
    adminId
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
    const { teacherId: newTeacherId } = await createTestUser({ role: 'teacher' })
    teacherId = newTeacherId!
  }

  const school = await prisma.school.create({
    data: {
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

  return school
}

/**
 * 创建完整的测试学校（包含负责人）
 */
export async function createTestSchoolWithPrincipal(schoolName?: string) {
  // 创建负责人教师
  const { user, teacherId } = await createTestUser({ role: 'school_principal' })

  // 创建学校
  const school = await createTestSchool({
    name: schoolName,
    principalTeacherId: teacherId
  })

  return {
    school,
    principal: {
      userId: user.id,
      teacherId: teacherId!,
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
      name: uniqueName,
      schoolId,
      isPublic
    }
  })

  // 如果提供了 ownerId，创建所有者成员记录
  if (ownerId) {
    await prisma.teamMember.create({
      data: {
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