import dotenv from 'dotenv'
import path from 'node:path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function main() {
  const enforce = process.argv.includes('--enforce')
  const [{ inspectContestAggregateMigration }, { prisma }] = await Promise.all([
    import('../src/modules/maintenance/application/contest-aggregate-migration.service'),
    import('../src/prisma'),
  ])

  try {
    const report = await inspectContestAggregateMigration()
    const violations = [
      ...(report.alreadyMapped !== report.total
        ? [`canonical mappings: ${report.alreadyMapped}/${report.total}`]
        : []),
      ...(report.migratable > 0 ? [`migratable runtimes: ${report.migratable}`] : []),
      ...(report.blocked > 0 ? [`blocked runtimes: ${report.blocked}`] : []),
      ...(report.ratingIdentity.missing > 0
        ? [`rating rows missing canonical contest identity: ${report.ratingIdentity.missing}`]
        : []),
      ...(report.ratingIdentity.mismatched > 0
        ? [`rating rows with mismatched runtime identity: ${report.ratingIdentity.mismatched}`]
        : []),
    ]

    console.log(JSON.stringify({
      ...report,
      status: violations.length ? 'inconsistent' : 'consistent',
      violations,
    }, null, 2))
    if (enforce && violations.length) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
