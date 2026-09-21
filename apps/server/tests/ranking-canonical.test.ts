import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { getOrganizationRanking, getPersonalSolvedRanking } from '../src/modules/ranking/application/ranking.service'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'

async function createAcceptedSubmission(input: {
  userId: string
  workspaceScope: 'personal' | 'campus'
  organizationId?: string | null
  oj: string
  problemId: string
  problemInternalId?: string | null
}) {
  const submission = await prisma.submission.create({
    data: {
      userId: input.userId,
      oj: input.oj,
      problemId: input.problemId,
      problemInternalId: input.problemInternalId || null,
      language: 'cpp17',
      code: 'int main(){}',
      codeLength: 12,
      submitMethod: 'local',
      submitScope: 'problem',
      workspaceScope: input.workspaceScope,
      organizationId: input.organizationId || null,
    },
  })
  const runId = crypto.randomUUID()
  await prisma.judgeRun.create({
    data: {
      id: runId,
      submissionId: submission.id,
      runNumber: 1,
      runType: 'NORMAL',
      status: 'FINALIZED',
      result: 'accepted',
      score: 100,
      finalizedAt: new Date(),
    },
  })
  await prisma.submission.update({
    where: { id: submission.id },
    data: { currentJudgeRunId: runId },
  })
  return submission
}

describe('canonical solved rankings', () => {
  it('does not collapse equal external problem ids from different OJ platforms', async () => {
    const account = await createTestUser()
    await prisma.personalProfile.create({
      data: { userId: account.user.id, rating: 1200 },
    })

    await createAcceptedSubmission({
      userId: account.user.id,
      workspaceScope: 'personal',
      oj: 'codeforces',
      problemId: '1000A',
    })
    await createAcceptedSubmission({
      userId: account.user.id,
      workspaceScope: 'personal',
      oj: 'luogu',
      problemId: '1000A',
    })

    const ranking = await getPersonalSolvedRanking({ page: '1', pageSize: '50' })
    expect(ranking.items.find(item => item.id === account.user.id)).toMatchObject({ solvedCount: 2 })
  })

  it('counts accepted campus submissions by canonical workspace organization instead of legacy Training linkage', async () => {
    const { school } = await createTestSchoolWithPrincipal()
    const student = await createTestUser({
      organization: { role: 'student', organizationId: school.organizationId! },
    })

    await createAcceptedSubmission({
      userId: student.user.id,
      workspaceScope: 'campus',
      organizationId: school.organizationId!,
      oj: 'carits',
      problemId: 'DIRECT-CAMPUS-1',
    })

    const ranking = await getOrganizationRanking(school.organizationId!, 'solved', { page: '1', pageSize: '50' })
    expect(ranking.items.find(item => item.userId === student.user.id)).toMatchObject({ solvedCount: 1 })
  })

  it('does not count accepted submissions from another organization in the active campus ranking', async () => {
    const { school: schoolA } = await createTestSchoolWithPrincipal()
    const { school: schoolB } = await createTestSchoolWithPrincipal()
    const student = await createTestUser({
      organization: { role: 'student', organizationId: schoolA.organizationId! },
    })

    await createAcceptedSubmission({
      userId: student.user.id,
      workspaceScope: 'campus',
      organizationId: schoolB.organizationId!,
      oj: 'carits',
      problemId: 'OTHER-ORG-1',
    })

    const ranking = await getOrganizationRanking(schoolA.organizationId!, 'solved', { page: '1', pageSize: '50' })
    expect(ranking.items.find(item => item.userId === student.user.id)).toMatchObject({ solvedCount: 0 })
  })
})
