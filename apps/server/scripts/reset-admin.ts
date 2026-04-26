/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('123456', 10)
  await prisma.user.update({
    where: { username: 'admin' },
    data: { passwordHash: hash }
  })
  console.log('Password reset to 123456')
  await prisma.$disconnect()
}

main()
