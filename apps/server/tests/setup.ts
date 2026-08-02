import { beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../src/prisma'

const PLATFORM_SCHOOL_ID = 'platform-school-00000000'
const PLATFORM_PRINCIPAL_USER_ID = 'platform-principal-user-placeholder'

async function ensurePlatformFixture() {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET session_replication_role = replica`
    await tx.$executeRaw`
      INSERT INTO "User" (id, username, "passwordHash", role, "schoolId", "updatedAt")
      VALUES (${PLATFORM_PRINCIPAL_USER_ID}, 'platform_principal_placeholder', 'placeholder', 'teacher', ${PLATFORM_SCHOOL_ID}, NOW())
      ON CONFLICT (id) DO NOTHING
    `
    await tx.$executeRaw`
      INSERT INTO "Teacher" (id, name, "schoolId", "updatedAt")
      VALUES (${PLATFORM_PRINCIPAL_USER_ID}, '平台负责人', ${PLATFORM_SCHOOL_ID}, NOW())
      ON CONFLICT (id) DO NOTHING
    `
    await tx.$executeRaw`
      INSERT INTO "School" (id, name, "currentPrincipalTeacherId", "updatedAt")
      VALUES (${PLATFORM_SCHOOL_ID}, '平台学校', ${PLATFORM_PRINCIPAL_USER_ID}, NOW())
      ON CONFLICT (id) DO NOTHING
    `
    await tx.$executeRaw`SET session_replication_role = origin`
  })
}

beforeAll(async () => {
  await prisma.$connect()
  await ensurePlatformFixture()
})

afterEach(async () => {
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE table_record RECORD;
    BEGIN
      FOR table_record IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = current_schema()
          AND tablename <> '_prisma_migrations'
      LOOP
        EXECUTE format('TRUNCATE TABLE %I.%I CASCADE', current_schema(), table_record.tablename);
      END LOOP;
    END $$;
  `)
  await ensurePlatformFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})
