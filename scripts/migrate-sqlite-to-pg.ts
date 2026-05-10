/**
 * SQLite → PostgreSQL 数据迁移脚本
 *
 * 使用方法:
 * 1. 先启动 PostgreSQL: docker compose up -d db
 * 2. 先用旧的 SQLite schema 执行 prisma generate
 * 3. 运行此脚本: npx tsx scripts/migrate-sqlite-to-pg.ts
 * 4. 切换 schema.prisma provider 为 postgresql
 * 5. 执行 prisma migrate deploy
 *
 * 此脚本从 SQLite 读取数据，按依赖顺序写入 PostgreSQL。
 */

import { PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'
import path from 'path'

// SQLite 源（旧数据库）
const sqlitePath = path.join(__dirname, '../apps/server/prisma/dev.db')
const sqlite = new Database(sqlitePath, { readonly: true })

// PostgreSQL 目标
const pg = new PrismaClient({
  datasourceUrl: process.env.PG_DATABASE_URL || 'postgresql://oi:oi_password@localhost:5432/oi_manager?schema=public',
})

// 按依赖顺序排列的表
const TABLES_IN_ORDER = [
  'User',
  'Admin',
  'School',
  'Teacher',
  'Student',
  'Team',
  'TeamMember',
  'TeamJoinRequest',
  'TeamOperationLog',
  'Contest',
  'ContestProblem',
  'ContestProblemScore',
  'ContestResource',
  'ContestResult',
  'Milestone',
  'Problem',
  'ProblemAttachment',
  'ProblemNote',
  'ProblemStatement',
  'TestdataFile',
  'ProblemList',
  'ProblemListSection',
  'ProblemListEntry',
  'ProblemListShare',
  'SchoolProblemList',
  'TeamProblemList',
  'File',
  'LoginLog',
  'PasswordResetLog',
  'PrincipalTransferLog',
  'UserStatusLog',
  'UserPlatformBinding',
  'OjPlatformConfig',
  'OjFetchJob',
  'OjAccount',
  'Submission',
  'Training',
  'TrainingProblem',
  'TrainingParticipant',
  'TrainingSubmission',
  'TrainingAttachment',
  'TrainingSolution',
  'TeamMemberExternalAccount',
  'TeamMemberImportBatch',
  'TeamMemberImportItem',
  'AiUsageLog',
]

async function main() {
  console.log('Starting SQLite → PostgreSQL migration...\n')

  let totalRows = 0

  for (const table of TABLES_IN_ORDER) {
    try {
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, any>[]
      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows (skipped)`)
        continue
      }

      console.log(`  ${table}: ${rows.length} rows...`)

      // 使用 raw SQL 批量插入
      for (const row of rows) {
        const columns = Object.keys(row)
        const values = Object.values(row)
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        const colNames = columns.map(c => `"${c}"`).join(', ')

        const sql = `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
        await pg.$executeRawUnsafe(sql, ...values)
      }

      totalRows += rows.length
      console.log(`  ${table}: done`)
    } catch (err: any) {
      console.log(`  ${table}: skipped (${err.message})`)
    }
  }

  console.log(`\nMigration complete. Total rows: ${totalRows}`)
}

main()
  .catch(console.error)
  .finally(async () => {
    sqlite.close()
    await pg.$disconnect()
  })
