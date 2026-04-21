# 当前任务

## 任务：评测耗时计算修复 + strictMemoryLimit（2026-04-18）

状态: **已完成** ✅

### 问题

1. 评测耗时（timeUsed）计算错误：使用所有测试点耗时之和，应取最大值
2. go-judge 沙箱未启用 `strictMemoryLimit: true`，栈空间不计入内存限制
3. 创建题目时评测设置 tab 不可见
4. 评测记录题号点击：Carits 题目不可点击 + 点击后页面丢失

### 修改

1. **judge.ts** — `totalTime +=` → `maxTime = Math.max()`，6 处修改覆盖所有评测路径（普通/交互/通信）
2. **sandbox/client.ts** — 所有 go-judge API 调用添加 `strictMemoryLimit: true`
3. **ProblemForm.tsx** — 创建模式显示评测设置 tab + 保存后跳转到 judge_settings tab
4. **SubmissionList.tsx** — Carits 题号始终可点击 + 新窗口打开题目详情

### 验证

- TypeScript 编译通过（`npx tsc --noEmit` 无错误）
- 无残留 `totalTime` 引用
- 提交 23 验证：time=6ms（单点最大值，非求和）
- submissions 15-18：time 从 60-69ms 降为合理值

### 修改

**前端** `apps/web/src/components/training/TrainingEditPage.tsx`:
- 保存训练时新增步骤 5：调用 reorder API 重新排序所有题目
- 确保删除题目后 orderIndex 保持连续（0, 1, 2, 3...）

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/training/TrainingEditPage.tsx` | 新增 reorder 调用 |

### 验证

- TypeScript 编译通过

---

## 任务：提交详情弹窗移除分数列（2026-04-17）

状态: **已完成** ✅

### 问题

用户反馈"提及结果弹窗不需要分数"。`SubmissionDetailModal.tsx` 测试点表格显示了每个测试点的分数列，但用户不需要这个功能。

### 修改

**前端** `apps/web/src/components/submission/SubmissionDetailModal.tsx`:
- 移除 `getResultBadge()` 函数中的分数显示逻辑
- 移除表头"得分"列（从 5 列改为 4 列）
- 移除子任务标题行分数显示 + 子任务用例分数列
- 移除平铺用例分数列（无子任务时的显示）
- 移除未使用的变量：`cScore`、`stScore`
- 移除未使用的函数：`getScoreColor()`

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/submission/SubmissionDetailModal.tsx` | 移除分数列及相关代码 |

### 验证

- TypeScript 编译通过（`npx tsc --noEmit` 无错误）
- 测试点表格现在只有 4 列：#、状态、耗时、内存

---

## 任务：训练评测记录 OJ 列不显示 + 服务器缓存（2026-04-17）

状态: **已完成** ✅

### 问题

训练评测记录 OJ 列显示为空（截图确认），尽管数据库有 `oj: "hdu"` 且代码中有 `oj: s.oj` 映射。

### 根因

运行中的后端服务器（`tsx watch`）未热更新到最新代码。源文件中已有 `oj: s.oj` 映射，但旧的进程缓存了没有 `oj` 字段的版本。`tsx watch` 存在多个实例导致热更新失效。

### 修复

重启后端服务器，API 响应中恢复 `oj: "hdu"` 和 `ojRemoteId` 字段。前端 `getOjLabel('hdu')` 返回 `"HDU"` 正常显示。

### 验证

- API 响应确认包含 `oj: "hdu"`
- 前端 0 个 TS 编译错误

---

## 任务：HDU 评测结果 score 字段补全（2026-04-17）

状态: **已完成** ✅

### 问题

训练列表展示的评测记录内容不全：耗时、OJ、分数没有显示。HDU 只有 0 分和 100 分（ACM 赛制）。

### 根因

`apps/server/src/lib/submission-poller.ts` 轮询 HDU 结果时只更新 `result`、`timeUsed`、`memoryUsed`，没有设置 `score` 字段。

### 修复

**submission-poller.ts** — 轮询结果时同时设置 score：
- HDU ACM 赛制：`accepted` → 100 分，其他结果 → 0 分
- 新增 `score` 字段到 `prisma.submission.update` 的 data 中
- 日志也增加了 score 字段输出

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/src/lib/submission-poller.ts` | score 字段补全 |

### 验证

- 已有 HDU 提交（如 Run ID 40838874，Accepted）需重新提交才能触发 poller 写入 score
- 新提交的 HDU 题目将自动获得正确分数

---

## 任务：训练评测记录样式对齐全局评测记录（2026-04-16）

状态: **已完成** ✅

### 问题

训练模块评测记录 tab 样式与全局 SubmissionList 不一致，且 HDU 题目的远程 ID（ojRemoteId）没有对齐。

### 修改

1. **前端 TrainingDetailPage.tsx** — 评测记录表格对齐全局 SubmissionList 样式
   - 评测 ID 改为可点击 `#id`（monospace + primary 色 + 下划线）
   - 新增 OJ 列（显示 `本OJ` / `HDU` 等）
   - 新增代码长度(B) 列
   - 评测结果改为彩色 Badge（Accepted 绿、WA 红、TLE 黄等，Pending/Judging 带旋转动画）
   - 表头统一样式：`padding: 0.75rem 1rem`、`fontWeight: 500`、`color: #6b7280`
   - 数据行统一样式：`padding: 0.75rem 1rem`、`borderBottom: 1px solid #f3f4f6`

2. **后端 training.routes.ts** — 评测记录接口返回 oj 和 ojRemoteId（此前已完成）

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 评测记录表格样式对齐 |
| `apps/server/src/modules/training/training.routes.ts` | 返回 oj/ojRemoteId（已完成） |

---

## 任务：训练提交弹窗对齐题库提交弹窗（2026-04-17）

状态: **已完成** ✅

### 问题

训练模块的提交弹窗与题库题目提交弹窗不一致，HDU 题目无法通过机器人账号提交。

### 修改

1. **前端 TrainingDetailPage.tsx** — 提交弹窗对齐题库提交弹窗
   - 新增提交方式选择：机器人账号 / 我的账号 / 归档（非 Carits 平台显示）
   - 新增平台账号绑定提示
   - 语言选项改为使用全局 `LANGUAGE_OPTIONS` 常量
   - 非机器人方式禁用代码输入和提交
   - 弹窗标题显示平台名和题号（如 "HDU 4000"）
   - 提交成功后自动打开提交详情弹窗
   - 传递 `submitMethod` 参数给后端

2. **后端 training.routes.ts** — 训练提交支持 HDU 机器人提交
   - 接受 `submitMethod` 参数
   - HDU 平台 + robot 方式：复用 `submitToHdu()` 提交到 HDU（与题库提交相同逻辑）
   - 洛谷等其他外部 OJ：回退到 `pending_review`（待人工评分）
   - Carits 平台：本地评测（不变）

