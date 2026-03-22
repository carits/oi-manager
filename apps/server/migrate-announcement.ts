import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== 迁移 description 到 announcement ===')

  // 先读取现有数据
  const schools = await prisma.$queryRaw`SELECT id, description FROM School WHERE description IS NOT NULL`
  console.log('找到学校数据:', schools)

  // 添加新列
  await prisma.$executeRaw`ALTER TABLE School ADD COLUMN announcement TEXT`
  console.log('已添加 announcement 列')

  // 复制数据
  await prisma.$executeRaw`UPDATE School SET announcement = description WHERE description IS NOT NULL`
  console.log('已复制数据到 announcement')

  // 删除旧列
  await prisma.$executeRaw`ALTER TABLE School DROP COLUMN description`
  console.log('已删除 description 列')

  console.log('\n迁移完成！')

  await prisma.$disconnect()
}

main()
