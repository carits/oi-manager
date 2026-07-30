# OI-MANAGER-V2 默认协作规则

## 零、绝对红线（违反即严重事故）

### 禁止删除/重置数据库

**绝对禁止使用以下任何命令或操作：**

- `prisma db push --force-reset`
- `prisma migrate reset`
- `DROP DATABASE` / `DROP TABLE` / `TRUNCATE`
- `docker-compose down -v` / `docker compose down -v`（`-v` 会删除 volume）
- 任何会清空或删除生产/开发数据库的操作

**2026-04-17 事故**：使用 `--force-reset` 导致生产数据库全部数据丢失（评测记录、OJ账号、训练等），无法恢复。

Schema 变更只用 `prisma db push`（安全增量更新）。如果需要新字段，先加 `@default` 再 push，永远不需要重置。

**自动备份已配置**：每天凌晨3点自动备份到 `backups/`，保留7天。恢复命令：`gunzip -c backups/oi_manager_时间戳.sql.gz | docker exec -i oi-postgres psql -U oi -d oi_manager`

### 禁止直接操作数据库（必须走 API）

**所有数据操作必须通过 API 进行，禁止脚本直接读写数据库。**

**禁止的操作：**
- 在 `scripts/` 目录下编写直接使用 `prisma.*.create/update/delete` 的脚本
- 使用 `npx tsx scripts/xxx.ts` 直接修改数据库数据
- 使用 `npx prisma studio` 手动修改生产数据

**允许的操作：**
- 通过 API 调用（`fetch`、`apiClient`、`curl`）进行数据操作
- 只读脚本（查询、统计、验证）可以直接访问数据库
- 数据库迁移脚本（`prisma migrate`）用于 schema 变更

**原因：**
1. API 层有权限校验、业务逻辑验证、日志记录
2. 直接操作数据库容易绕过业务规则，导致数据不一致
3. 操作可追溯，便于审计和问题排查

**如果需要批量操作数据：**
1. 先创建对应的 API 端点（通常是 `POST /api/admin/xxx` 形式）
2. 在 API 中实现权限校验和业务逻辑
3. 脚本通过 HTTP 调用 API 执行操作

**现有违规脚本**（已标记为废弃，仅供参考）：
- `scripts/fix-*.ts` — 数据修复脚本
- `scripts/migrate-*.ts` — 数据迁移脚本
- `scripts/generate-icpc-test-data.ts` — 测试数据生成
- `scripts/clean-icpc-test-data.ts` — 测试数据清理

---

## 一、启动时默认加载的项目文档

### 1. 必读文档（优先加载）
@docs/README.md
@docs/STATUS.md
@docs/guide/PROJECT_OVERVIEW.md
@docs/guide/PROJECT_TOUR.md
@docs/architecture/SYSTEM_OVERVIEW.md

### 2. 按需加载文档
- 涉及数据库结构、数据关系、Prisma 模型时：
  @docs/architecture/DATA_MODEL.md
  @docs/reference/DATABASE_SCHEMA.md

- 涉及接口开发、接口联调、权限边界时：
  @docs/reference/api/README.md
  @docs/reference/FIELD_CONTRACTS.md
  @docs/reference/api/
  @docs/architecture/AUTHORIZATION.md

- 涉及前端页面、组件、hooks、模块入口时：
  @docs/development/FRONTEND.md
  @docs/reference/WEB_ROUTES.md
  @docs/architecture/modules/

- 涉及前端样式、设计 token、颜色/圆角/阴影规范时：
  @docs/development/DESIGN_SYSTEM.md

- 涉及启动、环境变量、本地调试、部署排查时：
  @docs/operations/RUNBOOK.md
  @docs/operations/ENVIRONMENTS.md

- 涉及测试、编写测试用例、测试数据库时：
  @docs/development/TESTING.md
  @docs/development/UI_E2E.md

- 涉及业务流程、调用链、数据流时：
  @docs/guide/PROJECT_TOUR.md

- 涉及历史决策、设计取舍时：
  @docs/archive/README.md