3. **schema.prisma** — Submission.updatedAt 添加 `@updatedAt`
   - 修复创建 Submission 时缺少 updatedAt 导致的 500 错误

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 提交弹窗 UI 对齐 + import 新增 |
| `apps/server/src/modules/training/training.routes.ts` | HDU 机器人提交 + submitMethod 参数 |
| `apps/server/prisma/schema.prisma` | Submission.updatedAt 添加 @updatedAt |

### 验证

- HDU 1000 提交成功（Run ID: 40838874，Accepted）
- 洛谷题目提交成功（pending_review）
- 前端无 TypeScript 编译错误

---

## 任务：TypeScript 编译错误修复（2026-04-16）

状态: **已完成** ✅

### 问题

`tsc --noEmit` 报 17 个 TypeScript 编译错误 + 31 个 `declaration: true` 引发的 TS2742 错误。

### 修复

1. **requestLogger.ts** — 全局 Express Request 类型声明冲突，改为使用 `@oi-manager/shared` 的 `JwtPayload` 类型（与 auth.ts 统一）
2. **school.routes.ts** — School create 缺少 `currentPrincipalTeacherId`；User create 缺少 `schoolId`
3. **team.routes.ts** — 缺少 `prisma` 导入
4. **team.service.ts** — 数组类型 `unknown[]` 改为 `Record<string, unknown>[]`，修复 map 回调类型不兼容
5. **team.types.ts** — `CreateTeamDTO.id` 改为可选（`id?: string`），导入模块不需要预生成 ID
6. **team-import 模块**（5 个文件）：
   - 所有 User create 添加 `schoolId`（luogu、vjudge、repository、service）
   - 移除不存在的 `includeAvatar` 参数
   - 添加 `getImportHistory` 方法到 service
   - `team.id` 添加 `as string` 类型断言
   - `batch.teamId` 添加 `|| ''` 回退
7. **tsconfig.json** — 移除 `declaration: true` 和 `declarationMap: true`（Express 服务器不需要发布声明文件，且 pnpm 严格链接导致 TS2742 错误）

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/tsconfig.json` | 移除 declaration/declarationMap |
| `apps/server/src/middleware/requestLogger.ts` | 统一 JwtPayload 类型 |
| `apps/server/src/modules/school/school.routes.ts` | School/User create 补字段 |
| `apps/server/src/modules/team/team.routes.ts` | 添加 prisma 导入 |
| `apps/server/src/modules/team/team.service.ts` | 修复数组类型 |
| `apps/server/src/modules/team/team.types.ts` | CreateTeamDTO.id 改可选 |
| `apps/server/src/modules/team-import/team-import.service.ts` | User create + getImportHistory + 类型修复 |
| `apps/server/src/modules/team-import/team-import.routes.ts` | 移除 includeAvatar |
| `apps/server/src/modules/team-import/team-import.repository.ts` | User create 添加 schoolId |
| `apps/server/src/modules/team-import/luogu-import.service.ts` | User create 添加 schoolId |
| `apps/server/src/modules/team-import/vjudge-import.service.ts` | User create 添加 schoolId |

---

## 任务：时区修复 + 导航修复（2026-04-16）

状态: **已完成** ✅

### 问题

1. **训练编辑时区 Bug（P0）**：编辑训练标题/公告时，后端误判"训练已经开始，不能修改开始时间"。根因：Node.js 服务器（UTC）和浏览器（UTC+8）对 datetime-local 字符串解析不同，时间戳差 8 小时。
2. **学生训练 404（P0）**：学生团队页 `/student/team/`（单数）但训练详情页在 `/student/teams/`（复数）。
3. **router.back() 失效（P1）**：直接访问页面时无浏览器历史，`router.back()` 不工作。

### 修复

- 前端改发 UTC ISO 字符串；后端增加时区容忍检查（检测 datetime-local 无时区信息的整数小时偏移）
- 移动学生训练详情页到正确路径 + 修复 basePath
- 22 处 `router.back()` 替换为 `router.push(具体路径)`
- 训练列表 API 实时计算 status

---

## 任务：重构后全面错误探索与修复（2026-04-15）

状态: **已完成** ✅

### 背景

路由拆分到 `modules/` 目录后，发现存在多个错误：
- 前端页面/路由错误（import/export 不匹配）
- 脚本数据创建错误
- 数据库模型字段约束问题

经过全面探索，发现并修复以下关键问题。

### 修复内容

#### 1. 后端动态导入路径修复（P0）

路由文件从 `routes/` 移动到 `modules/problem/`、`modules/training/`、`modules/school/` 后，相对路径深度从 1 级变为 2 级，导致动态导入路径错误：

| 文件 | 行号 | 修复 |
|------|------|------|
| `modules/problem/problem.routes.ts` | 1188, 1299 | `../lib/ai-translate` → `../../lib/ai-translate` |
| `modules/training/training.routes.ts` | 903 | `../ws/judge` → `../../ws/judge` |

#### 2. Prisma Schema 字段约束完善

- 所有 `id String @id` 字段添加 `@default(cuid())`（44 个模型）
- 所有 `updatedAt DateTime` 字段添加 `@updatedAt`
- 这使得 Prisma 可以自动生成 ID 和更新时间戳

#### 3. Prisma 关联字段名修复（FIELD_CONTRACT）

根据 `docs/api/FIELD_CONTRACT.md` 规范，修复多处使用小写关联字段名导致的 500 错误：

| 文件 | 修复内容 |
|------|----------|
| `routes/problem-lists.ts` | `Sections` → `ProblemListSection`, `Entries` → `ProblemListEntry`, `Shares` → `ProblemListShare` |
| `routes/school-problem-lists.ts` | `_count.Sections` → `_count.ProblemListSection` |
| `routes/team-problem-lists.ts` | 同上 |
| `tests/helpers/problemListHelpers.ts` | `Sections` → `ProblemListSection` |

#### 4. 测试辅助函数 ID 生成修复

`tests/helpers/testUser.ts` 和 `tests/helpers/problemListHelpers.ts` 中所有 `prisma.create()` 调用添加显式 `crypto.randomUUID()` ids。

### 测试验证

- **230/230 测试全部通过** ✅
- 后端服务器正常运行（端口 3002）
- 前端应用正常运行（端口 3000）
- 种子数据正确加载（5 个团队）

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/src/modules/problem/problem.routes.ts` | 动态导入路径修复（2处） |
| `apps/server/src/modules/training/training.routes.ts` | 动态导入路径修复（1处） |
| `apps/server/prisma/schema.prisma` | @default(cuid()) + @updatedAt 添加到所有模型 |
| `apps/server/src/routes/problem-lists.ts` | Prisma 关联字段名修复 |
| `apps/server/src/routes/school-problem-lists.ts` | Prisma 关联字段名修复 |
| `apps/server/src/routes/team-problem-lists.ts` | Prisma 关联字段名修复 |
| `apps/server/tests/helpers/testUser.ts` | 显式 ID 生成 |
| `apps/server/tests/helpers/problemListHelpers.ts` | 显式 ID 生成 + 关联字段名修复 |

