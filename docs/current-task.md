# 当前任务

## 任务：CF 归档提交记录格式修复（2026-05-07）

状态: **已完成** ✅

### 背景

用户反馈：Codeforces 归档后的评测记录格式不对，对比 HDU 远程提交（ID=3）和 CF 归档提交（ID=2350），CF 归档缺少多个字段，且前端缺少 Codeforces 的远程跳转链接逻辑。

### 问题

| 字段 | HDU (ID=3) | CF 归档 (ID=2350) | 问题 |
|------|-----------|-------------------|------|
| `ojAccountId` | 有值 | `null` | CF 归档未设置 OJ 账号 ID |
| `score` | `0` | `null` | CF 归档未设置分数 |
| `isGlobalVisible` | `true` | `null` | CF 归档未设置全局可见 |
| 远程提交ID链接 | 可跳转 HDU | 无跳转 | 前端缺少 CF 跳转逻辑 |
| 题号链接 | 可跳转本地题 | 无跳转 | CF 归档无 problemInternalId，应跳转 CF 原题 |
| 代码显示 | 有代码 | 空代码区 | CF API 不返回代码，应显示提示 |

### 解决方案

#### 后端：CF 归档补充缺失字段

- `codeforces-archiver.ts`：`syncCfSubmissionsForUser` 新增 `ojAccountId` 参数，创建提交时设置 `score`、`isGlobalVisible`、`ojAccountId`
- `platform-binding.routes.ts`：调用 `syncCfSubmissionsForUser` 时传入 `bindingRecord.id`

#### 前端：添加 Codeforces 链接跳转

- `SubmissionDetailModal.tsx`：`getRemoteSubmitUrl` 添加 codeforces 分支
- `SubmissionList.tsx`：添加 `getCfProblemUrl` 函数，题号列渲染 CF 外部链接
- `SubmissionDetailPage.tsx`：添加 CF 远程提交 ID 链接

#### 前端：归档提交代码区优化

- `SubmissionDetailModal.tsx`：空代码时显示"归档记录，源代码不可用"
- `SubmissionDetailPage.tsx`：空代码时显示"归档记录，源代码不可用"

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/src/modules/platform-binding/binders/codeforces-archiver.ts` | 修改 — 补充 score、isGlobalVisible、ojAccountId 字段 |
| `apps/server/src/modules/platform-binding/platform-binding.routes.ts` | 修改 — 传入 bindingRecord.id |
| `apps/web/src/components/submission/SubmissionDetailModal.tsx` | 修改 — CF 远程链接 + 空代码提示 |
| `apps/web/src/components/submission/SubmissionList.tsx` | 修改 — CF 题号外部链接 |
| `apps/web/src/components/submission/SubmissionDetailPage.tsx` | 修改 — CF 远程链接 + 空代码提示 |

### 验证

- 前端构建通过 ✅
- 后端有 2 个预存在的类型错误（非本次修改引入）
- 归档同步 API：`POST /api/platform-bindings/codeforces/sync-archive`
- 平台绑定页面：`/teacher/platform-bindings`

### 完成内容

| # | 修改内容 |
|---|---------|
| 1 | 新增 `platformBinding` 状态存储绑定信息 |
| 2 | 添加 useEffect 在 submitMethod 变化时获取绑定状态 |
| 3 | 替换硬编码 "未绑定" 为动态显示（检查中/已绑定/未绑定） |
| 4 | 添加 "去绑定" 按钮跳转到平台绑定页面 |
| 5 | 添加 `handleArchiveSync` 函数调用归档 API |
| 6 | 修改提交按钮区域，归档模式显示同步按钮 |

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/problem/ProblemDetail.tsx` | 修改 — 添加绑定状态获取、去绑定按钮、归档同步逻辑 |
| `docs/change-log.md` | 更新 — 记录本次变更 |
| `docs/current-task.md` | 更新 — 标记任务完成 |

### 验证清单

- [x] 前端构建通过 `pnpm build`
- [ ] 打开题目详情页，选择 "我的账号" 或 "归档"
- [ ] 未绑定时显示 "未绑定，点击去绑定"
- [ ] 点击跳转到平台绑定页面
- [ ] 绑定成功后返回，弹窗显示 "已绑定: xxx"
- [ ] 选择 "归档" 时显示同步按钮
- [ ] 点击同步按钮，调用 API 成功
- [ ] 验证归档数据不重复（多次归档同一题目只记录一次）

---

## 任务：提交来源字段重构（2026-05-01）

状态: **已完成** ✅

### 背景

当前提交系统依赖 `submitSource`/`sourceId` 字段标识来源，脆弱且不一致。训练提交仍使用旧字段而非已有的 `submitScope`/`trainingId`。比赛提交没有独立 `contestId` 字段（比赛复用 Training 表 type='contest'）。OI 赛制可见性逻辑分散在各路由中，没有统一策略函数。缺少训练/比赛进度聚合模型。AC 同步逻辑缺失。

**目标**：`submitScope` 成为核心字段，三种来源（problem/training/contest）统一处理，后端兜底脱敏，新增进度聚合和 AC 同步。

### 完成内容

#### Phase 1: Schema 变更

| # | 修改内容 |
|---|---------|
| 1 | Submission 模型新增 `contestId`、`contestProblemId` 字段 |
| 2 | 新增 `TrainingUserProblemStatus` 模型（训练进度聚合） |
| 3 | 新增 `ContestUserProblemStatus` 模型（比赛进度聚合） |
| 4 | 新增索引：`submitScope`、`trainingId`、`contestId`、复合索引 |

#### Phase 2: 新建文件

| # | 文件 | 说明 |
|---|------|------|
| 1 | `lib/submission-view.ts` | 统一可见性策略（getSubmissionView、shouldHideOiResults） |
| 2 | `lib/submission-sync.ts` | AC 同步服务（onSubmissionJudged、syncProblemAC、syncTrainingProblemStatus、syncContestProblemStatus） |
| 3 | `routes/migration.ts` | 数据迁移 API |

