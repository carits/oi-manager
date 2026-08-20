/**
 * Training Ranking Routes
 * 训练排名路由
 */

import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { isAcceptedResult } from '../../lib/result-enum'
import {
  canAccessTraining,
  canManageTraining,
  parseTrainingId,
  getParticipantNames,
  requireTrainingStarted,
} from './training.helpers'

export const trainingRankingRouter = Router()

/**
 * GET /api/trainings/:id/ranking
 * 获取排名数据
 */
trainingRankingRouter.get('/trainings/:id/ranking', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({
      where: { id },
      include: {
        TrainingProblem: { orderBy: { orderIndex: 'asc' }, select: { id: true, problemId: true, alias: true, points: true, orderIndex: true, Problem: { select: { problemId: true } } } },
      },
    })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    // 作业排名只给管理员查看，普通学生不公开作业排名。
    const isAdminUser = await canManageTraining(userId, training)
    if (training.type === 'homework' && !isAdminUser) {
      return res.status(403).json({ success: false, message: '只有管理员可以查看作业排名' })
    }

    // OI 赛制：赛中非管理员不显示排名
    const nowRank = Date.now()
    const rankStatus = training.status === 'finished' ? 'finished'
      : (training.status === 'ongoing' || nowRank >= training.startTime.getTime() && nowRank <= training.endTime.getTime()) ? 'ongoing'
      : 'upcoming'
    if (training.format === 'oi' && rankStatus !== 'finished' && !isAdminUser) {
      return res.json({ success: true, data: { format: 'oi', problems: [], ranking: [], hidden: true } })
    }

    // 收集不计入排名的管理者；他们的提交也不能参与 ICPC 首 A 判定。
    let adminUserIds: string[] = []
    if (!training.includeAdminInRanking) {
      if (training.teamId) {
        const adminMembers = await prisma.teamMember.findMany({
          where: {
            teamId: training.teamId,
            status: 'active',
            role: { in: ['owner', 'admin'] },
          },
          select: { userId: true },
        })

        // TeamMember.userId 本身就是 User.id（共享主键设计）
        adminUserIds = adminMembers.map(m => m.userId)
      } else if (training.organizationId) {
        const [organizationAdmins, platformAdmins] = await Promise.all([
          prisma.organizationMembership.findMany({
            where: { organizationId: training.organizationId, status: 'active', memberRole: 'school_principal' },
            select: { userId: true },
          }),
          prisma.user.findMany({
            where: { role: { in: ['super_admin', 'platform_admin'] } },
            select: { id: true },
          }),
        ])
        adminUserIds = [...new Set([training.createdBy, ...organizationAdmins.map(member => member.userId), ...platformAdmins.map(user => user.id)])]
      }
    }

    const problems = training.TrainingProblem
    const trainingStartTime = training.startTime

    if (training.format === 'ioi' || training.format === 'oi') {
      // IOI: SQL aggregation for max score per (userId, problemId)
      // Exclude admin submissions
      const adminFilter = adminUserIds.length > 0
        ? Prisma.sql`AND "userId" NOT IN (${Prisma.join(adminUserIds)})`
        : Prisma.empty

      // Determine submitScope based on training type
      const submitScopeValue = training.type === 'contest' ? 'contest' : 'training'

      const aggregated: Array<{
        userId: string
        problemId: string
        maxScore: number
        lastSubmitAt: Date
      }> = await prisma.$queryRaw`
        SELECT
          "userId",
          "problemId",
          MAX(score) as "maxScore",
          MAX("createdAt") as "lastSubmitAt"
        FROM "Submission"
        WHERE "submitScope" = ${submitScopeValue}
          AND "trainingId" = ${id}
          AND result NOT IN ('queuing', 'judging', 'pending_review')
          AND result <> ''
          AND COALESCE(score, 0) = (
            SELECT MAX(COALESCE(s2.score, 0)) FROM "Submission" s2
            WHERE s2."userId" = "Submission"."userId"
              AND s2."problemId" = "Submission"."problemId"
              AND s2."submitScope" = ${submitScopeValue}
              AND s2."trainingId" = ${id}
              AND s2.result NOT IN ('queuing', 'judging', 'pending_review')
              AND s2.result <> ''
          )
          ${adminFilter}
        GROUP BY "userId", "problemId"
      `

      // Build per-user aggregation in JS from the much smaller result set
      const userScores = new Map<string, Map<string, { maxScore: number; lastSubmitAt: Date }>>()
      for (const row of aggregated) {
        if (!userScores.has(row.userId)) userScores.set(row.userId, new Map())
        const score = Number(row.maxScore) || 0
        userScores.get(row.userId)!.set(row.problemId, { maxScore: score, lastSubmitAt: new Date(row.lastSubmitAt) })
      }

      // Get participant names (single query instead of 3)
      const participantIds = [...userScores.keys()]
      const nameMap = await getParticipantNames(participantIds, training.organizationId || undefined)

      const ranking = Array.from(userScores.entries()).map(([uid, problemScores]) => {
        let totalScore = 0
        const problemDetails: Record<string, { score: number; alias: string; submitted: boolean }> = {}
        let lastSubmitAt = new Date(0)

        for (const p of problems) {
          // Submission.problemId 存储的是 Problem.problemId（外部 ID），而非 Problem.id（UUID）
          // 所以需要用 p.Problem.problemId 来匹配
          const externalProblemId = p.Problem.problemId
          const ps = problemScores.get(externalProblemId)
          const score = ps?.maxScore ?? 0
          totalScore += score
          problemDetails[p.id] = { score, alias: p.alias ?? '', submitted: Boolean(ps) }
          if (ps && ps.lastSubmitAt > lastSubmitAt) lastSubmitAt = ps.lastSubmitAt
        }

        return {
          userId: uid,
          name: nameMap.get(uid)?.name || '未知',
          username: nameMap.get(uid)?.username || '',
          avatar: nameMap.get(uid)?.avatar || null,
          userType: nameMap.get(uid)?.userType || 'student',
          totalScore,
          lastSubmitAt: lastSubmitAt.toISOString(),
          problems: problemDetails,
        }
      })

      ranking.sort((a, b) => b.totalScore - a.totalScore || new Date(a.lastSubmitAt).getTime() - new Date(b.lastSubmitAt).getTime())
      res.json({ success: true, data: { format: training.format, problems: problems.map(p => ({ id: p.id, alias: p.alias, points: p.points, orderIndex: p.orderIndex })), ranking } })
    } else {
      // ICPC: Need per-submission data for penalty calculation (can't fully aggregate in SQL)
      // But we still filter admins at DB level and merge name queries
      const adminFilterWhere = adminUserIds.length > 0
        ? { NOT: { userId: { in: adminUserIds } } }
        : {}

      // Determine submitScope based on training type
      const submitScopeValue = training.type === 'contest' ? 'contest' : 'training'

      const submissions = await prisma.submission.findMany({
        where: {
          submitScope: submitScopeValue,
          trainingId: id,
          ...adminFilterWhere,
          result: { not: '' },
        },
        // 同一毫秒内按提交 ID 稳定排序，保证首 A 归属不会因数据库返回顺序变化。
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, userId: true, problemId: true, score: true, result: true, createdAt: true },
      })

      const userStats = new Map<string, Map<string, {
        solved: boolean
        penalty: number
        attempts: number
        acceptedAtMinutes: number | null
        submitted: boolean
      }>>()
      const firstAcceptedUserByProblem = new Map<string, string>()

      for (const sub of submissions) {
        if (!userStats.has(sub.userId)) userStats.set(sub.userId, new Map())
        const problemStats = userStats.get(sub.userId)!
        if (!problemStats.has(sub.problemId)) {
          problemStats.set(sub.problemId, {
            solved: false,
            penalty: 0,
            attempts: 0,
            acceptedAtMinutes: null,
            submitted: false,
          })
        }
        const stat = problemStats.get(sub.problemId)!

        if (stat.solved) continue

        stat.submitted = true
        if (sub.result === 'queuing' || sub.result === 'judging' || sub.result === 'pending_review') continue

        stat.attempts++
        // Submission.problemId stores Problem.problemId (external ID like '1005'), not Problem.id (UUID)
        if (isAcceptedResult(sub.result) || (sub.score ?? 0) >= (problems.find(p => p.Problem.problemId === sub.problemId)?.points ?? 100)) {
          stat.solved = true
          const timeDiff = (sub.createdAt.getTime() - trainingStartTime.getTime()) / 60000
          stat.acceptedAtMinutes = Math.max(0, Math.floor(timeDiff))
          stat.penalty = timeDiff + (stat.attempts - 1) * 20
          if (!firstAcceptedUserByProblem.has(sub.problemId)) {
            firstAcceptedUserByProblem.set(sub.problemId, sub.userId)
          }
        }
      }

      const participantIds = [...userStats.keys()]
      const nameMap = await getParticipantNames(participantIds, training.organizationId || undefined)

      const ranking = Array.from(userStats.entries()).map(([uid, problemStats]) => {
        let solvedCount = 0
        let totalPenalty = 0
        const problemDetails: Record<string, {
          solved: boolean
          penalty: number
          attempts: number
          acceptedAtMinutes: number | null
          alias: string
          isFirstAccepted: boolean
          submitted: boolean
        }> = {}

        for (const p of problems) {
          // Submission.problemId = Problem.problemId (external ID), TrainingProblem.problemId = Problem.id (UUID)
          // Must use p.Problem.problemId to match submission keys
          const ps = problemStats.get(p.Problem.problemId)
          const solved = ps?.solved ?? false
          const penalty = ps?.penalty ?? 0
          const attempts = ps?.attempts ?? 0
          const acceptedAtMinutes = ps?.acceptedAtMinutes ?? null
          if (solved) {
            solvedCount++
            totalPenalty += penalty
          }
          problemDetails[p.id] = {
            solved,
            penalty,
            attempts,
            acceptedAtMinutes,
            alias: p.alias ?? '',
            isFirstAccepted: solved && firstAcceptedUserByProblem.get(p.Problem.problemId) === uid,
            submitted: ps?.submitted ?? false,
          }
        }

        return {
          userId: uid,
          name: nameMap.get(uid)?.name || '未知',
          username: nameMap.get(uid)?.username || '',
          avatar: nameMap.get(uid)?.avatar || null,
          userType: nameMap.get(uid)?.userType || 'student',
          solvedCount,
          totalPenalty: Math.round(totalPenalty),
          problems: problemDetails,
        }
      })

      ranking.sort((a, b) => b.solvedCount - a.solvedCount || a.totalPenalty - b.totalPenalty)
      res.json({ success: true, data: { format: 'icpc', problems: problems.map(p => ({ id: p.id, alias: p.alias, points: p.points, orderIndex: p.orderIndex })), ranking } })
    }
}, '查询失败'))
