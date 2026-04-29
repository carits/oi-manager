import { describe, it, expect } from 'vitest'
import { prisma } from '../src/prisma'

/**
 * userId 统一迁移验证测试
 *
 * 验证数据库中 userId 相关字段的一致性：
 * - Teacher.id === User.id（主键一致性）
 * - Student.id === User.id（主键一致性）
 * - Admin.id === User.id（主键一致性）
 * - TeamMember.userId 在 User 表中存在
 * - TeamOperationLog.operatorId 在 User 表中存在
 * - Milestone.studentId/teacherId 在 User 表中存在
 * - TeamJoinRequest.userId 在 Student 表中存在
 */
describe('userId 数据一致性验证', () => {
  it('Teacher.id 应全部匹配 User.id', async () => {
    const orphanedTeachers = await prisma.$queryRaw<{ id: string }[]>`
      SELECT t."id" FROM "Teacher" t
      LEFT JOIN "User" u ON t."id" = u.id
      WHERE u.id IS NULL
    `
    expect(orphanedTeachers.length).toBe(0)
  })

  it('Student.id 应全部匹配 User.id', async () => {
    const orphanedStudents = await prisma.$queryRaw<{ id: string }[]>`
      SELECT s."id" FROM "Student" s
      LEFT JOIN "User" u ON s."id" = u.id
      WHERE u.id IS NULL
    `
    expect(orphanedStudents.length).toBe(0)
  })

  it('Admin.id 应全部匹配 User.id', async () => {
    const orphanedAdmins = await prisma.$queryRaw<{ id: string }[]>`
      SELECT a."id" FROM "Admin" a
      LEFT JOIN "User" u ON a."id" = u.id
      WHERE u.id IS NULL
    `
    expect(orphanedAdmins.length).toBe(0)
  })

  it('TeamMember.userId 应全部匹配 User.id', async () => {
    const orphanedTeamMembers = await prisma.$queryRaw<{ userId: string }[]>`
      SELECT tm."userId" FROM "TeamMember" tm
      LEFT JOIN "User" u ON tm."userId" = u.id
      WHERE u.id IS NULL
    `
    expect(orphanedTeamMembers.length).toBe(0)
  })

  it('TeamOperationLog.operatorId 应全部匹配 User.id', async () => {
    const orphanedLogs = await prisma.$queryRaw<{ operatorId: string }[]>`
      SELECT tol."operatorId" FROM "TeamOperationLog" tol
      LEFT JOIN "User" u ON tol."operatorId" = u.id
      WHERE u.id IS NULL
    `
    expect(orphanedLogs.length).toBe(0)
  })

  it('Milestone.studentId 应全部匹配 User.id', async () => {
    const orphanedStudentMilestones = await prisma.$queryRaw<{ studentId: string }[]>`
      SELECT m."studentId" FROM "Milestone" m
      LEFT JOIN "User" u ON m."studentId" = u.id
      WHERE u.id IS NULL
    `
    expect(orphanedStudentMilestones.length).toBe(0)
  })

  it('Milestone.teacherId 应全部匹配 User.id', async () => {
    const orphanedTeacherMilestones = await prisma.$queryRaw<{ teacherId: string }[]>`
      SELECT m."teacherId" FROM "Milestone" m
      LEFT JOIN "User" u ON m."teacherId" = u.id
      WHERE u.id IS NULL
    `
    expect(orphanedTeacherMilestones.length).toBe(0)
  })

  it('TeamJoinRequest.userId 应在 Student 表中存在', async () => {
    const orphanedRequests = await prisma.$queryRaw<{ userId: string }[]>`
      SELECT tjr."userId" FROM "TeamJoinRequest" tjr
      LEFT JOIN "Student" s ON tjr."userId" = s.id
      WHERE s.id IS NULL
    `
    expect(orphanedRequests.length).toBe(0)
  })
})