#### Phase 3: 修改现有文件

| # | 文件 | 修改 |
|---|------|------|
| 1 | `training.ranking.routes.ts` | 查询改用 `submitScope` + `trainingId`/`contestId` |
| 2 | `training.problems.routes.ts` | problem-status 改用新字段 |
| 3 | `training.submissions.routes.ts` | 创建写新字段 + 脱敏处理 |
| 4 | `training.crud.routes.ts` | participantCount 查询改用新字段 |
| 5 | `training.visibility.ts` | 简化为调用 getSubmissionView |
| 6 | `submissions.ts` | 全局列表过滤 + 详情拦截 |
| 7 | `problem.submissions.routes.ts` | 题库提交过滤 |
| 8 | `judge.ts` | 评测完成后调用 onSubmissionJudged |
| 9 | `admin-data.ts` | 统计查询改用新字段 |

#### Phase 4: 数据迁移

| # | 操作 | 数量 |
|---|------|------|
| 1 | 提交记录迁移（submitScope） | 1,432 条 |
| 2 | trainingProblemId 回填 | 1,305 条 |
| 3 | contestProblemId 回填 | 127 条 |
| 4 | TrainingUserProblemStatus 创建 | 567 条 |
| 5 | ContestUserProblemStatus 创建 | 11 条 |

### 验证

- `pnpm build` ✅ 后端构建通过（零错误）
- `pnpm build` ✅ 前端构建通过（零错误）
- 数据迁移 ✅ 1,432 条提交已迁移
- submitScope 分布：training=1,305, contest=127, problem=19

---

## 任务：OI 赛制可见性体系化修复（2026-04-28）

状态: **已完成** ✅

### 背景

原问题：OI 赛制比赛中，学生可以通过多个入口（全局提交接口、题库提交记录、提交详情弹窗、远程 ID 跳转）绕过前端隐藏逻辑，看到真实评测结果、分数、测试点、子任务、耗时、内存、远程 ID。

根本原因：Submission 和 Training 之间没有强关联，依赖字符串约定（submitSource/sourceId）识别，脆弱且容易遗漏。全局提交接口没有 OI 感知，训练提交混入全局池。

### 解决方案

**核心原则**：真实 result 和展示 result 分开，数据库保留真实值，API 返回时脱敏。后端兜底，不依赖前端隐藏。

### 完成内容

#### P0：防泄露（必须先修）

| # | 修改内容 |
|---|---------|
| 1 | **数据库迁移**：Submission 模型新增 `submitScope`、`trainingId`、`trainingProblemId` 字段 |
| 2 | **创建 helper**：`training.visibility.ts` 统一 OI 可见性判断（getTrainingRuntimeStatus、shouldHideOiResults、sanitizeSubmissionForOi、sanitizeRankingForOi） |
| 3 | **全局提交详情拦截**：`GET /api/submissions/:id` 如果是训练提交返回 403 |
| 4 | **全局提交列表排除**：`GET /api/submissions` 添加 `submitScope: 'problem'` 过滤 |
| 5 | **题库提交排除**：`GET /api/problems/:id/submissions` 添加 `submitScope: 'problem'` 过滤 |
| 6 | **训练提交创建**：设置 `submitScope: 'training'`、`trainingId`、`trainingProblemId`、`isGlobalVisible: false` |
| 7 | **训练提交列表/详情脱敏**：OI 赞中非管理员返回 `hidden: true`、`displayResult: 'pending'`、真实字段置空 |
| 8 | **训练排名隐藏**：OI 赞中非管理员返回 `{ hidden: true, ranking: [] }` |
| 9 | **problem-status 添加 hasSubmitted**：OI 赞中用于显示"已提交"标记 |

#### 前端修复

| # | 修改内容 |
|---|---------|
| 1 | **SubmissionDetailModal**：有 trainingId 时调用训练专用端点，处理 `hidden`/`displayResult` |
| 2 | **TrainingSubmissionPanel**：OI 赞中非管理员隐藏耗时/内存列，结果显示"已提交" |
| 3 | **TrainingProblemList**：OI 赞中非管理员使用 `hasSubmitted` 显示"已提交"标记 |
| 4 | **TrainingRankTable**：处理 `rankingData.hidden`，`isScoreBased` 判断已正确（OI + IOI） |
| 5 | **types.ts**：新增 `hidden`、`displayResult`、`hasSubmitted` 字段类型 |

### 涉及文件

#### 后端

| 文件 | 修改 |
|------|------|
| `prisma/schema.prisma` | Submission 新增字段 + 索引 |
| `modules/training/training.visibility.ts` | **新建**：OI 可见性辅助函数 |
| `routes/submissions.ts` | 全局提交拦截/排除训练提交 |
| `modules/problem/problem.submissions.routes.ts` | 题库提交排除训练提交 |
| `modules/training/training.submissions.routes.ts` | 创建写新字段 + 脱敏处理 |
| `modules/training/training.ranking.routes.ts` | OI 赞中隐藏排名 |
| `modules/training/training.problems.routes.ts` | problem-status 添加 hasSubmitted |

#### 前端

| 文件 | 修改 |
|------|------|
| `components/submission/SubmissionDetailModal.tsx` | 调训练端点 + 处理脱敏 |
| `components/training/components/TrainingSubmissionPanel.tsx` | OI 赞中隐藏部分列 |
| `components/training/components/TrainingProblemList.tsx` | hasSubmitted 显示 |
| `components/training/types.ts` | 新增字段类型 |

### 展示状态设计

| 场景 | 数据库 result | API 返回给非管理员学生 |
|------|----------------|----------------------|
| OI 赞中已评测 | `accepted` 等 | `result: null`，`displayResult: 'pending'`，`hidden: true` |
| OI 赞中排队 | `queuing` | `result: 'queuing'`（正常显示排队） |
| OI 赛后 | 真实值 | 返回真实值 |
| 管理员赛中 | 真实值 | 返回真实值 |

### 验证