- 不明确的目录、模块、职责边界时：
  优先查阅 @docs/architecture/SYSTEM_OVERVIEW.md 和 @docs/guide/PROJECT_TOUR.md
  不要仅凭目录名称做假设

---

## 二、处理任务时的基本要求

### 1. 开始修改前必须先确认
- 当前任务目标是什么
- 本次改动影响哪些模块
- 当前真实运行中的前端、后端目录分别是什么
- 是否涉及权限、会话、接口、数据库、资源 URL、环境变量
- 是否已有相关历史说明、已知问题、技术债记录

### 2. 优先遵循“先理解，后修改”
- 修改前先阅读相关实现与文档，不要凭空重写
- 优先定位真实调用链：页面入口 → hook/client → API route / server route → 数据表
- 如果发现文档与代码不一致，需在输出中明确指出，不要默认文档一定正确

### 3. 优先做最小必要修改
- 优先局部修复，不做无关大重构
- 只有在现有结构明显导致问题反复出现时，才提出结构性优化
- 若需结构性优化，先说明原因、范围、风险，再实施

### 4. 涉及以下高风险区域时必须格外谨慎
- 登录态 / JWT / userId / teacherId / studentId / schoolId 相关逻辑
- “我的数据”类接口（如 `view=mine`）
- 会话切换、缓存失效、旧请求覆盖新状态
- 数据库结构、Prisma schema、迁移脚本
- 请求层统一、代理层、资源 URL 拼接
- 目录职责边界不清的区域（尤其存在历史遗留代码时）
- **Prisma 查询**：关联字段名必须大写（见 `docs/reference/FIELD_CONTRACTS.md`）

### 5. 默认排查顺序
遇到功能异常时，优先按以下顺序排查：
1. 当前任务文档与上下文
2. 页面入口和调用链
3. 请求参数、鉴权头、当前身份
4. 后端 route / service / 查询逻辑
5. 数据模型与表结构
6. 是否属于已知问题或历史遗留结构导致

---

## 三、完成任务前必须检查

### 1. 必须同步更新状态与变更记录
- 当前事实发生变化时更新 `docs/STATUS.md`
- 对外行为或工程流程变化时追加 `docs/CHANGELOG.md`
- 运行 `pnpm docs:check`

### 2. 必须检查是否需要同步更新文档
若本次改动影响以下任一内容，必须同步更新相应文档：
- 项目结构、目录职责、真实运行链路 → `docs/architecture/SYSTEM_OVERVIEW.md`
- 启动方式、环境变量、调试流程 → `docs/operations/RUNBOOK.md`
- 权限、身份、JWT、角色关系 → `docs/architecture/AUTHORIZATION.md`
- 模块入口、核心文件、状态说明 → `docs/guide/PROJECT_TOUR.md` 与 `docs/architecture/modules/`
- 已知问题、技术债、风险提示 → `docs/STATUS.md`
- 关键背景、架构决策 → `docs/guide/PROJECT_OVERVIEW.md` 与对应架构文档

### 3. 不允许在以下情况下直接结束任务
- 当前事实变化却没有更新 `docs/STATUS.md`
- 对外行为变化却没有追加 `docs/CHANGELOG.md`
- 没有运行 `pnpm docs:check`
- 改了结构/接口/权限/环境变量却没有检查文档是否需要同步
- 发现文档与代码不一致却未说明
- 留下“待确认”信息却没有在输出中明确列出

---

## 四、文件修改原则

### 1. 修改原则
- 优先最小必要修改
- 先理解现有实现，再动代码
- 不因局部任务顺手大面积改风格或重命名
- 新增约定、目录说明、开发规范，优先补充到文档中
- 新的长期协作规范，优先更新本文件

### 2. 文档原则
- 文档优先写“真实状态”，不要写成理想状态
- 无法确认的信息必须标注“待确认”
- 文档应服务于“接手、排查、恢复上下文”，而不是只做记录
- 若发现历史文档失效，不要静默跳过，应明确指出并建议修正

