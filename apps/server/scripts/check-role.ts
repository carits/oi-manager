/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 恢复 admin 为 super_admin
  await prisma.user.update({
    where: { username: 'admin' },
    data: { role: 'super_admin' }
  })
  console.log('admin role restored to super_admin')
  await prisma.$disconnect()
}

main()