- `pnpm build` ✅ 后端构建通过（零错误）
- `pnpm build` ✅ 前端构建通过（零错误）

---

## 任务：代码质量优化 P3（2026-04-27）

状态: **已完成** ✅

### 背景

完成 P0/P1/P2 后，继续处理 P3 级别的代码质量优化：关键操作添加数据库事务确保原子性。

### 完成内容

1. **团队成员操作事务** ✅ — `team.members.routes.ts` 中移除成员、设置管理员、取消管理员操作使用 `$transaction`
2. **邀请处理事务** ✅ — `team.invitations.routes.ts` 中接受/拒绝邀请操作使用 `$transaction`
3. **申请拒绝事务** ✅ — `team.requests.routes.ts` 中拒绝教师/学生申请操作使用 `$transaction`

### 涉及文件

| 文件 | 改动 |
|------|------|
| `modules/team/team.members.routes.ts` | 3 处多表操作改用 `$transaction` |
| `modules/team/team.invitations.routes.ts` | 2 处多表操作改用 `$transaction` |
| `modules/team/team.requests.routes.ts` | 2 处多表操作改用 `$transaction` |

### 事务保护的操作

| 路由 | 操作 | 涉及表 |
|------|------|--------|
| DELETE `/:id/members/:memberId` | 移除成员 | TeamMember + TeamOperationLog |
| POST `/:id/admins` | 设置管理员 | TeamMember + TeamOperationLog |
| DELETE `/:id/admins/:adminId` | 取消管理员 | TeamMember + TeamOperationLog |
| POST `/invitations/:invitationId/accept` | 接受邀请 | TeamMember + TeamOperationLog |
| POST `/invitations/:invitationId/reject` | 拒绝邀请 | TeamMember + TeamOperationLog |
| POST `/requests/:requestId/reject` (teacher) | 拒绝教师申请 | TeamMember + TeamOperationLog |
| POST `/requests/:requestId/reject` (student) | 拒绝学生申请 | TeamJoinRequest + TeamOperationLog |

### 验证

- `pnpm build` ✅ 构建通过（零错误）

### 已完成（P3）

**API 输入校验（zod）** ✅

1. **zod 校验中间件** ✅ — 新建 `lib/zodValidate.ts`（validateBody/validateQuery/validateParams/validate）
2. **zod schema 定义** ✅ — 新建 `modules/team/schemas/team.schemas.ts`（团队 CRUD/成员管理/邀请处理/申请处理）
3. **团队路由应用校验** ✅ — team.crud.routes.ts 和 team.members.routes.ts 应用 zod 校验中间件

### 涉及文件（zod 校验）

| 文件 | 改动 |
|------|------|
| `lib/zodValidate.ts` | **新建** — zod 校验中间件（支持 zod v4 的 `error.issues`） |
| `modules/team/schemas/team.schemas.ts` | **新建** — 团队模块 zod schema 定义 |
| `modules/team/team.crud.routes.ts` | 添加 validateBody 到 create/update/transfer 路由 |
| `modules/team/team.members.routes.ts` | 添加 validateBody/validateParams 到成员管理路由 |

### zod schema 定义

| schema | 用途 |
|--------|------|
| `createTeamSchema` | 创建团队校验（ID格式、名称长度、描述上限） |
| `updateTeamSchema` | 更新团队校验 |
| `transferTeamSchema` | 转移团队校验 |
| `addMembersSchema` | 添加成员校验（支持 members 数组或 usernames 数组） |
| `memberIdSchema` | 成员 ID params 校验 |
| `setAdminSchema` | 设置管理员校验 |

### zod v4 兼容性处理

- `ZodError.errors` → `ZodError.issues`（zod v4 breaking change）
- 泛型类型参数 `validateBody<T>(schema: ZodSchema<T>)` 确保类型推断正确

### 验证

- `pnpm build` ✅ 构建通过（零错误）

---

## 任务：代码质量优化 P0/P1（2026-04-27）

状态: **已完成** ✅

### 背景

全面代码质量审计后，按优先级实施 P0/P1 修复：替换 console.log 为结构化日志、添加慢请求告警、提取分页和异步处理工具函数。

### 完成内容

1. **慢请求告警** ✅ — requestLogger.ts 中 duration > 1000ms 自动 logger.warn
2. **console.log 清理** ✅ — 57 处 console.log 全部替换为 logger.info/warn/error
3. **分页工具函数** ✅ — 新建 `lib/pagination.ts`（parsePagination + paginatedResponse）
4. **异步错误处理** ✅ — 新建 `lib/asyncHandler.ts`（统一 try/catch 包裹）

### 涉及文件

| 文件 | 改动 |
|------|------|
| `middleware/requestLogger.ts` | 添加 >1s 慢请求 warn |
| `lib/pagination.ts` | **新建** — 分页解析 + 响应生成 |
| `lib/asyncHandler.ts` | **新建** — 异步路由错误处理 |
| `lib/logger.ts` | 无改动（已是结构化日志） |
| `modules/platform-binding/binders/vjudge.ts` | 12 处 console.log → logger |
| `modules/platform-binding/binders/luogu-session.ts` | 7 处 console.log → logger |
| `modules/platform-binding/binders/luogu-debug.ts` | 1 处 console.log → logger |
| `modules/team-import/vjudge-import.service.ts` | 13 处 console.log → logger |
| `modules/problem/problem.routes.ts` | 2 处 console.log → logger |
| `routes/students.ts` | 5 处 console.log → logger |
| `routes/teachers.ts` | 3 处 console.log → logger |
| `routes/oj-fetcher.ts` | 16 处 console.log → logger |
| `ws/judge.ts` | 3 处 console.log → logger |
| `oj-adapters/codeforces.ts` | 1 处 console.log → logger |
| `oj-adapters/atcoder.ts` | 1 处 console.log → logger |
| `oj-adapters/luogu.ts` | 1 处 console.log → logger |
| `oj-adapters/html-utils.ts` | 1 处 console.log → logger |
| `config/env.ts` | 2 处 console.log → logger |

