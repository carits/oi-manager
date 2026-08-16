import { Router } from 'express'
import {
  authenticate,
  getMembershipType,
  getResourceScope,
  requireOrganizationContext,
  requirePersonalContext,
} from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { prisma } from '../prisma'
import { getComputedTrainingStatus, sortTrainingListForDisplay } from '../modules/training/training.helpers'

export const meRouter = Router()

function formatTraining(training: any, source: 'team' | 'school') {
  return {
    id: training.id,
    title: training.title,
    description: training.description,
    startTime: training.startTime,
    endTime: training.endTime,
    status: getComputedTrainingStatus(training),
    format: training.format,
    teamId: training.teamId,
    organizationId: training.organizationId,
    problemCount: training._count.TrainingProblem,
    source,
    createdAt: training.createdAt,
  }
}

async function getCurrentTeamIds(user: NonNullable<Express.Request['user']>) {
  const memberships = await prisma.teamMember.findMany({
    where: {
      userId: user.userId,
      userType: getMembershipType(user),
      status: 'active',
      Team: { scope: getResourceScope(user) },
    },
    select: { teamId: true },
  })
  return memberships.map(membership => membership.teamId)
}

meRouter.get(
  '/homeworks',
  authenticate,
  requireOrganizationContext,
  asyncHandler(async (req, res) => {
    const teamIds = await getCurrentTeamIds(req.user!)
    if (teamIds.length === 0) return res.json({ success: true, data: [] })

    const trainings = await prisma.training.findMany({
      where: { teamId: { in: teamIds }, type: 'homework', scope: 'campus' },
      orderBy: { startTime: 'desc' },
      include: { _count: { select: { TrainingProblem: true } } },
    })
    res.json({ success: true, data: trainings.map(training => formatTraining(training, 'team')) })
  }),
)

meRouter.get('/contests', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  const scope = getResourceScope(user)
  const teamIds = await getCurrentTeamIds(user)

  const [teamTrainings, schoolTrainings] = await Promise.all([
    teamIds.length > 0
      ? prisma.training.findMany({
          where: { teamId: { in: teamIds }, type: 'contest', scope },
          orderBy: { startTime: 'desc' },
          include: { _count: { select: { TrainingProblem: true } } },
        })
      : [],
    scope === 'campus' && user.organizationId
      ? prisma.training.findMany({
          where: { organizationId: user.organizationId, teamId: null, type: 'contest', scope: 'campus' },
          orderBy: { startTime: 'desc' },
          include: { _count: { select: { TrainingProblem: true } } },
        })
      : [],
  ])

  const data = [
    ...teamTrainings.map(training => formatTraining(training, 'team')),
    ...schoolTrainings.map(training => formatTraining(training, 'school')),
  ]

  res.json({
    success: true,
    data: sortTrainingListForDisplay(data),
  })
}))

meRouter.get(
  '/overview',
  authenticate,
  requirePersonalContext,
  asyncHandler(async (req, res) => {
    const user = req.user!
    const teamIds = await getCurrentTeamIds(user)
    const profile = await prisma.personalProfile.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId },
      update: {},
      include: { User: { select: { username: true, avatar: true } } },
    })

    const [invitations, contests, submissions, higherRated] = await Promise.all([
      prisma.teamMember.findMany({
        where: {
          userId: user.userId,
          userType: 'user',
          status: 'pending',
          Team: { scope: 'personal' },
        },
        select: {
          id: true,
          joinedAt: true,
          Team: { select: { id: true, name: true, avatar: true, isPublic: true } },
        },
        orderBy: { joinedAt: 'desc' },
        take: 5,
      }),
      teamIds.length > 0
        ? prisma.training.findMany({
            where: { teamId: { in: teamIds }, scope: 'personal', type: 'contest' },
            select: {
              id: true,
              title: true,
              startTime: true,
              endTime: true,
              status: true,
              teamId: true,
            },
            orderBy: { startTime: 'desc' },
            take: 5,
          })
        : [],
      prisma.submission.findMany({
        where: { userId: user.userId, workspaceScope: 'personal' },
        select: {
          id: true,
          oj: true,
          problemId: true,
          result: true,
          score: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.personalProfile.count({
        where: { rating: { gt: profile.rating }, User: { status: 'active' } },
      }),
    ])

    res.json({
      success: true,
      data: {
        profile: {
          username: profile.User.username,
          avatar: profile.User.avatar,
          rating: profile.rating,
          rank: higherRated + 1,
        },
        invitations: invitations.map(invitation => ({
          id: invitation.id,
          invitedAt: invitation.joinedAt,
          team: invitation.Team,
        })),
        contests,
        submissions,
      },
    })
  }),
)