### 3. 输出原则
每次完成任务后，默认输出：
- 本次修改了哪些文件
- 每个文件解决了什么问题
- 是否同步更新了哪些文档
- 当前还存在的待确认信息或潜在风险
- 建议如何手工验收

---

## 五、默认协作思路

### 1. 接管视角优先
在上下文不完整时，先恢复项目理解，再做修改。
优先回答以下问题：
- 这个项目当前真实结构是什么
- 这次任务改的是哪条链路
- 改动会影响哪些角色、权限、数据、页面
- 是否会引入回归风险

### 2. 模块定位优先
如果任务涉及具体模块，先定位：
- 页面入口
- 主要组件
- 主要 hooks / client
- 后端路由
- 数据表 / Prisma 模型
- 相关文档位置

### 3. 风险最小化优先
对不确定的区域：
- 先查文档
- 先查调用链
- 先说明不确定点
- 不要在未确认真实运行链路前做大改

---

## 六、文档维护约定

### 1. `docs/README.md`
作为唯一入口，维护面向开发、架构、测试、运维和接口查阅的阅读路径。

### 2. `docs/STATUS.md`
只记录当前可验证事实、开发阶段、验证快照和已知限制，不充当临时任务看板。

### 3. `docs/CHANGELOG.md`
从 2026-07 起记录安全、工程流程和用户可见行为变化；完整旧记录保留在归档。

### 4. 活动文档元数据
活动文档必须维护 `status`、`audience`、`last_verified` 和 `source_of_truth`；历史文档必须标记 `archived`。

---

## 七、特别提醒

- 不要默认所有目录都是当前真实运行代码，先确认再修改
- 不要默认 `mine`、`me`、`current user` 这类逻辑天然安全，先确认身份来源
- 不要默认前端看到的状态就是当前真实状态，注意旧请求、旧缓存、旧会话污染
- 不要默认文档与代码总是同步，发现偏差要明确指出

### Prisma 查询规范（必须遵守）

**关联字段名必须大写**，否则会报 500 错误：

```typescript
// 错误 ❌ - 导致 500
include: { teacher: true, student: true }
select: { school: true }
_count: { select: { teams: true } }

// 正确 ✅
include: { Teacher: true, Student: true }
select: { School: true }
_count: { select: { Team: true } }
```

**访问关联对象也要大写**：

```typescript
// 错误 ❌ - 返回 undefined
const name = user.teacher?.name

// 正确 ✅
const name = user.Teacher?.name
```

**不直接返回原始 Prisma 对象**：

```typescript
// 错误 ❌ - 暴露大写关联字段，前端期望小写
res.json({ success: true, data: { profile: user.Teacher } })

// 正确 ✅ - 转换后返回
const profileData = { id: user.Teacher.id, name: user.Teacher.name }
res.json({ success: true, data: { profile: profileData } })
```

详细规范见：`docs/reference/FIELD_CONTRACTS.md`

### Teacher/Student/Admin ID 规范（必须遵守）

**核心事实**：`Teacher.id` = `Student.id` = `Admin.id` = `User.id`（共享主键）

**禁止使用的字段**：
- ❌ `teacher.userId` - Teacher 模型没有这个字段
- ❌ `student.userId` - Student 模型没有这个字段
- ❌ `admin.userId` - Admin 模型没有这个字段

**正确做法**：
```typescript
// ✅ Teacher.id 就是 User.id
const userId = teacher.id

// ✅ Student.id 就是 User.id
const userId = student.id

// ✅ Admin.id 就是 User.id
const userId = admin.id
```

**TeamMember.userId 说明**：
- 存储 `Teacher.id` 或 `Student.id`
- 由于共享主键，`TeamMember.userId` = `User.id`
- 可以直接用于过滤 `Submission.userId`

---

## 八、后端代码目录结构

