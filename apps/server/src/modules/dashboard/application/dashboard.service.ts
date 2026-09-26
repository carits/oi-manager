import { prisma } from '../../../prisma'
import { getComputedContestStatus, sortContestListForDisplay } from '../../contest/contest.helpers'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import { listContestsForDashboard } from '../../contest/contest-query.facade'

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
    status: getComputedContestStatus(training),
    format: training.format,
    teamId: training.teamId,
    organizationId: training.organizationId,
    problemCount: training._count.ContestProblem,
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
      Team: {
        scope: actor.resourceScope,
        ...(actor.resourceScope === 'campus'
          ? { organizationId: actor.organizationId || '__missing_organization__' }
          : { organizationId: null }),
      },
    },
    select: { teamId: true },
  })
  return memberships.map(membership => membership.teamId)
}

export async function listMyHomeworks(actor: DashboardActor) {
  const teamIds = await currentTeamIds(actor)
  if (teamIds.length === 0) return []
  const assignments = await prisma.assignment.findMany({
    where: { teamId: { in: teamIds }, status: { notIn: ['DRAFT', 'CANCELLED', 'ARCHIVED'] } },
    orderBy: { openAt: 'desc' },
    include: { _count: { select: { Problems: true } } },
  })
  return assignments.map(assignment => ({
    id: assignment.id,
    title: assignment.title,
    description: assignment.description,
    startTime: assignment.openAt,
    endTime: assignment.dueAt,
    status: assignment.status.toLowerCase(),
    format: 'assignment',
    teamId: assignment.teamId,
    organizationId: assignment.organizationId,
    problemCount: assignment._count.Problems,
    source: 'team' as const,
    createdAt: assignment.createdAt,
  }))
}

export async function listMyContests(actor: DashboardActor) {
  const teamIds = await currentTeamIds(actor)
  const contests = await listContestsForDashboard({
    teamIds,
    resourceScope: actor.resourceScope,
    organizationId: actor.organizationId,
  })
  return sortContestListForDisplay(contests.map(training => formatTraining(
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
    listContestsForDashboard({
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
        id: true, oj: true, problemId: true, createdAt: true,
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
