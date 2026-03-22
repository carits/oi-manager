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