### 验证结果

- **230/230 测试全部通过** ✅
- PostgreSQL 服务运行正常（端口 5432）
- 后端服务器正常运行（端口 3002）
- 前端应用正常运行（端口 3000）
- 种子数据正确加载

---

### PostgreSQL 全环境迁移（续）

状态: **已完成** ✅

**安装配置**:
1. 安装 PostgreSQL 服务（Ubuntu 20.04）
2. 创建数据库 `oi_manager` 和用户 `oi`
3. 配置密码 `oi_password`

**Schema 更新**:
- `schema.prisma` provider 从 `sqlite` 改为 `postgresql`
- 测试环境使用独立 `test` schema 隔离

**测试 setup 修复**:
- 新增 `beforeAll` 创建平台学校（系统管理员必须绑定学校）
- `afterEach` 清理改用 Prisma `deleteMany`

**验证结果**:
- **230/230 测试全部通过** ✅
- 后端（端口 3002）正常
- 前端（端口 3000）正常

**涉及文件**:
- `apps/server/prisma/schema.prisma` — provider 改 postgresql
- `apps/server/tests/setup.ts` — 新增平台学校创建 + deleteMany 清理

---

## 任务：1000 QPS 架构升级（2026-04-15）

状态: **已完成** ✅

### 目标

将系统从 SQLite + 单进程 Express 架构升级为支持 1000 QPS 的生产架构。

### 完成内容

#### Phase 1: P0 — 硬性前提 ✅

1. **SQLite → PostgreSQL 迁移**
   - `schema.prisma` provider 改为 `postgresql`
   - `.env` 连接串改为 `postgresql://oi:oi_password@localhost:5432/oi_manager`
   - `.env.production` 模板（生产环境密钥占位）
   - `scripts/migrate-sqlite-to-pg.ts` 数据迁移脚本（按依赖顺序 45 张表）
   - `apps/server/package.json` 新增 `pg` 依赖
   - `tests/setup-env.ts` 测试数据库指向 `test.db`（保持 SQLite 用于测试隔离）

2. **限流参数调高**
   - `rateLimiter.ts` 全局限流从 100/分钟 → 2000/分钟（支持环境变量 `RATE_LIMIT_MAX`）
   - 按用户 ID（已登录）或 IP（未登录）维度限流

#### Phase 2: P1 — 性能关键路径 ✅

3. **排名 SQL 聚合**
   - IOI 排名：`$queryRaw` 替代内存 JS 聚合，DB 侧完成 GROUP BY + MAX
   - ICPC 排名：同理 SQL 聚合 solved + penalty
   - 数据量从全量拉取降至只拿聚合结果

4. **PM2 + Docker 部署配置**
   - `ecosystem.config.js` — cluster 模式，instances: max
   - `docker-compose.yml` — PostgreSQL 16 + healthcheck
   - `Dockerfile` — 多阶段构建（deps → build-server → build-web → production）
   - `.dockerignore`

5. **前端 SWR 缓存**
   - `apps/web/src/lib/fetcher.ts` — SWR fetcher 函数
   - `apps/web/src/hooks/useQuery.ts` — 统一数据获取 hook（5 秒去重、关闭 focus 重验证）

#### Phase 3: P2 — 查询优化 ✅

6. **权限查询合并**
   - `isTeamAdmin()` 合并 teacherId/student 查询为单条 `findFirst`
   - `getParticipantNames()` 一次 JOIN 查询替代 3 次分别查 User/Teacher/Student

7. **数据库索引**
   - Submission: `@@index([userId, oj, problemId])`, `@@index([createdAt, result])`
   - TrainingSubmission: `@@index([trainingId, userId])`, `@@index([trainingId, trainingProblemId, userId])`, `@@index([trainingId, result])`

8. **Next.js standalone 输出**
   - `apps/web/next.config.js` 新增 `output: 'standalone'`

#### Phase 4: P3 — 架构改进 ✅

9. **Nginx 反向代理配置**
   - `nginx/oi-manager.conf` — upstream backend + frontend
   - API 代理、WebSocket 升级、静态资源长缓存（365 天）

10. **路由文件拆分** ✅
     - `routes/trainings.ts` (1622行) → `modules/training/` (types + helpers + routes)
     - `routes/problems.ts` (1633行) → `modules/problem/` (types + helpers + routes)
     - `routes/schools.ts` (1392行) → `modules/school/` (types + routes)
     - `index.ts` 和 `testRequest.ts` import 路径已更新
     - 旧路由文件已删除

### 测试验证