```
apps/server/src/
├── index.ts           # 后端入口文件（Express 应用配置、路由注册）
├── prisma.ts          # Prisma 客户端导出
│
├── config/            # 配置文件
│   ├── env.ts         # 环境变量校验
│   └── cors.ts        # CORS 动态配置
│
├── lib/               # 工具函数
│   ├── logger.ts      # 统一日志模块（结构化日志）
│   ├── jwtSecret.ts   # JWT Secret 统一获取
│   ├── auth.ts        # 认证工具函数（密码哈希等）
│   ├── grade.ts       # 年级计算工具
│   ├── regionData.ts  # 区域数据
│   ├── api.ts         # API 辅助函数
│   ├── pagination.ts  # 分页解析 + 响应生成
│   ├── asyncHandler.ts # 异步路由错误处理
│   ├── zodValidate.ts # zod 校验中间件
│   └── storage.ts     # 文件存储服务
│
├── middleware/        # Express 中间件
│   ├── auth.ts        # 认证中间件（authenticate, authorize）
│   ├── permissions.ts # 权限检查函数（canManageStudent 等）
│   ├── rateLimiter.ts # 速率限制中间件
│   └── requestLogger.ts # 请求追踪中间件（requestId）
│
├── modules/           # 业务模块（分层架构）
│   └── team/          # 团队模块
│       ├── team.types.ts      # 类型定义
│       ├── team.utils.ts      # 工具函数
│       ├── team.repository.ts # 数据访问层
│       ├── team.service.ts    # 业务逻辑层
│       ├── team.routes.ts     # 路由挂载入口
│       ├── team.crud.routes.ts    # 团队 CRUD 路由
│       ├── team.members.routes.ts # 成员管理路由
│       ├── team.invitations.routes.ts # 邀请处理路由
│       ├── team.requests.routes.ts    # 申请处理路由
│       └── schemas/
│           └── team.schemas.ts # zod 校验 schema
│
├── oj-adapters/       # OJ 平台适配器
│   ├── index.ts       # 适配器注册和导出
│   ├── types.ts       # 类型定义（OjPlatform, OjProblem 等）
│   └── luogu.ts       # 洛谷适配器
│
└── routes/            # API 路由
    ├── auth.ts        # 认证相关（登录、注册、/me）
    ├── users.ts       # 用户管理
    ├── schools.ts     # 学校管理
    ├── teachers.ts    # 教师管理
    ├── students.ts    # 学生管理
    ├── teams.ts       # 团队管理（重导出到 modules/team）
    ├── problems.ts    # 题目管理
    ├── oj-fetcher.ts  # OJ 拉取队列
    ├── milestones.ts  # 里程碑
    └── stats.ts       # 统计数据
```

### 模块分层规范

新模块建议采用分层架构（参考 `modules/team/`）：

1. **types.ts** - 类型定义（DTO、响应类型、错误类型）
2. **utils.ts** - 工具函数（数据转换、校验）
3. **repository.ts** - 数据访问层（Prisma 查询封装）
4. **service.ts** - 业务逻辑层（权限检查、业务规则）
5. **routes.ts** - 路由层（请求解析、响应格式化）

---

## 九、前端代码目录结构

```
apps/web/src/
├── app/               # 页面路由（Next.js App Router）
│   ├── admin/         # 超级管理员页面
│   ├── platform-admin/ # 平台管理员页面
│   ├── teacher/       # 教师端页面
│   ├── student/       # 学生端页面
│   ├── profile/       # 公开资料页面
│   └── login/         # 登录页面
│
├── components/        # React 组件
│   ├── ui/            # 通用 UI 组件（Button, Modal, Table, Card, Badge 等）
│   ├── business/      # 业务组件（RegionSelector 等）
│   ├── team/          # 团队相关组件
│   ├── training/      # 训练相关组件（TeamTrainingList, TrainingDetailPage 等）
│   ├── problem/       # 题目相关组件（ProblemDetail, ProblemForm, JudgeSettingsTab 等）
│   ├── submission/    # 评测记录组件（SubmissionList, SubmissionDetailPage 等）
│   ├── profile/       # 个人资料组件
│   ├── AppShell.tsx   # 应用外壳（导航布局）
│   ├── AuthProvider.tsx # 认证状态管理
│   └── Providers.tsx  # 全局 Provider 封装
│
├── hooks/             # 自定义 Hooks
│   ├── data/          # 数据获取 Hooks（useList, useTeams 等）
│   ├── form/          # 表单 Hooks（useForm, useModal）
│   └── actions/       # 操作 Hooks（useDelete, useToggleStatus）
│
├── lib/               # 工具函数
│   ├── apiClient.ts   # 统一 API 客户端（所有 API 调用必须使用）
│   ├── api.ts         # API 类定义
│   ├── auth.ts        # 认证工具函数
│   ├── assets.ts      # 资源 URL 辅助
│   ├── grade.ts       # 年级计算
│   ├── regionData.ts  # 区域数据
│   ├── tokens.ts      # 设计 token 常量（与 CSS 变量一一对应）
│   └── styles.ts      # 样式预设（表单、表格、卡片等场景样式）
│
└── config/            # 配置文件
    ├── navigation.ts  # 导航配置
    ├── env.ts         # 编译时环境变量
    └── runtime.ts     # 运行时配置
```

