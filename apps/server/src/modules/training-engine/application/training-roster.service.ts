import { prisma } from '../../../prisma'
import { TrainingEngineError } from '../training-engine.errors'

export type TrainingScope = { organizationId: string | null; teamId: string | null }
export type ParticipantTarget = 'team' | 'organization_students' | 'custom_students'

async function assertCanTargetWholeSchool(userId: string, organizationId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
  if (user?.role === 'super_admin' && user.status === 'active') return
  const principal = await prisma.organizationMembership.findFirst({
    where: { organizationId, userId, status: 'active', memberRole: 'school_principal' },
    select: { id: true },
  })
  if (!principal) throw new TrainingEngineError(403, 'TRAINING_SCHOOL_WIDE_FORBIDDEN', '只有学校负责人可以创建全校学生训练')
}

export async function eligibleTrainingParticipantIds(scope: TrainingScope) {
  if (scope.teamId) {
    return (await prisma.teamMember.findMany({
      where: { teamId: scope.teamId, status: 'active', userType: 'student' },
      select: { userId: true },
    })).map(item => item.userId)
  }
  if (scope.organizationId) {
    return (await prisma.organizationMembership.findMany({
      where: { organizationId: scope.organizationId, status: 'active', memberRole: 'student' },
      select: { userId: true },
    })).map(item => item.userId)
  }
  return []
}

export async function validateTrainingParticipantTarget(
  userId: string,
  scope: TrainingScope,
  participantTarget: string | undefined,
  requestedParticipantIds: string[],
) {
  if (scope.organizationId && !participantTarget) {
    throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_TARGET_REQUIRED', '校园训练必须明确选择团队学生、全校学生或自定义学生')
  }
  const target = (participantTarget || (scope.teamId ? 'team' : undefined)) as ParticipantTarget | undefined
  if (target === 'team' && !scope.teamId) throw new TrainingEngineError(422, 'TRAINING_TEAM_REQUIRED', '团队学生范围必须选择一个团队')
  if (target === 'organization_students') {
    if (!scope.organizationId || scope.teamId) throw new TrainingEngineError(422, 'TRAINING_SCHOOL_REQUIRED', '全校学生范围必须选择学校')
    await assertCanTargetWholeSchool(userId, scope.organizationId)
  }
  if (target === 'custom_students' && !requestedParticipantIds.length) {
    throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_REQUIRED', '自定义学生范围至少选择一名学生')
  }
  if (requestedParticipantIds.length) {
    const eligible = new Set(await eligibleTrainingParticipantIds(scope))
    if (requestedParticipantIds.some(participantId => !eligible.has(participantId))) {
      throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_OUT_OF_SCOPE', '名单中包含不属于当前训练范围的学生')
    }
  }
  return target
}
