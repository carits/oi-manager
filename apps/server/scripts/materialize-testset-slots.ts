import 'dotenv/config'
import { prisma } from '../src/prisma'
import { materializeCurrentTestSetSlots } from '../src/modules/problem/problem.testset-slot.service'

async function main() {
  const problemId = process.argv[2]?.trim() || undefined
  const result = await materializeCurrentTestSetSlots(problemId)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

main()
  .catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