### 前端开发规范

1. **API 调用**：必须使用 `lib/apiClient.ts`，禁止直接使用 `fetch`
2. **状态管理**：使用 `AuthProvider` 管理全局登录状态
3. **样式**：使用内联样式 + CSS 变量，遵守设计 token 规范（见下方）
4. **路由**：使用 Next.js App Router（`app/` 目录）

### 设计 Token 规范（必须遵守）

**详细文档**: `docs/development/DESIGN_SYSTEM.md`

1. **颜色**：使用 `var(--xxx)` 或 `lib/tokens.ts` 导出，禁止硬编码 hex 值
   - 文字：`var(--text-primary)` / `var(--text-secondary)` / `var(--text-muted)`
   - 背景：`var(--bg-card)` / `var(--bg-hover)` / `var(--bg-muted)`
   - 语义色：`var(--success)` / `var(--error)` / `var(--warning)` / `var(--info)` 及 `-light`/`-text` 变体
2. **圆角**：使用 `var(--radius-sm/md/lg)`，禁止 `3px`、`12px` 等非标值
3. **字号**：使用 `var(--text-xs/sm/base/lg/xl/2xl)`
4. **阴影**：使用 `var(--shadow-xs/sm/md/lg)`
5. **按钮**：禁止渐变背景，使用纯色 `var(--primary)`
6. **例外**：图表调色板等数据可视化颜色允许硬编码

---

## 十、AI 翻译模块规则（必须遵守）

**当前模块文档**: `docs/architecture/modules/PROBLEMS_AND_OJ.md`

### 格式保护红线

翻译模块的核心原则：**格式保护高于一切**。以下内容在翻译过程中绝对不能被修改：

1. **代码块**（fenced / indented / inline）：字符、语言标记、缩进完全不变
2. **数学公式**（`$...$` / `$$...$$`）：LaTeX 内容和定界符完全不变
3. **样例输入输出**：每个字符完全不变
4. **URL**：完全不变
5. **文件名/路径**（`.in` / `.out` / `.cpp` 等）：完全不变
6. **HTML/XML 标签**：标签名和属性完全不变
7. **竞赛输出字面量**（`YES` / `NO` / `Alice` / `Bob` / `First` / `Second`）：完全不变
8. **Markdown 结构**（标题层级、列表层级、表格列数、空行）：完全不变

### 处理流程

不允许"整篇直接发给模型翻译"，，必须走保护流水线：

1. `protect()` — 提取危险片段 → 占位符
2. `splitter()` — 按段落分块（不切在代码/公式中间）
3. 逐块翻译（低温度，带重试）
4. `restore()` — 占位符还原（字节级一致）
5. `validate()` — 9 项结构校验
6. 失败降级：重试 → 缩小分块 → plain text → 标记人工审查

### 模块位置

`apps/server/src/lib/ai-translate/` — 所有翻译相关代码

### 测试要求

- 先写测试，再写实现
- 所有新功能都必须补 e2e case
- 只要出现格式损坏就算测试失败，不允许静默输出损坏结果

### 术语表

三级合并：用户自定义 > 项目配置 > 平台默认。详见 `glossary.ts`

