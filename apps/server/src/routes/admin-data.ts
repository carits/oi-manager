/**
 * 管理员数据维护 API
 *
 * 替代直接操作数据库的脚本，所有数据修复/清理操作必须通过此 API 进行。
 * 仅限 super_admin 和 platform_admin 访问。
 */
import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'

export const adminDataRouter = Router()

// 所有路由需要管理员权限
adminDataRouter.use(authenticate)

// 权限检查中间件
adminDataRouter.use((req: any, res, next) => {
  if (!['super_admin', 'platform_admin'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: '需要管理员权限' })
  }
  next()
})

/**
 * GET /api/admin/data/submission-stats
 * 查询提交统计（只读）
 */
adminDataRouter.get('/submission-stats', async (req, res) => {
  try {
    const [
      total,
      carits,
      caritsNoRemoteId,
      trainingSubmissions,
      byResult,
    ] = await Promise.all([
      prisma.submission.count(),
      prisma.submission.count({ where: { oj: 'carits' } }),
      prisma.submission.count({ where: { oj: 'carits', ojRemoteId: null } }),
      prisma.submission.count({ where: { submitSource: 'training' } }),
      prisma.submission.groupBy({
        by: ['result'],
        _count: true,
        orderBy: { _count: { result: 'desc' } },
        take: 20,
      }),
    ])

    res.json({
      success: true,
      data: {
        total,
        carits,
        caritsNoRemoteId,
        trainingSubmissions,
        byResult: byResult.map(r => ({ result: r.result, count: r._count })),
      },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

/**
 * POST /api/admin/data/fix-carits-remote-id
 * 修复 Carits 提交缺失的 ojRemoteId
 */
adminDataRouter.post('/fix-carits-remote-id', async (req, res) => {
  try {
    const submissions = await prisma.submission.findMany({
      where: { oj: 'carits', ojRemoteId: null },
      select: { id: true },
    })

    if (submissions.length === 0) {
      return res.json({ success: true, data: { updated: 0, message: '无需修复' } })
    }

    let updated = 0
    for (const sub of submissions) {
      await prisma.submission.update({
        where: { id: sub.id },
        data: { ojRemoteId: sub.id.toString() },
      })
      updated++
    }

    res.json({
      success: true,
      data: { updated, message: `已修复 ${updated} 条记录` },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

/**
 * POST /api/admin/data/fix-hdu-memory
 * 修复 HDU 提交缺失的 memoryUsed
 */
adminDataRouter.post('/fix-hdu-memory', async (req, res) => {
  try {
    const { defaultKB = 1280 } = req.body

    const submissions = await prisma.submission.findMany({
      where: { oj: 'hdu', memoryUsed: null, result: { not: 'queuing' } },
      select: { id: true },
    })

    if (submissions.length === 0) {
      return res.json({ success: true, data: { updated: 0, message: '无需修复' } })
    }

    const result = await prisma.submission.updateMany({
      where: { id: { in: submissions.map(s => s.id) } },
      data: { memoryUsed: defaultKB },
    })

    res.json({
      success: true,
      data: { updated: result.count, message: `已修复 ${result.count} 条记录` },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

/**
 * POST /api/admin/data/clean-training-submissions
 * 清理指定训练的评测提交
 */
adminDataRouter.post('/clean-training-submissions', async (req, res) => {
  try {
    const { trainingId } = req.body
    if (!trainingId) {
      return res.status(400).json({ success: false, message: '缺少 trainingId' })
    }

    const result = await prisma.submission.deleteMany({
      where: { submitSource: 'training', sourceId: `training-${trainingId}` },
    })

    res.json({
      success: true,
      data: { deleted: result.count, message: `已删除 ${result.count} 条提交` },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

/**
 * POST /api/admin/data/reset-user-password
 * 重置用户密码
 */
adminDataRouter.post('/reset-user-password', async (req, res) => {
  try {
    const { userId, newPassword } = req.body
    if (!userId || !newPassword) {
      return res.status(400).json({ success: false, message: '缺少 userId 或 newPassword' })
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '密码至少 6 位' })
    }

    const bcrypt = await import('bcryptjs')
    const passwordHash = await bcrypt.hash(newPassword, 10)

    const user = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: { id: true, username: true },
    })

    res.json({
      success: true,
      data: { userId: user.id, username: user.username, message: '密码已重置' },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

/**
 * POST /api/admin/data/backfill-training-participants
 * 补录训练参与者数据
 *
 * 为所有现有训练补录参与者记录。
 * 对每个训练，查找其所属团队的活跃学生成员，写入 TrainingParticipant。
 * 已存在的记录会跳过（skipDuplicates）。
 *
 * Body (optional):
 *   trainingId: number — 只补录指定训练（不传则补录所有训练）
 */
adminDataRouter.post('/backfill-training-participants', async (req, res) => {
  try {
    const { trainingId } = req.body

    const trainings = await prisma.training.findMany({
      where: trainingId ? { id: trainingId } : {},
      select: { id: true, teamId: true, title: true },
    })

    if (trainings.length === 0) {
      return res.status(404).json({ success: false, message: '没有找到训练' })
    }

    let totalCreated = 0
    const details: { trainingId: number; title: string; created: number }[] = []

    for (const t of trainings) {
      const studentMembers = await prisma.teamMember.findMany({
        where: { teamId: t.teamId, userType: 'student', status: 'active' },
        select: { userId: true },
      })

      if (studentMembers.length === 0) {
        details.push({ trainingId: t.id, title: t.title, created: 0 })
        continue
      }

      const result = await prisma.trainingParticipant.createMany({
        data: studentMembers.map(m => ({
          trainingId: t.id,
          userId: m.userId,
          userType: 'student',
        })),
        skipDuplicates: true,
      })

      totalCreated += result.count
      details.push({ trainingId: t.id, title: t.title, created: result.count })
    }

    res.json({
      success: true,
      data: {
        totalTrainings: trainings.length,
        totalCreated,
        details,
      },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})
