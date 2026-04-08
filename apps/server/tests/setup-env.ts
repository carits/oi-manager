/**
 * This file MUST be loaded BEFORE any other setup files.
 * It sets environment variables that are needed at Prisma client
 * initialization time (which happens on import).
 *
 * Vitest loads setupFiles in order, so this file's side effects
 * execute before setup.ts imports prisma.
 */

// 使用测试数据库 — 必须在 prisma import 之前设置
process.env.DATABASE_URL = 'file:./prisma/test.db'
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-key-for-testing-only'
