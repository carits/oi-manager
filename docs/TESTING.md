# 测试文档

> 最后更新: 2026-04-08

## 1. 概述

- **测试框架**: Vitest
- **HTTP 测试**: supertest
- **数据库**: SQLite（test.db，与开发数据库 PostgreSQL 完全隔离）
- **测试文件位置**: `apps/server/tests/`
- **注意**: 生产/开发环境已迁移到 PostgreSQL，但测试环境保持 SQLite 以确保隔离性和速度

## 2. 数据库隔离机制（核心）

### 2.1 为什么需要隔离

测试会在 afterEach 中清理数据库数据。如果测试连接到 dev.db，会导致生产数据被删除。

### 2.2 隔离实现

```
vitest.config.ts
  setupFiles: ['./tests/setup-env.ts', './tests/setup.ts']
                    ↓ 第一个加载              ↓ 第二个加载
              设置 DATABASE_URL        import prisma（此时 DATABASE_URL 已是 test.db）
              = 'file:./prisma/test.db'
```

**关键原理**：
- Vitest 按顺序加载 setupFiles
- `setup-env.ts` 只做一件事：设置 `process.env.DATABASE_URL = 'file:./prisma/test.db'`
- `setup.ts` import prisma 单例，此时 DATABASE_URL 已经指向 test.db
- PrismaClient 单例在首次 import 时创建，之后全局复用

### 2.3 文件说明

| 文件 | 职责 |
|------|------|
| `vitest.config.ts` | 配置 setupFiles 加载顺序 |
| `tests/setup-env.ts` | 设置测试环境变量（DATABASE_URL、JWT_SECRET） |
| `tests/setup.ts` | 数据库连接（beforeAll）、数据清理（afterEach）、断开连接（afterAll） |
| `src/prisma.ts` | PrismaClient 单例（测试和开发共用，通过 DATABASE_URL 区分连接的数据库） |

### 2.4 注意事项

- **不要**在 `setup-env.ts` 中 import 任何模块，只设置环境变量
- **不要**改变 `setupFiles` 的顺序
- **不要**在测试文件中 new PrismaClient
- **不要**在测试文件中修改 `process.env.DATABASE_URL`

## 3. 测试 Helper 详解

### 3.1 testRequest.ts — 测试应用

```typescript
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'

// 创建配置好所有路由的 Express 应用（不监听端口）
const app = createTestApp()

// 创建带认证的请求
const req = createAuthenticatedRequest(app, token)
await req.get('/api/xxx')
await req.post('/api/xxx').send(data)
await req.put('/api/xxx').send(data)
await req.delete('/api/xxx')
```

### 3.2 testUser.ts — 用户/学校/团队创建

```typescript
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'

// 创建测试用户（自动创建 User + Teacher/Student/Admin 记录）
const { user, password, teacherId, studentId, adminId } = await createTestUser({
  role: 'teacher',
  schoolId: 'xxx',
  status: 'active'
})

// 创建测试学校（自动创建负责人教师）
const { school, principal } = await createTestSchoolWithPrincipal('学校名')

// 创建测试团队
const team = await createTestTeam({ schoolId: 'xxx', ownerId: teacherId })
```

### 3.3 testToken.ts — Token 生成

```typescript
import { generateTestToken, generateTokenFromUser } from './helpers/testToken'

// 直接构造 payload 生成 token
const token = generateTestToken({
  userId: 'xxx',
  role: 'teacher',
  username: 'testuser',
  teacherId: 'xxx',
  schoolId: 'xxx'
})

// 从用户数据生成 token
const token = generateTokenFromUser({
  id: user.id,
  role: user.role,
  username: user.username,
  teacherId: teacher.id,
  schoolId: school.id
})
```

### 3.4 problemListHelpers.ts — 题单测试辅助

```typescript
import { createTestProblemList, shareTestProblemList, createTestProblem } from './helpers/problemListHelpers'

// 创建测试题单（含默认章节）
const { list, defaultSection } = await createTestProblemList({
  ownerId: user.id,
  schoolId: school.id
})

// 分享题单
await shareTestProblemList({
  problemListId: list.id,
  targetType: 'teacher',
  targetId: teacherId,
  permission: 'edit',
  sharedBy: ownerUser.id
})

// 创建测试题目
const problem = await createTestProblem({
  platform: 'carits',
  problemId: 'TEST_P123',
  ownerId: user.id
})
```

## 4. 数据清理策略

### 4.1 afterEach 清理

每个测试结束后，`setup.ts` 的 `afterEach` 会按依赖顺序清理以下表：

```
清理顺序（子表先删）：
1. ProblemListEntry      ← 题单条目
2. ProblemListSection    ← 题单章节
3. ProblemListShare      ← 题单分享
4. SchoolProblemList     ← 学校题单
5. TeamProblemList       ← 团队题单
6. ProblemList           ← 题单
5. TeamOperationLog      ← 团队操作日志
6. LoginLog              ← 登录日志
7. TaskItem              ← 任务项
8. ContestProblemScore   ← 比赛单题成绩
9. ContestResult         ← 比赛成绩
10. ContestProblem       ← 比赛题目
11. ContestResource      ← 比赛资源
12. Contest              ← 比赛
13. TeamMember           ← 团队成员
14. TeamJoinRequest      ← 加入申请
15. Team                 ← 团队
16. Milestone            ← 里程碑
17. Student              ← 学生
18. Teacher              ← 教师
19. PrincipalTransferLog ← 负责人转移日志
20. Admin                ← 管理员
21. School               ← 学校
22. User                 ← 用户
```

