import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // SQLite 不支持并发写入，测试必须串行执行
    // 否则多个测试文件同时清理/写入 test.db 会产生 FK 错误
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/types/**',
        'src/index.ts'
      ]
    },
    // setup-env.ts 必须在 setup.ts 之前加载
    // 它设置 DATABASE_URL，确保 prisma 连接测试数据库而非开发数据库
    setupFiles: ['./tests/setup-env.ts', './tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
