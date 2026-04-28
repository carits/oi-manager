/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

/**
 * 修复现有 Carits 训练提交的 ojRemoteId 字段
 *
 * 将 oj='carits' 且 submitSource='training' 且 ojRemoteId 为空的提交记录
 * 设置 ojRemoteId = submission.id.toString()
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== 修复 Carits 训练提交的 ojRemoteId ===\n')

  // 查询需要修复的记录
  const submissions = await prisma.submission.findMany({
    where: {
      oj: 'carits',
      submitSource: 'training',
      ojRemoteId: null,
    },
    select: { id: true },
  })

  console.log(`找到 ${submissions.length} 条需要修复的记录`)

  if (submissions.length === 0) {
    console.log('无需修复')
    return
  }

  // 逐条更新（Prisma 不支持直接用 id 更新 ojRemoteId）
  let updated = 0
  for (const sub of submissions) {
    await prisma.submission.update({
      where: { id: sub.id },
      data: { ojRemoteId: sub.id.toString() },
    })
    updated++
  }

  console.log(`已更新 ${updated} 条记录`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
