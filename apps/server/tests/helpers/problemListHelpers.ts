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
      Sections: {
        create: { title: '默认章节', sortOrder: 0 }
      }
    },
    include: { Sections: true }
  })

  return { list, defaultSection: list.Sections[0] }
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
 */
export async function createTestProblem(options: {
  platform?: string
  problemId?: string
  title?: string
  ownerId?: string
}) {
  const { platform = 'carits', problemId = `P${Date.now()}`, title = '测试题目', ownerId = 'system' } = options

  return prisma.problem.create({
    data: {
      platform,
      problemId,
      title,
      ownerId,
      visibility: 'public',
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
