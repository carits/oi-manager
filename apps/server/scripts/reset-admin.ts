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
