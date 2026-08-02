import { prisma } from '../../src/prisma'
import { CreatedTestUser } from './testUser'

/**
 * 创建测试题单（含默认章节）
 */
export async function createTestProblemList(options: {
  ownerId: string
  schoolId?: string | null
  title?: string
  ownerType?: 'teacher' | 'student'
}) {
  const { ownerId, schoolId = null, title = '测试题单', ownerType = 'teacher' } = options

  const list = await prisma.problemList.create({
    data: {
      id: await generateListId(),
      title,
      ownerId,
      ownerType,
      schoolId,
      ProblemListSection: {
        create: { id: crypto.randomUUID(), title: '默认章节', sortOrder: 0 }
      }
    },
    include: { ProblemListSection: true }
  })

  return { list, defaultSection: list.ProblemListSection[0] }
}

/**
 * 分享测试题单给指定用户
 */
export async function shareTestProblemList(options: {
  problemListId: string
  targetType: 'teacher' | 'student'
  targetId: string
  permission: 'view' | 'edit'
  sharedBy: string
}) {
  return prisma.problemListShare.create({
    data: {
      id: crypto.randomUUID(),
      problemListId: options.problemListId,
      targetType: options.targetType,
      targetId: options.targetId,
      permission: options.permission,
      sharedBy: options.sharedBy,
    }
  })
}

/**
 * 创建测试题目（用于条目测试）
 *
 * Carits 平台题号必须是纯数字，使用 Date.now() 保证唯一。
 * 非 Carits 平台无此限制。
 */
let testProblemCounter = 900000

export async function createTestProblem(options: {
  platform?: string
  problemId?: string
  title?: string
  ownerId?: string
}) {
  const { platform = 'carits', problemId, title = '测试题目', ownerId = 'system' } = options

  const actualProblemId = problemId || (
    platform === 'carits'
      ? String(++testProblemCounter)
      : `P${Date.now()}`
  )

  return prisma.problem.create({
    data: {
      id: `prob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      platform,
      problemId: actualProblemId,
      title,
      ownerId,
      visibility: 'public',
      libraryScope: 'platform',
      libraryKey: 'platform',
      status: 'published',
      publishedAt: new Date(),
      statementType: 'none',
      solutionType: 'none',
    }
  })
}

/**
 * 生成题单 ID（与后端一致）
 */
async function generateListId(length = 7): Promise<string> {
  const min = Math.pow(10, length - 1)
  const max = Math.pow(10, length) - 1
  let id = String(min + Math.floor(Math.random() * (max - min + 1)))
  while (await prisma.problemList.findUnique({ where: { id } })) {
    length++
    id = await generateListId(length)
  }
  return id
}
