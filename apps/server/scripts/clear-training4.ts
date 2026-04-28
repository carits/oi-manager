/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

// 删除 training-4 的提交数据
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function clear() {
  const result = await prisma.submission.deleteMany({
    where: { sourceId: 'training-4' }
  })
  console.log('删除了', result.count, '条提交记录')
  await prisma.$disconnect()
}

clear().catch(console.error)
