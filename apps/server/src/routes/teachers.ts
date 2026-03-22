import { Router, Response } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { prisma } from '../prisma.js'

export const teacherRouter = Router()

// 获取当前登录教师信息
teacherRouter.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId

    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        title: true,
        schoolId: true,
        school: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    if (!teacher) {
      return res.status(404).json({ success: false, message: '教师信息不存在' })
    }

    res.json({ success: true, data: teacher })
  } catch (error) {
    console.error('Get current teacher error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新教师状态（启用/禁用）- 仅学校负责人可用
teacherRouter.put('/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { status } = req.body
    const user = req.user!

    // 验证状态值
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态值' })
    }

    // 获取教师信息
    const teacher = await prisma.teacher.findUnique({
      where: { id },
      include: { school: true }
    })

    if (!teacher) {
      return res.status(404).json({ success: false, message: '教师不存在' })
    }

    // 权限检查：只有学校负责人可以操作
    if (user.role !== 'super_admin' && user.role !== 'platform_admin') {
      if (user.teacherId !== teacher.school?.currentPrincipalTeacherId) {
        return res.status(403).json({ success: false, message: '只有学校负责人可以操作' })
      }
    }

    // 不能禁用自己
    if (user.teacherId === id && status === 'disabled') {
      return res.status(400).json({ success: false, message: '不能禁用自己的账号' })
    }

    // 更新用户状态
    await prisma.user.update({
      where: { id: teacher.userId },
      data: { status }
    })

    res.json({ success: true, message: status === 'active' ? '已启用' : '已禁用' })
  } catch (error) {
    console.error('Update teacher status error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 删除教师 - 仅学校负责人和超管可用
teacherRouter.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const user = req.user!

    // 获取教师信息
    const teacher = await prisma.teacher.findUnique({
      where: { id },
      include: { school: true }
    })

    if (!teacher) {
      return res.status(404).json({ success: false, message: '教师不存在' })
    }

    // 权限检查：只有学校负责人和超管可以操作
    if (user.role !== 'super_admin' && user.role !== 'platform_admin') {
      if (user.teacherId !== teacher.school?.currentPrincipalTeacherId) {
        return res.status(403).json({ success: false, message: '只有学校负责人可以删除教师' })
      }
    }

    // 不能删除自己
    if (user.teacherId === id) {
      return res.status(400).json({ success: false, message: '不能删除自己的账号' })
    }

    // 在删除教师前，处理其作为团队所有者的情况
    await handleTeacherOwnerDeletion(id, teacher.schoolId)

    // 删除教师（级联删除会处理关联数据）
    await prisma.teacher.delete({ where: { id } })

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('Delete teacher error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 处理教师作为所有者被删除时的团队所有权转移
async function handleTeacherOwnerDeletion(teacherId: string, schoolId: string | null) {
  // 查找该教师作为所有者的所有团队
  const ownedTeams = await prisma.teamMember.findMany({
    where: { userId: teacherId, userType: 'teacher', role: 'owner' },
    include: { team: true }
  })

  for (const ownerMember of ownedTeams) {
    const teamId = ownerMember.teamId

    // 教师所有者被删除 → 转移给学校负责人
    if (schoolId) {
      const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { currentPrincipalTeacherId: true, name: true }
      })

      if (school?.currentPrincipalTeacherId && school.currentPrincipalTeacherId !== teacherId) {
        // 检查学校负责人是否已经是团队成员
        let principalMember = await prisma.teamMember.findUnique({
          where: {
            teamId_userId_userType: {
              teamId,
              userId: school.currentPrincipalTeacherId,
              userType: 'teacher'
            }
          }
        })

        await prisma.$transaction(async (tx) => {
          if (principalMember) {
            // 学校负责人已是成员，更新为 owner
            await tx.teamMember.update({
              where: { id: principalMember!.id },
              data: { role: 'owner' }
            })
          } else {
            // 学校负责人不是成员，创建 owner 记录
            principalMember = await tx.teamMember.create({
              data: {
                teamId,
                userId: school.currentPrincipalTeacherId,
                userType: 'teacher',
                role: 'owner',
                status: 'active',
                joinedAt: new Date()
              }
            })
          }

          // 将原所有者改为普通成员
          await tx.teamMember.update({
            where: { id: ownerMember.id },
            data: { role: 'member' }
          })

          // 更新团队表（owner 信息现在通过 TeamMember 查询，无需更新 Team 表）
        })

        console.log(`团队 ${ownerMember.team.name} 所有权已转移给学校负责人`)
        continue
      }
    }

    // 无学校负责人或学校负责人是被删除的教师，尝试转移给其他成员
    const members = await prisma.teamMember.findMany({
      where: {
        teamId,
        status: 'active',
        id: { not: ownerMember.id }
      },
      orderBy: [
        { role: 'asc' },
        { userType: 'asc' }
      ]
    })

    const teacherAdmin = members.find(m => m.userType === 'teacher' && m.role === 'admin')
    const studentAdmin = members.find(m => m.userType === 'student' && m.role === 'admin')
    const teacherMember = members.find(m => m.userType === 'teacher' && m.role === 'member')
    const studentMember = members.find(m => m.userType === 'student' && m.role === 'member')

    const newOwner = teacherAdmin || studentAdmin || teacherMember || studentMember

    if (newOwner) {
      await prisma.$transaction([
        prisma.teamMember.update({
          where: { id: ownerMember.id },
          data: { role: 'member' }
        }),
        prisma.teamMember.update({
          where: { id: newOwner.id },
          data: { role: 'owner' }
        })
      ])
      console.log(`团队 ${ownerMember.team.name} 所有权已转移给${newOwner.userType === 'teacher' ? '教师' : '学生'}`)
    } else {
      // 团队无其他成员，解散团队
      await prisma.team.delete({ where: { id: teamId } })
      console.log(`团队 ${ownerMember.team.name} 已解散（无其他成员）`)
    }
  }
}