- 229/230 测试通过（1 个预存注册失败，非本次变更引入）
- 测试数据库仍使用 SQLite `test.db`（测试隔离不受影响）

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/prisma/schema.prisma` | provider 改 postgresql + 新增索引 |
| `apps/server/.env` | DATABASE_URL 改 PG 连接串 |
| `apps/server/.env.production` | 新建生产环境模板 |
| `apps/server/package.json` | 新增 pg 依赖 |
| `apps/server/src/middleware/rateLimiter.ts` | 限流调高 + 按用户维度 |
| `apps/server/src/modules/training/training.types.ts` | 新建训练类型定义 |
| `apps/server/src/modules/training/training.helpers.ts` | 新建训练辅助函数 |
| `apps/server/src/modules/training/training.routes.ts` | 新建训练路由（从 routes/trainings.ts 拆分） |
| `apps/server/src/modules/problem/problem.types.ts` | 新建题目类型定义 |
| `apps/server/src/modules/problem/problem.helpers.ts` | 新建题目辅助函数 |
| `apps/server/src/modules/problem/problem.routes.ts` | 新建题目路由（从 routes/problems.ts 拆分） |
| `apps/server/src/modules/school/school.types.ts` | 新建学校类型定义 |
| `apps/server/src/modules/school/school.routes.ts` | 新建学校路由（从 routes/schools.ts 拆分） |
| `apps/server/src/routes/trainings.ts` | 删除（已迁移到 modules/training/） |
| `apps/server/src/routes/problems.ts` | 删除（已迁移到 modules/problem/） |
| `apps/server/src/routes/schools.ts` | 删除（已迁移到 modules/school/） |
| `apps/server/src/index.ts` | 改 import 路径 |
| `apps/server/tests/helpers/testRequest.ts` | 改 schoolRouter import 路径 |
| `apps/server/tests/setup-env.ts` | 测试环境变量 |
| `apps/server/src/config/env.ts` | 环境配置适配 |
| `apps/web/package.json` | 新增 swr 依赖 |
| `apps/web/src/lib/fetcher.ts` | 新建 SWR fetcher |
| `apps/web/src/hooks/useQuery.ts` | 新建统一 hook |
| `apps/web/next.config.js` | output: standalone |
| `ecosystem.config.js` | 新建 PM2 配置 |
| `docker-compose.yml` | 新建 Docker 配置 |
| `Dockerfile` | 新建多阶段构建 |
| `.dockerignore` | 新建 |
| `nginx/oi-manager.conf` | 新建 Nginx 配置 |
| `scripts/migrate-sqlite-to-pg.ts` | 新建迁移脚本 |

---

## 任务：团队训练模块（2026-04-14）

状态: **开发中** 🔄（前端核心功能已完成，待测试和文档）

### 目标

在团队模块内新增"训练"功能，支持 IOI/ICPC 赛制。训练归属团队，团队成员可参与。

### 设计决策

1. 训练详情页作为独立页面（有自己的路由）
2. 评测系统：混合模式（Carits 本地评测 + 外部 OJ 手动评分）
3. 权限：团队管理员可提交但不参与排名，排名只统计学生成员

### 已完成

#### Phase 1: 数据模型 + 基础 CRUD ✅

1. **Prisma Schema** — 新增 Training, TrainingProblem, TrainingParticipant, TrainingSubmission, TrainingAttachment, TrainingSolution 模型
2. **数据库同步** — `prisma db push` 已执行
3. **后端 API** — `routes/trainings.ts` 基础 CRUD（创建、查看、编辑、删除训练）
4. **路由注册** — `index.ts` 注册 `/api` 下训练路由
5. **训练列表组件** — `TeamTrainingList.tsx` 替换 TeamDetailPage 训练 tab 占位
6. **前端路由** — 教师端 + 学生端训练详情页路由

#### Phase 2: 训练创建 + 题目管理 + 编辑功能 ✅

1. **创建训练弹窗** — `TrainingCreateModal.tsx`（标题、公告、赛制、时间、题目添加）
2. **题目添加方式** — OJ 平台下拉 + 题号输入 + 500ms debounce 自动解析（与题单模块一致）
   - 调用 `/api/resolve-problems` API 批量解析题号
   - 显示解析结果：题名（绿色 ✓）或"题目不存在"（红色 ✕）
   - localStorage 记忆上次使用的 OJ 平台
3. **编辑训练功能** — `TrainingEditPage.tsx`（标题、公告、赛制、时间、题目管理）
   - 管理员可在训练详情页点击"编辑"按钮进入编辑页
   - 支持修改题目别名、分值，添加/移除题目
   - 已开始的训练不能修改开始时间
4. **训练详情页 UI 重构** — 风格对齐题库题目详情页
   - 三栏布局：左侧题目按钮（140px）+ 中间题面 + 右侧操作按钮（150px）
   - 左侧题目按钮横向排列（flex-wrap），约 5 个一行
   - 右侧操作按钮：写思路、提交代码（紫色渐变）
   - 提交代码按钮始终显示，训练未开始时灰显禁用
   - Tab 名称"题目列表"改为"题面"
   - 5 个 Tab：题面 | 评测记录 | 题解 | 附件 | 排名
   - 提交代码使用 Modal 弹窗
   - 思路面板内嵌显示（带自动保存）
   - 头部添加"编辑"按钮（管理员可见）
5. **评测记录筛选功能** — 前端筛选栏 + 后端筛选参数支持
   - 题号下拉、用户名输入、评测结果下拉、语言下拉
   - 后端支持 username/result/language 筛选
6. **排名用户名列** — 排名表格新增"用户名"列

#### Phase 3: 训练详情页 ✅

1. **训练详情页** — `TrainingDetailPage.tsx`（左侧题号列表、中间题面、右侧思路面板）
2. **ProblemNote 集成** — 训练中写思路复用 ProblemNote 表，自动同步
3. **倒计时** — 开始前/进行中/已结束状态显示
4. **评测记录 tab** — 列表显示（题号、提交者、结果、分数、耗时、内存、语言、时间），点击查看详情弹窗
5. **排名 tab** — IOI 赛制（总分+每题分数）和 ICPC 赛制（通过数+罚时+每题状态）
6. **代码提交** — 训练进行中可提交代码（选择语言+粘贴代码），Carits 题目自动评测
7. **题解 UI** — 查看/编辑题解面板，管理员可设置对学生可见性

#### Phase 4: 排名 + 提交 + 题解 + 附件 ✅

1. **训练提交 API** — 创建 TrainingSubmission，Carits 题目自动评测，外部 OJ 手动评分
2. **评测记录 API** — 列表查询（含分页）+ 详情查询
3. **排名 API** — IOI（总分排序）和 ICPC（解题数+罚时排序）
4. **题解 API** — 获取/保存题解，管理员可设置可见性
5. **附件 API** — 列表/上传/删除

#### Phase 5: 评测回调集成 ✅

1. **judge.ts handleResult** — 支持 `T-` 前缀的 submissionId，自动路由到 TrainingSubmission 表更新
2. **trainings.ts submit** — 修复 dispatchJudgeTask 调用，传入正确的 testdataPath + problemConfig，使用 `T-{id}` 前缀

#### Phase 6: 训练详情页"题目列表" Tab ✅

1. **后端 API** — `GET /trainings/:id/problem-status` 返回题目列表（含来源、原题链接、当前用户提交状态）
   - 查询 TrainingProblem + Problem 获取题目来源信息
   - 查询 TrainingSubmission 聚合当前用户每题最佳成绩
   - 使用 OJ adapter 的 getProblemUrl() 生成原题链接
   - Carits 内部平台：前端构造本地链接（`/teacher/problems/{UUID}`）
   - 所有团队成员可见来源信息（与题面 tab 隐藏来源策略不同）
2. **前端 Tab** — 新增"题目列表" Tab，位于"题面"左侧，默认选中
   - 表格 4 列：状态（分数+AC/WA）、序号（A/B/C...）、来源（平台+题号+链接）、标题（点击切换到题面）
   - Carits 平台显示 "Carits 1000" 可点击跳转题库详情页
   - 外部 OJ 显示 "HDU 4000" 可点击跳转原题链接
   - Hydro OJ 风格状态列（AC 绿色、非满分红色、未提交灰色）

### 涉及文件

- `apps/server/prisma/schema.prisma` — 新增 6 个模型
- `apps/server/src/routes/trainings.ts` — 新建（~1000 行）
- `apps/server/src/ws/judge.ts` — handleResult 支持 TrainingSubmission
- `apps/server/src/index.ts` — 注册路由
- `apps/web/src/components/training/TeamTrainingList.tsx` — 训练列表+创建弹窗
- `apps/web/src/components/training/TrainingDetailPage.tsx` — 训练详情页（三tab+提交+排名+题解）
- `apps/web/src/components/training/TrainingCreateModal.tsx` — 创建训练弹窗
- `apps/web/src/components/team/TeamDetailPage.tsx` — 训练 tab 替换
- `apps/web/src/app/teacher/teams/[id]/trainings/[tid]/page.tsx` — 教师端训练详情路由
- `apps/web/src/app/student/teams/[id]/trainings/[tid]/page.tsx` — 学生端训练详情路由

### 待完成

- 附件前端 UI（下载/上传）
- 测试

---

## 任务：评测记录鉴权修复 + 进程清理脚本（2026-04-14）

状态: **已完成** ✅

### 问题

1. 教师在评测记录页面能看到 platform_admin 的评测记录（学校隔离缺失）
2. 教师能点击私有题目 #1000 进入题目详情（题目权限检查缺失）
3. 重启服务时旧进程未清理

### 修改

1. **后端 `submissions.ts` GET /** — 教师和学生按学校过滤
   - 查询 Teacher/Student 表获取同校 userIds，用 `where.userId = { in: schoolUserIds }` 过滤
   - 管理员（super_admin, platform_admin）不做过滤
   - 新增 `problemVisibility` 字段到响应，供前端判断题目可见性

2. **后端 `submissions.ts` GET /:id** — 教师和学生按学校鉴权
   - 比较 `user.schoolId` 与提交者的 schoolId，不匹配返回 403
   - 修复 `const user` 重复声明问题（重命名为 `submitter`）

3. **后端 `problems.ts` GET /:id** — 私有题目权限检查
   - 私有题目（`visibility === 'private'`）仅 admin 和 owner 可访问

4. **前端 `SubmissionList.tsx`** — 私有题目不可点击
   - 新增 `problemVisibility` 字段和 `canClickProblem()` 函数
   - 非公开题目在教师/学生端不显示可点击链接

5. **进程清理脚本** — `scripts/kill-ports.sh` + `package.json`
   - 新增 kill-ports.sh 脚本，清理 3000/3001/3002 端口
   - `pnpm dev` 启动前自动执行清理
   - `pnpm kill-ports` 单独清理端口
   - `pnpm dev:dirty` 不清理直接启动

状态: **已完成** ✅

### 问题

对比 Hydro OJ 评测引擎，发现 oi-manager 评测系统存在大量"假配置"：UI 允许设置但评测时不生效。

### 对比审计结果

**假配置（UI 可设置但不生效）**:
1. File IO (`filename`) — 配置后仍用 stdin 管道 ✅ 已修复
2. 自定义 Checker 源码执行 — testlib/lemon 等只是 JS 字符串比较 ✅ 已修复
3. Interactor（交互题）— 无双向管道支持 ✅ 已修复
4. Manager + 多进程通信题 — 无多进程管道支持 ✅ 已修复
5. 提交答案题 — 无 zip 处理逻辑 ✅ 已修复
6. 额外文件 (`user_extra_files`) — 不传入沙箱 ✅ 已修复
7. 语言限制 (`langs`) — 不检查 ✅ 已修复

**部分工作的功能**:
- 子任务配置: 分组/依赖/评分方式正常，但缺少提前终止和并行执行
- 默认/严格 Checker: JS 字符串比较可用，但 diff 信息不如 Hydro 精确

**完全正常的功能**: 基础评测流程、测试数据管理、子任务前端展示

### 修改

1. **File IO 支持** — `judge.ts` + `sandbox/client.ts` + `sandbox/local.ts`
   - 当 `config.filename` 设置时，程序通过 `{filename}.in` / `{filename}.out` 文件读写
   - go-judge 模式: 用 copyIn 提供输入文件，copyOut 捕获输出文件
   - 本地模式: 写入 workDir 文件，执行后读取输出文件

2. **自定义 Checker 沙箱执行** — `judge.ts` + `checker/index.ts`
   - 新增 `CheckerContext` 接口，封装 checker 类型、JS checker 函数、编译后的 fileId/workDir
   - 编译阶段: 如果配置了 checker 源码且类型不是 default/strict，在评测前编译 checker
   - 执行阶段: `runCheckerInSandbox()` 函数支持 6 种 checker 格式
   - testlib: 解析 stderr（ok/wrong answer/points）
   - lemon: 读取 score/message 文件（支持部分分）
   - hustoj/qduoj: 检查 exit code
   - syzoj: stdout 为分数百分比
   - kattis: exit code 42=AC/43=WA，读取 feedback_dir

3. **额外文件支持** — `types.ts` + `judge.ts` + `sandbox/client.ts` + `sandbox/local.ts`
   - `ProblemConfig` 新增 `user_extra_files`、`judge_extra_files`、`langs`、`manager`、`num_processes` 字段
   - `sandbox.execute()` 新增 `extraCopyIn` 参数
   - 额外文件通过 copyIn 传入沙箱执行环境

4. **语言限制检查** — `judge.ts`
   - 评测前检查提交语言是否在 `config.langs` 允许列表中

5. **导出 sandbox runCommand** — `sandbox/client.ts`
   - 将 `runCommand` 改为 `export`，供 judge.ts 的 checker 沙箱执行使用

### 第二轮修复

6. **Checker 源码读取** — 前端只传文件名（如 `checker.cpp`），评测引擎从 testdata 目录读取源码再编译
7. **ignoreTrailingSpace 开关** — 前端保存 `ignore_trailing_space` 到 config，评测引擎根据配置选择 default/strict checker
8. **子任务提前终止** — min 类型一个失败后跳过剩余，max 类型一个满分后跳过剩余
9. **Checker workDir 清理** — 临时目录和 fileId 在评测完成后正确清理
10. **Config 字段映射** — `CompilableSource` 新增 `lang` 字段，修复 `num_processes` 重复

### 第三轮修复：交互题、通信题、提交答案题

11. **交互题 (`interactive`)** — `judge.ts` 新增 `judgeInteractive()` 和 `runInteractiveCase()` 函数
    - 读取 interactor 源码（从 testdata 目录）
    - 编译用户代码 + interactor
    - 使用 `runPiped` / `runPipedLocal` 创建双向管道连接用户程序和 interactor
    - pipeMapping: user stdout → interactor stdin, interactor stdout → user stdin
    - 解析 interactor stderr（testlib 格式：ok/wrong answer/points/partially correct）

12. **通信题 (`communication`)** — `judge.ts` 新增 `judgeCommunication()` 和 `runCommunicationCase()` 函数
    - 读取 manager 源码（从 testdata 目录）
    - 编译用户代码 + manager
    - 使用 `runPiped` 创建 N 个用户进程 + 1 个 manager 进程
    - pipeMapping: manager fd(p*2+3) → user[p] stdout, manager fd(p*2+4) → user[p] stdin
    - manager stdout 输出分数百分比，stderr 输出消息
    - 本地模式暂不支持（管道连接复杂），提示使用 go-judge

13. **提交答案题 (`submit_answer`)** — `judge.ts` 新增 `judgeSubmitAnswer()` 函数
    - 用户提交的 code 直接作为答案内容（简化实现，不处理 zip）
    - 使用 checker 比对答案文件（支持沙箱 checker 和 JS checker）

14. **题目类型分发** — `judge.ts` 主函数新增 problemType 路由
    - `cfg.type === 'interactive'` → `judgeInteractive()`
    - `cfg.type === 'communication'` → `judgeCommunication()`
    - `cfg.type === 'submit_answer'` → `judgeSubmitAnswer()`
    - default / objective / 未指定 → 原有评测流程

15. **本地模式 runPiped** — `sandbox/local.ts` 新增 `runPipedLocal()` 函数
    - 使用 Node.js child_process spawn + pipe() 实现进程间管道连接
    - 返回 `LocalPipedResult[]`（status、exitStatus、time、memory、stdout、stderr、files）

### 涉及文件

- `apps/judge/src/judge.ts` — File IO、Checker 沙箱执行、语言限制、额外文件
- `apps/judge/src/types.ts` — ProblemConfig 新增字段
- `apps/judge/src/sandbox/client.ts` — execute 新增 filename/extraCopyIn 参数，导出 runCommand
- `apps/judge/src/sandbox/local.ts` — localExecute 新增 filename/extraCopyIn 参数

### Lemon 兼容性

Lemon checker 已在本次修复中实现（`runCheckerInSandbox` 的 lemon 分支）。只需按 Lemon 格式传入命令行参数，读取 score/message 文件。依赖 checker 沙箱执行（已实现）。

---

## 任务：评测配置持久化修复（2026-04-12）

状态: **已完成** ✅

### 问题

用户反馈 "FileIO 配置等 保存之后还是失败 重新进来还是原内容"。

**根因**: ProblemForm 的主"保存"按钮只调用 `PUT /:id`（保存标题、题面等基础信息），**不会**保存 `judgeConfig`（FileIO、Checker、子任务、额外文件等评测配置）。用户修改评测设置后点击主保存按钮，评测配置不会持久化。JudgeSettingsTab 有独立的"保存评测配置"按钮，但用户不会使用它。

**证据**: 服务器日志只有 `PUT /api/problems/:id`，没有 `PUT /judge-config` 请求。

### 修改

1. **JudgeSettingsTab.tsx** — 使用 `forwardRef` + `useImperativeHandle` 暴露 `saveConfig()` 方法
   - 导出 `JudgeSettingsTabHandle` 接口（`saveConfig: () => Promise<void>`）
   - `useImperativeHandle(ref, () => ({ saveConfig: () => handleSaveConfig() }))`

2. **ProblemForm.tsx** — 主保存按钮同时保存评测配置
   - 创建 `judgeSettingsRef = useRef<JudgeSettingsTabHandle>(null)`
   - 将 ref 传给 `<JudgeSettingsTab ref={judgeSettingsRef} />`
   - 在 `handleSubmit` 中，主 `PUT /:id` 成功后，编辑模式下调用 `judgeSettingsRef.current?.saveConfig()` 保存评测配置

### 涉及文件

- `apps/web/src/components/problem/JudgeSettingsTab.tsx` — forwardRef + useImperativeHandle
- `apps/web/src/components/problem/ProblemForm.tsx` — 主保存集成评测配置保存

---

## 任务：子任务配置自动保存（2026-04-12）

状态: **已完成** ✅

### 问题

用户反馈 "评测自动配置 保存之后 仍然失效"。根因分析：
1. 所有修改子任务的操作（`autoConfigure`、`addSubtask`、`deleteSubtask`、`assignCasesToSubtask`、`removeCaseFromSubtask`）只更新本地 React 状态，不会自动保存到后端
2. 用户需要额外点击顶部 "保存配置" 按钮才能持久化，但这个操作容易被忽略
3. 删除子任务和删除测试数据文件使用浏览器原生 `confirm()`，不符合项目 UI 规范

### 修改

1. **前端** `JudgeSettingsTab.tsx`
   - 提取 `buildConfig()` 函数，支持传入自定义 `subtasksOverride` 参数构建配置
   - 新增 `updateSubtasksAndSave()` 辅助函数：更新状态 + 自动保存到后端
   - **所有子任务修改操作均改为自动保存**：`autoConfigure`、`addSubtask`、`deleteSubtask`、`saveEditSubtask`、`assignCasesToSubtask`、`removeCaseFromSubtask`
   - `autoConfigure` toast 改为 "已生成 X 个子任务并保存"
   - 替换所有 `confirm()` 为 `ConfirmModal` 组件（删除子任务、删除测试数据文件）
   - 添加 `console.log` 调试日志用于追踪保存/加载流程
   - 修复 TypeScript 类型错误

2. **后端** `problems.ts`
   - `PUT /:id/judge-config` 添加 `console.log` 打印接收到的 subtasks 数量
   - `GET /:id/judge-config` 添加 `console.log` 打印返回的 subtasks 数量

### 涉及文件

- `apps/web/src/components/problem/JudgeSettingsTab.tsx` — 所有子任务操作自动保存 + ConfirmModal
- `apps/server/src/routes/problems.ts` — 调试日志

---

## 任务：评测配置持久化 + 子任务分数显示（2026-04-12）

状态: **已完成** ✅

### 问题

1. 评测配置了子任务并保存后，再进入页面子任务处于折叠状态，用户误以为配置丢失
2. 评测机的 `subtasks` 结果数据未保存到数据库，提交详情页无法显示子任务级别分数

### 修改

1. **前端** `JudgeSettingsTab.tsx`
   - 加载配置后自动展开所有已保存的子任务（`setExpandedSubtasks(new Set(loaded.map(st => st.id)))`)

2. **数据库** `schema.prisma`
   - Submission 模型新增 `subtasks String?` 字段
   - `prisma db push` 已执行

3. **后端** `ws/judge.ts`
   - 从评测结果 payload 解构 `subtasks` 字段
   - 保存 `subtasks: JSON.stringify(subtasks)` 到数据库

4. **后端** `submissions.ts`
   - GET /:id 返回解析后的 `subtasks` 数据

5. **前端** `SubmissionDetailPage.tsx`
   - 新增 `SubtaskResult` 接口
   - 测试点表格支持子任务分组显示：每个子任务有标题行（ID + 测试点数 + 评分方式 + 得分），下方显示该子任务的测试点
   - 无子任务时保持原有平铺显示

### 涉及文件

- `apps/web/src/components/problem/JudgeSettingsTab.tsx` — 自动展开子任务
- `apps/server/prisma/schema.prisma` — Submission 新增 subtasks 字段
- `apps/server/src/ws/judge.ts` — 保存 subtasks JSON
- `apps/server/src/routes/submissions.ts` — 返回 subtasks 数据
- `apps/web/src/components/submission/SubmissionDetailPage.tsx` — 子任务分组显示

---

## 任务：评测设置(Beta) 完整实现（2026-04-11）

状态: **已完成** ✅

### 目标

参考 Hydro OJ 的评测设置界面，将 Carits 的评测设置从基本骨架升级为完整的三栏配置编辑器。

### 完成内容

1. **前端 JudgeSettingsTab.tsx 完整重写**
   - 三栏布局：左 YAML 预览（只读）/ 中配置编辑区 / 右测试数据管理
   - 基础配置 Tab：题目类型分段选择、Checker 类型（默认/testlib/其他）、忽略行末空格开关、FileIO 前缀、Interactor/Manager 文件选择、通信题进程数、提交答案题 Multi-file、额外文件、语言限制
   - 子任务 Tab：全局时间/内存设置、自动配置按钮、子任务列表（分值/依赖/评分方式/测试点分配）、添加/删除子任务、测试点分配下拉选择
   - YAML 实时预览（config.yaml 只读显示）

2. **Judge 引擎增强**
   - 子任务依赖检查：支持 `if` 字段，依赖的子任务未通过时自动跳过
   - SubtaskConfig 类型新增 `if?: number[]` 字段
   - 依赖跳过时测试点标记为 System Error 并附带提示信息

3. **前端依赖**
   - 新增 `js-yaml` 和 `@types/js-yaml`（YAML 序列化）

### 涉及文件

- `apps/web/src/components/problem/JudgeSettingsTab.tsx` — 完整重写（457行 → ~870行）
- `apps/judge/src/judge.ts` — 子任务依赖检查
- `apps/judge/src/types.ts` — SubtaskConfig 新增 `if` 字段
- `apps/web/package.json` — 新增 js-yaml 依赖

---

## 任务：提交详情页链接优化（2026-04-11）

状态: **已完成** ✅

### 问题

1. 题目详情页的评测记录 tab 中，评测ID 列是纯文本，无法点击跳转到提交详情页
2. 提交详情页默认头像（无上传头像时）显示灰色，与系统其他位置蓝色默认头像不一致

### 修改

**前端** `apps/web/src/components/problem/ProblemDetail.tsx`
- 评测ID 列改为可点击链接，点击后根据当前角色跳转到对应提交详情页（`/teacher/submissions/{id}`、`/student/submissions/{id}`、`/platform-admin/submissions/{id}`）

**前端** `apps/web/src/components/submission/SubmissionDetailPage.tsx`
- 默认头像从灰色圆（`#e5e7eb` 背景 + `#6b7280` 文字）改为蓝色圆（`var(--primary)` 背景 + 白色文字），与系统其他位置一致