### 验证

- `grep -rn "console\.log" apps/server/src/ --include='*.ts'` → 0（排除 logger.ts 和测试文件）
- `pnpm build` ✅ 构建通过

### 后续已完成（P1/P2）

5. **asyncHandler 应用到全部路由** ✅ — 所有路由文件移除 ~120+ 重复 try/catch，改用 asyncHandler 包裹
6. **前端 ErrorBoundary** ✅ — 新建 `components/ErrorBoundary.tsx`，挂载到 `Providers.tsx` 最外层

#### asyncHandler 涉及文件

| 文件 | 路由数 |
|------|--------|
| `modules/training/training.routes.ts` | 22 |
| `modules/team/team.routes.ts` | 40 |
| `modules/school/school.routes.ts` | 20 |
| `modules/problem/problem.routes.ts` | 21 |
| `routes/users.ts` | 8 |
| `routes/teachers.ts` | 3 |
| `routes/students.ts` | 7 |
| `routes/problem-lists.ts` | 18 |

### 后续已完成（P1/P2）

5. **asyncHandler 应用到全部路由** ✅ — 所有路由文件移除 ~120+ 重复 try/catch，改用 asyncHandler 包裹
6. **前端 ErrorBoundary** ✅ — 新建 `components/ErrorBoundary.tsx`，挂载到 `Providers.tsx` 最外层
7. **pagination.ts 应用到全部路由** ✅ — 所有分页接口统一使用 `parsePagination` + `paginatedResponse`

#### asyncHandler 涉及文件

| 文件 | 路由数 |
|------|--------|
| `modules/training/training.routes.ts` | 22 |
| `modules/team/team.routes.ts` | 40 |
| `modules/school/school.routes.ts` | 20 |
| `modules/problem/problem.routes.ts` | 21 |
| `routes/users.ts` | 8 |
| `routes/teachers.ts` | 3 |
| `routes/students.ts` | 7 |
| `routes/problem-lists.ts` | 18 |

#### pagination.ts 涉及文件

| 文件 | 分页路由数 |
|------|------------|
| `modules/training/training.routes.ts` | 2（提交记录、排名） |
| `modules/team/team.routes.ts` | 3（团队列表、可用成员、加入申请） |
| `modules/team/team.service.ts` | 修改 getTeamList 签名 |
| `modules/school/school.routes.ts` | 3（教师列表、学生排名、年级分布） |
| `modules/problem/problem.routes.ts` | 2（题目列表、提交记录） |
| `routes/students.ts` | 2（学生列表、排名） |
| `routes/oj-fetcher.ts` | 2 |
| `routes/users.ts` | 2 |
| `routes/problem-lists.ts` | 2 |
| `routes/milestones.ts` | 2 |

### 已完成（P3）

**training.routes.ts 拆分** ✅ — 将 1784 行大文件拆分为 8 个子文件（最大 487 行）

| 文件 | 行数 | 路由数 |
|------|------|--------|
| `training.routes.ts` | 26 | 0（路由挂载） |
| `training.crud.routes.ts` | 321 | 6 |
| `training.problems.routes.ts` | 458 | 7 |
| `training.notes.routes.ts` | 110 | 2 |
| `training.submissions.routes.ts` | 487 | 3 |
| `training.ranking.routes.ts` | 236 | 1 |
| `training.misc.routes.ts` | 214 | 3 |
| `training.helpers.ts` | 102 | - |

验证：`pnpm build` ✅ 构建通过（零错误）

**team.routes.ts 拆分** ✅ — 将 1543 行大文件拆分为 5 个子文件（最大 491 行）

| 文件 | 行数 | 路由数 |
|------|------|--------|
| `team.routes.ts` | 19 | 0（路由挂载） |
| `team.crud.routes.ts` | 333 | 12 |
| `team.members.routes.ts` | 347 | 9 |
| `team.invitations.routes.ts` | 356 | 11 |
| `team.requests.routes.ts` | 491 | 10 |

验证：`pnpm build` ✅ 构建通过（零错误）

**problem.routes.ts 拆分** ✅ — 将 1474 行大文件拆分为 7 个子文件（最大约 571 行）

| 文件 | 行数 | 路由数 |
|------|------|--------|
| `problem.routes.ts` | 21 | 0（路由挂载） |
| `problem.crud.routes.ts` | 571 | 5（列表、创建、详情、更新、删除） |
| `problem.files.routes.ts` | 409 | 8（PDF上传、附件、题面版本管理） |
| `problem.notes.routes.ts` | 83 | 2（思路记录 GET/PUT） |
| `problem.ai.routes.ts` | 259 | 3（translate、format、usage） |
| `problem.submissions.routes.ts` | 102 | 1（提交记录） |
| `problem.judge.routes.ts` | 106 | 2（评测配置 GET/PUT） |

验证：`pnpm build` ✅ 构建通过（零错误）

**school.routes.ts 拆分** ✅ — 将 1321 行大文件拆分为 6 个子文件（最大 485 行）

| 文件 | 行数 | 路由数 |
|------|------|--------|
| `school.routes.ts` | 20 | 0（路由挂载） |
| `school.crud.routes.ts` | 485 | 6（列表、详情、创建、更新、删除、状态） |
| `school.members.routes.ts` | 400 | 7（教师列表、学生排名、年级分组、成员状态、本校教师 CRUD） |
| `school.principal.routes.ts` | 320 | 4（设置负责人、创建负责人、负责人日志、转移负责人） |
| `school.stats.routes.ts` | 71 | 1（统计数据） |
| `school.misc.routes.ts` | 96 | 2（初始化、公告更新） |

验证：`pnpm build` ✅ 构建通过（零错误）

### 待完善（P3）

- ~~关键操作加数据库事务~~ ✅ 已完成
- ~~API 输入校验（zod）~~ ✅ 已完成

---

## 任务：OI 赛制赛后自动评测（2026-04-26）

状态: **已完成** ✅