---

## 十一、测试规范（必须遵守）

### 1. 测试数据库隔离（红线规则）

**测试必须且只能使用 PostgreSQL 的 `test` schema，绝对禁止影响开发 `public` schema。**

- 测试 schema：`postgresql://.../oi_manager?schema=test`
- UI E2E schema：`postgresql://.../oi_manager?schema=e2e`
- 开发 schema：`postgresql://.../oi_manager?schema=public`

**实现机制**（已配置，无需修改）：

1. `tests/setup-env.ts` — 在所有 import 之前设置 `DATABASE_URL`，由 vitest 作为第一个 setupFile 加载
2. `vitest.config.ts` — `setupFiles: ['./tests/setup-env.ts', './tests/setup.ts']`，顺序不可颠倒
3. `src/prisma.ts` — PrismaClient 单例在首次 import 时创建，setup-env.ts 确保在此之前 `DATABASE_URL` 已指向 `test` schema

**禁止事项**：
- 禁止在测试代码中直接修改 `process.env.DATABASE_URL`（由 setup-env.ts 统一管理）
- 禁止在测试文件中单独 new PrismaClient（必须从 `src/prisma.ts` 导入单例）
- 禁止在 `afterEach`/`afterAll` 中清理 `Problem` 表（题目是共享公共数据）

### 2. 测试文件结构

```
apps/server/tests/
├── setup-env.ts          # 环境变量设置（第一个加载）
├── setup.ts              # 数据库连接、afterEach 清理
├── vitest.config.ts      # vitest 配置
├── helpers/
│   ├── testRequest.ts    # Express 测试应用 + 认证请求
│   ├── testUser.ts       # 测试用户/学校/团队创建
│   ├── testToken.ts      # JWT Token 生成
│   └── problemListHelpers.ts  # 题单测试辅助
├── auth.test.ts
├── permissions.test.ts
├── teams.test.ts
├── transactions.test.ts
├── regression.test.ts
├── problem-lists.test.ts
└── ai-translate/         # 翻译模块测试
```

### 3. afterEach 数据清理规则

`setup.ts` 的 `afterEach` 会在每个测试后清理 `test` schema 中的数据，清理范围：

**会清理的表**（测试自己创建的数据）：
- ProblemListEntry, ProblemListSection, ProblemListShare, ProblemList
- TeamOperationLog, LoginLog, TaskItem
- ContestProblemScore, ContestResult, ContestProblem, ContestResource, Contest
- TeamMember, TeamJoinRequest, Team, Milestone
- Student, Teacher, PrincipalTransferLog, Admin, School, User

**不会清理的表**（共享公共数据）：
- Problem — 题目数据是全局共享的，不在测试中删除

### 4. 编写新测试的规范

1. 所有测试文件放在 `apps/server/tests/` 目录下
2. 使用 `createTestUser`、`createTestSchoolWithPrincipal` 等 helper 创建测试数据
3. 使用 `generateTestToken` / `generateTokenFromUser` 生成认证 Token
4. 使用 `createAuthenticatedRequest(app, token)` 发送带认证的 HTTP 请求
5. 测试中需要创建 Problem 时使用 `createTestProblem`（helper 中自动生成唯一 ID）
6. **禁止**在测试中 new PrismaClient，必须 `import { prisma } from '../src/prisma'`
7. **禁止**在 afterEach 之外写批量 DELETE SQL

### 5. 运行测试命令

```bash
cd apps/server

# 运行所有测试
npx vitest run

# 运行指定测试文件
npx vitest run tests/problem-lists.test.ts

# 运行并监听
npx vitest tests/problem-lists.test.ts
```

### 6. 测试数据库初始化

单元测试与 UI E2E 都使用 PostgreSQL 隔离 schema。数据库 URL 必须显式指向 `schema=test` 或 `schema=e2e`，不得复用开发 schema。

```bash
pnpm test
pnpm test:ui:smoke
```

详细测试文档：`docs/development/TESTING.md` 和 `docs/development/UI_E2E.md`