### 涉及文件

- `apps/web/src/components/problem/ProblemDetail.tsx` — 评测ID 可点击
- `apps/web/src/components/submission/SubmissionDetailPage.tsx` — 默认头像蓝色

---

## 任务：提交详情页 Hydro 风格改造 — 补充测试点分数列（2026-04-11）

状态: **已完成** ✅

### 问题

提交详情页测试点表格缺少 Score 列，与 Hydro OJ 不一致。Hydro 每个测试点行显示独立分数（如 "5"），但当前页面只有 #、Status、Time、Memory 四列。

### 修改

**前端** `apps/web/src/components/submission/SubmissionDetailPage.tsx`
- 测试点表格新增 **Score** 列（Status 和 Time 之间）
- 每行显示该测试点得分，通过绿色、失败红色、无数据灰色 "-"
- 评测机已正确发送每个用例的 score（judge.ts: `caseResult.score = caseScore`）

### 涉及文件

- `apps/web/src/components/submission/SubmissionDetailPage.tsx` — 新增 Score 列

---

## 任务：提交详情页 Hydro 风格改造（2026-04-11）

状态: **已完成** ✅

### 问题

提交详情页存在多个问题：
1. 布局与 Hydro OJ 不一致
2. 头像链接有问题（后端 `submissions.ts:160` 三元表达式错误，始终返回 null）
3. 没有显示具体通过了哪些测试点（缺少可视化摘要）
4. 分数不够突出