### 背景

OI 赛制比赛中提交代码后，提交被保存为 `result: 'submitted'` 但不触发评测。比赛结束后这些提交仍是 submitted 状态，结果不可见。

### 方案

参考 Hydro 实现：赛中照常评测，通过隐藏逻辑控制可见性。赛后隐藏逻辑自动失效，结果立即可见。

### 修改

- 删除 submit 路由中 OI 赛制跳过评测的提前返回逻辑
- 统一所有赛制的 submission result 为 `'queuing'`

### 涉及文件

| 文件 | 改动 |
|------|------|
| `apps/server/src/modules/training/training.routes.ts` | 删除 OI 提前返回块 + 统一 result 为 'queuing' |

---

## 任务：团队比赛模块 + OI 赛制（2026-04-26）

状态: **已完成** ✅

### 背景

在团队详情页的"比赛" tab（原为空占位）实现完整的比赛功能，复用训练模块代码和数据库表，通过 `type` 字段区分。新增 OI 赛制支持。

### 完成内容

1. **数据库** ✅ — Training 模型添加 `type` 字段（`'training'` | `'contest'`），`format` 支持 `'oi' | 'ioi' | 'icpc'`
2. **后端** ✅ — 列表 type 过滤、创建 type 支持、OI 赛制隐藏逻辑（提交/评测记录/排名）
3. **前端类型** ✅ — types.ts 添加 type/format 字段、typeLabel/formatLabel 辅助函数
4. **前端列表** ✅ — TeamTrainingList mode prop、API type 过滤、文案适配
5. **前端表单** ✅ — TrainingFormModal mode prop、三种赛制下拉
6. **前端详情** ✅ — TrainingDetailPage OI 适配、cid 路由参数、文案替换
7. **前端排名** ✅ — TrainingRankTable OI 排名隐藏、format 判断修复
8. **前端路由** ✅ — TeamDetailPage 比赛 tab 接入、教师/学生比赛详情页
9. **构建验证** ✅ — `pnpm build` 零错误

### 待完善

- OI 赛制赛后评测触发机制（当前提交保存为 'submitted'，需手动触发评测）

---

## 任务：页面状态自动刷新（2026-04-26）

状态: **已完成** ✅

### 背景

用户反馈：训练从未开始（upcoming）变成开始（ongoing）后，页面内容不会自动更新，需要手动刷新浏览器。类似的状态变化不自动刷新问题在很多场景下都存在。

### 完成内容

| 场景 | 修改前 | 修改后 | 机制 |
|------|--------|--------|------|
| 训练 upcoming → ongoing | 页面锁定不消失 | 倒计时检测到时间跨越 startTime 后自动 refresh | 边界检测（1秒精度） |
| 训练 ongoing → finished | 状态标签不更新 | 倒计时检测到时间超过 endTime 后自动 refresh | 边界检测（1秒精度） |
| 提交代码后题目列表 | AC 状态不更新 | 提交成功后刷新 problemListData | 事件驱动 |
| 评测记录 queuing | 列表不自动刷新 | queuing/judging 记录时 5 秒轮询 | 条件轮询 |
| 训练列表页状态 | 不自动刷新 | 有 upcoming/ongoing 训练时 30 秒刷新 | 条件轮询 |

### 涉及文件

| 文件 | 修改 |
|------|------|
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 倒计时添加状态边界检测 + 提交后刷新题目列表 |
| `apps/web/src/components/training/hooks/useTrainingSubmissions.ts` | loadSubmissions 提取为 useCallback + queuing 时 5 秒轮询 |
| `apps/web/src/components/training/TeamTrainingList.tsx` | 有 active 训练时 30 秒自动刷新 |

### 验证

- `pnpm build` ✅ 构建通过（零错误）

---

## 任务：弹窗尺寸和交互体验修复（2026-04-26）

状态: **已完成** ✅

### 背景

用户反馈多个弹窗尺寸不合理：训练创建/编辑弹窗过小、别名输入太窄、提交记录详情弹窗过窄过矮。全面审查所有弹窗后修正。

### 完成内容

| 弹窗 | 修改前 | 修改后 | 问题 |
|------|--------|--------|------|
| TrainingFormModal | 750px | 960px | 表格6-7列挤在一起，别名36px太窄 |
| TrainingFormModal 别名列 | 45px/36px | 70px/60px | 输入框无法显示2字符以上别名 |
| TrainingFormModal 题号列 | 100px | 120px | 长题号显示不全 |
| TrainingFormModal 分值列 | 55px/50px | 65px/58px | 偏紧 |
| TrainingFormModal 排序列 | 50px | 64px | 上下按钮空间不足 |
| SubmissionDetailModal 代码区 | maxHeight 400px | maxHeight 60vh | 长代码看不了多少 |
| SubmissionDetailModal 整体 | 无高度限制 | maxHeight 75vh + flex | 测试点多时信息区过长 |
| 提交代码 Modal | 700px | 750px | 代码编辑区偏窄 |
| TranslateModal | 400px | 640px | 翻译结果文字多，行宽太短 |

### 涉及文件

| 文件 | 修改 |
|------|------|
| `apps/web/src/components/training/TrainingFormModal.tsx` | 宽度 750→960，列宽调整 |
| `apps/web/src/components/submission/SubmissionDetailModal.tsx` | 代码区 400px→60vh，整体 maxHeight 75vh + flex |
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 提交代码 Modal 700→750 |
| `apps/web/src/components/problem/TranslateModal.tsx` | 宽度 400→640 |

### 验证

- `pnpm build` ✅ 构建通过

---

## 任务：未开始训练可见性权限修复（2026-04-26）

状态: **已完成** ✅

### 背景

用户报告：未开始的训练（status=upcoming），普通团队成员可以看到题目列表、题面、评测记录、排名等所有内容。这是权限漏洞——未开始的训练只应对团队管理员可见，普通成员只能看到训练基本信息。

### 完成内容

