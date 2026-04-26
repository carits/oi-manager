/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 查找所有没有联系方式的教师
  const teachersWithoutContact = await prisma.teacher.findMany({
    where: {
      AND: [
        { email: null },
        { phone: null }
      ]
    }
  })

  console.log(`找到 ${teachersWithoutContact.length} 个没有联系方式的教师`)

  // 为每个教师添加随机邮箱
  for (const teacher of teachersWithoutContact) {
    const randomEmail = `${teacher.name.toLowerCase().replace(/\s+/g, '_')}_${Math.random().toString(36).substring(2, 8)}@example.com`

    await prisma.teacher.update({
      where: { id: teacher.id },
      data: { email: randomEmail }
    })

    console.log(`为教师 ${teacher.name} 添加邮箱: ${randomEmail}`)
  }

  console.log('完成！')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