### 修改

1. **后端** `apps/server/src/routes/submissions.ts`
   - 修复 line 160 错误的三元表达式（`user.avatar || user.Teacher?.name ? null : null` 始终返回 null）

2. **前端** `apps/web/src/components/submission/SubmissionDetailPage.tsx` — 完整重写
   - 参考 Hydro OJ 的 `record_detail.html` 布局
   - 左栏（9/12）：状态标题栏（图标 + 分数 + 结果文字）+ 测试点摘要色条 + 测试点详情表格 + 统计摘要 + 代码
   - 右栏（3/12）：提交者信息、题目、语言、代码长度、提交时间
   - Hydro 风格元素：
     - `getScoreColor()`: 分数颜色渐变（0=红→100=绿）
     - 测试点行左侧彩色边框（绿=通过，红=失败）
     - 测试点摘要色条（每个测试点一个小色块）
     - 状态图标（✓ / ✕ / 旋转圈）

### 涉及文件

- `apps/server/src/routes/submissions.ts` — 修复头像变量
- `apps/web/src/components/submission/SubmissionDetailPage.tsx` — 重写布局

## 任务：ProblemNote 题面显示修复（2026-04-11）

状态: **已完成** ✅

### 问题

ProblemNote（写思路页面）使用旧的 `problem.description` / `problem.statementType` / `problem.statementPdfUrl` 字段显示题面。但使用多版本题面（ProblemStatement 表）创建/更新的题目（如 1000 潜入行动）这些旧字段为空，导致题面不显示。