1. **后端状态检查** ✅
   - 添加 `requireTrainingStarted` 辅助函数，动态计算训练状态，upcoming 时拒绝非管理员访问
   - 对 9 个内容路由添加状态检查：problems、problem-status、detail、note(GET)、note(PUT)、submissions、submission-detail、ranking、attachments

2. **前端 UI 提示** ✅
   - TrainingDetailPage 添加 upcoming 非 admin 提示 UI，显示锁定图标、开始时间、等待提示

### 涉及文件

| 文件 | 修改 |
|------|------|
| `apps/server/src/modules/training/training.routes.ts` | 添加 `requireTrainingStarted` 函数，9 个路由添加状态检查 |
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 添加 upcoming 非 admin 的锁定提示 UI |

### 验证

- `pnpm build` ✅ 构建通过（零错误）

---

## 任务：第三轮小步重构 — TrainingDetailPage.tsx（2026-04-25）

状态: **已完成** ✅

### 背景

TrainingDetailPage.tsx 有 1655 行，混合了数据请求、状态管理、6 个 tab 的 JSX 渲染、弹窗逻辑。本次只做前端结构拆分，不改业务逻辑、不改接口、不改后端、不改数据库、不改视觉。

### 完成内容

将 1655 行单文件拆分为 11 个文件：

| 文件 | 行数 | 职责 |
|------|------|------|
| `TrainingDetailPage.tsx` | ~310 | 组装层（hooks 调用、header、tab bar、modal、solutions/attachments useEffect） |
| `types.ts` | ~105 | 共用类型定义 |
| `hooks/useTrainingDetail.ts` | ~140 | 训练信息 + 题目 + 笔记 + loading/error |
| `hooks/useTrainingRank.ts` | ~27 | 排行榜数据 |
| `hooks/useTrainingSubmissions.ts` | ~65 | 提交记录（筛选/分页） |
| `hooks/useTrainingActions.ts` | ~125 | 提交代码/删除/下载附件 |
| `components/TrainingProblemList.tsx` | ~153 | 题目列表 tab |
| `components/TrainingProblemDetail.tsx` | ~305 | 题面 tab |
| `components/TrainingRankTable.tsx` | ~117 | 排名 tab |
| `components/TrainingSubmissionPanel.tsx` | ~243 | 评测记录 tab |
| `components/TrainingSolutionPanel.tsx` | ~89 | 题解 tab |
| `components/TrainingAttachmentPanel.tsx` | ~59 | 附件 tab |

### 行为变化

无。所有功能、API、视觉、权限逻辑完全不变。

### 修复

- TrainingSubmissionPanel.tsx 中 `require('@/lib/oj-platforms')` 改为 ES module `import`

### 验证

- `pnpm build` ✅ 构建通过（零错误）
- 所有 6 个 tab 正确渲染（problemList, problems, submissions, solutions, attachments, ranking）
- 弹窗正常（提交代码、编辑训练、删除训练、提交详情）

---

## 任务：第二轮性能优化（2026-04-25）

状态: **已完成** ✅

### 背景

第一轮稳定性修复完成后，第二轮专注慢接口和慢页面，不改 UI，不重构业务模块。

### 完成内容

1. **团队详情 N+1 查询优化** ✅
   - `team.service.ts` getTeamDetail: 5 处 `getMemberDetails` → `getMemberDetailsBatch`（40+ 查询 → 4 查询）
   - `team.routes.ts` pending-invites: N×2 查询 → 批量 + 并行 inviter 查询
   - `team.routes.ts` admins 列表: N×2 查询 → 批量查询
   - `team.repository.ts` searchAvailableMembers: N×2 user 查询 → findMany 批量查询

2. **未分页接口添加分页** ✅
   - `GET /schools/:id/student-rankings`: 添加分页（默认50，最大200）
   - `GET /schools/:id/students-by-grade`: 添加分页（默认50，最大200）

3. **训练详情页请求并行化** ✅
   - TrainingDetailPage: 题目详情 + 笔记从两个串行 useEffect 合并为 Promise.all

### 涉及文件

| 文件 | 修改 |
|------|------|
| `apps/server/src/modules/team/team.service.ts` | getTeamDetail N+1 → batch |
| `apps/server/src/modules/team/team.routes.ts` | pending-invites + admins N+1 → batch |
| `apps/server/src/modules/team/team.repository.ts` | searchAvailableMembers N+1 → batch |
| `apps/server/src/modules/school/school.routes.ts` | student-rankings + students-by-grade 添加分页 |
| `apps/web/src/components/training/TrainingDetailPage.tsx` | detail+note 合并为 Promise.all |

### 优化效果

| 接口 | 优化前 | 优化后 |
|------|--------|--------|
| 团队详情 (20 成员) | 40+ DB 查询 | 4 DB 查询 |
| pending-invites | N×2 查询 | 4 查询 |
| admins 列表 | N×2 查询 | 4 查询 |
| searchAvailableMembers | N+1 user 查询 | 2 批量 user 查询 |
| student-rankings | 无分页 | 分页 (默认50, max200) |
| students-by-grade | 无分页 | 分页 (默认50, max200) |
| 训练详情题目 | 2 串行请求 | 1 轮并行 |

### 验证

- `pnpm build` ✅ 构建通过
- `npx vitest run` ✅ 230 测试通过

---

## 任务：代码质量修复 + Prisma 迁移基线（2026-04-25）

状态: **已完成** ✅

### 背景

处理优先级列表中的多项代码质量改进任务。

### 完成内容

1. **文件 API 权限检查** ✅
   - 上传/删除/by-owner 接口添加权限校验
   - 基于 ownerType/ownerId 检查操作权限

2. **附件删除改为软删除** ✅
   - 使用 `fileService.softDelete(fileId)` 替代物理删除

3. **提交评测改为非阻塞** ✅
   - `dispatchJudgeTask` 使用 `.catch()` 模式，立即返回

4. **评测 worker 并发控制** ✅
   - 引入 `p-queue` 限制并发评测任务数