### 4.2 不清理的表

| 表 | 原因 |
|----|------|
| Problem | 题目数据是全局共享的，创建成本高，不应在测试中删除 |
| File | 文件存储数据，清理需配合文件系统操作 |

### 4.3 测试中的 Problem 处理

测试 helper `createTestProblem` 使用时间戳 + 随机后缀生成唯一 `problemId`，避免测试间冲突。这些测试题目会留在 test.db 的 Problem 表中，不会影响测试正确性。

## 5. 现有测试覆盖

### 5.1 认证模块 (auth.test.ts)

| 测试数 | 覆盖内容 |
|--------|---------|
| 15 | 登录成功/失败、禁用账号、角色端点校验、注册、/me、修改密码、修改资料 |

### 5.2 权限模块 (permissions.test.ts)

| 测试数 | 覆盖内容 |
|--------|---------|
| 18 | 学校访问/管理权限、学生查看/管理权限、教师查看/管理权限、团队查看/管理权限 |

### 5.3 团队模块 (teams.test.ts)

| 测试数 | 覆盖内容 |
|--------|---------|
| 11 | 团队创建、成员添加/移除、角色管理、权限转移、团队列表/详情、删除权限 |

### 5.4 事务模块 (transactions.test.ts)

| 测试数 | 覆盖内容 |
|--------|---------|
| 8 | 学校创建事务、学生创建事务、负责人转移、用户状态更新、团队创建 |

### 5.5 回归测试 (regression.test.ts)

| 测试数 | 覆盖内容 |
|--------|---------|
| 8 | 学生列表分页/筛选、学校列表/详情、教师列表、用户列表/筛选、排行榜 |

### 5.6 题单权限 (problem-lists.test.ts)

| 测试数 | 覆盖内容 |
|--------|---------|
| 43 | CRUD 权限（owner/edit/view/stranger）、章节操作权限、条目操作权限、分享管理权限、_permission 字段、乐观锁冲突 |

### 5.7 学校题单 & 团队题单 (school-team-problem-lists.test.ts)

| 测试数 | 覆盖内容 |
|--------|---------|
| 20 | 学校题单：列表查看、跨校拒绝、添加权限（owner 校验）、重复添加、删除权限（教师只能删自己、负责人可删所有）；团队题单：列表查看、owner/admin/教师添加、owner 校验、重复添加、删除权限（owner 可删所有、admin 只能删自己、admin 不能删他人） |

## 6. 编写新测试模板

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'

const app = createTestApp()

describe('新模块', () => {
  // 每个测试前创建需要的测试数据
  let schoolData: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>
  let ownerToken: string

  beforeEach(async () => {
    schoolData = await createTestSchoolWithPrincipal()
    ownerUser = await createTestUser({ role: 'teacher', schoolId: schoolData.school.id })
    ownerToken = generateTestToken({
      userId: ownerUser.user.id,
      role: 'teacher',
      username: ownerUser.user.username,
      teacherId: ownerUser.teacherId,
      schoolId: schoolData.school.id,
    })
  })

  it('应该正常工作', async () => {
    const res = await createAuthenticatedRequest(app, ownerToken)
      .get('/api/xxx')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
```

## 7. 全 UI E2E

Playwright 套件位于 `e2e/`，使用 PostgreSQL 的独立 `e2e` schema、`3100/3102`
端口和 `test-results/storage` 文件目录。准备脚本会拒绝 `public` 或未明确指定
`schema=e2e` 的数据库 URL。

```bash
pnpm test:ui:smoke
pnpm test:ui
pnpm test:ui:headed
pnpm test:ui:report
```

- `test:ui:smoke`：Chromium 与 Firefox 的登录、权限、导航和角色核心流程。
- `test:ui`：90 个页面路由、双桌面视口、核心业务、文件和模拟 Judge 全量回归。
- `test:ui:live`：仅手动运行的真实 OJ/Judge 连通性检查，需要仓库 Secrets。
- 失败证据写入 `test-results/`，包括 HTML/JSON、截图、视频、trace 和缺陷摘要。

环境变量模板见 `e2e/.env.example`。测试认证状态由登录 API 动态生成到
`e2e/.auth/`。准备脚本每次生成随机账号密码、JWT 密钥和 Judge 令牌，并以
`0600` 权限写入忽略的 `test-results/e2e-runtime.json`。不得提交认证状态、
运行时凭据或真实平台凭据。

## 8. 常见问题

### Q: 运行测试后 dev.db 数据丢失了

**检查**：
1. `vitest.config.ts` 的 setupFiles 顺序是否正确（setup-env.ts 必须在 setup.ts 之前）
2. 是否有测试文件直接 new PrismaClient 而不是 import 单例
3. 是否有测试文件修改了 process.env.DATABASE_URL

### Q: test.db 不存在

```bash
cd apps/server
cp prisma/dev.db prisma/test.db
```

### Q: 测试超时

vitest.config.ts 已设置 `testTimeout: 30000`（30秒）。如果单个测试需要更长时间：

```typescript
it('长时间测试', async () => {
  // ...
}, 60_000) // 毫秒
```

### Q: 如何只运行某个测试

```bash
# 运行单个文件
npx vitest run tests/problem-lists.test.ts

# 运行匹配名称的测试
npx vitest run -t "应该正常工作"
```

## 9. 变更日志

### 2026-04-08
- 创建测试文档
- 修复数据库隔离问题：新增 setup-env.ts 确保 test.db 隔离
- 移除 Problem 表从 afterEach 清理列表
- 从 seed.ts 移除 50 个随机测试团队