### 修复

修改 `apps/web/src/components/problem/ProblemNote.tsx`：
- 添加 `Statement` 接口和 `statements` 字段到 `Problem` 接口
- 优先使用 `statements[]` 数组选择题面（优先中文 markdown → 任意 markdown → 第一个可见版本）
- 保留旧字段作为回退

### 涉及文件

- `apps/web/src/components/problem/ProblemNote.tsx` — 修改题面渲染逻辑

---

## 任务：Carits 提交记录详情页（2026-04-11）

状态: **已完成** ✅

### 目标

新增独立提交详情页，点击评测 ID 跳转，显示逐测试点结果、分数、提交者信息、代码。

### 已完成内容

1. **数据库**: Submission 模型添加 `score`、`cases` 字段
2. **后端**: `ws/judge.ts` 保存 score + cases JSON；`submit.ts` Carits 设置 ojRemoteId；`submissions.ts` GET /:id 增强
3. **前端**: SubmissionDetailPage 共享组件 + 3 个路由页面；SubmissionList 评测 ID 可点击；SubmissionDetailModal Carits 链接

### 涉及文件

- `apps/server/prisma/schema.prisma` — Submission 添加 score、cases
- `apps/server/src/ws/judge.ts` — 保存完整评测结果
- `apps/server/src/routes/submit.ts` — Carits ojRemoteId
- `apps/server/src/routes/submissions.ts` — 详情 API 增强
- `apps/web/src/components/submission/SubmissionDetailPage.tsx` — 新建
- `apps/web/src/app/teacher/submissions/[id]/page.tsx` — 新建
- `apps/web/src/app/student/submissions/[id]/page.tsx` — 新建
- `apps/web/src/app/platform-admin/submissions/[id]/page.tsx` — 新建
- `apps/web/src/components/submission/SubmissionList.tsx` — 评测 ID 可点击
- `apps/web/src/components/submission/SubmissionDetailModal.tsx` — Carits 链接