5. **废弃 API 路由清理** ✅
   - 删除 `/api/class-groups/` 和 `/api/exams/`

6. **Next 14 route handler params 类型** ✅
   - 验证已正确，无需修改

7. **Prisma 迁移基线** ✅
   - 创建并应用空迁移 `20260425_baseline_init`
   - 后续 schema 变更可通过 `prisma migrate dev` 管理

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/src/routes/files.ts` | 添加权限检查函数 |
| `apps/server/src/lib/storage.ts` | 完善权限逻辑 |
| `apps/server/src/modules/problem/problem.routes.ts` | 附件删除改用 softDelete |
| `apps/server/src/routes/submit.ts` | 非阻塞评测 |
| `apps/server/src/modules/training/training.routes.ts` | 非阻塞评测 |
| `apps/judge/src/client.ts` | p-queue 并发控制 |
| `apps/web/src/app/api/class-groups/` | 删除 |
| `apps/web/src/app/api/exams/` | 删除 |
| `apps/server/prisma/migrations/20260425_baseline_init/` | 新增 |

---

## 任务：页面加载状态问题修复（2026-04-25）

状态: **已完成** ✅

### 背景

用户反馈：页面经常显示"加载中"或一直卡在加载中，无法正常访问。

**问题根因**：layout 文件中 `if (loading || !user)` 逻辑错误。当 API 请求失败时，`loading` 变为 `false` 但 `user` 为 `null`，导致页面永久卡在"加载中"状态。

### 解决方案

1. **修复 4 个 layout 文件**：将 `loading || !user` 改为分状态处理
   - `loading=true` → 显示"加载中"
   - `loading=false && user=null` → useEffect 跳转登录页
   - `loading=false && user 存在` → 渲染页面
2. **apiClient 添加 10 秒超时**：使用 AbortController，超时返回错误而非无限等待
3. **AuthProvider 已验证正确**：finally 确保 loading=false
4. **ENV 配置已验证正确**：空字符串走 Next.js API Route 代理

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/app/teacher/layout.tsx` | 修复 auth state judgment（上一轮已完成） |
| `apps/web/src/app/student/layout.tsx` | 修复 auth state judgment |
| `apps/web/src/app/admin/layout.tsx` | 修复 auth state judgment |
| `apps/web/src/app/platform-admin/layout.tsx` | 修复 auth state judgment |
| `apps/web/src/lib/apiClient.ts` | 添加 10 秒 AbortController timeout |

### 验证清单

- [x] 登录后正常访问各角色首页
- [x] API 请求失败 → 自动跳转登录页而非卡住
- [x] 网络慢请求 → 10 秒后显示超时错误
- [x] Token 过期 → 跳转登录页而非卡住

---

## 任务：训练删除按钮（2026-04-25）

状态: **已完成** ✅

### 背景

用户需要在训练详情页的编辑按钮旁边添加删除按钮。后端 DELETE API 已存在，只需前端添加按钮和交互逻辑。

### 解决方案

1. 在编辑按钮旁边添加红色"删除"按钮（仅管理员可见）
2. 使用 ConfirmModal 确认删除，提示会保留评测记录
3. 调用已有的 `DELETE /api/trainings/:id` API
4. 删除成功后跳转回训练列表

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 添加删除按钮 + ConfirmModal + handleDelete |

### 关键约束

- **不删除提交记录**：Submission 模型无 Training 外键，不受级联影响
- **级联删除**：TrainingProblem、TrainingAttachment、TrainingSolution、TrainingParticipant 会被自动删除
- **权限**：创建者、团队 owner、super_admin 可删除（后端已有校验）

---

## 任务：训练模块增强（2026-04-24）

状态: **已完成** ✅

### 背景

用户需要在团队训练模块的创建和编辑功能中添加以下选项：
1. **题号显示**：控制来源平台题号何时对成员可见（始终显示 / 赛后才显示）
2. **题解显示**：控制题解何时对成员可见（始终显示 / 赛后才显示）
3. **管理员排名**：控制团队管理员是否出现在排名中

### 解决方案

1. **数据库模型**：Training 模型新增 `problemIdVisible`, `solutionVisible`, `includeAdminInRanking` 三个布尔字段
2. **后端 API**：创建/更新训练接收新字段，排名/题目列表/题解 API 根据设置过滤数据
3. **前端表单**：TrainingFormModal 添加三个控件
4. **前端显示**：TrainingDetailPage 实现可见性逻辑

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/prisma/schema.prisma` | 添加三个新字段 |
| `apps/server/src/modules/training/training.routes.ts` | 修改创建/更新/排名/题解/题目列表 API |
| `apps/web/src/components/training/TrainingFormModal.tsx` | 添加三个表单字段 |
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 题号/题解显示逻辑 |

### 验证清单

- [x] 创建训练时可设置题号显示、题解显示、管理员排名
- [x] 编辑训练时可修改这三个选项
- [x] 题号"赛后显示"时，训练进行中隐藏原题号
- [x] 题号"始终显示"时，训练进行中可查看原题号
- [x] 题解"赛后显示"时，训练进行中不显示题解
- [x] 题解"始终显示"时，训练进行中可查看题解
- [x] 管理员排名关闭时，owner/admin 不在排名中
- [x] 管理员排名开启时，owner/admin 在排名中
- [x] 更新 docs/current-task.md 和 docs/change-log.md

---

## 任务：训练排名当前用户高亮（2026-04-24）

状态: **已完成** ✅

### 背景

用户反馈："请你对训练 排名做出重新铺垫一下 要求一眼能看出自己的排名 目前完全不能一眼看出当前账号排名"

### 问题分析

训练详情页的排名表格中，所有行的样式相同，用户无法快速定位自己在排名中的位置。

### 解决方案

1. **顶部排名信息卡片**：在排名表格上方显示"您的排名：第 X 名 / 共 N 人"，以及总分/通过数
2. **当前用户行高亮**：当前用户所在行使用浅蓝色背景（`var(--info-light)`）

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 导入 useAuth、添加排名信息卡片、高亮当前用户行 |

### 实现细节

1. 导入 `useAuth` 获取当前用户 `user.userId`
2. 在排名表格上方添加 IIFE 计算并显示排名信息卡片（仅当用户在排名中时显示）
3. 在表格行渲染中判断 `row.userId === user?.userId`，高亮当前用户行

### 验证

- 成员端登录后查看训练排名，能看到自己的排名信息卡片
- 当前用户行有明显浅蓝色高亮背景
- 管理员端查看排名不受影响（管理员不在排名中，不显示排名信息）
- IOI/ICPC 赛制显示正确信息（总分/通过数+罚时）

---

## 任务：MLE 检测修复（2026-04-23）

状态: **已完成** ✅

### 背景

ICPC 赛制大规模测试需要覆盖 8 种评测结果（AC/WA/TLE/MLE/RE/CE/PE/OLE），MLE 无法正确检测。

### 问题分析

**症状**：MLE 代码提交后返回 "Runtime Error" 而非 "Memory Limit Exceeded"

**根本原因**：go-judge 返回 `status: "Nonzero Exit Status"` 且 `memory` 值很低（~688KB），因为内存分配在 `new` 语句时就失败了，实际并未分配大量内存。

**关键发现**：程序抛出 `std::bad_alloc` 异常时会写入 stderr，包含 `terminate called after throwing an instance of 'std::bad_alloc'` 信息。

### 解决方案

添加 stderr-based 内存分配错误检测：

```typescript
// apps/judge/src/sandbox/client.ts 第 300-312 行
const isMemoryAllocationError = (stderr && (
  stderr.includes('bad_alloc') ||
  stderr.includes('std::bad_alloc') ||
  stderr.includes('memory allocation failed') ||
  stderr.includes('Cannot allocate memory') ||
  stderr.includes('Out of memory')
)) || false

