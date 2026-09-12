import { prisma } from '../../../prisma'
import { getComputedTrainingStatus, sortTrainingListForDisplay } from '../../training/training.helpers'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import { listContestRuntimesForDashboard } from '../../contest/contest-query.facade'

export interface DashboardActor {
  userId: string
  membershipType: string
  resourceScope: 'campus' | 'personal'
  organizationId?: string | null
}

function formatTraining(training: any, source: 'team' | 'school' | 'platform') {
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

async function currentTeamIds(actor: DashboardActor) {
  const memberships = await prisma.teamMember.findMany({
    where: {
      userId: actor.userId,
      userType: actor.membershipType,
      status: 'active',
      Team: { scope: actor.resourceScope },
    },
    select: { teamId: true },
  })
  return memberships.map(membership => membership.teamId)
}

export async function listMyHomeworks(actor: DashboardActor) {
  const teamIds = await currentTeamIds(actor)
  if (teamIds.length === 0) return []
  const trainings = await prisma.training.findMany({
    where: { teamId: { in: teamIds }, type: 'homework', scope: 'campus' },
    orderBy: { startTime: 'desc' },
    include: { _count: { select: { TrainingProblem: true } } },
  })
  return trainings.map(training => formatTraining(training, 'team'))
}

export async function listMyContests(actor: DashboardActor) {
  const teamIds = await currentTeamIds(actor)
  const contests = await listContestRuntimesForDashboard({
    teamIds,
    resourceScope: actor.resourceScope,
    organizationId: actor.organizationId,
  })
  return sortTrainingListForDisplay(contests.map(training => formatTraining(
    training,
    training.teamId ? 'team' : training.scope === 'platform' ? 'platform' : 'school',
  )))
}

export async function getMyPersonalOverview(actor: DashboardActor) {
  const teamIds = await currentTeamIds(actor)
  const profile = await prisma.personalProfile.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId },
    update: {},
    include: { User: { select: { username: true, avatar: true } } },
  })
  const [invitations, contests, submissions, higherRated] = await Promise.all([
    prisma.teamMember.findMany({
      where: { userId: actor.userId, userType: 'user', status: 'pending', Team: { scope: 'personal' } },
      select: {
        id: true,
        joinedAt: true,
        Team: { select: { id: true, name: true, avatar: true, isPublic: true } },
      },
      orderBy: { joinedAt: 'desc' },
      take: 5,
    }),
    listContestRuntimesForDashboard({
      teamIds,
      resourceScope: 'personal',
      organizationId: null,
    }).then(rows => rows
      .sort((left, right) => right.startTime.getTime() - left.startTime.getTime())
      .slice(0, 5)
      .map(({ id, title, startTime, endTime, status, teamId, scope }) => ({
        id, title, startTime, endTime, status, teamId, scope,
      }))),
    prisma.submission.findMany({
      where: { userId: actor.userId, workspaceScope: 'personal' },
      select: {
        id: true, oj: true, problemId: true, result: true, score: true, createdAt: true,
        CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.personalProfile.count({ where: { rating: { gt: profile.rating }, User: { status: 'active' } } }),
  ])
  return {
    profile: { username: profile.User.username, avatar: profile.User.avatar, rating: profile.rating, rank: higherRated + 1 },
    invitations: invitations.map(invitation => ({ id: invitation.id, invitedAt: invitation.joinedAt, team: invitation.Team })),
    contests,
    submissions: submissions.map(projectSubmissionJudgeResult),
  }
}