---

## 任务：Carits 平台本地评测功能（2026-04-10）

状态: **已完成** ✅

### 目标

为 Carits 平台自建题目添加本地评测功能，参考 Hydro OJ 的评测设置界面。

### 已完成内容

#### Phase 1: 数据模型扩展 ✅
- Problem 模型添加 `problemType` 字段
- 新增 `TestdataFile` 模型
- 后端测试数据 API（7 个端点）
- 前端评测设置 Tab

#### Phase 3: 评测机服务 ✅
创建了完整的 `apps/judge/` 项目：
- 类型定义（兼容 Hydro）
- 语言配置（支持 C/C++）
- 沙箱客户端（支持 go-judge 和 Windows 本地模式）
- 8 种 Checker 实现
- 评测核心逻辑
- WebSocket 客户端

#### Phase 4: 后端评测调度 ✅
- WebSocket 服务端 `ws/judge.ts`
- submit.ts 路由改造

#### Phase 5: Windows 本地执行模式 ✅
- 创建 `sandbox/local.ts` 实现 Windows 兼容执行
- 自动检测沙箱可用性，切换到本地模式
- 测试通过（A+B 问题）

### 使用方法

**启动评测机**:
```bash
cd apps/judge
pnpm dev
```

评测机会自动检测环境：
- Linux + go-judge 可用：使用沙箱模式
- Windows 或 go-judge 不可用：使用本地执行模式

### 涉及文件

**后端**:
- `apps/server/prisma/schema.prisma`
- `apps/server/src/routes/testdata.ts`
- `apps/server/src/routes/problems.ts`
- `apps/server/src/routes/submit.ts`
- `apps/server/src/ws/judge.ts`
- `apps/server/src/index.ts`

**前端**:
- `apps/web/src/components/problem/ProblemForm.tsx`
- `apps/web/src/components/problem/JudgeSettingsTab.tsx`

**评测机** (apps/judge/):
- `src/index.ts`, `src/types.ts`, `src/config.ts`
- `src/judge.ts`, `src/client.ts`
- `src/sandbox/client.ts`, `src/sandbox/local.ts`
- `src/checker/index.ts`, `src/langs.yaml`

---

## 任务：HDU 提交登录控制优化（2026-04-10）

状态: 已完成

### 完成内容

1. **Bug 修复**: HDU 提交返回 403 错误
   - 根因：登录成功后 Cookie 未保存到数据库
   - 修复：`hdu-submit.ts` 登录成功后同时保存 `cookie` 和 `cookieRaw`

2. **登录控制逻辑**: 实现 Cookie 复用，避免频繁登录
   - 判断是否需要续登：`elapsed >= (cookieValidMinutes - renewLoginThresholdMinutes)`
   - 默认配置：Cookie 有效 3600 分钟，提前 10 分钟续登
   - 实际续登时机：登录后约 59.8 小时

3. **失败冷却机制**:
   - 登录失败后进入 15 分钟冷却期
   - 连续失败 3 次后账号冻结（状态变为 `error`）

4. **累计统计**:
   - `totalSubmissions` — 累计提交次数（只增不减）
   - `totalSubmissionErrors` — 累计提交失败次数（只增不减）

5. **前端更新**:
   - OJ 账号管理页面："最后验证" → "最后登录"
   - 提交统计柱状图显示累计提交/失败数

6. **文档更新**:
   - `docs/oj-submit/README.md` — 通用登录控制设计（可复用到其他平台）
   - `docs/oj-submit/hdu.md` — HDU 具体实现和注意事项

### 验证结果

- 账号：`carits`
- 题目：HDU 1000
- Run ID：40832719
- 结果：**Accepted**

### 涉及文件
- `apps/server/src/lib/hdu-submit.ts` — 登录控制逻辑
- `apps/server/prisma/schema.prisma` — OjAccount 模型字段
- `apps/server/src/routes/oj-accounts.ts` — API 调整
- `apps/web/src/app/platform-admin/oj-accounts/page.tsx` — 前端展示
- `docs/oj-submit/README.md` — 通用设计文档
- `docs/oj-submit/hdu.md` — HDU 实现文档
- `docs/change-log.md` — 变更记录

---

## 任务：学校题单 & 团队题单功能（2026-04-08）

状态: 已完成

### 完成内容

1. **Prisma Schema 变更**: 新增 `SchoolProblemList` 和 `TeamProblemList` 模型
   - School、Team、ProblemList 模型添加关联字段
   - `prisma db push` 已执行，数据库已同步

2. **后端 API**（6 个新端点）:
   - `GET /api/schools/:schoolId/problem-lists` — 获取学校题单列表
   - `POST /api/schools/:schoolId/problem-lists` — 添加题单到学校
   - `DELETE /api/schools/:schoolId/problem-lists/:id` — 移除学校题单
   - `GET /api/teams/:teamId/problem-lists` — 获取团队题单列表
   - `POST /api/teams/:teamId/problem-lists` — 添加题单到团队
   - `DELETE /api/teams/:teamId/problem-lists/:id` — 移除团队题单

3. **前端**:
   - 学校页面新增「题单库」tab（`ProblemListsTab` 组件）
   - 团队详情页「题单」tab 替换占位为真实功能（`TeamProblemListsTab` 组件）
   - 添加题单弹窗：列出自己 owner 的题单，已添加灰显

4. **测试**: 20 个新测试全部通过（学校题单 10 + 团队题单 10）

5. **权限规则**:
   - 学校：负责人和教师可添加（只能添加自己是 owner 的），负责人可删所有，教师只能删自己添加的
   - 团队：owner/admin/教师成员可添加，owner 可删所有，admin 只能删自己添加的

### 涉及文件
- `apps/server/prisma/schema.prisma` — 新增模型
- `apps/server/src/routes/school-problem-lists.ts` — 新建
- `apps/server/src/routes/team-problem-lists.ts` — 新建
- `apps/server/src/index.ts` — 注册路由
- `apps/server/tests/setup.ts` — 清理列表新增两个表
- `apps/server/tests/helpers/testRequest.ts` — 测试应用注册新路由
- `apps/server/tests/helpers/testUser.ts` — createTestTeam 添加 id 生成
- `apps/server/tests/school-team-problem-lists.test.ts` — 新建测试
- `apps/web/src/app/teacher/school/page.tsx` — 新增题单库 tab
- `apps/web/src/app/teacher/school/components/ProblemListsTab.tsx` — 新建
- `apps/web/src/components/team/TeamProblemListsTab.tsx` — 新建
- `apps/web/src/components/team/TeamDetailPage.tsx` — 替换占位为真实组件