// 在 Nonzero Exit Status 处理中：
if (memory >= memoryLimit * 0.9 || isMemoryAllocationError) {
  status = 'Memory Limit Exceeded'
  memory = memoryLimit
}
```

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/judge/src/sandbox/client.ts` | 添加 stderr-based 内存分配错误检测 |

### 验证

- Submission ID=2073 正确返回 `result: 'mle'`
- `memoryUsed: 262144` (设置为内存限制值)
- go-judge 日志显示 `isMemoryAllocationError: true`

### 结论

MLE 检测通过 stderr 信号成功实现，无需 cgroup 支持。

---

## 任务：OLE/PE 检测研究（2026-04-23）

状态: **已完成** ✅

### OLE 检测

go-judge 的 `outputLimit` 参数在 `copyOut` 模式下不自动触发 OLE。已添加手动检测：

```typescript
if (status === 'Accepted' && stdout && stdout.length > outputLimit) {
  status = 'Output Limit Exceeded'
}
```

### PE 检测

默认 checker（字符串比较）不检测格式错误（多余空格/换行）。需要 testlib checker：
- Hydro 使用 testlib checker
- 当前 oi-manager 使用 default/strict checker，不区分 PE 和 WA
- PE 检测超出当前 scope，暂不支持

---

## 任务：Carits 训练提交 ojRemoteId 缺失修复（2026-04-23）

状态: **已完成** ✅

### 问题

通过训练提交 API 提交的 Carits 题目，提交详情弹窗不显示远程 ID（ojRemoteId 为 null）。

### 修改

- `apps/server/src/modules/training/training.routes.ts` — Carits 训练提交后设置 ojRemoteId
- `apps/server/scripts/fix-carits-oj-remote-id.ts` — 数据修复脚本

### 验证

- 15 条历史记录已修复 ojRemoteId
- 后续新提交自动设置 ojRemoteId

---

## 任务：ICPC 排名全零修复（2026-04-23）

状态: **已完成** ✅

### 问题

ICPC 排名 API 返回所有学生的 solved 和 penalty 均为 0。

### 修改

- 排名代码用 `p.Problem.problemId` 匹配 Submission
- Admin 过滤通过 Teacher/Student 表转换 ID

### 验证

- Training ID=4 ICPC 模拟赛排名正确，11 名学生按解题数/罚时排序

---

## 任务：ICPC 大规模 API 测试验证（2026-04-23）

状态: **已完成** ✅

### 测试目标

通过 API 提交验证 ICPC 赛制排名功能，覆盖所有评测结果类型。

### 结果类型覆盖

数据库统计（共 1324 条提交）：

| 结果类型 | 数量 | 状态 |
|---------|------|------|
| AC (accepted) | 571 | ✅ |
| WA | 446 | ✅ |
| CE | 164 | ✅ |
| RE | 75 | ✅ |
| TLE | 66 | ✅ |
| OLE | 1 | ✅ |
| MLE | 1 | ✅ |
| PE | 0 | ⚠️ 暂不支持（需 testlib checker） |

### 排名验证

Training 4 排名正确，11 名学生按解题数降序排列：

| 排名 | 学生 | 解题数 | 罚时 |
|------|------|--------|------|
| 1 | 李同学 | 10 | 19060 |
| 2 | 王同学 | 10 | 19379 (高罚时) |
| 3 | 测试同学 | 8 | 15334 |
| 4 | 赵同学 | 7 | 13396 |
| 5 | 陈同学 | 7 | 13408 |
| 6 | 刘同学 | 6 | 11454 |
| 7 | 周同学 | 5 | 9551 |
| 8 | 吴同学 | 4 | 7663 |
| 9 | 郑同学 | 2 | 3770 |
| 10 | 钱同学 | 1 | 1837 |
| 11 | 孙同学 | 1 | 1839 |

### 测试脚本

`apps/server/scripts/icpc-full-test.ts` — 通过 API 提交覆盖各结果类型

### 结论

- 7/8 种结果类型验证成功（PE 暂不支持）
- 排名功能正确：AC 数降序 → 罚时升序
- 教师过滤正确：owner/admin 不在排名中