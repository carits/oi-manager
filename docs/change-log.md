# 变更日志

## 2026-04-24 (训练模块增强：题号/题解可见性 + 管理员排名开关)

### 背景

用户需要在团队训练模块的创建和编辑功能中添加以下选项：
1. **题号显示**：控制来源平台题号（如 LOJ 1234、CF 753A）何时对成员可见（始终显示 / 赛后才显示）
2. **题解显示**：控制题解何时对成员可见（始终显示 / 赛后才显示）
3. **管理员排名**：控制团队管理员（owner/admin）是否出现在排名中

### 变更内容

1. **数据库模型**：Training 模型新增三个字段
   - `problemIdVisible` (Boolean, 默认 false)：题号可见性
   - `solutionVisible` (Boolean, 默认 false)：题解可见性
   - `includeAdminInRanking` (Boolean, 默认 false)：是否包含管理员在排名中

2. **后端 API**：
   - 创建/更新训练 API 接收新字段
   - 排名 API 根据 `includeAdminInRanking` 决定是否过滤管理员
   - 题目列表 API 根据 `problemIdVisible` 和训练状态决定是否返回平台题号
   - 题解 API 根据 `solutionVisible` 和训练状态决定是否返回题解内容

3. **前端表单**：TrainingFormModal 新增三个控件
   - 题号显示：下拉选择（赛后显示 / 始终显示）
   - 题解显示：下拉选择（赛后显示 / 始终显示）
   - 管理员排名：复选框（包含团队管理员在排名中）

4. **前端显示**：TrainingDetailPage 实现可见性逻辑
   - 题号隐藏时，来源列只显示平台名称，不显示具体题号
   - 题解隐藏时，题解 Tab 显示"题解将在比赛结束后显示"
   - 管理员始终可见完整信息

### 效果

- 创建/编辑训练时可设置三个新选项
- 题号"赛后显示"时，训练进行中成员看不到来源平台题号
- 题解"赛后显示"时，训练进行中成员看不到题解内容
- 管理员排名关闭时，owner/admin 不在排名中；开启时则参与排名

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/prisma/schema.prisma` | 修改 — 添加 problemIdVisible, solutionVisible, includeAdminInRanking 字段 |
| `apps/server/src/modules/training/training.routes.ts` | 修改 — 创建/更新/排名/题解/题目列表 API |
| `apps/web/src/components/training/TrainingFormModal.tsx` | 修改 — 添加三个表单字段 |
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 修改 — 题号/题解显示逻辑 |

---

## 2026-04-24 (训练排名当前用户高亮)

### 背景

用户反馈训练排名页面无法一眼看出自己的排名位置。

### 变更内容

1. **顶部排名信息卡片**：在排名表格上方显示"您的排名：第 X 名 / 共 N 人"，以及总分/通过数
2. **当前用户行高亮**：当前用户所在行使用浅蓝色背景（`var(--info-light)`）高亮

### 效果

- 成员端登录后查看训练排名，能看到自己的排名信息卡片
- 当前用户行有明显浅蓝色高亮背景
- 管理员端查看排名不受影响（管理员不在排名中）

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 修改 — 导入 useAuth、添加排名信息卡片、高亮当前用户行 |

---

## 2026-04-23 (ICPC 大规模 API 测试验证)

### 背景

验证 ICPC 赛制排名功能，通过 API 提交覆盖所有评测结果类型。

### 测试结果

**结果类型覆盖**（数据库统计，共 1324 条提交）：
- AC: 571 条 ✅
- WA: 446 条 ✅
- CE: 164 条 ✅
- RE: 75 条 ✅
- TLE: 66 条 ✅
- OLE: 1 条 ✅
- MLE: 1 条 ✅
- PE: 0 条 ⚠️（暂不支持，需 testlib checker）

**排名验证**：
- Training 4 排名正确，11 名学生按解题数/罚时排序
- 教师过滤正确，owner/admin 不出现在排名中
- 罚时计算正确：先失败后 AC 的题目包含失败次数 × 20 分钟

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/scripts/icpc-full-test.ts` | 新建测试脚本 |
| `docs/current-task.md` | 更新验证结果 |

---

## 2026-04-23 (MLE/OLE/PE 检测研究 + sandbox client 增强)

### 背景

ICPC 赛制大规模测试需要覆盖 8 种评测结果类型。MLE/OLE/PE 三种类型无法触发，进行研究并修复。

### 修改

1. **sandbox/client.ts** — 参考 Hydro OJ 添加评测增强
   - 新增 `addressSpaceLimit` 参数（控制 RLIMIT_AS）
   - 新增 OLE 手动检测（stdout.length > outputLimit 时标记 OLE）
   - 新增 MLE 手动检测（memory > memoryLimit 时标记 MLE）
   - `runCommand` 接口和请求体传递 `addressSpaceLimit` 和 `outputLimit`

2. **scripts/icpc-full-test.ts** — MLE 代码改用 vector 分配

### 结论

- MLE 检测需要 go-judge 启用 cgroup memory controller（生产环境用 Docker 部署）
- OLE 检测已通过手动检查实现
- PE 检测需要 testlib checker（超出当前 scope）

### 影响模块

- `apps/judge/src/sandbox/client.ts` — sandbox 执行参数和结果检测
- `apps/server/scripts/icpc-full-test.ts` — ICPC 测试脚本

---

## 2026-04-23 (Carits 训练提交 ojRemoteId 缺失修复)

### 背景

通过训练提交 API 提交的 Carits 题目，提交详情弹窗不显示远程 ID（ojRemoteId 为 null）。
- 训练提交（`training.routes.ts`）缺少设置 `ojRemoteId` 的步骤
- 非训练提交（`submit.ts`）已正确设置 `ojRemoteId = submission.id.toString()`

### 修改

**`apps/server/src/modules/training/training.routes.ts`**
- Carits 训练提交 dispatch judge task 后，新增 `prisma.submission.update` 设置 `ojRemoteId: submission.id.toString()`
- 与 `submit.ts` 行为对齐

**`apps/server/scripts/fix-carits-oj-remote-id.ts`**（新建）
- 数据修复脚本，将现有 `oj='carits' + submitSource='training' + ojRemoteId=null` 的记录更新为 `ojRemoteId = id.toString()`
- 已修复 15 条记录

### 影响范围

- 训练提交详情弹窗正常显示远程 ID
- 后续新提交自动设置 ojRemoteId

---

## 2026-04-23 (ICPC 排名全零修复)

### 背景

ICPC 排名 API 返回所有学生的 solved 和 penalty 均为 0。

### 根因

1. **Problem ID 不匹配**：排名代码用 `p.problemId`（TrainingProblem 的外键，UUID）匹配 `sub.problemId`（存的是外部 ID 如 '1005'）。应使用 `p.Problem.problemId`。
2. **Admin 过滤 ID 不匹配**：`TeamMember.userId` 存的是 Teacher.id/Student.id，而 `Submission.userId` 存的是 User.id。

### 修改

**`apps/server/src/modules/training/training.routes.ts`**
- 排名代码中 `p.problemId` → `p.Problem.problemId`（3 处）
- Admin 过滤通过 Teacher/Student 表转换 TeamMember.userId → User.id

### 影响范围

- ICPC 排名正常显示解题数和罚时
- 教师提交不计入排名

---

## 2026-04-22 (学生 OJ 平台风格统一重构)

### 背景

前端有 29,361 行 TSX 代码、2,411 个内联样式对象、75 个页面、49 个组件。存在大量视觉不一致：
- 10+ 处紫色渐变按钮
- borderRadius 有 4px/6px/8px/12px 四种值混用
- boxShadow 有 10+ 种不同值
- fontSize 有 20+ 种非标准值
- 73 处硬编码 #6b7280
- CSS 变量缺失 warning/info/radius/shadow/spacing/typography token

### 修改

**第 1 阶段：设计 Token 与基础规范**
- `styles/globals.css` 扩展 CSS 变量：色彩（primary/success/warning/error/info 及 light/text 变体）、背景（bg-page/bg-card/bg-hover/bg-muted）、文字（text-primary/text-secondary/text-muted/text-inverse）、边框、圆角（radius-sm/radius/radius-md/radius-lg）、阴影（shadow-sm/shadow/shadow-md/shadow-lg）、间距（space-1~space-10）、字号（text-xs~text-2xl）
- `lib/tokens.ts` 新建 JS 设计 token 常量，导出 colors/radius/shadow/space/fontSize 对象
- `lib/styles.ts` 全面改为 CSS 变量引用

**第 2 阶段：底层组件统一**
- `Button.tsx` 增加 outline/ghost/fullWidth 变体
- `Card.tsx` 增加 hoverable/padding/subtitle/onClick props
- `Badge.tsx` 增加 neutral/pending 变体、dot prop、getResultVariant() 函数
- `Table.tsx` hover 改为 CSS class，使用 CSS 变量
- `PageHeader.tsx` 描述颜色从 var(--gray-600) 改为 var(--text-secondary)，字号改为 var(--text-sm)
- `AppShell.tsx` 移除内联 Card/PageHeader 定义（34 行），改用 ui/ 组件

**第 3 阶段：高频核心页面重构**
- `ProblemDetail.tsx` 3 处紫色渐变改为 var(--primary)
- `TrainingDetailPage.tsx` 2 处紫色渐变改为 var(--primary)
- `SubmissionList.tsx` RESULT_COLORS 改为 CSS 变量
- `TeamTrainingList.tsx` STATUS_MAP 颜色改为 CSS 变量
- `TranslateModal.tsx`、`ProfileEditor.tsx`、`TeamHeader.tsx` 等组件去渐变

**第 4 阶段：批量颜色替换**
- 92 个 TSX 文件批量替换硬编码颜色：
  - 文字色：#1e293b/#374151/#111827 → var(--text-primary)
  - 次要文字：#475569/#6b7280/#64748b → var(--text-secondary)
  - 弱化文字：#9ca3af/#94a3b8/#999 → var(--text-muted)
  - 背景：#f9fafb/#f3f4f6/#f8fafc → var(--bg-muted)
  - 边框：#e5e7eb/#e2e8f0/#ccc → var(--border)
  - 主色：#3b82f6/#2563eb/#667eea/#7c3aed/#8b5cf6 → var(--primary)
  - 成功/错误/警告色统一为 var(--success)/var(--error)/var(--warning)

**第 5 阶段：一致性校验**
- borderRadius 12px → var(--radius-lg)（10 个文件）
- borderRadius 3px → var(--radius-sm)（6 个文件）

### 结果

- 紫色渐变：17 处 → 0 处
- 硬编码颜色：351 处 → 56 处（84% 减少，剩余为图表调色板等有意保留）
- 非标准 borderRadius：全部标准化
- TypeScript 编译通过

### 涉及文件

- `apps/web/src/styles/globals.css`
- `apps/web/src/lib/tokens.ts`（新建）
- `apps/web/src/lib/styles.ts`
- `apps/web/src/components/ui/Button.tsx`
- `apps/web/src/components/ui/Card.tsx`
- `apps/web/src/components/ui/Badge.tsx`
- `apps/web/src/components/ui/Table.tsx`
- `apps/web/src/components/ui/PageHeader.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/components/problem/ProblemDetail.tsx`
- `apps/web/src/components/training/TrainingDetailPage.tsx`
- `apps/web/src/components/submission/SubmissionList.tsx`
- `apps/web/src/components/training/TeamTrainingList.tsx`
- 92 个 TSX 文件（批量替换）

---

## 2026-04-17 (训练编辑题号排序修复)

### 背景

训练编辑时删除题目后 orderIndex 不会重新排序，导致题号显示混乱（如 orderIndex 有空缺：0, 2, 5... 而非连续的 0, 1, 2...）。

### 修改

**`apps/web/src/components/training/TrainingEditPage.tsx`**
- 保存训练时新增步骤 5：调用 `PUT /trainings/:id/problems/reorder` API 重新排序所有题目
- 确保删除题目后 orderIndex 保持连续（0, 1, 2, 3...）

### 影响范围

- 编辑训练删除题目后，题号会自动重新排序
- 前端题号显示（A/B/C/D...）基于 orderIndex 计算，会正确显示

---

## 2026-04-17 (提交详情弹窗移除分数列)

### 背景

用户反馈"提及结果弹窗不需要分数"。`SubmissionDetailModal.tsx` 测试点表格显示了每个测试点的分数列，但用户不需要这个功能。

### 修改

**`apps/web/src/components/submission/SubmissionDetailModal.tsx`**
- 移除表头"得分"列（从 5 列改为 4 列：#、状态、耗时、内存）
- 移除子任务标题行分数显示 + 子任务用例分数列
- 移除平铺用例分数列（无子任务时的显示）
- 移除未使用的变量 `cScore`、`stScore`
- 移除未使用的函数 `getScoreColor()`

### 影响范围

- 提交详情弹窗测试点表格不再显示分数列
- TypeScript 编译通过，无新增错误

---

## 2026-04-17 (训练评测记录 OJ 列修复)

### 背景

训练评测记录 OJ 列显示为空。数据库 `oj: "hdu"` 存在，后端代码有 `oj: s.oj` 映射，但 API 响应中缺少该字段。

### 根因

运行中的后端服务器（`tsx watch`）存在多个实例，热更新未生效，旧进程缓存了没有 `oj` 字段的代码版本。

### 修复

重启后端服务器恢复 API 响应中的 `oj` 和 `ojRemoteId` 字段。

### 影响范围

- 训练评测记录 OJ 列恢复正常显示
- 无代码变更，仅需重启服务

---

## 2026-04-17 (HDU 评测结果 score 补全)

### 背景

训练列表展示的评测记录内容不全：耗时、OJ、分数没有显示。HDU ACM 赛制只有 AC=100 和 非AC=0 两种分数。

### 修改

**`apps/server/src/lib/submission-poller.ts`**
- 轮询 HDU 结果时新增 `score` 字段更新：`accepted` → 100，其他 → 0
- 日志输出增加 score 字段

### 影响范围

- 所有通过 HDU 机器人提交的评测记录，poller 轮询到结果后会自动设置 score
- 已有的已完成提交（result 非 queuing）不受影响，score 保持为 null

---

## 2026-04-16 (训练评测记录样式对齐)

### 背景

训练模块的评测记录 tab 样式与全局评测记录 SubmissionList 不一致，且 HDU 题目的远程 ID（ojRemoteId）没有对齐。

### 修改

1. **TrainingDetailPage.tsx** — 评测记录表格样式对齐全局 SubmissionList
   - 评测 ID 改为可点击的 `#id` 格式（monospace + primary 色 + 下划线）
   - 新增 OJ 列（显示 `本OJ` / `HDU` 等）
   - 新增代码长度(B) 列
   - 评测结果改为彩色 Badge（Accepted 绿色、WA 红色、TLE 黄色等）
   - 评分结果 Pending/Judging 状态显示旋转动画
   - 表头样式统一：`padding: 0.75rem 1rem`、`fontWeight: 500`、`color: #6b7280`
   - 数据行样式统一：`padding: 0.75rem 1rem`、`color: #1e293b`、`borderBottom: 1px solid #f3f4f6`
   - 语言列点击打开提交详情弹窗
   - 耗时/内存不附加单位后缀（表头已有单位说明）

2. **后端 training.routes.ts**（此前已完成）
   - GET `/trainings/:id/submissions` 返回 `oj` 和 `ojRemoteId` 字段
   - GET `/trainings/:id/submissions/:submissionId` 返回实际 `submission.ojRemoteId`

### 验证

- 前端 `npx tsc --noEmit` 零错误

---

## 2026-04-16 (TypeScript 编译错误修复)

### 背景

后端路由拆分到 `modules/` 目录后，引入了共享包 `@oi-manager/shared` 和全局 Express 类型增强。`tsc --noEmit` 报 48 个 TypeScript 错误（17 个代码错误 + 31 个 declaration 声明文件错误）。

### 修改内容

1. **requestLogger.ts** — 全局 `declare global { namespace Express { interface Request { user? } } }` 与 `auth.ts` 中的声明冲突（两个文件各自声明 `user` 类型不同）。统一使用 `@oi-manager/shared` 的 `JwtPayload` 类型。
2. **school.routes.ts** — Prisma schema 变更后 `School` create 需要 `currentPrincipalTeacherId`；`User` create 需要 `schoolId`（所有用户必须绑定学校）。
3. **team.routes.ts** — ID 校验路由使用了 `prisma` 但未导入，添加 `import { prisma } from '../../prisma'`。
4. **team.service.ts** — `joinedTeams`、`pendingInvitations`、`pendingRequests` 声明为 `unknown[]`，导致 `.map(transformTeamForFrontend)` 类型不匹配。改为 `Record<string, unknown>[]`。
5. **team.types.ts** — `CreateTeamDTO.id` 改为可选字段，team-import 模块调用 `createTeam` 时不提供预生成 ID。
6. **team-import 模块** — 所有 `prisma.user.create()` 添加 `schoolId` 字段；移除 `previewGroup` 不支持的 `includeAvatar` 参数；添加 `getImportHistory` service 方法。
7. **tsconfig.json** — 移除 `declaration: true` 和 `declarationMap: true`。Express 服务器不发布 npm 包，不需要声明文件。pnpm 严格符号链接导致 `@types/express-serve-static-core` 无法被声明文件引用。

### 验证

- `tsc --noEmit` 零错误通过 ✅

### 涉及文件

| 文件 | 变更 |
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

## 2026-04-16 (时区问题 + 导航修复)

### 背景

用户反馈：(1) 训练编辑页面修改标题/公告后提交，报错"训练已经开始，不能修改开始时间"（用户未修改开始时间）；(2) 学生端训练导航 404；(3) 全项目 `router.back()` 在直接访问页面时失效。

### 根因分析

**时区问题**：Node.js 服务器运行在 UTC 时区，用户浏览器在 UTC+8。前端发送 datetime-local 字符串（如 `"2026-04-16T01:00"`，无时区信息），后端 `new Date()` 解析为 UTC 01:00，但实际应为 UTC 17:00（UTC+8 的 01:00）。时间戳比较差 8 小时，导致误判为"修改了开始时间"。

**导航问题**：学生端团队路径为 `/student/team/`（单数），但训练详情页位于 `/student/teams/`（复数），导致 404。

**router.back() 问题**：直接通过 URL 访问页面时无浏览器历史记录，`router.back()` 无法返回。

### 修改

#### 1. 时区修复（P0）

**前端**：发送 UTC ISO 字符串替代 datetime-local 字符串
- `TrainingEditPage.tsx`：`startTime: new Date(startTime).toISOString()`
- `TrainingCreateModal.tsx`：同上

**后端**：`training.routes.ts` PUT `/trainings/:id`
- 检测提交的时间字符串是否含时区信息（`Z` 或 `+HH:MM`）
- 有时区信息且 diff > 60s → 确实修改了时间，拒绝
- 无时区信息时，检查 diff 是否为 ≤14h 的整数小时偏移（时区差异特征）且分钟数相同 → 判定为时区解析差异，允许

#### 2. 学生训练路径修复（P0）

- 移动 `student/teams/[id]/trainings/[tid]/` → `student/team/[id]/trainings/[tid]/`
- 修改 basePath：`"/student/teams"` → `"/student/team"`
- 修复 Carits 题目链接：`split('/teams')` → `split('/team')`

#### 3. router.back() 全项目替换（P1）

将 22 处 `router.back()` 替换为 `router.push(具体路径)`，确保直接访问页面时也能正确导航。保留 4 处公开资料页的 `router.back()`（从多处访问，无单一返回目标）。

#### 4. 训练列表实时状态计算（P1）

训练列表 API 不再返回数据库中的 status 字段，改为根据 startTime/endTime 实时计算。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/src/modules/training/training.routes.ts` | 时区容忍比较 + 列表实时状态 |
| `apps/web/src/components/training/TrainingEditPage.tsx` | 发送 UTC ISO 字符串 + router.back 替换 |
| `apps/web/src/components/training/TrainingCreateModal.tsx` | 发送 UTC ISO 字符串 |
| `apps/web/src/components/training/TrainingDetailPage.tsx` | Carits 链接修复 + router.back 替换 |
| `apps/web/src/components/problem/ProblemDetail.tsx` | router.back 替换（2处） |
| `apps/web/src/components/problem/ProblemForm.tsx` | router.back 替换（2处） |
| `apps/web/src/components/problem/ProblemNote.tsx` | router.back 替换（2处） |
| `apps/web/src/components/problem/NewProblemListPage.tsx` | router.back 替换（2处） |
| `apps/web/src/components/problem/ProblemListDetailPage.tsx` | router.back 替换（1处） |
| `apps/web/src/components/team/TeamDetailPage.tsx` | router.back 替换（1处） |
| `apps/web/src/app/student/team/[id]/trainings/[tid]/page.tsx` | 新建（从 teams 移动） |
| `apps/web/src/app/admin/schools/[id]/page.tsx` | router.back 替换 |
| `apps/web/src/app/admin/users/[id]/page.tsx` | router.back 替换 |
| `apps/web/src/app/admin/users/new-platform-admin/page.tsx` | router.back 替换（2处） |
| `apps/web/src/app/teacher/students/import/*.tsx` | router.back 替换（4处） |

### 验证

1. 前端编辑训练（只改标题/公告）→ 不再报"不能修改开始时间"
2. 前端编辑训练（实际修改开始时间）→ 仍被拒绝
3. curl 发送 datetime-local `"2026-04-16T01:00"` → 不再误判
4. 学生端训练列表 → 点击训练卡片 → 正确跳转训练详情
5. 直接访问题目/题单/团队详情页 → 点击"返回" → 正确跳转到列表

---

## 2026-04-15 (Docker PostgreSQL 迁移)

### 背景

之前 PostgreSQL 因 Docker 网络问题而直接安装在系统上。用户安装好 Docker 后，将 PostgreSQL 迁移到 Docker 容器管理。

### 修改

1. **备份数据**: `pg_dump oi_manager > /tmp/oi_manager_backup.sql`
2. **停止直接安装的 PostgreSQL**: `systemctl stop postgresql && systemctl disable postgresql`
3. **启动 Docker PostgreSQL**: `docker-compose up -d db`
4. **修复 pg_hba.conf**: 将 `scram-sha-256` 改为 `md5` 以兼容密码认证
5. **恢复数据**: `psql oi_manager < backup.sql`
6. **修复测试 setup.ts**: 使用 raw SQL 插入平台学校数据解决循环外键依赖
7. **添加用户到 docker 组**: 免 sudo 运行 docker 命令

### 涉及文件

| 文件 | 操作 |
|------|------|
| `docker-compose.yml` | 已配置 PostgreSQL 16 |
| `apps/server/tests/setup.ts` | 使用 raw SQL 处理循环外键 |

### 验证结果

- **230/230 测试全部通过** ✅
- Docker PostgreSQL 容器正常运行
- 用户已添加到 docker 组

---

## 2026-04-15 (路由文件拆分)

### 背景

`routes/trainings.ts` (1622 行)、`routes/problems.ts` (1633 行)、`routes/schools.ts` (1392 行) 三个文件过大，按 `modules/team/` 的分层模式拆分为独立模块。

### 修改

**`routes/trainings.ts` → `modules/training/`**
- `training.types.ts` — 类型定义
- `training.helpers.ts` — 辅助函数（权限检查、ID 解析、参与者查询）
- `training.routes.ts` — 全部路由端点

**`routes/problems.ts` → `modules/problem/`**
- `problem.types.ts` — 类型定义
- `problem.helpers.ts` — 辅助函数（Carits 题号生成、权限检查）
- `problem.routes.ts` — 全部路由端点 + multer 配置

**`routes/schools.ts` → `modules/school/`**
- `school.types.ts` — 类型定义
- `school.routes.ts` — 全部路由端点

**注册更新**
- `src/index.ts` — import 路径从 `./routes/*` 改为 `./modules/*/`
- `tests/helpers/testRequest.ts` — schoolRouter import 路径更新

**删除**
- `routes/trainings.ts`、`routes/problems.ts`、`routes/schools.ts`

### 影响范围

- 纯代码组织变更，API 行为完全不变
- 229/230 测试通过（1 个 auth 注册测试的已有问题与本次无关）

---

## 2026-04-15 (1000 QPS 架构升级)

### 背景

系统使用 SQLite + 单进程 Express + 前端无缓存，在 1000 QPS 目标下存在多个硬性瓶颈：SQLite 单写锁、限流过低、排名内存计算、无部署配置、无前端缓存。

### 修改

**Phase 1: P0 硬性前提**
- `schema.prisma` provider 从 `sqlite` 改为 `postgresql`
- `.env` DATABASE_URL 改为 `postgresql://oi:oi_password@localhost:5432/oi_manager`
- `.env.production` 新建生产环境模板（密钥占位）
- `scripts/migrate-sqlite-to-pg.ts` 新建数据迁移脚本（按依赖顺序迁移 45 张表）
- `package.json` 新增 `pg` 和 `@types/pg` 依赖
- `rateLimiter.ts` 全局限流 100/分钟 → 2000/分钟，按 userId 或 IP 维度

**Phase 2: P1 性能关键路径**
- `trainings.ts` IOI/ICPC 排名用 `$queryRaw` SQL 聚合替代内存 JS 计算
- `ecosystem.config.js` PM2 cluster 模式（instances: max）
- `docker-compose.yml` PostgreSQL 16 + healthcheck
- `Dockerfile` 多阶段构建（deps → build → production）
- `.dockerignore`
- `apps/web/src/lib/fetcher.ts` SWR fetcher（统一 API 获取）
- `apps/web/src/hooks/useQuery.ts` useQuery hook（5 秒去重、关闭 focus 重验证）
- `apps/web/package.json` 新增 `swr` 依赖

**Phase 3: P2 查询优化**
- `trainings.ts` `isTeamAdmin()` 合并 3 次 DB 查询为 1 次 `findFirst`
- `trainings.ts` `getParticipantNames()` 1 次 JOIN 查询替代 3 次独立查询
- `schema.prisma` Submission 新增 `@@index([userId, oj, problemId])`、`@@index([createdAt, result])`
- `schema.prisma` TrainingSubmission 新增 3 个复合索引
- `next.config.js` 新增 `output: 'standalone'`

**Phase 4: P3 架构改进**
- `nginx/oi-manager.conf` 反向代理配置（API/WebSocket/静态资源缓存）
- 路由文件拆分（trainings → modules/training/）延后到后续迭代

### 影响范围

- 全系统：数据库从 SQLite 切换到 PostgreSQL
- 部署方式：新增 Docker + PM2 + Nginx 配置
- 前端数据获取：新增 SWR 缓存层
- 测试：230 个测试全部通过，测试环境保持 SQLite 隔离

### 潜在风险

- 开发环境需先 `docker compose up -d db` 启动 PostgreSQL
- 测试环境使用 SQLite `test.db`，与生产 PostgreSQL 有细微 SQL 差异（如 `$queryRaw` 模板语法）
- Next.js `output: 'standalone'` 改变了构建产物结构，需验证部署流程

---

## 2026-04-14 (训练详情页 — 新增"题目列表" Tab)

### 背景

训练详情页需要一个类似 Hydro OJ 比赛页面的"题目列表"视图，展示每道题的状态、序号、来源和标题。用户可快速查看题目来源（如 HDU 4000、Carits 1000）并跳转原题链接。

### 修改

**后端新增 API** (`trainings.ts`)
- `GET /trainings/:id/problem-status` — 返回题目列表（含来源、原题链接、当前用户提交状态）
- 查询 TrainingProblem + Problem 获取来源信息
- 查询 TrainingSubmission 聚合当前用户每题最佳成绩
- 使用 OJ adapter 的 getProblemUrl() 生成原题链接
- Carits 内部平台：`platformLabel = "Carits"`，`problemUrl = "__carits__"`，前端构造本地链接
- 所有团队成员可见来源信息（与题面 tab 隐藏来源策略不同）

**前端新增 Tab** (`TrainingDetailPage.tsx`)
- TabType 新增 `problemList`，位于"题面"左侧
- 默认选中"题目列表" tab（进入训练详情页默认看到题目列表）
- 表格 4 列：状态、序号、来源、标题
  - 状态：AC 绿色 `✓ score/max`、非满分红色、未提交灰色 `-/max`
  - 序号：A/B/C...（使用 toExcelColumnName）
  - 来源：Carits 题目链接到题库详情页（`/teacher/problems/{UUID}`），外部 OJ 链接到原题
  - 标题：点击切换到"题面" tab 并选中该题

### 涉及文件

- `apps/server/src/routes/trainings.ts` — 新增 problem-status 端点 + Carits platformLabel 修复
- `apps/web/src/components/training/TrainingDetailPage.tsx` — 新增 problemList tab + 表格 UI

### 回归风险

- 新增 Tab 不影响其他 Tab 功能
- 默认 Tab 从 `problems` 改为 `problemList`，用户进入页面后看到的是题目列表而不是题面

---

## 2026-04-14 (团队训练模块 - UI 对齐 + 编辑功能)

### 背景

训练详情页的题目界面风格与普通题目详情页不一致，按钮样式和布局需要统一。同时缺少编辑训练的入口。

### 修改

**题目选择横向按钮布局** (`TrainingDetailPage.tsx` 重构)
- 三栏布局：左侧题目按钮（140px）+ 中间题面内容 + 右侧操作按钮（150px）
- 左侧题目按钮横向排列（flex-wrap），约 5 个一行
- 右侧操作按钮：写思路（紫色渐变）、提交代码（紫色渐变）、附件
- 提交代码按钮始终显示，训练未开始时灰显并禁用
- Tab 名称"题目列表"改为"题面"

**评测记录筛选功能** (`TrainingDetailPage.tsx` + `trainings.ts`)
- 前端添加筛选栏：题号（下拉）、用户名（输入）、评测结果（下拉）、语言（下拉）
- 后端 submissions API 支持新增筛选参数：username、result、language
- 用户名筛选支持模糊匹配

**排名用户名列** (`trainings.ts` ranking endpoint)
- 排名表格新增"用户名"列（在姓名列之后）
- 后端 ranking API 返回 username 字段

**新增编辑训练功能** (`TrainingEditPage.tsx` 新建)
- 管理员可在训练详情页头部点击"编辑"按钮进入编辑页
- 路由：`/teacher/teams/[id]/trainings/[tid]/edit`
- 支持修改标题、公告、赛制、开始/结束时间
- 支持管理题目（修改别名/分值、添加/移除题目）
- 已开始的训练禁止修改开始时间（后端校验）

**TypeScript 修复**
- `selectedProblem?.attachmentCount ?? 0` 条件表达式修复

### 涉及文件

- `apps/web/src/components/training/TrainingDetailPage.tsx` — 重构题目 tab 布局、添加编辑按钮、提交改为 Modal
- `apps/web/src/components/training/TrainingEditPage.tsx` — 新建编辑页面组件
- `apps/web/src/app/teacher/teams/[id]/trainings/[tid]/edit/page.tsx` — 新建编辑路由

### 回归风险

- TrainingDetailPage 重构布局，需测试三个 tab 的交互
- 新增编辑页面，需测试编辑流程

---

## 2026-04-14 (团队训练模块 - 题目添加方式修复)

### 背景

训练创建弹窗的题目添加方式使用关键词搜索（调用 `/api/problems?keyword=`），与题单模块的交互不一致。题单模块使用 OJ 平台下拉 + 题号输入 + 自动解析的模式，用户体验更好。

### 修改

**题目添加改为 OJ+题号解析** (`TrainingCreateModal.tsx` 完整重写)
- 移除关键词搜索，改为 OJ 平台下拉选择 + 题号输入框
- 500ms debounce 后自动调用 `/api/resolve-problems` 解析题号
- 解析结果显示：题名（绿色 ✓）或"题目不存在"（红色 ✕）
- localStorage 记忆上次使用的 OJ 平台
- 表格显示：OJ、题号、题目名称、别名、分值（IOI）、删除按钮
- 默认别名按 A/B/C... 自动生成

**新增题目解析 API** (`apps/server/src/routes/trainings.ts`)
- 新增 `POST /api/resolve-problems` 端点
- 只需认证，不要求题单 ownership 权限
- 查询逻辑：Carits 平台用 ID/problemId，外部 OJ 用 platform+problemId
- 可见性检查：仅返回公开或用户拥有的题目

**TypeScript 类型修复**
- `TrainingCreateModal.tsx` line 165: `(res.data as any).id` cast
- `TrainingCreatePage.tsx` line 108: `(res.data as any).id` cast

### 涉及文件

- `apps/web/src/components/training/TrainingCreateModal.tsx` — 完整重写（~330行）
- `apps/web/src/components/training/TrainingCreatePage.tsx` — TypeScript fix
- `apps/server/src/routes/trainings.ts` — 新增 `/resolve-problems` 端点

### 回归风险

- TrainingCreateModal 完整重写，需测试创建流程和题目解析
- `/resolve-problems` 新增端点，不影响其他功能

---

## 2026-04-14 (团队训练模块 - 前端核心功能 + 评测回调集成)

### 背景

训练模块前端详情页之前只有题目 tab（题面+思路面板），缺少评测记录、排名、代码提交、题解等核心功能。同时后端评测回调只更新 Submission 表，不支持 TrainingSubmission。

### 修改

**创建训练改为弹窗** (`TrainingCreateModal.tsx` 新建, `TeamTrainingList.tsx` 修改)
- 创建训练按钮改为打开 Modal 弹窗而非跳转页面
- 删除独立的 `apps/web/src/app/teacher/teams/[id]/trainings/new/page.tsx` 路由页面

**训练详情页完整重构** (`TrainingDetailPage.tsx` 重写)
- Tab 导航：题目 | 评测记录 | 排名
- 评测记录 tab：表格列出所有提交，点击行打开详情弹窗（含测试点结果、源代码）
- 排名 tab：IOI（总分+每题分数）、ICPC（通过数+罚时+每题 AC/尝试状态）
- 代码提交面板：训练进行中显示"提交代码"按钮，选择语言+粘贴代码
- 题解面板：查看/编辑题解，管理员可设置可见性
- 提交详情弹窗：测试点表格（状态、分数、耗时、内存）+ 源代码显示

**评测回调支持 TrainingSubmission** (`apps/server/src/ws/judge.ts`)
- handleResult 根据 submissionId 的 `T-` 前缀区分 TrainingSubmission vs Submission
- `T-{id}` 前缀路由到 `prisma.trainingSubmission.update`

**修复训练提交评测调度** (`apps/server/src/routes/trainings.ts`)
- submit 路由正确读取题目的 judgeConfig 和 testdataPath
- 使用 `T-{id}` 前缀调用 dispatchJudgeTask

### 涉及文件

- `apps/web/src/components/training/TrainingCreateModal.tsx` — 新建
- `apps/web/src/components/training/TrainingDetailPage.tsx` — 完整重写
- `apps/web/src/components/training/TeamTrainingList.tsx` — 改为弹窗创建
- `apps/server/src/ws/judge.ts` — handleResult 支持 TrainingSubmission
- `apps/server/src/routes/trainings.ts` — 修复 dispatchJudgeTask 调用
- 删除 `apps/web/src/app/teacher/teams/[id]/trainings/new/page.tsx`

### 回归风险

- `T-` 前缀约定是新增机制，不影响现有 Submission 评测流程
- TrainingDetailPage 完整重写，需测试三个 tab 的加载和交互

## 2026-04-13 (评测系统假配置修复)

### 背景

对比 Hydro OJ 评测引擎（`/home/ecs-user/Hydro/packages/hydrojudge/`），发现 oi-manager 评测系统存在 7 个"假配置"：UI 允许设置但评测时不生效。核心问题是 `judge.ts` 的 `runTestCase` 函数只支持 stdin/stdout 管道 + JS 字符串比较，不支持文件 IO、沙箱 checker 执行等。

### 修改

**P0: File IO 支持** (`apps/judge/src/judge.ts`, `sandbox/client.ts`, `sandbox/local.ts`)
- 当 `config.filename` 设置时，程序通过 `{filename}.in` / `{filename}.out` 文件读写而非 stdin/stdout
- go-judge 模式: copyIn 提供输入文件 + copyOut 捕获输出文件
- 本地模式: 写入 workDir 文件 + 读取输出文件

**P0: 自定义 Checker 沙箱执行** (`apps/judge/src/judge.ts`)
- 新增 `CheckerContext` 接口封装 checker 信息
- 编译阶段编译 checker 源码（如果需要沙箱执行）
- `runCheckerInSandbox()` 支持 testlib/lemon/hustoj/qduoj/syzoj/kattis 6 种格式
- 每种格式按 Hydro 规范传入命令行参数和文件

**P1: 额外文件支持** (`apps/judge/src/types.ts`, `judge.ts`, `sandbox/client.ts`, `sandbox/local.ts`)
- `ProblemConfig` 新增 `user_extra_files`、`judge_extra_files`、`langs`、`manager`、`num_processes` 字段
- 额外文件通过 `extraCopyIn` 传入沙箱

**P1: 语言限制检查** (`apps/judge/src/judge.ts`)
- 评测前检查提交语言是否在允许列表中

**基础改动** (`sandbox/client.ts`)
- `sandbox.execute()` 新增 `filename`、`extraCopyIn` 参数
- `runCommand` 改为 export
- `sandboxExecute` 重构为支持 File IO 模式

**基础改动** (`sandbox/local.ts`)
- `localExecute` 新增 `filename`、`extraCopyIn` 参数
- File IO 模式: 写入输入文件 + 不管道 stdin + 读取输出文件
- 额外文件: 写入 workDir

### 第三轮修复：交互题、通信题、提交答案题

**交互题 (`interactive`)** (`apps/judge/src/judge.ts`)
- 新增 `judgeInteractive()` 和 `runInteractiveCase()` 函数
- 读取 testdata 目录下的 interactor 源码并编译
- 使用 `runPiped` / `runPipedLocal` 创建用户程序和 interactor 的双向管道
- pipeMapping: user stdout → interactor stdin (fd 0), interactor stdout → user stdin (fd 0)
- 解析 interactor stderr（testlib 格式）获取评测结果
- 支持部分分（partially correct / points）

**通信题 (`communication`)** (`apps/judge/src/judge.ts`)
- 新增 `judgeCommunication()` 和 `runCommunicationCase()` 函数
- 读取 testdata 目录下的 manager 源码并编译
- 使用 `runPiped` 创建 N 个用户进程 + 1 个 manager 进程
- pipeMapping: manager fd(p*2+3) 接收 user[p] stdout, manager fd(p*2+4) 发送到 user[p] stdin
- manager stdout 输出分数百分比（0-100），stderr 输出消息
- 本地模式暂不支持（管道连接复杂），返回 System Error 提示使用 go-judge

**提交答案题 (`submit_answer`)** (`apps/judge/src/judge.ts`)
- 新增 `judgeSubmitAnswer()` 函数
- 简化实现：用户提交的 code 直接作为答案内容，用于所有测试点
- 使用 checker 比对答案文件（支持沙箱 checker 和 JS checker）

**题目类型分发** (`apps/judge/src/judge.ts`)
- 主 `judge()` 函数新增 problemType 路由逻辑
- `cfg.type === 'interactive'` → 调用 `judgeInteractive()`
- `cfg.type === 'communication'` → 调用 `judgeCommunication()`
- `cfg.type === 'submit_answer'` → 调用 `judgeSubmitAnswer()`
- default / objective / 未指定 → 继续原有评测流程

**本地模式 runPiped** (`apps/judge/src/sandbox/local.ts`)
- 新增 `runPipedLocal()` 函数，使用 Node.js child_process 实现进程间管道连接
- 新增 `LocalPipedResult` 接口（status、exitStatus、time、memory、stdout、stderr、files）
- 支持 pipeMapping 配置，连接不同进程的 stdin/stdout

### 已修复的假配置（完整清单）

1. File IO (`filename`) — ✅ 已修复
2. 自定义 Checker 源码执行 — ✅ 已修复
3. Interactor（交互题）— ✅ 已修复
4. Manager + 多进程通信题 — ✅ 已修复
5. 提交答案题 — ✅ 已修复
6. 额外文件 (`user_extra_files`) — ✅ 已修复
7. 语言限制 (`langs`) — ✅ 已修复

### 第二轮修复

**Checker 源码读取** (`apps/judge/src/judge.ts`)
- 前端 `config.checker` 只传文件名（如 `{ file: "checker.cpp", lang: "cpp17" }`），不传源码
- 评测引擎现在从 `testdataPath` 目录读取 checker 源码文件再编译

**ignoreTrailingSpace 开关** (`JudgeSettingsTab.tsx`, `judge.ts`, `types.ts`)
- 前端现在将 `ignore_trailing_space` 保存到 config
- 评测引擎：当 `ignore_trailing_space=false` 且 `checker_type=default` 时，自动切换为 strict checker

**子任务提前终止** (`apps/judge/src/judge.ts`)
- min 类型：一个用例失败后，剩余用例跳过（标记为 System Error）
- max 类型：一个用例获得满分后，剩余用例跳过

**Checker workDir 清理** (`apps/judge/src/judge.ts`)
- 编译 checker 后创建的临时目录现在在评测完成后正确清理
- go-judge 模式下 checker 的 fileId 也会删除

**Config 字段映射** (`apps/judge/src/types.ts`)
- `CompilableSource` 新增 `lang` 字段（前端传的简写形式，与 `language` 等价）
- `ProblemConfig` 修复 `num_processes` 重复定义

---

## 2026-04-12 (评测配置持久化修复)

### 主保存按钮集成评测配置保存

**背景**: 用户反馈 FileIO、Checker 等评测配置保存后重新进入丢失。根因：ProblemForm 的主"保存"按钮只调用 `PUT /:id` 保存基础信息（标题、题面、时间/内存限制），不会保存 `judgeConfig`（YAML 格式的完整评测配置）。JudgeSettingsTab 有独立的"保存评测配置"按钮，但用户自然地点击主保存按钮后离开页面。

**修改**:
- `apps/web/src/components/problem/JudgeSettingsTab.tsx`:
  - 使用 `forwardRef` + `useImperativeHandle` 暴露 `saveConfig()` 方法
  - 导出 `JudgeSettingsTabHandle` 接口供 ProblemForm 使用
- `apps/web/src/components/problem/ProblemForm.tsx`:
  - 创建 ref 并传给 JudgeSettingsTab
  - `handleSubmit` 中主 `PUT /:id` 成功后，编辑模式下自动调用 `judgeSettingsRef.current?.saveConfig()` 保存评测配置

**影响范围**: 编辑题目页面（Carits 平台题目）。主保存按钮现在会同时保存基础信息和评测配置。

**回归风险**: 低。仅影响保存流程，增加了评测配置保存调用。评测配置保存失败不影响基础信息的保存。

**涉及文件**:
- `apps/web/src/components/problem/JudgeSettingsTab.tsx`
- `apps/web/src/components/problem/ProblemForm.tsx`

---

## 2026-04-12 (子任务配置自动保存)

### 子任务编辑后自动保存到后端

**背景**: 用户反馈子任务配置保存后再次进入丢失。根因：所有修改子任务的操作（自动配置、添加、删除、编辑、分配/移除测试点）仅更新本地 React 状态，不会自动保存到后端。用户需额外点击"保存配置"按钮，容易被忽略。

**修改**:
- `apps/web/src/components/problem/JudgeSettingsTab.tsx`:
  - 提取 `buildConfig()` 函数，支持传入自定义 subtasks 参数构建配置对象
  - 新增 `updateSubtasksAndSave()` 辅助函数：更新状态 + 自动保存
  - **所有子任务修改操作均改为自动保存**：`autoConfigure`、`addSubtask`、`deleteSubtask`、`saveEditSubtask`、`assignCasesToSubtask`、`removeCaseFromSubtask`
  - 替换所有 `confirm()` 为 `ConfirmModal` 组件（删除子任务、删除测试数据文件）
  - 添加前后端 `console.log` 调试日志
- `apps/server/src/routes/problems.ts`: GET/PUT judge-config 端点添加调试日志

**涉及文件**:
- `apps/web/src/components/problem/JudgeSettingsTab.tsx`
- `apps/server/src/routes/problems.ts`

---

## 2026-04-12 (评测配置持久化 + 子任务分数显示)

### 评测配置加载后子任务自动展开 + 子任务分数保存与展示

**背景**: 评测配置了子任务并保存后，再进入页面子任务处于折叠状态，用户误以为配置丢失。同时评测机的 `subtasks` 结果数据未保存到数据库，导致提交详情页无法显示子任务级别分数。

**修改**:
- `apps/web/src/components/problem/JudgeSettingsTab.tsx`: 加载配置后自动展开所有已保存的子任务
- `apps/server/prisma/schema.prisma`: Submission 模型新增 `subtasks String?` 字段
- `apps/server/src/ws/judge.ts`: 保存评测结果时同时保存 `subtasks` JSON
- `apps/server/src/routes/submissions.ts`: GET /:id 返回解析后的 `subtasks` 数据
- `apps/web/src/components/submission/SubmissionDetailPage.tsx`: 测试点表格支持子任务分组显示，每个子任务显示标题行（ID + 测试点数 + 评分方式 + 得分）和对应的测试点行

**涉及文件**:
- `apps/web/src/components/problem/JudgeSettingsTab.tsx`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/ws/judge.ts`
- `apps/server/src/routes/submissions.ts`
- `apps/web/src/components/submission/SubmissionDetailPage.tsx`

---

## 2026-04-11 (评测设置 Beta 完整实现)

### 评测设置三栏配置编辑器 + 子任务依赖

**背景**: 参考 Hydro OJ 的评测设置界面，将 Carits 的评测设置从基本骨架升级为完整配置编辑器。Judge 引擎已支持 subtask/评分方式等，但前端缺少 UI 来编辑这些字段。

**修改**:
- `apps/web/src/components/problem/JudgeSettingsTab.tsx`: **完整重写** — 三栏布局（YAML 预览 + 配置表单 + 测试数据管理）
  - 基础 Tab：题目类型分段选择（传统题/交互题/通信题/提交答案题/客观题）、Checker（默认+忽略行末空格/testlib 预设+自定义/其他接口）、FileIO 前缀、Interactor/Manager 文件选择、通信题进程数、提交答案题 Multi-file 开关、额外文件、语言限制多选
  - 子任务 Tab：全局时间/内存、自动配置（按文件名前缀分组）、添加/删除子任务、编辑子任务（分值/时间覆盖/依赖/评分方式 min/max/sum）、测试点分配/移除
  - YAML 只读预览：实时从 config 对象生成 config.yaml 格式
  - 右栏测试数据：上传/列表/删除（从底部迁移到右栏）
- `apps/judge/src/types.ts`: SubtaskConfig 新增 `if?: number[]` 依赖字段
- `apps/judge/src/judge.ts`: 子任务评测增加依赖检查 — 依赖未通过的子任务自动跳过，测试点标记为 System Error
- `apps/web/package.json`: 新增 `js-yaml` + `@types/js-yaml` 依赖

**影响范围**: 评测设置 UI、Judge 引学子任务处理、评测配置数据结构

---

## 2026-04-11 (提交详情页链接优化)

### 评测ID 可点击 + 默认头像修复

**问题**: 题目详情页评测记录 tab 的评测ID 是纯文本不可点击；提交详情页默认头像为灰色，与系统风格不一致。

**修改**:
- `apps/web/src/components/problem/ProblemDetail.tsx`: 评测ID 列改为可点击链接，根据角色跳转到对应提交详情页
- `apps/web/src/components/submission/SubmissionDetailPage.tsx`: 默认头像改为蓝色圆+白色首字母，与系统其他位置一致

**影响**: 题目页的评测记录可一键跳转到详情页；未上传头像的用户在详情页显示蓝色默认头像。

---

## 2026-04-11 (提交详情页 Hydro 风格改造)

### 对齐 Hydro OJ 的提交详情页布局

**问题**: 提交详情页布局与 Hydro 不一致，头像链接有 bug，没有可视化测试点摘要，分数不突出。

**修改**:
- `apps/server/src/routes/submissions.ts`: 修复错误的三元表达式（line 160 `user.avatar || user.Teacher?.name ? null : null` 始终返回 null）
- `apps/web/src/components/submission/SubmissionDetailPage.tsx`: 完整重写
  - 参考 Hydro `record_detail.html` 布局：左 9/12 + 右 3/12
  - 状态栏：图标 + 分数（颜色渐变）+ 结果文字 + 测试点色条摘要
  - 测试点表格：左侧彩色边框（绿/红），Hydro 风格
  - 统计摘要栏：Score / Total Time / Peak Time / Peak Memory
  - 代码区：默认展开，语法高亮
  - 右侧信息栏：Submit By（含头像）、Problem、Language、Code Length、Submit At、Remote ID

**影响**: 提交详情页现在与 Hydro OJ 风格一致，测试点通过/失败一目了然，分数醒目显示。

---

## 2026-04-11 (ProblemNote 题面显示修复)

### 修复写思路页面看不到题面的问题

**问题**: ProblemNote 使用旧的 `description`/`statementType` 字段显示题面，但多版本题面的题目这些字段为空。

**修改**: `apps/web/src/components/problem/ProblemNote.tsx`
- 添加 `Statement` 接口和 `statements` 字段
- 优先使用 `statements[]` 选择题面（中文 markdown → 任意 markdown → 第一个可见）
- 保留旧字段作为回退

**影响**: 使用多版本题面（ProblemStatement 表）的题目现在能在写思路页面正常显示题面。

---

## 2026-04-11 (提交记录详情页)

### 新增独立提交详情页

**背景**: 评测记录列表中点击评测 ID 可跳转到独立详情页，显示逐测试点结果、分数、提交者信息、源码。

**修改文件**:
- `apps/server/prisma/schema.prisma` — Submission 添加 score、cases 字段
- `apps/server/src/ws/judge.ts` — 保存 score + cases JSON
- `apps/server/src/routes/submit.ts` — Carits 提交设置 ojRemoteId
- `apps/server/src/routes/submissions.ts` — GET /:id 增强返回数据
- `apps/web/src/components/submission/SubmissionDetailPage.tsx` — 新建详情页组件
- 3 个路由页面 (teacher/student/platform-admin)
- `apps/web/src/components/submission/SubmissionList.tsx` — 评测 ID 可点击
- `apps/web/src/components/submission/SubmissionDetailModal.tsx` — Carits 远程链接

---

## 2026-04-10 (Carits 本地评测功能 - 全部完成)

### 添加 Carits 平台自建题目的本地评测功能

**背景**: OI Manager V2 的 carits 平台自建题目目前无法进行本地评测，只能通过 VJudge 代理提交到其他 OJ。需要为 carits 平台添加本地评测功能。

**已完成内容**:

1. **数据模型扩展**:
   - Problem 模型添加 `problemType` 字段（default/interactive/objective/submit_answer/communication）
   - 新增 `TestdataFile` 模型（测试数据文件管理）

2. **后端 API**:
   - 测试数据管理：上传、列表、删除、自动识别测试数据对
   - 评测配置：获取和保存评测配置（YAML 格式）
   - WebSocket 评测机服务端：接收评测机注册、分发任务、处理结果
   - submit.ts 路由改造：carits 平台题目走本地评测

3. **前端界面**:
   - ProblemForm 添加「评测设置」Tab（仅 carits 平台题目显示）
   - 支持题目类型、校验器、时间/内存限制设置
   - 支持测试数据上传和管理

4. **评测机服务** (apps/judge/):
   - 独立 Node.js 项目
   - WebSocket 客户端连接后端
   - 支持 go-judge 沙箱模式和 Windows 本地执行模式
   - 8 种 Checker 实现（default/strict/testlib/lemon/hustoj/qduoj/syzoj/kattis）
   - 支持 C/C++（c, c11, cpp, cpp11, cpp14, cpp17, cpp20）

5. **Windows 本地执行模式**:
   - 自动检测 go-judge 可用性
   - Windows 环境自动切换到本地执行模式
   - 已验证：A+B 问题测试通过

**涉及文件**:
- `apps/server/prisma/schema.prisma` — Problem.problemType, TestdataFile 模型
- `apps/server/src/routes/testdata.ts` — 新建测试数据 API
- `apps/server/src/routes/problems.ts` — 添加 judge-config 端点
- `apps/server/src/routes/submit.ts` — carits 平台本地评测路由
- `apps/server/src/ws/judge.ts` — WebSocket 评测机服务端
- `apps/server/src/index.ts` — 初始化 WebSocket 服务
- `apps/web/src/components/problem/ProblemForm.tsx` — 添加评测设置 Tab
- `apps/web/src/components/problem/JudgeSettingsTab.tsx` — 新建评测设置组件
- `apps/judge/` — 新建评测机项目（含沙箱客户端、Checker、评测核心）

**影响范围**: carits 平台题目的评测设置、本地评测
**风险**: 低 — 新增功能，不影响其他模块

---

## 2026-04-10 (Carits 本地评测功能 - Phase 1-4)

### 添加 Carits 平台自建题目的本地评测功能

**背景**: OI Manager V2 的 carits 平台自建题目目前无法进行本地评测，只能通过 VJudge 代理提交到其他 OJ。需要为 carits 平台添加本地评测功能。

**已完成内容**:

1. **数据模型扩展**:
   - Problem 模型添加 `problemType` 字段（default/interactive/objective/submit_answer/communication）
   - 新增 `TestdataFile` 模型（测试数据文件管理）

2. **后端 API**:
   - 测试数据管理：上传、列表、删除、自动识别测试数据对
   - 评测配置：获取和保存评测配置（YAML 格式）
   - WebSocket 评测机服务端：接收评测机注册、分发任务、处理结果
   - submit.ts 路由改造：carits 平台题目走本地评测

3. **前端界面**:
   - ProblemForm 添加「评测设置」Tab（仅 carits 平台题目显示）
   - 支持题目类型、校验器、时间/内存限制设置
   - 支持测试数据上传和管理

4. **评测机服务** (apps/judge/):
   - 独立 Node.js 项目
   - WebSocket 客户端连接后端
   - go-judge 沙箱客户端
   - 多种 Checker 实现（default/strict/testlib/lemon 等）
   - 支持 14+ 种编程语言

**待完成**: Phase 5（语言环境配置、go-judge 部署）

**涉及文件**:
- `apps/server/prisma/schema.prisma` — Problem.problemType, TestdataFile 模型
- `apps/server/src/routes/testdata.ts` — 新建测试数据 API
- `apps/server/src/routes/problems.ts` — 添加 judge-config 端点
- `apps/server/src/routes/submit.ts` — carits 平台本地评测路由
- `apps/server/src/ws/judge.ts` — WebSocket 评测机服务端
- `apps/server/src/index.ts` — 初始化 WebSocket 服务
- `apps/web/src/components/problem/ProblemForm.tsx` — 添加评测设置 Tab
- `apps/web/src/components/problem/JudgeSettingsTab.tsx` — 新建评测设置组件
- `apps/judge/` — 新建评测机项目

**影响范围**: carits 平台题目的评测设置、本地评测
**风险**: 低 — 新增功能，不影响其他模块

---

## 2026-04-10 (Carits 本地评测功能 - Phase 1-2)

### 添加 Carits 平台自建题目的本地评测设置功能

**背景**: OI Manager V2 的 carits 平台自建题目目前无法进行本地评测，只能通过 VJudge 代理提交到其他 OJ。需要为 carits 平台添加本地评测功能。

**已完成内容**:

1. **数据模型扩展**:
   - Problem 模型添加 `problemType` 字段（default/interactive/objective/submit_answer/communication）
   - 新增 `TestdataFile` 模型（测试数据文件管理）
   - `prisma db push` 已执行

2. **后端 API**:
   - `GET /api/problems/:id/testdata` — 获取测试数据列表
   - `POST /api/problems/:id/testdata` — 上传测试数据（支持多文件）
   - `DELETE /api/problems/:id/testdata/:fileId` — 删除测试数据
   - `POST /api/problems/:id/testdata/auto` — 自动识别测试数据对
   - `GET /api/problems/:id/judge-config` — 获取评测配置
   - `PUT /api/problems/:id/judge-config` — 保存评测配置

3. **前端界面**:
   - ProblemForm.tsx 添加「评测设置」Tab（仅 carits 平台题目显示）
   - 创建 `JudgeSettingsTab.tsx` 组件
   - 支持题目类型、校验器类型、时间/内存限制设置
   - 支持测试数据上传、列表、删除
   - 自动识别 .in/.out 测试数据对

**待完成**: Phase 3-5（评测机服务、后端调度、语言环境）

**涉及文件**:
- `apps/server/prisma/schema.prisma` — Problem.problemType, TestdataFile 模型
- `apps/server/src/routes/testdata.ts` — 新建测试数据 API
- `apps/server/src/routes/problems.ts` — 添加 judge-config 端点
- `apps/server/src/index.ts` — 注册 testdata 路由
- `apps/web/src/components/problem/ProblemForm.tsx` — 添加评测设置 Tab
- `apps/web/src/components/problem/JudgeSettingsTab.tsx` — 新建评测设置组件

**影响范围**: carits 平台题目的评测设置
**风险**: 低 — 新增功能，不影响其他模块

---

## 2026-04-10 (HDU 提交登录控制优化)

### HDU 提交代理解登录控制、Cookie 复用、失败冷却机制

**背景**: HDU 提交一直返回 403 错误，经排查发现登录成功后 Cookie 未保存到数据库。

**问题根因**: `hdu-submit.ts` 中登录成功后只更新了 `lastLoginAt`，没有保存 `cookie` 和 `cookieRaw` 字段，导致下次提交时 `cookie` 为 null。

**变更内容**:

1. **Bug 修复**: 登录成功后保存 `cookie` 和 `cookieRaw` 到数据库
2. **登录控制**: 实现 Cookie 复用逻辑，根据 `cookieValidMinutes` 和 `renewLoginThresholdMinutes` 判断是否需要续登
3. **失败冷却**: 登录失败后进入 `loginFailureCooldownMinutes` 分钟冷却期
4. **账号冻结**: 连续失败 `maxConsecutiveFailures` 次后账号状态变为 `error`
5. **累计统计**: 添加 `totalSubmissions` 和 `totalSubmissionErrors` 字段（只增不减）
6. **文档更新**: 更新 `docs/oj-submit/` 目录下的 README.md 和 hdu.md

**OjAccount 模型新增字段**:
- `lastLoginAt` — 最后成功登录时间
- `lastLoginFailureAt` — 最后登录失败时间
- `lastSubmitAt` — 最后提交时间
- `consecutiveFailures` — 连续失败次数
- `totalSubmissions` — 累计提交次数
- `totalSubmissionErrors` — 累计提交失败次数
- `cookieValidMinutes` — Cookie 预期有效期（默认 3600 分钟）
- `renewLoginThresholdMinutes` — 提前续登阈值（默认 10 分钟）
- `loginFailureCooldownMinutes` — 登录失败冷却时间（默认 15 分钟）

**验证结果**: 使用账号 `carits` 成功提交 HDU 1000，Run ID 40832719，结果 Accepted

**涉及文件**:
- `apps/server/src/lib/hdu-submit.ts` — 登录控制逻辑、Cookie 保存
- `apps/server/prisma/schema.prisma` — OjAccount 模型字段
- `apps/server/src/routes/oj-accounts.ts` — 前端显示"最后登录"而非"最后验证"
- `apps/web/src/app/platform-admin/oj-accounts/page.tsx` — 提交统计柱状图
- `docs/oj-submit/README.md` — 通用登录控制设计
- `docs/oj-submit/hdu.md` — HDU 具体实现

**影响范围**: OJ 账号池管理、HDU 提交代理
**风险**: 低 — 修复 Bug + 新增功能，不影响其他模块

---

## 2026-04-08 (学校题单 & 团队题单)

### 新增学校题单和团队题单收录功能

**背景**: 学校和团队需要维护自己的题单推荐库，教师/负责人可以将自己创建的个人题单收录到学校或团队的题单库中。

**变更内容**:
- 新增 `SchoolProblemList` 和 `TeamProblemList` 数据模型（Prisma schema）
- 后端新增 6 个 API 端点（GET/POST/DELETE 各 3 个）
- 前端学校页面新增「题单库」tab
- 前端团队详情页「题单」tab 从占位改为真实功能
- 新增 20 个 API 测试（学校 10 + 团队 10）

**权限规则**:
- 学校：负责人+教师可添加自己是 owner 的题单，负责人可删所有，教师只能删自己添加的
- 团队：owner/admin/教师成员可添加，owner 可删所有，非 owner 只能删自己添加的

**影响范围**: 题单模块、学校页面、团队详情页
**风险**: 低 — 纯新增功能，不影响现有个人题单逻辑

## 2026-04-07 (题单模块移除归档功能)

### 题单模块移除归档功能，删除改为硬删除

**背景**: ProblemList 的归档（archive）功能实际使用场景有限，且 `status` 字段增加了查询复杂度。决定简化为直接硬删除。

**变更内容**:

1. **Prisma Schema**: `ProblemList` 模型移除 `status` 字段（不再有 active/archived/deleted 状态），`visibility, status` 复合索引简化为 `visibility` 单字段索引
2. **后端 API**: 移除 `POST /api/problem-lists/:id/archive` 端点；`DELETE /api/problem-lists/:id` 改为硬删除
3. **文档**: 6 个文件同步更新，移除所有归档相关描述

**影响模块**: 题单管理模块（前端 + 后端）

**涉及文件**:
- `apps/server/prisma/schema.prisma` — 移除 status 字段
- `docs/SYSTEM_MAP.md` — API 路由表、模型字段
- `docs/MODULE_INDEX.md` — 题单模块 API 和功能描述
- `docs/api/API_REFERENCE.md` — 题单管理接口
- `docs/database/DATABASE_MODELS.md` — ProblemList 模型字段和索引
- `docs/current-task.md` — 任务记录
- `docs/change-log.md` — 变更日志

## 2026-04-07 (题单模块旧代码清理)

### 题单模块旧代码和文档全面清理

**背景**: 项目已从旧的 `TaskList/Task/TaskProgress` 题单系统迁移到新的 `ProblemList` 飞书文档式权限题单系统（`problem-lists` 路由），但旧的模型、占位页、文档引用一直未清理。

**清理内容**:

1. **Prisma Schema**: 删除 `Task`、`TaskList`、`TaskProgress` 三个旧模型
   - 移除 `Student` 模型中的 `TaskProgress` 关联引用
   - 移除 `Teacher` 模型中的 `TaskList` 关联引用
   - 执行 `prisma db push --accept-data-loss` 同步数据库

2. **前端**: 删除旧占位页 `apps/web/src/app/student/task-lists/page.tsx`（"功能暂未开放"页面）

3. **Seed 数据**: 移除 `seed.ts` 中对旧 TaskList/Task/TaskProgress 的种子数据创建

4. **测试配置**: 清理 `tests/setup.ts` 中的旧表名引用

5. **文档全面更新**（8 个文件）:
   - `docs/MODULE_INDEX.md` — 题单模块改为 Problem Lists，完整 API 列表
   - `docs/SYSTEM_MAP.md` — 路由、API、数据模型、ER 图全部更新
   - `docs/api/API_REFERENCE.md` — 题单管理接口替换为新 API
   - `docs/api/FIELD_CONTRACT.md` — 移除旧模型关联字段
   - `docs/database/DATABASE_MODELS.md` — 旧模型文档替换为 ProblemList 四模型
   - `docs/PROJECT_OVERVIEW.md` — 题单状态改为已完成
   - `docs/HANDOVER.md` — 数据关系和状态更新
   - `docs/KNOWN_ISSUES.md` — 移除 "题单执行闭环未完成" 条目
   - `docs/AUTH_AND_PERMISSION.md` — API 路径更新

**影响**: 纯清理操作，不影响现有 ProblemList 功能

## 2026-04-06 (团队模块 ID 歧义修复 + 全面审计)

### 团队模块 ID 歧义 bug 修复

**Bug 描述**: `POST /:id/admins` 和 `DELETE /:id/admins/:adminId` 两个端点存在 ID 类型混淆。`request body` 中的 `memberId`/`adminId` 参数实际发送的是 Teacher/Student profile ID，但后端使用 `findMemberById()` 查找 TeamMember 记录 ID，导致查找失败返回"该成员不存在"。

**修复方案**: 攣用 `findMember({ teamId, userId, userType })` 复合唯一键查找替代 `findMemberById()`
并清理了 `DELETE /:id/admins/:adminId` 中构建了 `whereClause` 但从未使用的死代码。

**手动测试**: 16 个场景全部通过（16 passed, 0 failed)

 0 failed)

**涉及文件**:
- `apps/server/src/modules/team/team.routes.ts` — 修复 2 个端点 + 添加 ID 语义注释 + 清理死代码
- `docs/team/TEAM_API_CONTRACT.md` — 修正 4 处 ID 语义说明
- `docs/team/TEAM_TEST_SCENARIOS.md` — 新建 46 个测试场景文档
- `docs/current-task.md` — 更新当前任务
- `docs/change-log.md` — 记录审计变更

**影响模块**: 团队管理模块（设置管理员、取消管理员、成员管理）

**回归风险**: 低（兼容模式保留了 `findMemberById` 回退路径）

**不涉及**: 前端其他组件、数据库结构、权限体系、业务逻辑

---

## 2026-04-06 (全面替换浏览器原生弹窗)



### 替换 prompt/alert/confirm 为自定义 UI 组件

**背景**: 项目前端有约 169 处浏览器原生弹窗调用（`prompt()` 3 处、`alert()` 149 处、`confirm()` 17 处），体验差、不可定制。全面替换为自定义 UI 组件。

**新增组件**:
1. `components/ui/Toast.tsx` — Toast 通知系统（ToastProvider + useToast hook + showToastNotification 独立函数）
2. `components/ui/PasswordResetModal.tsx` — 密码重置弹窗（替代 prompt）
3. 已有 `ConfirmModal.tsx` — 确认弹窗（替代 confirm），补充 `danger`/`loading` props

**替换统计**:
- `prompt()` 3 处 → PasswordResetModal
- `alert()` 149 处 → toast.success/error/warning
- `confirm()` 17 处 → ConfirmModal + useState 模式

**涉及文件**（约 30+ 个）:
- 团队组件 6 个: TeamDetailPage, TeamEditModal, TeamTransferModal, TeamInviteModal, TeamInviteListModal, TeamHeader
- 管理页面: admin/users, platform-admin/users, platform-admin/problems
- 导入页面: ImportPreview, vjudge/page, luogu/page, students/import/page
- 学校组件: TeachersTab, HomeTab, EditSchoolModal
- 题目组件: ProblemForm, ProblemDetail, ProblemNote
- 学生端: student/team, student/team/browse
- 题单页面: problem-lists/[id], problem-lists/[id]/[pageId]
- 其他: ProfileEditor, PasswordEditor, MarkdownRenderer, PasswordResetModal, hooks/useDelete, hooks/useToggleStatus
- hooks: useDelete, useToggleStatus
- 班级页面: teacher/classes, teacher/students
- 按需挂载: Providers.tsx 包裹 ToastProvider

**验证**: `grep -r '\b(alert|confirm|prompt)\(' apps/web/src --include='*.tsx'` → 0 匹配

**影响模块**: 前端全部页面和组件的用户反馈

**不涉及**: 后端代码、数据库、权限逻辑、业务逻辑

**同步更新文档**: KNOWN_ISSUES.md（标记 8.2 为已解决）、current-task.md、COMPONENTS.md（新增 Toast/PasswordResetModal 文档）

---

## 2026-04-05 (导入功能修复 + teamCode彻底清除)

### 修复导入 500 错误 + 清除所有 teamCode 残留

**背景**: VJudge 导入接口在 `createTeam: true` + `teamId` 时返回 500 "团队不存在"。同时需彻底清除所有 `teamCode` 引用。

**修复的 Bug**:
1. **导入 createTeam 逻辑错误**: `if (request.createTeam && !request.teamId)` 导致 `createTeam: true` + `teamId` 时走入 else 分支查询不存在的团队。改为 `if (request.createTeam)`。
2. **teamCode 彻底清除**: `team-import.types.ts`、`team-import.routes.ts`、`vjudge-import.service.ts`、`luogu-import.service.ts` 中所有 `teamCode` 改为 `teamId`。
3. **前端导入页面 defaultTeamId**: VJudge 导入页面 `defaultTeamCode` → `defaultTeamId`（Luogu 页面同步修复），并用 `.replace(/[^a-zA-Z0-9_]/g, '_')` 确保格式合法。

**测试结果**: 导入修复测试 3/4 通过（第4项为 createTeam=false+无teamId 不报错，行为合理）。

**涉及文件**: `vjudge-import.service.ts`, `luogu-import.service.ts`, `team-import.types.ts`, `team-import.routes.ts`, `teacher/team-import/vjudge/page.tsx`, `teacher/team-import/luogu/page.tsx`

---

## 2026-04-05 (团队功能测试 + Bug修复)

### 全面测试团队功能并修复 3 个 Bug

**背景**: 合并 `id`/`teamCode` 后，对团队全功能进行自动化测试。

**修复的 Bug**:
1. **路由顺序 bug**: `GET /check-team-id` 在 `GET /:id` 之后注册，Express 参数路由优先匹配，导致 check-team-id 永远返回"团队不存在"。修复：将 check-team-id 移至 `/:id` 之前。
2. **countMembers 过滤字段错误**: `countMembers(teamId, excludeMemberId)` 用 `{ id: { not: excludeMemberId } }` 排除，但 `id` 是 TeamMember 记录 UUID，调用者传的是 teacherId/studentId（即 `userId` 字段值），排除永远不生效→解散团队时总提示"还有其他成员"。修复：改为 `{ userId: { not: excludeUserId } }`。
3. **leaveTeam 传参错误**: `leaveTeam` 传 `member.id`（TeamMember 记录 UUID）给 `countMembers`，应传 `member.userId`。

**测试结果**: 基础团队功能 23/23 通过，导入相关 8/8 通过。

**涉及文件**: `team.routes.ts`, `team.repository.ts`, `team.service.ts`

---

## 2026-04-05 (合并团队ID)

### 合并 Team.id 和 teamCode，用 id 替代 teamCode

**背景**: Team 模型有 `id`(UUID) 和 `teamCode`(用户自定义) 两个字段，功能重复。将其合并为一个 `id` 字段，由用户在创建时指定。

**改动**:
1. `schema.prisma`: 删除 `teamCode` 字段；`id` 从 `@default(uuid())` 改为用户提供的值
2. `team.types.ts`: `CreateTeamDTO` 移除 `teamCode`，3. `team.service.ts`: `createTeam` 移除 UUID 生成，用 `dto.id`
4. `team.routes.ts`: `check-team-code` → `check-team-id`；创建时用 `id` 替代 `teamCode`
5. `vjudge-import.service.ts` / `luogu-import.service.ts`: `teamCode` → `teamId`（参数名保持 `teamCode` 用于传递）
6. 前端组件: 所有 `teamCode` 引用改为 `teamId`/`id`
7. 数据迁移: 53个团队的 id 从 UUID 格式迁移为 teamCode 值（下划线格式）

**影响**: 创建团队时用户必须提供 ID（只允许 `[a-zA-Z0-9_]+`，2-50字符），创建后不可修改

---

## 2026-04-05 (团队标识必填)

### 团队标识(teamCode)改为必填+唯一

**背景**: 用户要求 teamCode 从数据库层面就是必填且唯一的标识，不可为空。

**改动**:
1. `schema.prisma`: `teamCode String? @unique` → `teamCode String @unique`（必填）
2. `team.types.ts`: `CreateTeamDTO.teamCode` 从可选改为必填
3. `team.service.ts`: 移除 `|| null` 兜底
4. `team.routes.ts`: 创建团队路由增加 teamCode 格式校验
5. `vjudge-import.service.ts` / `luogu-import.service.ts`: 移除 `|| null` 兜底
6. `TeamListPage.tsx`: 创建表单 teamCode 改为必填标记 + disabled 条件
7. `ImportPreview.tsx`: 团队标识标签改为必填，提示文案更新
8. 教师/学生团队列表页: handleCreateTeam 参数类型增加 teamCode
9. 数据迁移：为所有 53 个已有团队设置 teamCode（用 id 转下划线）

**影响**: 创建团队必须输入 teamCode，导入团队默认带 teamCode

---

## 2026-04-05 (Phase 13 补充2)

### 题单管理修复与改进

**背景**: 用户反馈新建题单不应用弹窗、分享管理应叫权限管理、教师端详情页有报错。

**改动**:
1. **新建题单：弹窗 → 独立页面** — 新增 `problem-lists/new/page.tsx` 独立页面（教师端和学生端），参考 `schools/new` 模式
2. **删除 Modal 代码** — 列表页删除 Modal 相关状态和 JSX，按钮改为 `router.push('.../new')`
3. **"分享管理" → "权限管理"** — 详情页按钮和面板标题文案修改
4. **修复教师端 SharePanel 丢失** — 教师端 `[id]/page.tsx` 添加 `SharePanel` 组件定义
5. **修复 CSSProperties 类型错误** — `[pageId]/page.tsx` 给 `styles` 常量添加 `Record<string, React.CSSProperties>` 类型标注

**涉及文件**:
- `apps/web/src/app/teacher/problem-lists/new/page.tsx`（新建）
- `apps/web/src/app/student/problem-lists/new/page.tsx`（新建）
- `apps/web/src/app/teacher/problem-lists/page.tsx`（删除 Modal）
- `apps/web/src/app/student/problem-lists/page.tsx`（删除 Modal）
- `apps/web/src/app/teacher/problem-lists/[id]/page.tsx`（添加 SharePanel + 改文案）
- `apps/web/src/app/student/problem-lists/[id]/page.tsx`（改文案）
- `apps/web/src/app/teacher/problem-lists/[id]/[pageId]/page.tsx`（CSSProperties 类型）

---

## 2026-04-05 (Phase 13 补充)

### 新建题单弹窗重新设计（已废弃，被上方补充2替代）

---

## 2026-04-05 (Phase 13)

### 题单管理功能（飞书文档式权限）

**背景**: 教师和学生需要一套完整的题单管理系统，支持题单 → 页面 → 节 → 题目的层级结构，以及飞书文档式的分享权限管理。

**新增**:
1. **数据库** — 6 个新 Prisma 模型（ProblemList, ProblemListPage, ProblemListSection, ProblemListEntry, ProblemListShare, ProblemListPageShare）
2. **后端** — 完整 CRUD 路由（`routes/problem-lists.ts`），支持：
   - 题单/页/节/条目的增删改查
   - 批量添加题目
   - 排序（页/节/条目）
   - 飞书文档式分享权限（owner/admin/edit/view）
   - 页级权限覆盖（inherit/custom）
   - 校内分享限制
3. **前端** — 教师和学生完全相同的题单管理页面：
   - 列表页（全部/我的/共享 tab）
   - 详情页（页面列表 + 分享管理面板）
   - 页面编辑器（节管理 + 题目搜索弹窗 + 内联备注编辑 + 表格展示）
4. **导航** — 教师和学生导航栏添加"题单"tab

**涉及文件**:
- `apps/server/prisma/schema.prisma`
- `apps/server/src/routes/problem-lists.ts`（新建）
- `apps/server/src/index.ts`
- `apps/web/src/config/navigation.ts`
- `apps/web/src/app/teacher/problem-lists/`（新建目录）
- `apps/web/src/app/student/problem-lists/`（新建目录）

**兼容性**: 旧的 TaskList/Task/TaskProgress 模型保留不动，不影响现有功能。

**注意**: 需要重启开发服务器后执行 `npx prisma:generate`。

---

## 2026-04-05 (Phase 12.5)

### 代码库审计与编译错误修复

**背景**: 经过多次迭代（OJ适配器开发、平台改名、Logo替换等），项目积累了大量 TS 编译错误。执行全面审计并修复。

**修复**:
1. 6 个 OJ 适配器 DOM API 类型修复（`/// <reference lib="dom" />`）
2. kattis/luogu/szkopul 适配器类型错误修复
3. auth.ts 路由类型错误修复（login/register/profile）
4. schools.ts 路由类型错误修复（shortName/findUnique/description）
5. students.ts 类型错误修复
6. Express Request.user 类型声明
7. shared 包 exports 配置
8. 前端 apiClient/useFetch/ProblemList/SubmissionList 类型修复
9. 删除 18 个根目录孤立测试文件

---

## 2026-04-04 (Phase 12)

### UOJ 适配器 timeLimit/memoryLimit 提取修复

**背景**: UOJ 题目拉取时 timeLimit 和 memoryLimit 始终返回 `null`。原因是 UOJ HTML 中时限格式为 `$1\texttt{s}$`（LaTeX 包裹单位），旧正则 `/(?:时间限制)[^\d]*(\d+)\s*(?:s|ms)/` 在数字 `1` 之后期望直接匹配 `s` 或 `ms`，但中间有 `\texttt{` LaTeX 命令阻隔。

**修复**:
1. `extractLimits()` — 简化正则只提取数字：`/(?:时间限制)[^\d]*(\d+(?:\.\d+)?)/`，不再要求匹配单位后缀（默认秒）
2. `extractLimits()` — 内存同理简化：`/(?:空间限制)[^\d]*(\d+)/`
3. `extractDescription()` — 添加 `\texttt{xxx}` 清理，转为纯文本 `xxx`

**涉及文件**: `apps/server/src/oj-adapters/uoj.ts`

**CSES 排查**: `cses.fi` 从当前网络环境连接超时（IPv4/IPv6 均不通），适配器代码无问题，属于网络层限制。

**验证**: UOJ #1 输出 `timeLimit=1000, memoryLimit=256`；UOJ #2 输出 `timeLimit=1000, memoryLimit=512`。

## 2026-04-04 (Phase 11)

### Szkopuł 适配器 Markdown 质量修复

**背景**: Szkopuł 题目 `mzrTn1kzVBOAwVYn55LUeAai` 拉取输出格式完全错误：
1. 所有数学公式图片（48 个 `<span class="texmath"><img src="images/OI18/xxx.png"/>`）被当作普通图片下载，变成 `![](/uploads/...)` 无意义引用
2. `extractLimits` 正则表达式 `(?:Memory|Pamięć|Limit)` 过于宽泛，"Limit" 单独匹配到 HTML 中其他文本，导致 memoryLimit 值错误（返回 4 而非 64）
3. HTML wrapper `<div>` 导致 Markdown 输出有 4 空格缩进，被 Markdown 解析为代码块
4. `<h3>Memory limit: 64 MB</h3>` 残留在内容中未移除

**修复**:
1. `replaceEquationImages()` — 将 `<span class="texmath"><img src="..."/></span>` 转为 `![tex](full_url)`，URL 使用 problem-specific 路径前缀解决 404 问题
2. `extractLimits()` — 移除 "Limit" 独立关键词，改为 `Memory\s+limit` 精确匹配，避免误匹配 HTML 中其他文本
3. `extractDescription()` — 添加 wrapper div 剥离逻辑，先去掉 `<div width="100%"...><div>` 外层包裹
4. `cleanMarkdown()` — 剥离所有前导空格（保护围栏代码块），消除 wrapper div 导致的缩进

**涉及文件**: `apps/server/src/oj-adapters/szkopul.ts`

**验证**: `mzrTn1kzVBOAwVYn55LUeAai` 输出格式正确：0 HTML 残留，48 个公式图片转为 `![tex](url)`，memoryLimit=64，无 4 空格缩进。

## 2026-04-04 (Phase 10)

### HTML blockquote 转 Markdown 引用块

**背景**: NowCoder 题目 HTML 中使用 `<blockquote>` 标签包裹引用内容（如脑筋急转弯背景故事），但 `convertHtmlToMarkdown` 没有处理该标签，`stripTags` 直接去掉了标签，导致引用内容变成普通段落，丢失了 `>` 引用标记。

**修复**: 在 `convertHtmlToMarkdown` 中新增 `<blockquote>` → Markdown 引用块转换规则，在 `stripTags` 之前将 `<blockquote>` 内的每一行加上 `> ` 前缀。

**涉及文件**: `apps/server/src/oj-adapters/html-utils.ts`

**验证**: 286222 题目描述中的脑筋急转弯引用块已正确显示 `>` 前缀。

## 2026-04-04 (Phase 9)

### NowCoder 数学公式修复

**背景**: NowCoder 平台用 `<img src="https://(www|hr).nowcoder.com/equation?tex=..." alt="...">` 表示行内 LaTeX 公式。原适配器将这些图片交给 `convertHtmlToMarkdown` 处理，导致公式变成 `![alt](url)`，再被 `processMarkdownImages` 下载保存为本地图片，最终变成无意义的 `![](/uploads/public/problem-images/...)` 引用——数学内容全部丢失。

**根因**: 缺少对 NowCoder equation 图片的特殊处理，将其当作普通图片下载而非 LaTeX 转换。

**修复方案**: 在 HTML 传给 `convertHtmlToMarkdown` 之前，新增 `replaceEquationImages()` 函数将 equation `<img>` 替换为 `$...$` LaTeX 行内公式。支持两种情况：
- `alt` 属性非空：直接用 `alt` 内容
- `alt` 为空或缺失：从 URL `tex=` 参数 URL-decode 提取 LaTeX

**验证**: 三道题全部修复
- 286222（金条切割）：`$t$`、`$len_i$`、`$1 \le t \le 10^5$` 等公式正确显示
- 209910（Easy）：`$\sum_{i=1}^{K} a_i = N$`、`$P = \prod_{i=1}^{K} min(a_i, b_i)$` 等复杂公式正确显示
- 234425（小红的食尸鬼）：`$op=1$`、`$1\leq n,q\leq 10^5$` 等公式正确显示

**修改文件**:
| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/oj-adapters/nowcoder.ts` | 新增 `replaceEquationImages()` 函数，在所有 HTML→Markdown 转换前预处理 equation 图片 |

**影响范围**: NowCoder 适配器输出格式
**回归风险**: 无。仅影响 NowCoder 平台题目的数学公式显示

## 2026-04-04 (Phase 7-8)

### 二十轮随机压力测试 + Markdown 质量修复

**背景**: 对 22 个平台进行 20 轮随机题号压力测试（共 440 次），发现并修复 Markdown 转换质量问题。

**修改文件**:
| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/oj-adapters/__tests__/adapter-e2e-test.ts` | 新增 `--random` 模式：22 平台随机 ID 生成器、自动分类（fetched/not_found/parse_error/network_error/other_error）、成功率可视化 |
| `apps/server/src/oj-adapters/__tests__/adapter-e2e-test.ts` | 质量检查器改进：排除 `$...$` LaTeX 内容的反斜杠转义检查，消除 LaTeX 误报 |
| `apps/server/src/oj-adapters/atcoder.ts` | 新增 `normalizeHeadings()` 方法，将内容标题层级归一化到 `##` 起，修复 `# → ###` 跳级 |

**测试结果**:
- 20 轮随机测试（440 次）：198 成功拉取 / 134 题目不存在(预期) / 25 解析错误 / 65 网络错误 / 18 其他
- 解析错误主因：gym 随机 ID 格式问题（18次）、qoj 部分题目格式异常（4次）
- 预设 E2E 测试：43/57 通过，质量警告从 11 降至 3

**影响范围**: E2E 测试框架（新增随机模式）、AtCoder 适配器（标题层级修复）、质量检查器（减少误报）
**回归风险**: 无。仅影响测试工具和 AtCoder 输出格式

## 2026-04-04 (Phase 6)

### Szkopuł PDF 支持 + E2E 测试修正

**背景**: Szkopuł 平台部分题目使用 PDF 格式嵌入题面（`<object type="application/pdf">`），原适配器仅支持 HTML/Markdown 提取。同时修正 E2E 测试中多个无效的测试题号。

**修改文件**:
| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/oj-adapters/szkopul.ts` | **重写**：新增 PDF 检测（`isPdfPage`）、PDF URL 提取（`extractPdfUrl`）、`downloadAndSavePdf()` 下载保存到本地 |
| `apps/server/src/oj-adapters/__tests__/adapter-e2e-test.ts` | 修正测试题号：`usaco` → `1300/1305`、`openj_noi` → `ch0101/01`、`openj_poj` → `1000`、`nowcoder` → `166`、`szkopul` → `sum`+`9p6vgNb4lWTsrtHVnHNBR_0U` |

**影响范围**: Szkopuł 适配器（新增 PDF 支持），E2E 测试（修正无效 ID）
**回归风险**: 无。非 PDF 页面仍走原有 HTML 提取逻辑

### E2E 全量测试结果

57 题测试：**41 通过 / 16 失败**

失败分类：
- 网络超时/不可达（9）：libreoj, yosupo, yukicoder, cses, ural, csg(csgoj.com), darkbzoj, dmoj(403)
- Cloudflare/封锁（2）：spoj, baekjoon(IP封锁)
- 代码 bug（5）：aizu(SPA 需 Playwright), tlx(PARSE_ERROR), qoj/1538(PARSE_ERROR), vnoj/kilonova(测试ID可能有误), csacademy(页面结构变化)

## 2026-04-03 (续)

### Vijos + EOlymp 新增适配器

**背景**: 补齐两个 OJ 平台适配器。Vijos（HTTP + Cheerio）和 EOlymp（Playwright SPA）。

**修改文件**:
| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/oj-adapters/vijos.ts` | **新增** Vijos 适配器（HTTP + Cheerio，服务端渲染） |
| `apps/server/src/oj-adapters/eolymp.ts` | **新增** EOlymp 适配器（Playwright SPA） |
| `apps/server/src/oj-adapters/types.ts` | OjPlatform 增加 vijos/eolymp |
| `apps/server/src/oj-adapters/index.ts` | 注册 Vijos/EOlymp 到适配器 Map + getSupportedPlatforms() |
| `apps/web/src/lib/oj-platforms.ts` | FETCHABLE_PLATFORMS 增加 Vijos/EOlymp（共 35 个） |

**影响范围**: OJ 拉取模块，新增两个平台
**回归风险**: 无

仅新增适配器，不影响已有功能

### SPOJ + Baekjoon 新增适配器

**背景**: 补齐两个国际 OJ 平台适配器，SPOJ 需要绕过 Cloudflare，Baekjoon 需要绕过 AWS ELB IP 封锁。

**修改文件**:
| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/oj-adapters/spoj.ts` | **新增** SPOJ 适配器，Playwright + Stealth 绕过 Cloudflare，`#problem-name`/`#problem-body` 提取 |
| `apps/server/src/oj-adapters/baekjoon.ts` | **新增** Baekjoon 适配器，Playwright + Stealth 绕过 IP 封锁，韩语/英语双语提取 |
| `apps/server/src/oj-adapters/index.ts` | 注册 SPOJ/Baekjoon 到适配器 Map + getSupportedPlatforms() |
| `apps/web/src/lib/oj-platforms.ts` | FETCHABLE_PLATFORMS 增加 SPOJ/Baekjoon（共 33 个） |

**影响范围**: OJ 拉取模块，新增两个平台的远程题目拉取能力
**回归风险**: 无，仅新增适配器，不影响已有功能

---

## 2026-04-03

### P2 可选优化实施（表格支持 + AtCoder 公式增强）

**背景**: P0/P1/P2 核心修复和新增适配器完成后，继续实施 P2 可选优化项。

**修改文件**:
| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/oj-adapters/html-utils.ts` | `convertHtmlToMarkdown()` 增加 `<table>` → Markdown 表格支持；修复行内数学公式 `$...$` 保护逻辑；增加 `<pre>` 代码块保护 |
| `apps/server/src/oj-adapters/atcoder.ts` | `<var>` 标签处理增强：新增 `varToLatex()` 递归方法，支持嵌套 `<sup>`/`<sub>` → LaTeX 上标 `^{}`/下标 `_{}` |

**影响范围**:
- HTML 表格支持影响所有使用 `convertHtmlToMarkdown()` 的适配器（~20 个）
- AtCoder 数学公式增强提升复杂公式（如 $x_i^{2}$）的转换质量

---

## 2026-04-03

### OJ 适配器 P0/P1 缺陷修复实施

**背景**: 完成设计文档后，按优先级实施适配器缺陷修复。

**修改文件**:
| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/routes/oj-fetcher.ts` | `extractImageLinks()` 移除域名白名单，下载所有 http/https 图片；`downloadAndUploadImage()` 自动根据图片域名设置 Referer |
| `apps/web/src/components/problem/ProblemDetail.tsx` | `OjBinding` 增加 `url?` 字段；`getOjProblemUrl()` 从 12 个平台扩展到 60+；链接渲染优先使用 `binding.url` |
| `apps/web/src/components/problem/ProblemForm.tsx` | `OjBinding` 增加 `url?` 字段 |
| `apps/server/src/oj-adapters/nowcoder.ts` | 从正则表达式改为 cheerio DOM 解析：按 h2 + 兄弟遍历提取内容，同时支持 OI 题 textarea 和普通题 pre 两种样例格式 |
| `apps/server/src/oj-adapters/html-utils.ts` | `convertHtmlToMarkdown()` 末尾增加二次 `unescapeHtml()` 调用，修复双重编码实体 |

**影响范围**:
- 所有 24 个已有适配器的图片下载能力（不再限于 luogu/atcoder/codeforces）
- 前端所有平台的原题链接显示

### P1.3 OpenJudge 拆分为 3 个子平台

**背景**: OpenJudge 有百炼/NOI/POJ 三个独立子站，HTML 结构相同但 URL 和域名不同，需要分开管理。

**新增/修改文件**:
| 文件 | 说明 |
|------|------|
| `apps/server/src/oj-adapters/openjudge.ts` | 重构为 `OpenjudgeBaseAdapter` 基类 + 保留 `OpenjudgeAdapter` 向后兼容 |
| `apps/server/src/oj-adapters/openj_bailian.ts` | **新增** 百炼子站适配器（`bailian.openjudge.cn`） |
| `apps/server/src/oj-adapters/openj_noi.ts` | **新增** NOI 子站适配器（`noi.openjudge.cn`，题号含分组路径） |
| `apps/server/src/oj-adapters/openj_poj.ts` | **新增** POJ 子站适配器（`poj.openjudge.cn`） |
| `apps/server/src/oj-adapters/types.ts` | `OjPlatform` 增加 `openj_bailian`、`openj_noi`、`openj_poj`；`KNOWN_OJ_PLATFORMS` 增加 3 条 |
| `apps/server/src/oj-adapters/index.ts` | 注册 3 个新适配器；`getSupportedPlatforms()` 增加 3 条 |
| `apps/web/src/lib/oj-platforms.ts` | `OJ_PLATFORMS` 增加 3 个子平台选项 |

**向后兼容**: 保留 `openjudge` 标识（映射到百炼），,已有数据不受影响。

### P2 新增 4 个 OJ 适配器（Szkopuł / DarkBZOJ / DMOJ / CSES）

**背景**: 完成已有适配器 P0/P1 修复后，按设计文档 P2 优先级新增 4 个可纯 HTTP 实现的平台。

**新增文件**:
| 文件 | 平台 | 特点 |
|------|------|------|
| `apps/server/src/oj-adapters/szkopul.ts` | Szkopuł（波兰 OI） | 天然 Markdown 输出，`<pre>`/HTML/article 三级提取策略 |
| `apps/server/src/oj-adapters/darkbzoj.ts` | DarkBZOJ（黑暗爆炸） | UOJ 系统 HTML，`<article class="uoj-article">` 解析 |
| `apps/server/src/oj-adapters/dmoj.ts` | DMOJ | API-first（`/api/v2/problem/{pid}`），JSON 含 `html` 字段；失败退化为 HTML 拉取 |
| `apps/server/src/oj-adapters/cses.ts` | CSES Problem Set | 简洁 HTML，`<div class="md">` 提取 Markdown-like 内容 |

**修改文件**:
| 文件 | 说明 |
|------|------|
| `apps/server/src/oj-adapters/types.ts` | `OjPlatform` 联合类型增加 `'szkopul' \| 'darkbzoj' \| 'dmoj' \| 'cses'` |
| `apps/server/src/oj-adapters/index.ts` | 适配器 Map 注册 4 个新适配器；`getSupportedPlatforms()` 增加 4 条 |
| `apps/web/src/lib/oj-platforms.ts` | `FETCHABLE_PLATFORMS` 从 4 个扩展到 31 个（含所有已有适配器平台） |

**向后兼容**: 纯新增，不影响已有平台。

**风险**:
- DarkBZOJ 网站可用性待验证（`darkbzoj.cc` 可能不稳定）
- Szkopuł 波兰语页面，时/空限制提取正则可能需要调整
- DMOJ API 可能变更

### P1.4 PDF 统一下传上传

**背景**: oj.uz 检测到 PDF 题面时只生成外部链接，未下载上传到本地。需要统一所有 PDF 题面的处理流程。

**修改文件**:
| 文件 | 说明 |
|------|------|
| `apps/server/src/oj-adapters/html-utils.ts` | 新增 `downloadAndSavePdf()` 通用函数：下载远程 PDF → 上传到 FileService → 返回本地 URL |
| `apps/server/src/oj-adapters/ojuz.ts` | `extractDescription()` 改为 async；检测到 PDF 时调用 `downloadAndSavePdf()` 下载上传；失败时退化为外部链接 |

**处理流程**: 检测 PDF → 下载 → fileService.upload() → `/api/files/:id/public` → Markdown 中引用本地 URL
- 牛客题目拉取质量
- HTML 实体解码正确性

**风险**:
- 图片下载量增加可能触发某些平台的频率限制（已有限流配置兜底）
- 牛客 cheerio 解析可能对新版页面结构不兼容

---

## 2026-04-03

### OJ 适配器设计文档编写

**背景**: 适配器质量全面整改的前置工作。用户指出 LOJ 图片未下载、USACO 链接/实体解码错误、前端原题链接不完整、牛客 Markdown 转换严重出错、OpenJudge 需拆分为 3 个子平台等问题。

**新增文件**:
| 文件 | 说明 |
|------|------|
| `docs/oj-adapters/ADAPTER_DESIGN.md` | 全平台适配器设计文档（24 已有 + 15 待实现 + 10 不可实现），每个平台含标识、URL、题号格式、页面类型、HTML 选择器、图片域名、PDF 处理、难点、5+ 测试题号（含图片/PDF/复杂题标注） |
| `docs/oj-adapters/ADAPTER_FIXES.md` | 已有适配器缺陷修复方案，按 P0/P1/P2 优先级排列 |
| `docs/oj-adapters/PLATFORM_URL_MAP.md` | 全平台 URL 映射表 + 完整 `getOjProblemUrl()` 实现代码 + 新增平台同步清单 |

**关键设计决策**:
- LOJ = LibreOJ，统一标识为 `libreoj`
- OpenJudge 拆分为 `openj_bailian`、`openj_noi`、`openj_poj`
- 图片下载管线移除域名白名单，改为下载所有外部图片
- 前端原题链接优先使用后端存储 URL，`getOjProblemUrl()` 仅作兜底
- 每个平台测试题号至少 5 个，且必须覆盖含图片、含 PDF/附件、题面较长复杂的题目

**影响范围**: 仅新增文档，未修改任何代码

---

## 2026-04-03（早前）

### QOJ PDF 题面显示修复（端到端流程修复）

**背景**: QOJ 拉取的 PDF 题面在前端 404，原因是三个环节都有 bug：
1. `oj-fetcher.ts` 创建/更新题目时硬编码 `statementType: 'markdown'`，不管适配器是否返回 PDF
2. `savePdfToLocal()` 返回的 URL 格式不对（`/uploads/...` 而非 `/api/files/:id/public`）
3. `ProblemNote.tsx` 的 `getPdfUrl()` 指向跨域后端 URL，被 `X-Frame-Options: SAMEORIGIN` 拦截

**修改文件**:
| 文件 | 说明 |
|------|------|
| `apps/server/src/routes/oj-fetcher.ts` | 创建/更新题目时检测 PDF statement，正确设置 `statementType='pdf'` 和 `statementPdfUrl` |
| `apps/server/src/oj-adapters/qoj.ts` | `savePdfToLocal()` 返回 `/api/files/:id/public` 格式 |
| `apps/web/src/components/problem/ProblemNote.tsx` | `getPdfUrl()` 使用 Next.js 同域代理代替直接后端 URL |

**数据修复**:
- QOJ 76: 重新上传 PDF 文件到 File 表，更新 `ProblemStatement.fileUrl` 和 `Problem.statementPdfUrl`
- QOJ 35: 修复 `Problem.statementType` 和 `Problem.statementPdfUrl`（URL 已正确但 Problem 字段未设）

### QOJ PDF 下载方案实现（headed 模式 + 独立浏览器）

**背景**: QOJ `download.php` 端点受 Cloudflare JS Challenge 严格保护，headless 模式四级策略全部失败。发现 headed 模式下 CF challenge 约 3 秒自动通过。

**关键发现**:
- `download.php?type=statement&id={题目编号}` — id 直接就是题目编号，不需要额外映射
- CF 对 headless 浏览器严格检测，headed 模式 3 秒自动通过
- browserManager 的 stealth/UA 注入反而干扰 CF 通过，需要独立裸浏览器实例
- 需要 `QOJ_SESSION`（UOJSESSID cookie），类似洛谷的 `LUOGU_COOKIE`

**修改文件**:
- `apps/server/src/oj-adapters/qoj.ts` — 核心改动：
  - `fetch()` 使用 headed 模式（`headless: false`）
  - `downloadPdf()` 启动独立浏览器实例，不经过 browserManager
  - 新增 `waitForCloudflare()` 方法，检测 PDF contentType 或页面 title 判断 CF 通过
  - 新增 `getSessionCookie()` 读取 `QOJ_SESSION` 环境变量
  - 删除旧的四级下载策略，替换为单一可靠的独立浏览器方案
- `apps/server/src/lib/browser/manager.ts` — 支持 headed/headless 双浏览器实例：
  - `init(headless)` 和 `ensureBrowser(headless)` 参数化
  - 两个独立浏览器实例：`headlessBrowser` 和 `browser`（headed）
  - `close()` 同时关闭两个实例
- `apps/server/.env` — 新增 `QOJ_SESSION` 环境变量

**测试结果**:
- QOJ 76 (PDF): ✅ 98818 bytes 本地存储
- QOJ 60 (HTML): ✅ Markdown 题面正常
- QOJ 9741 (PDF): ✅ 97363 bytes 本地存储

**影响范围**: QOJ 所有题目拉取，PDF 题面现在可下载到本地

---

## 2026-04-02（续四）

### QOJ PDF 下载策略优化（四级策略）

**背景**: QOJ `download.php` 端点受 Cloudflare JS Challenge 严格保护，所有服务器端 PDF 下载均失败。

**修改文件**:
- `apps/server/src/oj-adapters/qoj.ts` — 实现四级 PDF 下载策略：
  1. `page.request.get()`（Playwright API Request，共享 context cookies）
  2. Node.js `fetch` + 手动 cookie 注入
  3. 浏览器内 `fetch()`（通过 `page.evaluate`，Chrome TLS 指纹）
  4. `newPage().goto()` fallback
  - 新增 cookies 诊断日志（`cf_clearance` 状态）
  - 新增 `savePdfToLocal` 辅助方法

**测试结果**:
- `cf_clearance` cookie 已确认存在于浏览器上下文
- 四级策略全部失败：CF 检查 TLS 指纹和请求上下文，非住宅代理无法绕过
- PDF 题面保留外部 URL，前端显示"打开 PDF 题面"按钮

**影响范围**: QOJ PDF 题面（如 76、35），无回归风险

---

## 2026-04-02（续三）

### QOJ PDF 处理 + 题面页 UI 优化

**问题**: QOJ PDF 题面由于 CF 防护无法 iframe 嵌入、无法服务器端下载。

**修改文件**:
- `apps/server/src/oj-adapters/qoj.ts` — PDF 下载改用 browser context newPage goto，CF 拦截时 fallback 外部 URL
- `apps/web/src/components/problem/ProblemDetail.tsx` — PDF 展示：本地路径用 iframe，外部 URL 用"在新窗口打开"按钮
- `docs/OJ_ADAPTERS.md` — 更新 QOJ 已知限制说明

**影响范围**: QOJ PDF 题面（如 76、35）展示方式变更

**兼容性**: 无回归风险，本地 PDF 仍用 iframe 嵌入

---

## 2026-04-02（续二）

### 评测记录页面骨架

**目标**: 为教师、学生、平台管理员添加评测记录列表页面（UI 骨架，暂无实际数据）。

**新增文件**:
- `apps/web/src/lib/judge-constants.ts` — 评测结果（14选项）和编程语言（20选项）全局常量
- `apps/web/src/components/submission/SubmissionList.tsx` — 共用评测记录列表组件（筛选 + 表格 + 分页）
- `apps/web/src/app/teacher/submissions/page.tsx` — 教师端评测记录页
- `apps/web/src/app/student/submissions/page.tsx` — 学生端评测记录页
- `apps/web/src/app/platform-admin/submissions/page.tsx` — 平台管理员评测记录页
- `apps/server/src/routes/submissions.ts` — 后端 API 骨架（返回空数组）

**修改文件**:
- `apps/web/src/lib/oj-platforms.ts` — 新增 `SUBMISSION_OJ_OPTIONS`（含"本OJ"选项）
- `apps/web/src/config/navigation.ts` — 教师、学生、平台管理员导航添加"评测记录"入口
- `apps/server/src/index.ts` — 注册 `/api/submissions` 路由

**筛选功能**: 用户名（输入）、OJ（下拉，含本OJ）、题号（输入）、评测结果（下拉14选项）、语言（下拉20选项）

### 密码文档修正

**目标**: 将所有文档中 `admin123` 密码引用改为 `123456`。

**修改文件**: README.md, HANDOVER.md, RUNBOOK.md, API_REFERENCE.md, KNOWN_ISSUES.md

## 2026-04-02（续）

### HDU 适配器实现

**目标**: 新增 HDU (acm.hdu.edu.cn) 题目拉取支持。

**修改文件**:
- `apps/server/src/oj-adapters/hdu.ts` — 新增 HDU 适配器（纯 HTTP，GB2312 解码，panel_title/content 解析）
- `apps/server/src/oj-adapters/index.ts` — 注册 HduAdapter，标记 `supported: true`

**技术决策**:
- 不使用 Playwright，HDU 是服务端渲染，纯 HTTP + GB2312 解码即可
- 数学公式保留原始 `$...$` 格式，不转换
- 语言检测：中文字符占比 > 5% 判定为中文

**验证**: 1000, 7000, 6460, 5545, 7241 共 5 题全部拉取成功

### 题面页 UI 细节修复

**修改文件**:
- `apps/web/src/styles/globals.css` — inline code 去掉 border、文字加深；pre code 补 border:none；正文色加深
- `apps/web/src/components/problem/ProblemDetail.tsx` — visibility badge 蓝色加深
- `apps/web/src/app/platform-admin/problems/page.tsx` — 附件状态列：无附件时显示"无附件"而非"-"

## 2026-04-02

### 题面详情页 UI 设计重构

**目标**: 走"专业文档页 + 轻比赛平台感"路线，建立统一的 slate 色系视觉系统。

**修改文件**:
- `apps/web/src/styles/globals.css` — `.markdown-content` 全面重构
- `apps/web/src/components/ui/MarkdownRenderer.tsx` — CopyButton 适配浅色代码块
- `apps/web/src/components/problem/ProblemDetail.tsx` — 头部去蓝、卡片微阴影、Tab 加粗

**核心改动**:
1. **行内 code**：蓝紫色（`#eef2ff`/`#4338ca`）→ 中性灰（`#f1f5f9`/`#1e293b`/`#e2e8f0` 边框）
2. **代码块**：深蓝黑（`#1e293b`）→ 浅灰文档风（`#f8fafc`/`#1e293b`），融入正文流
3. **blockquote**：蓝色边线 → 中性灰（`#94a3b8`）+ 浅灰底色
4. **正文/标题色**：统一到 slate 色系（`#334155`/`#0f172a`/`#1e293b`），h2 去底边线
5. **h4**：新增小标签风格（大写、小号、灰色）
6. **表格**：边框/底色统一到 slate
7. **题号颜色**：蓝色 → 灰色，蓝色只保留给交互元素
8. **CopyButton**：深色半透明 → 浅灰底深灰字

**设计原则**: 蓝色只用于交互语义（链接/tab/按钮），非交互元素用中性灰

---

## 2026-04-02

### Playwright 浏览器基础设施 + QOJ 适配器

**新增**: 建立 Playwright + Stealth + rebrowser-patches 浏览器基础设施，供所有需要 JS 渲染的 OJ 适配器复用。实现 QOJ 题目拉取适配器。

**新增文件**:
- `apps/server/src/lib/browser/types.ts` — 浏览器会话类型（ProxyConfig, BrowserSessionOptions 等）
- `apps/server/src/lib/browser/proxy.ts` — 代理管理器（环境变量加载、轮询/随机/健康检查）
- `apps/server/src/lib/browser/stealth.ts` — 7 项 Stealth 反检测（navigator.webdriver、chrome.runtime、Plugins、WebGL、Permissions 等）
- `apps/server/src/lib/browser/manager.ts` — 浏览器单例管理器（懒加载 Chromium、withPage 自动创建/清理）
- `apps/server/src/lib/browser/session.ts` — Cookie/登录态文件持久化
- `apps/server/src/lib/browser/README.md` — 使用文档
- `apps/server/src/oj-adapters/qoj.ts` — QOJ 适配器

**QOJ 适配器功能**:
1. 标题提取：`<h1 class="page-header">` 去掉 "#N. " 前缀；fallback `<title>` 标签
2. 时限/内存限制：从 badge span 提取，支持 s/ms/MB/GB/KB
3. MathJax 处理：移除 SVG 渲染结果，从 `<script type="math/tex">` 提取 LaTeX → `$...$`
4. HTML→Markdown：标题、段落、代码块、表格、列表、加粗/斜体完整转换
5. PDF 检测：检查 iframe/embed 指向 download.php
6. Cloudflare：403 时等待 8 秒

**依赖变更**: 新增 `rebrowser-playwright-core`（需要 `npx rebrowser-playwright-core install chromium`）

**验证**:
- QOJ 60: 标题/时限/内存/LaTeX 公式/代码块/子任务 — 全部正确
- QOJ 1: 复杂 LaTeX/行内代码/表格 — 正确
- QOJ 49: PDF 题面检测/时限/内存 — 正确

---

## 2026-04-01

### CF/Gym 适配器：内存限制提取 + 字体样式转换 + Math 定界符全面修复

**问题**: Gym 106384A 拉取失败（内存限制未提取），CF 特殊字体样式未转换，display math 与文字同行，相邻 inline math `$$` 冲突。

**修复内容**:
1. **内存限制正则**：`extractLimits()` 中 `/(\d+)\s*(?:MB|MiB)/i` → `/(\d+)\s*(?:MB|MiB|megabytes?)/i`
   - CF/Gym 部分题目使用 "256 megabytes" 而非 "256 MB" 格式
2. **tex-font-style 处理**：`renderInline()` 的 span 分支新增：
   - `tex-font-style-bf` → `**粗体**`
   - `tex-font-style-it` → `*斜体*`
   - `tex-font-style-underline` → `<u>下划线</u>`
3. **fixCfMath display math 行分离**：6-dollar 转换时用 `\n\n` 包裹 `$$...$$`
   - 确保 `$$` 单独成行，remark-math 才能正确识别 display math
4. **相邻 inline math 修复**：`fixCfMath()` 末尾新增 `$$` → `$ $` 后处理
   - 修复 `$s$$^{\text{∗}}$`（相邻 inline math `$$` 被误解为 display math）
   - 使用 lookbehind/lookahead 排除 display math（`$$\n` 不受影响）

**影响文件**: `apps/server/src/oj-adapters/codeforces.ts`

**影响范围**: CF/Gym 题目拉取，需重新拉取已拉取的题目才能生效

---

## 2026-03-31

### 拉取队列统一平台切换 + 共享平台常量

**问题**: 拉取队列页面的平台选择和 Cookie 配置是分离的，且前端多处重复定义 OJ 平台列表。

**修复内容**:
1. **新建共享平台常量** `apps/web/src/lib/oj-platforms.ts`
   - `OJ_PLATFORMS`（含"全部平台"）、`OJ_PLATFORMS_NO_ALL`、`OJ_PLATFORM_LABEL_MAP`
   - `FETCHABLE_PLATFORMS`、`PLATFORM_COOKIE_FIELDS`
   - `isFetchablePlatform()`、`hasCookieConfig()` 工具函数
2. **拉取队列页面统一平台切换**
   - 一个下拉控制 Cookie 配置和批量拉取
   - 切换平台时动态加载对应 Cookie 配置
   - 无 Cookie 需求的平台自动隐藏配置区域
3. **消除重复平台列表**
   - `ProblemDetail.tsx` 删除本地 Record，改用 `OJ_PLATFORM_LABEL_MAP`
   - 所有平台相关页面统一使用共享常量

**修改文件**:
- `apps/web/src/lib/oj-platforms.ts` — 新建共享常量
- `apps/web/src/app/platform-admin/problems/page.tsx` — 统一平台切换 UI
- `apps/web/src/components/problem/ProblemDetail.tsx` — 改用共享常量

**回归风险**: 低。后端 API 无变更，仅前端 UI 和常量组织调整。

---

## 2026-03-30

### 拉取队列 UI 修复 + CF/Gym 适配器修复（2026-04-01)

### 目标
修复拉取队列页面的 UI 问题，以及 Codeforces/Gym 适配器的时间/内存限制和数学公式处理。

### 修改文件
| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `apps/web/src/app/platform-admin/problems/page.tsx` | 自动刷新使用 silent 模式避免滚动条跳动; 平台选择持久化到 localStorage |
| 修改 | `apps/server/src/oj-adapters/codeforces.ts` | tex-span 数学定界符保留 display/inline 类型; 安全网去除 time/memory limit |

### 验证
- [ ] 自动刷新时任务列表滚动条不跳动
- [ ] 切换页面再返回时平台选择保持
- [ ] 重新拉取 CF/Gym 题目， time/memory limit 不再出现在 Markdown 鴶面中
- [ ] 数学公式 display math 不会被错误识别为 inline math

**改了什么**：
1. OJ 平台下拉从 5-12 项扩展为 55+ 项全平台列表，统一使用 `KNOWN_OJ_PLATFORMS`
2. 批量拉取区域新增平台选择器（不再硬编码 luogu）
3. 任务列表增加平台筛选 + 状态筛选 + 分页（每页 20 条）
4. 后端 GET /jobs 支持分页筛选，POST /jobs/batch 改用 `isKnownPlatform()` 白名单

**为什么改**：平台下拉只有几项不够用，任务列表无筛选无分页难以管理

**影响模块**：
- 拉取队列页面（platform-admin/problems）
- 公共题库筛选（ProblemList）
- OJ 绑定下拉（ProblemForm）
- OJ 平台显示（ProblemDetail）
- 后端拉取路由（oj-fetcher）
- OJ 适配器索引（oj-adapters/index.ts）

**兼容性风险**：无，洛谷实际拉取逻辑完全不变

### 洛谷团队导入功能实现
- **新建**: `binders/luogu-session.ts` — 洛谷会话服务（核心数据拉取），  - 内置 RateLimiter QPS 限速器（最小间隔 1.5s + 随机抖动 0.5-1.5s），  - 所有 HTTP 请求都经过 `throttledFetch` 或 `fetchWithC3VK`（含限速）
  - 支持获取团队列表和团队详情（公告 + 成员）
- **新建**: `team-import/luogu-import.service.ts` — 洛谷导入薄层服务
- **新建**: `web/teacher/team-import/luogu/page.tsx` — 前端洛谷导入页面
- **修改**: `binders/luogu.ts` — bindingData 增加 clientId/uidCookie 存储
- **修改**: `team-import/team-import.types.ts` — 添加洛谷类型定义
- **修改**: `team-import/team-import.routes.ts` — 添加 4 个洛谷 API 路由
- **修改**: `web/teacher/students/import/page.tsx` — 添加洛谷跳转

### 夶盖范围
- 团队导入模块
- 平台绑定模块（洛谷绑定器）
- 前端导入入口页

## 2026-03-28

### VJudge Cloudflare 拦截检测修复
- **修复**: Cookie 绑定验证阶段优先检测 Cloudflare 拦截页，不再误报"Cookie 已失效"
- **修复**: `getMyGroups()` 被 Cloudflare 拦截时抛出异常而非静默返回空数组
- **修复**: `getGroupDetails()` 新增 Cloudflare 拦截检测
- **修复**: 登录方法增加 "Human verification failed" 专门识别
- **修复**: 导入路由层识别 Cloudflare 错误，返回 400 + `errorType: 'CLOUDFLARE_BLOCKED'`
- **修复**: 前端导入页获取空团队列表时不再标记为 cookieValid=true
- **优化**: 绑定页错误提示支持多行显示（`whiteSpace: pre-line`）
- **影响文件**: vjudge.ts, vjudge-session.ts, team-import.routes.ts, vjudge/page.tsx, platform-bindings/page.tsx

### VJudge 导入共享组件提取 & 重构
- **新建**: `apps/web/src/components/team-import/types.ts` — 共享类型（ImportMember, ConflictInfo, ValidateResultItem, ImportResult 等）
- **新建**: `apps/web/src/components/team-import/ImportPreview.tsx` — 共享预览/校验/导入组件（~500 行）
- **重构**: VJudge 导入页面从 934 行精简到 ~230 行，仅保留平台鉴权和数据获取逻辑
- **架构**: 平台页面只负责 Cookie/Token 验证 + 获取原始成员，`ImportPreview` 统一处理预览→校验→问题解决→导入→结果展示
- **好处**: 后续洛谷等平台只需实现自己的鉴权+数据获取，复用 `ImportPreview` 组件

### VJudge 导入预览冲突检测 & 解决功能
- **新增**: `member-match.service.ts` — 通用成员冲突检测服务（所有平台导入共用)
- **修改**: 类型定义增加 ConflictType, ConflictInfo MemberInput 等
- **修改**: `vjudge-import.service.ts` — 预览只返回原始数据，校验调用通用服务,导入支持 invite/skip
- **修改**: `team-import.routes.ts` — 新增 `POST /vjudge/validate` 校验端点
- **重写**: 前端预览页 — 冲突卡片UI、校验流程、性别选择(默认男)
- **三类冲突**: 本校用户名冲突 / 本校姓名冲突 / 外校用户名冲突
- **交互流程**: 校验→解决冲突→再校验→直到全部通过才能导入

### 学生删除真删除 & 禁用账号功能

- **问题**: 教师删除学生后超管列表仍显示（只删 Student 不删 User）
- **修复**:
  - `apps/server/src/routes/students.ts` DELETE 端点改为事务级联删除 Student + User
  - 新增 `PUT /api/students/:id/account-status` 接口支持禁用/启用
  - `apps/web/src/app/teacher/students/page.tsx` 新增禁用/启用按钮
  - 学生列表返回 `user.status` 字段
- **验证**: 删除后 User 级联删除；禁用后无法登录；启用后恢复

### 学校详情页 Prisma 字段名修复

- **问题**: 教师编辑学生时密码修改不生效
- **根因**: `PUT /api/students/:id` 未从 req.body 解构 password 字段
- **修复**:
  - `apps/server/src/routes/students.ts`: 解构 password 字段，在事务中添加密码哈希更新
  - `apps/web/src/app/teacher/students/page.tsx`: 添加白色 Toast 成功通知
- **验证**: carits 账号密码更新测试通过，登录验证成功

### VJudge 团队导入 Bug 修复

**问题**：
1. 导入创建的学生使用随机用户名（如 `stu_timestamp_random`），而非预览中显示的 VJudge 用户名
2. 导入时选择"创建新团队"，但团队未被创建（导航到 VJudge 页面时未传递 createTeam 参数）

**修改文件**：
- `apps/server/src/modules/team-import/vjudge-import.service.ts` - 使用 VJudge 用户名作为系统登录名（含冲突检测）
- `apps/server/src/modules/team-import/team-import.types.ts` - 添加 systemUsername/tempPassword 字段
- `apps/web/src/app/teacher/students/import/page.tsx` - 导航时传递 createTeam 和 visibility 参数
- `apps/web/src/app/teacher/team-import/vjudge/page.tsx` - 导入结果页显示账号信息表

**修复内容**：
1. **Bug 1 - 用户名修复**：新创建学生的系统登录名使用 VJudge 用户名（用户可在预览时编辑），若用户名冲突则追加 `_vj_timestamp` 后缀
2. **Bug 2 - 团队创建修复**：从导入入口页导航到 VJudge 导入页时，传递 `createTeam` 和 `visibility` URL 参数
3. **结果页增强**：导入结果页新增账号信息表，显示学生姓名、登录用户名、初始密码和 VJudge 用户名

---

### VJudge 团队导入功能优化（早期变更）

**变更说明**：优化 VJudge 团队导入流程，支持编辑用户名和学生姓名。

**修改文件**：
- `apps/server/src/modules/team-import/team-import.routes.ts` - 移除冗余的团队验证
- `apps/server/src/modules/team-import/vjudge-import.service.ts` - 使用编辑后的用户名进行平台绑定
- `apps/web/src/app/teacher/team-import/vjudge/page.tsx` - 预览页用户名和学生姓名可编辑

**功能变更**：
1. 移除后端"请选择团队或创建新团队"验证（前端已传入 createTeam 参数）
2. 预览页用户名（VJudge 用户名）现在可编辑
3. 预览页学生姓名（仅新成员）可编辑
4. 后端使用前端传来的编辑后用户名进行平台绑定

---

## 2026-03-27

### VJudge 团队导入功能

**变更说明**：添加从 VJudge 平台导入团队成员的功能，支持获取 VJudge 团队列表、预览成员、批量导入。

**新建文件**：
- `apps/server/src/modules/team-import/vjudge-import.service.ts` - VJudge 导入服务
- `apps/web/src/app/teacher/team-import/vjudge/page.tsx` - VJudge 导入页面

**修改文件**：
- `apps/server/src/modules/platform-binding/binders/vjudge-session.ts` - 添加团队获取方法
- `apps/server/src/modules/team-import/team-import.types.ts` - 添加 VJudge 类型定义
- `apps/server/src/modules/team-import/team-import.routes.ts` - 添加 VJudge API 路由

**功能说明**：
1. 入口位置：`/teacher/team-import/vjudge`
2. 导入流程：选择 VJudge 团队 → 选择拉取选项 → 预览成员 → 确认导入
3. 成员处理：
   - 新成员：创建学生账号，设置入学年份
   - 已存在成员：发送团队邀请，信息不可更改
4. 支持批量设置入学年份
5. 验证 VJudge Cookie 有效性

**API 端点**：
- `GET /api/team-import/vjudge/groups` - 获取 VJudge 团队列表
- `POST /api/team-import/vjudge/preview` - 预览团队成员
- `POST /api/team-import/vjudge/import` - 执行导入

---

### 团队导入功能

**变更说明**：为团队管理模块添加"团队导入"功能，支持从外部 OJ 平台（VJudge、洛谷）批量导入学生到团队。

**新建文件**：
- `apps/server/prisma/schema.prisma` - 添加 TeamMemberExternalAccount, TeamMemberImportBatch, TeamMemberImportItem 模型
- `apps/server/src/modules/team-import/team-import.types.ts` - 类型定义
- `apps/server/src/modules/team-import/team-import.repository.ts` - 数据访问层
- `apps/server/src/modules/team-import/team-import.service.ts` - 业务逻辑层
- `apps/server/src/modules/team-import/team-import.routes.ts` - 路由层
- `apps/web/src/app/teacher/students/import/page.tsx` - 导入入口页（选择团队+平台）
- `apps/web/src/app/teacher/students/import/bind/page.tsx` - 平台绑定页
- `apps/web/src/app/teacher/students/import/input/page.tsx` - 数据输入页
- `apps/web/src/app/teacher/students/import/preview/page.tsx` - 预览页
- `apps/web/src/app/teacher/students/import/result/page.tsx` - 结果页

**修改文件**：
- `apps/server/src/index.ts` - 注册 team-import 路由
- `apps/web/src/app/teacher/students/page.tsx` - 添加"导入团队"按钮（在"添加学生"左侧）

**功能说明**：
1. 入口位置：学生管理页面，"添加学生"按钮左侧的"导入团队"按钮
2. 支持平台：VJudge、洛谷（可扩展）
3. 导入流程：选择团队 → 选择平台 → 检查绑定 → 输入数据 → 预览匹配 → 确认导入 → 查看结果
4. 数据格式：每行一个用户名，或"用户名 姓名"（空格/逗号分隔）
5. 匹配逻辑：优先用学生姓名匹配，其次用平台绑定匹配
6. 邀请机制：匹配到的学生发送邀请，需确认后加入

**API 端点**：
- `GET /api/team-import/teams` - 获取用户管理的团队
- `GET /api/team-import/platforms` - 获取可用平台及绑定状态
- `POST /api/team-import/start` - 开始导入批次
- `GET /api/team-import/:batchId/preview` - 获取预览数据
- `POST /api/team-import/:batchId/confirm` - 确认导入
- `GET /api/team-import/:batchId/result` - 获取导入结果
- `GET /api/team-import/history/:teamId` - 获取导入历史

**匹配类型**：
- `new_member` - 新成员，可选择创建学生
- `existing_member` - 已绑定该平台的账号
- `same_name` - 姓名匹配但未绑定平台
- `conflict` - 账号已被其他学生绑定
- `invalid` - 无效数据

---

## 2026-03-26

### 平台绑定功能基础框架

**变更说明**：为每个用户添加平台绑定功能，支持绑定 Vjudge、洛谷、Codeforces、AtCoder 等 OJ 账号。

**新建文件**：
- `apps/server/prisma/schema.prisma` - 添加 UserPlatformBinding 模型
- `apps/server/src/modules/platform-binding/platform-binding.types.ts` - 类型定义
- `apps/server/src/modules/platform-binding/platform-binding.repository.ts` - 数据访问层
- `apps/server/src/modules/platform-binding/platform-binding.service.ts` - 业务逻辑层
- `apps/server/src/modules/platform-binding/platform-binding.routes.ts` - 路由层
- `apps/server/src/modules/platform-binding/binders/` - 各平台绑定器（预留）
- `apps/web/src/app/teacher/platform-bindings/page.tsx` - 教师端页面
- `apps/web/src/app/student/platform-bindings/page.tsx` - 学生端页面
- `apps/web/src/app/admin/platform-bindings/page.tsx` - 管理端页面

**修改文件**：
- `apps/server/src/index.ts` - 注册路由
- `apps/web/src/components/AppShell.tsx` - 添加菜单入口

**功能说明**：
1. 入口位置：点击头像后，在"账号安全"下方显示"平台绑定"
2. 支持平台：Vjudge、洛谷、Codeforces、AtCoder（可扩展）
3. 初始状态：所有平台显示为"未绑定"
4. 点击平台后弹出绑定弹窗（本次只做弹窗框架）
5. 每个用户的绑定独立，不同用户之间无关联

**API 端点**：
- `GET /api/platform-bindings` - 获取当前用户绑定状态
- `GET /api/platform-bindings/platforms` - 获取支持的平台列表
- `POST /api/platform-bindings/:platform/bind` - 发起绑定
- `DELETE /api/platform-bindings/:platform` - 解除绑定
- `POST /api/platform-bindings/:platform/refresh` - 刷新绑定

**后续事项**：
- 各平台绑定器实现（需要研究各平台 API）
- 绑定弹窗完善（表单、验证、错误提示）
- 绑定数据加密存储

---

### 旧题目保存修复

**变更说明**：修复旧题目（没有 ProblemStatement 记录）保存时失败的问题。

**修改文件**：
- `apps/server/src/routes/problems.ts` - 修复更新逻辑，处理 `legacy-` 假 ID

**问题原因**：
编辑旧题目时，前端为兼容旧数据生成了 `legacy-md-zh`、`legacy-pdf` 等假 ID。后端尝试用这些 ID 更新记录时，因记录不存在而报错：`Record to update not found`。

**解决方案**：
1. 检查 ID 是否以 `legacy-` 开头（前端生成的假 ID）
2. 如果是假 ID，跳过更新，改为查找是否存在相同唯一键的记录
3. 如果存在则更新，否则创建新记录

**版本唯一性约束**：
前端已实现版本唯一性检查，每种版本类型（Markdown 中文、Markdown 英文、PDF）只能添加一次。

---

### 题面/题解多语言多格式支持

**变更说明**：实现题面和题解的多语言（中文/英文）、多格式（Markdown/PDF）支持。

**修改文件**：
- `apps/server/prisma/schema.prisma` - 新增 ProblemStatement 模型
- `apps/server/src/routes/problems.ts` - 修改 CRUD API 支持多版本
- `apps/web/src/components/problem/ProblemDetail.tsx` - 查看界面语言切换
- `apps/web/src/components/problem/ProblemForm.tsx` - 编辑界面多版本管理

**功能说明**：
1. 每个题面/题解可同时存在 Markdown 中文、Markdown 英文、PDF 版本
2. 编辑者可控制每个版本的可见性
3. 查看者通过下拉选择查看不同语言版本
4. PDF 通过上传接口管理

**API 变更**：
- `GET /api/problems/:id` 返回 `statements` 和 `solutions` 数组
- `POST /api/problems` 支持创建时传入 `statements`/`solutions` 数组
- `PUT /api/problems/:id` 支持更新 `statements`/`solutions` 数组
- `POST /api/problems/:id/statements/pdf` 统一 PDF 上传接口
- `PUT /api/problems/:id/statements/:id/visibility` 更新可见性
- `DELETE /api/problems/:id/statements/:id` 删除版本

---

### Markdown 中文件链接下载修复

**变更说明**：修复 Markdown 中的文件链接点击后返回 404 的问题。

**修改文件**：
- `apps/web/src/components/ui/MarkdownRenderer.tsx` - 添加链接点击处理，文件下载携带认证 Token

**问题原因**：
Markdown 中的附件链接（如 `[3.in](/api/files/xxx/download)`）点击后浏览器直接访问 URL，没有携带认证 Token，导致返回 401。

**解决方案**：
在 MarkdownRenderer 中拦截 `/api/files/` 开头的链接点击，使用 JavaScript fetch 携带 Token 下载文件。

---

### Markdown 指令语法支持

**变更说明**：修复 Markdown 中 `:::align{center}` 等指令语法不被解析，导致图片无法显示的问题。

**修改文件**：
- `apps/web/src/components/ui/MarkdownRenderer.tsx` - 添加 remark-directive 和 remark-directive-rehype 插件
- `apps/web/src/styles/globals.css` - 添加 .align 和图片居中样式

**问题原因**：
洛谷 Markdown 使用 `:::align{center}` 语法包裹图片，ReactMarkdown 默认不支持该指令语法，导致整个块被渲染为纯文本，图片不显示。

**解决方案**：
1. 安装 `remark-directive` 和 `remark-directive-rehype` 插件
2. 添加 CSS 支持 `.align` 和 `.center` 类

---

### 图片显示修复

**变更说明**：修复 Markdown 中的图片无法显示的问题。

**修改文件**：
- `apps/server/src/routes/oj-fetcher.ts` - 移除图片处理的 Cookie 要求
- `apps/web/src/components/ui/MarkdownRenderer.tsx` - 添加图片 URL 后端前缀

**问题原因**：
1. 图片处理需要 Cookie 才会执行，但 CDN 图片不需要 Cookie
2. 前端渲染图片时 URL `/uploads/...` 没有添加后端 API 前缀

---

### OJ 拉取重复附件修复

**变更说明**：修复重新拉取题目时附件重复创建的问题。

**修改文件**：
- `apps/server/src/routes/oj-fetcher.ts`

**修复内容**：
1. `downloadAttachmentInternal` 函数：下载前先查询同名附件，存在则删除旧记录
2. 主拉取流程：更新已存在题目时，先清理所有旧图片文件

---

### 附件下载行为修复

**变更说明**：修复附件点击下载时被查看而不是下载的问题。

**修改文件**：
- `apps/server/src/lib/storage.ts` - 修改 `getUrl()` 方法，私有文件返回 API 路径

**根因**：`LocalStorageProvider.getUrl()` 总是返回 `/uploads/...` 静态路径，静态文件服务不设置 `Content-Disposition: attachment` 响应头。

**修复**：公开文件返回静态路径，私有文件返回 `/api/files/:id/download` API 路径。

---

### 文件存储系统实现

**变更说明**：实现本地文件存储系统，支持权限控制和 OSS 迁移。

**新增内容**：

1. **数据库模型** (`apps/server/prisma/schema.prisma`):
   - 新增 `File` 模型，包含存储抽象层字段

2. **存储配置** (`apps/server/src/config/storage.ts`):
   - 目录结构定义
   - 文件大小限制
   - 允许的 MIME 类型和扩展名

3. **存储服务** (`apps/server/src/lib/storage.ts`):
   - `LocalStorageProvider` 类实现
   - `FileService` 类提供统一接口
   - 路径穿越防护
   - 安全文件命名

4. **API 路由** (`apps/server/src/routes/files.ts`):
   - POST `/api/files/upload` - 文件上传
   - GET `/api/files/:id/download` - 下载私有文件
   - GET `/api/files/:id/public` - 访问公开文件
   - GET `/api/files/:id` - 获取文件信息
   - DELETE `/api/files/:id` - 软删除文件
   - GET `/api/files/by-owner/:ownerType/:ownerId` - 按业务对象获取文件列表

5. **迁移脚本** (`apps/server/prisma/migrate-files.ts`):
   - 迁移现有文件到新目录结构
   - 创建 File 数据库记录

6. **文档** (`docs/FILE_STORAGE_DESIGN.md`):
   - 完整的存储系统设计文档

**修改的上传代码**：

1. `apps/server/src/routes/auth.ts`:
   - 头像上传改用 FileService
   - 新 URL 格式：`/api/files/:id/public`

2. `apps/server/src/routes/problems.ts`:
   - 题面 PDF 上传改用 FileService
   - 题解 PDF 上传改用 FileService
   - 附件上传改用 FileService
   - 新 URL 格式：`/api/files/:id/download`

3. `apps/server/src/modules/team/team.routes.ts`:
   - 团队头像上传改用 FileService
   - 新 URL 格式：`/api/files/:id/public`

**前端修改**：

1. `apps/web/src/lib/assets.ts`:
   - 新增 `getFileDownloadUrl` 和 `getPublicFileUrl` 函数
   - 支持新的 File API URL 格式

2. `apps/web/src/components/problem/ProblemDetail.tsx`:
   - PDF 显示支持新旧两种 URL 格式
   - 附件下载使用认证请求

3. `apps/web/src/components/problem/ProblemNote.tsx`:
   - PDF 显示支持新旧两种 URL 格式

**涉及文件**：
- `apps/server/prisma/schema.prisma`
- `apps/server/src/config/storage.ts`（新建）
- `apps/server/src/lib/storage.ts`（新建）
- `apps/server/src/routes/files.ts`（新建）
- `apps/server/prisma/migrate-files.ts`（新建）
- `apps/server/src/index.ts`
- `apps/server/src/routes/auth.ts`
- `apps/server/src/routes/problems.ts`
- `apps/server/src/modules/team/team.routes.ts`
- `apps/web/src/lib/assets.ts`
- `apps/web/src/components/problem/ProblemDetail.tsx`
- `apps/web/src/components/problem/ProblemNote.tsx`
- `docs/FILE_STORAGE_DESIGN.md`（新建）
- `docs/database/DATABASE_MODELS.md`
- `docs/api/API_REFERENCE.md`
- `docs/KNOWN_ISSUES.md`

**迁移状态**：已完成
- 迁移脚本已运行
- 现有上传代码已更新
- 前端代码已更新

---

## 2026-03-25

### 学校教师列表字段契约修复

**问题描述**：前端访问 `teacher.user.status` 报错 undefined。

**根因分析**：
- 前端期望：`teacher.user.status`（小写）
- 后端返回：`teacher.User.status`（Prisma 大写关联字段）

**修复内容** (`apps/server/src/routes/schools.ts`):
- 教师列表 API 添加字段转换：`User` → `user`
- 使用解构移除原始大写字段

```typescript
const teachersWithUser = teachers.map(t => {
  const { User, ...rest } = t
  return { ...rest, user: User }
})
```

**符合字段契约**：按 `docs/api/FIELD_CONTRACT.md` 规范。

---

### 学生邀请列表过滤与 UI 优化

**问题描述**：学生端邀请列表显示无法处理的"邀请"，点击接受/拒绝提示"邀请不存在"。

**根因分析**：
- `getStudentTeams` 返回所有 `status='pending'` 记录
- 没有区分邀请（`invitedBy !== null`）和申请（`invitedBy === null`）
- 学生看到自己的申请记录，尝试"接受"失败

**修复内容**:

1. **后端过滤** (`apps/server/src/modules/team/team.service.ts`):
   - 邀请列表只返回 `invitedBy !== null` 的记录
   - 新增 `requests` 数组返回学生申请记录

2. **UI 优化** (`apps/web/src/components/team/InvitationCard.tsx`):
   - 邀请人信息更突出显示
   - 格式改为：`邀请人: XXX · 学校名称`

**符合规范**：
- `docs/team/TEAM_STATE_MACHINE.md` - INVITED vs REQUESTED 区分

---

### 学校模块 `_count` 字段大小写修复

**问题描述**：学校列表和详情页的学生/教师/团队数量显示不正确。

**根因分析**：
- Prisma `_count` 返回大写字段名：`Team`, `Teacher`, `Student`
- 前端期望小写字段名：`teams`, `teachers`, `students`

**修复内容** (`apps/server/src/routes/schools.ts`):
1. **学校列表端点** (line 68-70): 转换 `_count.Team/Teacher/Student` → `_count.teams/teachers/students`
2. **学校详情端点 - 非本校用户** (line 314-316): 同样的转换
3. **学校详情端点 - 本校用户** (line 346-348): 同样的转换

**符合规范**：按 `docs/api/FIELD_CONTRACT.md` 规范

---

### 团队模块 P1 危险问题修复

**问题描述**：团队模块存在多个安全漏洞和数据一致性问题。

**修复内容** (`apps/server/src/modules/team/team.routes.ts`):

#### 1. 跨团队操作漏洞
- `DELETE /:id/invites/:inviteId`: 添加 `invitation.teamId !== id` 检查
- `DELETE /:id/members/:memberId`: 添加 `member.teamId !== id` 检查
- `POST /:id/admins`: 添加 `existingMember.teamId !== id` 检查

#### 2. ID 维度混用修复
- `POST /:id/admins`: 使用 `findMemberById(memberId)` 获取 TeamMember 记录，而非用 userId 查询
- `DELETE /:id/members/:memberId`: 统一使用 TeamMember.id 作为 memberId 语义

#### 3. 查询语义验证
- 教师申请审批端点: 添加 `invitedBy !== null` 检查，拒绝邀请记录
- 邀请接受/拒绝端点: 添加 `invitedBy === null` 检查，拒绝申请记录

#### 4. 并发安全增强
- `POST /invitations/:invitationId/accept`: 使用 `updateMemberStatusIfPending` 条件更新
- `POST /invitations/:invitationId/reject`: 使用 `deleteMemberIfPending` 条件删除

**符合规范**：
- `docs/team/TEAM_STATE_MACHINE.md` - INVITED vs REQUESTED 区分
- `docs/team/TEAM_API_CONTRACT.md` - API 请求/响应格式
- `docs/team/TEAM_CONFLICT_RULES.md` - 并发安全模式

---

### 学生列表字段命名修复

**问题描述**：学生管理页面没有显示用户名和主教练。

**根因分析**：
- 前端期望：`user.username`、`headTeacher.name`（小写/camelCase）
- 后端返回：`User.username`、`Teacher.name`（Prisma 大写关联字段）

**修复内容** (`apps/server/src/routes/students.ts`):
- 转换 `User` → `user`
- 转换 `Teacher` → `headTeacher`
- 转换 `School` → `school`

**符合字段契约**：按 `docs/api/FIELD_CONTRACT.md` 规范，嵌套对象使用小写字段名。

---

### 团队审批并发安全问题修复

**问题描述**：多个管理员同时审批同一个申请时存在竞态条件，可能导致数据不一致。

**问题场景**：
```
时间线：
1. 管理员A 读取 member (status='pending')
2. 管理员B 读取 member (status='pending')
3. 管理员A 调用 approve → 更新为 'active'
4. 管理员B 调用 reject → 删除成员 ⚠️ 删除了已批准的成员！
```

**修复内容** (`apps/server/src/modules/team/team.repository.ts`):
- 新增 `updateMemberStatusIfPending`: 条件更新，只有 status='pending' 时才更新
- 新增 `deleteMemberIfPending`: 条件删除，只有 status='pending' 时才删除
- 新增 `updateJoinRequestIfPending`: 条件更新加入申请

**修复路由** (`apps/server/src/modules/team/team.routes.ts`):
- `/teacher-join-requests/:memberId/approve` - 使用条件更新
- `/teacher-join-requests/:memberId/reject` - 使用条件删除
- `/requests/:requestId/reject` - 使用条件更新/删除
- `/join-requests/:requestId/approve` - 使用条件更新
- `/join-requests/:requestId/reject` - 使用条件更新

**并发安全保证**：
- 使用乐观锁（Optimistic Locking）模式
- `updateMany`/`deleteMany` 返回受影响行数
- count=0 时返回 "该申请已被处理" 错误
- 后请求的操作会被拒绝，保证幂等性

---

### 团队加入申请显示为邀请的 Bug 修复

**问题描述**：教师申请加入团队后，申请记录错误地显示在自己的"待处理邀请"界面，而不是团队管理员的审批界面。

**根因分析**：
1. 教师申请加入时，`joinRequest` 方法创建 `TeamMember` 记录：`role: 'member', status: 'pending', invitedBy: null`
2. 前端获取邀请时，`findUserAdminInvites` 和 `findUserMemberInvites` 返回所有 pending 记录
3. 没有区分"邀请"（invitedBy 有值）和"申请"（invitedBy 为空）

**修复内容** (`apps/server/src/modules/team/team.repository.ts`):
- `findUserPendingInvites`: 添加 `invitedBy: { not: null }` 条件
- `findUserAdminInvites`: 添加 `invitedBy: { not: null }` 条件
- `findUserMemberInvites`: 添加 `invitedBy: { not: null }` 条件

**预期行为**：
- 邀请（invitedBy 有值）：显示在被邀请人的"待处理邀请"界面
- 申请（invitedBy 为空）：显示在团队管理员/所有者的审批界面

**影响范围**：
- 教师端团队邀请列表
- 学生端团队邀请列表

---

### 学生数据模型必填字段修改

**功能描述**：修改学生数据模型，确保学生必须有用户账号和主教练。

**修改内容**：

1. **Schema 修改** (`apps/server/prisma/schema.prisma`):
   - `userId` 从可选改为必填（`String?` → `String`）
   - `headTeacherId` 从可选改为必填（`String?` → `String`）
   - 关联关系从可选改为必填

2. **创建逻辑修改** (`apps/server/src/routes/students.ts`):
   - 强制要求 `username` 参数
   - 强制要求 `headTeacherId` 参数（如未指定，默认使用当前登录教师）
   - 创建学生时自动创建关联的用户账号

**影响范围**：
- 学生创建 API 强制要求用户名和主教练
- 现有数据已验证无空值
- 数据完整性得到保障

---

### 前后端字段契约规范文档

**功能描述**：创建前后端字段契约规范文档，统一 Prisma 查询和 API 响应规范。

**新增文档**：
- `docs/api/FIELD_CONTRACT.md` - 前后端字段契约规范

**修复内容**：
1. **/auth/me 的 profile 字段优化**：
   - 问题：`profile` 字段返回原始 Prisma 对象，包含大写关联字段（School, Teacher 等）
   - 修复：只返回简化的基本字段，避免暴露 Prisma 内部结构
   - 文件：`apps/server/src/routes/auth.ts`

**规范要点**：
- Prisma `include`/`select` 必须使用大写关联字段名（Teacher, School, Student 等）
- 访问关联对象使用大写字段名（`user.Teacher?.name`）
- API 返回优先使用扁平字段（teacherId, schoolId 等）
- 避免直接返回原始 Prisma 对象

**影响范围**：
- 后端 API 响应更规范
- 前端字段访问更一致
- 减少潜在的 500 错误

---

### Prisma 关联字段大小写全面修复

**功能描述**：修复所有 Prisma 查询中使用小写关联字段名导致的 500 错误。

**修复的文件和内容**：

| 文件 | 错误代码 | 修复后 |
|------|----------|--------|
| routes/students.ts:218 | `contestResults`, `contest` | `ContestResult`, `Contest` |
| routes/students.ts:76,214 | `headTeacher` | `Teacher` |
| routes/students.ts:215 | `Team.leader` | 移除（Team 无 leader 字段） |
| routes/students.ts:217 | `milestones` | `Milestone` |
| routes/schools.ts:188 | `headTeacher` | `Teacher` |
| routes/schools.ts:271-273 | `teams`, `teachers`, `students` | `Team`, `Teacher`, `Student` |

**影响范围**：
- `/api/schools/:id` - 修复 500 错误
- `/api/students` - 修复 500 错误
- `/api/students/:id` - 修复 500 错误
- 所有涉及这些查询的页面恢复正常

---

### 认证链路稳定性修复

**功能描述**：修复认证链路的稳定性问题，解决登录态刷新后丢失、错误信息不明确等问题。

**修复内容**：

1. **/auth/me Prisma 关联字段名不一致**：
   - 问题：`/me` 端点在 Prisma include 中使用小写 `student/teacher/admin`，但访问时使用大写 `Student/Teacher/Admin`
   - 结果：`teacherId`、`studentId`、`schoolId` 等字段返回 `undefined`
   - 修复：将 include 改为使用大写 `Student/Teacher/Admin`

2. **AuthProvider 过于激进清除认证状态**：
   - 问题：`fetchUserData` 在任何错误（包括网络错误）时都调用 `clearAuth()`
   - 结果：网络波动就会导致用户被登出
   - 修复：只在 HTTP 状态码 401/403 时才清除认证状态

3. **apiClient 吞掉所有错误**：
   - 问题：所有错误都返回 "网络错误"，不保留 HTTP 状态码
   - 修复：在 ApiResponse 中添加 `status` 字段，网络错误使用 status=0

4. **env.ts 要求 DATABASE_URL**：
   - 问题：SQLite 使用文件路径 `file:./dev.db`，不需要 DATABASE_URL 环境变量
   - 修复：将 `required` 数组改为空，不再强制要求 DATABASE_URL

**涉及文件**：
- `apps/server/src/routes/auth.ts` - Prisma 关联字段名修复
- `apps/web/src/components/AuthProvider.tsx` - 错误处理逻辑优化
- `apps/web/src/lib/apiClient.ts` - 保留 HTTP 状态码
- `apps/server/src/config/env.ts` - 移除 DATABASE_URL 强制要求

**影响范围**：
- 登录态在刷新页面后不再丢失
- 网络波动不会导致用户被登出
- API 错误信息更明确

---

### 代码仓库清理

**功能描述**：清理仓库中的无用、重复、历史残留代码，减少磁盘占用。

**清理内容**：

1. **删除 test 目录（约 114MB）**：
   - 包含旧项目完整副本和 `apps.zip` 打包文件
   - .gitignore 已配置忽略，但物理文件仍在磁盘上

2. **删除数据库备份文件**：
   - `apps/server/prisma/dev.db.backup`

3. **删除临时/旧版脚本**：
   - `apps/server/prisma/check-data.ts` - 临时检查脚本
   - `apps/server/prisma/seed-test-data.ts` - 无引用的测试数据脚本
   - `apps/server/prisma/seed-v1.ts` - 旧版本种子数据

4. **清理 webpack 缓存旧文件**：
   - `apps/web/.next/cache/**/*.old`

5. **更新 package.json**：
   - 删除 `prisma:seed-v1` 脚本

**涉及文件**：
- 删除：test 目录、4 个 prisma 脚本、多个 .old 缓存文件
- 修改：apps/server/package.json

**清理后 apps/server/src 职责边界**：
- 纯后端职责：Express API 服务
- 无前端代码残留
- 目录结构清晰：config/、lib/、middleware/、modules/、routes/

---

### 比赛和题单模块清理

**功能描述**：彻底清理比赛和题单模块代码，仅保留导航占位入口。

**清理原因**：
- 比赛模块和题单模块为"摆烂半成品"，功能未完成
- 清理目的是减少干扰，保持代码整洁
- 暂不删除数据库模型，保留数据结构

**删除内容**：

1. **前端API代理**（共9个文件）：
   - `apps/web/src/app/api/contests/**` (5个文件)
   - `apps/web/src/app/api/task-lists/**` (2个文件)
   - `apps/web/src/app/api/task-progress/**` (2个文件)

2. **前端组件**：
   - `apps/web/src/app/teacher/school/components/ContestsTab.tsx`

**修改内容**：

1. **学生端占位页**：
   - `/student/contests` - 改为"功能暂未开放"占位页
   - `/student/task-lists` - 改为"功能暂未开放"占位页

2. **导航配置**（navigation.ts）：
   - 平台管理员：移除"公共比赛"
   - 学校负责人/教师：移除"题单管理"和"比赛中心"
   - 学生：移除"我的题单"和"我的比赛"

3. **首页**：
   - 教师端：移除比赛相关卡片和快捷入口
   - 学生端：移除比赛相关卡片和快捷入口
   - 平台管理端：移除比赛统计卡片和入口

4. **学校详情页**：
   - 移除"联考比赛"tab

5. **成绩页面**：
   - `/teacher/scores` - 改为占位页
   - `/student/scores` - 改为占位页

6. **后端统计接口**（stats.ts）：
   - 删除 `/contests` 端点
   - `/global` 端点移除比赛相关字段

**涉及文件**：
- 删除：10个文件
- 修改：8个文件

**影响范围**：
- 比赛和题单功能不可用
- 相关路由返回占位页
- 数据库 Contest/TaskList 等表保留但暂不使用

---

### 权限验证与注释修正

**功能描述**：验证并修正权限相关代码的注释，确保注释与实际逻辑一致。

**发现与修正**：
经代码审查发现，`canManageStudent` 和团队管理员删除的权限逻辑**已经正确实现**（可能在前次会话中修复），但注释与代码不一致，可能误导后续开发者。

**修改内容**：

1. **permissions.ts 注释修正**：
   - 第 16-17 行：角色权限说明
     - 原注释：`- teacher: 本校数据 + 自己的团队 + 自己的学生`
     - 修正为：`- teacher: 本校数据 + 自己的团队 + 自己作为主教练的学生`
   - canManageStudent 函数 JSDoc：
     - 原注释：`- teacher: 可管理自己的学生（主教练）或本校学生`
     - 修正为：`- teacher: 只能管理自己作为主教练的学生`

2. **验证结果**：
   - `canManageStudent` 逻辑正确：普通教师只能管理 headTeacherId === teacherId 的学生
   - `students.ts` 删除接口正确使用 canManageStudent
   - `team.routes.ts` 已有跨团队操作验证（adminMember.teamId !== id）

**涉及文件**：
- `apps/server/src/middleware/permissions.ts` - 注释修正

---

### 代码清理与权限修复

**功能描述**：系统性清理项目代码，解决权限漏洞、目录污染、历史残留等问题。

**清理内容**：

1. **删除历史残留文件**：
   - `apps/server/prisma/seed.ts.bak`
   - `apps/server/prisma/seed.ts.old`
   - `docs/docs.zip`
   - `.next/cache/**/*.old`

2. **清理目录污染**（删除server下错误放置的前端代码）：
   - `apps/server/src/app/` - 前端页面结构
   - `apps/server/src/components/` - React组件
   - `apps/server/src/hooks/` - React Hooks
   - `apps/server/src/styles/` - CSS样式
   - `apps/server/src/config/navigation.ts` - 前端导航配置

3. **删除题单模块**（功能未完成，保留Tab导航UI）：
   - 后端：`task-lists.ts`, `task-progress.ts`
   - 前端：教师端页面，学生端简化为只保留Tab

4. **删除比赛模块**（功能未完成，保留Tab导航UI）：
   - 后端：`contests.ts`, `contest-notes.ts`
   - 前端：教师端页面，学生端详情页，简化列表页只保留Tab

5. **权限漏洞修复**：
   - `canManageStudent`：普通教师只能管理自己作为主教练的学生
   - 团队跨团队漏洞：删除管理员时验证是否属于当前团队

**涉及文件**：
- 删除：多个后端路由、前端页面
- 修改：`apps/server/src/index.ts`, `apps/server/src/middleware/permissions.ts`, `apps/server/src/modules/team/team.routes.ts`

**影响范围**：
- 题单和比赛功能暂时不可用
- 权限控制更加严格

---

### 题库界面优化

**功能描述**：优化题库列表和详情页的显示与交互。

**修改内容**：

1. **题目名称点击跳转**：
   - 修复题目名称点击跳转问题，改为使用客户端导航 `router.push()`，与"查看"按钮行为一致
   - 位置：`apps/web/src/app/platform-admin/problems/page.tsx`

2. **时间/空间限制显示单位调整**：
   - 时间限制显示单位改为毫秒（ms）
   - 标签名称从"时限"改为"时间限制"，"内存"改为"空间限制"
   - 修改位置：
     - `apps/web/src/components/problem/ProblemDetail.tsx` - 详情页显示
     - `apps/web/src/components/problem/ProblemForm.tsx` - 表单输入

3. **OJ 拉取时间限制修复**：
   - 修复从洛谷拉取题目时时间限制被错误除以1000的问题
   - 洛谷 API 返回的时间限制已经是毫秒，无需转换
   - 位置：`apps/web/src/components/problem/ProblemForm.tsx`

**涉及文件**：
- `apps/web/src/app/platform-admin/problems/page.tsx`
- `apps/web/src/components/problem/ProblemDetail.tsx`
- `apps/web/src/components/problem/ProblemForm.tsx`

---

## 2026-03-24

### OJ 拉取队列管理功能

**功能描述**：为平台管理员设计批量从OJ平台拉取题目的队列管理功能。

**核心功能**：
- 批量拉取：输入多个题号，队列式自动拉取
- 平台Cookie配置：每个平台可配置不同Cookie（洛谷需要 __client_id, _uid）
- 状态返回：拉取成功、拉取失败、附件下载失败等
- 去重：已拉取的题目不重复创建
- 重新拉取：对失败的题目可手动重试
- 无Cookie也能拉取：但附件可能下载失败

**数据库模型**：
- `OjFetchJob` - 拉取任务记录（platform, problemId, status, message, hasAttachment, attachmentStatus, createdProblemId）
- `OjPlatformConfig` - 平台Cookie配置（platform, cookies）

**API 端点**：
- `GET /api/oj-fetcher/platforms/:platform/config` - 获取平台Cookie配置
- `PUT /api/oj-fetcher/platforms/:platform/config` - 更新平台Cookie配置
- `GET /api/oj-fetcher/jobs` - 获取拉取任务列表
- `POST /api/oj-fetcher/jobs/batch` - 批量创建拉取任务
- `POST /api/oj-fetcher/jobs/:id/retry` - 重试任务
- `DELETE /api/oj-fetcher/jobs/:id` - 删除任务

**前端页面**：
- `apps/web/src/app/platform-admin/problems/page.tsx` - 重写为Tab布局（拉取队列 + 公共题库）

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 OjFetchJob, OjPlatformConfig 模型
- `apps/server/src/routes/oj-fetcher.ts` - 添加队列管理API和异步处理逻辑
- `apps/web/src/app/platform-admin/problems/page.tsx` - 重写为Tab布局

**技术要点**：
- 异步队列处理：批量任务提交后，后台自动处理队列
- 唯一题号生成：自动生成 P000001 格式的题号，避免冲突
- 管理员所有者：拉取的题目以管理员用户作为所有者

---

### 附件下载功能（洛谷附件）

**功能描述**：支持从洛谷题目页面下载附件到本地系统。

**核心功能**：
- 拉取洛谷题目时自动获取附件信息
- 在编辑页面的"附件"标签页显示远程附件列表
- 支持一键下载远程附件到本地
- 支持配置洛谷 Cookie（通过环境变量 `LUOGU_COOKIE`）

**技术实现**：
- 洛谷附件下载链接会重定向（302）到阿里云 OSS
- 后端手动处理重定向，获取最终文件内容
- 部分附件需要登录才能下载，返回 403 时提示配置 Cookie

**修改文件**：
- `apps/server/src/oj-adapters/types.ts` - 添加 `OjAttachment` 类型和 `attachments` 字段
- `apps/server/src/oj-adapters/luogu.ts` - 返回附件信息，添加调试日志
- `apps/server/src/routes/oj-fetcher.ts` - 添加下载附件 API（含重定向处理）
- `apps/web/src/components/problem/ProblemForm.tsx` - 添加远程附件显示和下载功能
- `apps/server/.env.example` - 添加 LUOGU_COOKIE 配置说明

**使用方法**：
1. 在编辑页面的"发布设置"中，添加洛谷题目绑定
2. 点击"拉取"按钮，系统会自动获取题目信息和附件列表
3. 切换到"附件"标签页，查看"远程附件"部分
4. 点击"下载"按钮下载附件

**配置洛谷 Cookie（如果下载失败）**：
1. 登录洛谷 https://www.luogu.com.cn
2. 打开浏览器开发者工具 (F12) -> Application -> Cookies
3. 复制所有 cookie 字符串（格式如 `key1=value1; key2=value2`）
4. 在后端 `.env` 文件中添加：`LUOGU_COOKIE="你的Cookie"`

---

### 题目附件功能修复与优化

**功能描述**：
1. 修复附件上传权限检查问题
2. 题目列表显示创建者（所有角色可见）
3. 思路记录按钮移到更显眼的位置

**修改文件**：
- `apps/server/src/routes/problems.ts` - 修复 `canModifyProblem` 权限检查函数，从 JWT payload 正确获取 ownerId
- `apps/web/src/components/problem/ProblemList.tsx` - 所有角色都能看到创建者列
- `apps/web/src/components/problem/ProblemDetail.tsx` - 思路记录按钮移到 Tab 区域右侧
- `apps/web/src/components/problem/ProblemForm.tsx` - 修复 FormData 上传问题（移除手动设置的 Content-Type）

---

### 题目附件功能

**功能描述**：为每个题目添加附件功能，支持在详情页查看下载，在编辑页上传删除。

**核心功能**：
- 详情页显示附件 Tab，展示附件列表和下载链接
- 编辑页显示附件 Tab，支持上传和删除附件
- 支持多种文件格式：PDF、ZIP、RAR、7Z、TXT、CPP、C、PY、JAVA、PAS、IN、OUT、MD
- 最大文件大小：50MB

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 ProblemAttachment 模型
- `apps/server/src/routes/problems.ts` - 添加附件 API 端点（GET/POST/DELETE）
- `apps/web/src/components/problem/ProblemDetail.tsx` - 添加附件 Tab 和下载功能
- `apps/web/src/components/problem/ProblemForm.tsx` - 添加附件 Tab（仅编辑模式）和上传/删除功能

**新增 API 端点**：
- `GET /api/problems/:id/attachments` - 获取附件列表
- `POST /api/problems/:id/attachments` - 上传附件
- `DELETE /api/problems/:id/attachments/:attachmentId` - 删除附件

---

### 洛谷适配器题面解析修复

**问题描述**：洛谷适配器无法正确拉取题目内容，只获取了样例和附件，缺失题目背景、描述、输入输出格式、提示等主要内容。

**根因**：洛谷 API 返回的数据结构中，题目内容在 `content` 子对象中，原代码错误地在根层级查找这些字段。

**修复内容**：
- 修正 `LuoguProblemData` 接口，添加 `content` 子对象结构
- 修改 `buildMarkdown` 方法，从 `content` 子对象读取各字段
- 样例支持数组和对象两种格式

**修改文件**：
- `apps/server/src/oj-adapters/luogu.ts` - 修复数据结构解析

**验证**：
- 成功拉取 P14839 完整题面
- 创建题目 P000006（[THUPC 2026 初赛] 集合）

---

### 题库搜索与平台筛选功能

**功能描述**：为题库列表页面添加搜索和平台筛选功能。

**核心功能**：
- 公有题库：添加 OJ 平台下拉选择 + 搜索题号和名字
- 私有题库：添加搜索题号和名字功能
- 支持回车键快速搜索
- 重置按钮清空筛选条件

**修改文件**：
- `apps/server/src/routes/problems.ts` - 添加 keyword 和 platform 查询参数
- `apps/web/src/components/problem/ProblemList.tsx` - 添加搜索框和平台下拉

**新增 API 参数**：
- `keyword`: 搜索关键词（匹配 problemCode 和 title）
- `platform`: OJ 平台筛选（仅对公有题库有效）

**技术要点**：
- 关键词搜索使用 Prisma 的 `contains` 匹配
- 平台筛选在应用层实现（ojBindings 是 JSON 字符串）

---

### OJ 远程题目拉取功能

**功能描述**：实现从洛谷平台拉取题目信息，自动填充题目表单。

**核心功能**：
- 在题目编辑页的 OJ 绑定区域添加"拉取"按钮
- 输入题号后点击拉取，自动填充表单（标题、题面、时间/内存限制、难度）
- 支持限流控制（2 请求/秒 + 0.10-0.35秒随机抖动）
- 错误处理和重试机制（最多3次，指数退避）

**新建文件**：
- `apps/server/src/oj-adapters/types.ts` - 类型定义
- `apps/server/src/oj-adapters/luogu.ts` - 洛谷适配器
- `apps/server/src/oj-adapters/index.ts` - 统一导出
- `apps/server/src/routes/oj-fetcher.ts` - API 路由

**修改文件**：
- `apps/server/src/index.ts` - 注册路由
- `apps/web/src/components/problem/ProblemForm.tsx` - 添加拉取按钮
- `apps/server/package.json` - 添加 cheerio 依赖

**技术要点**：
- 使用 cheerio 解析 HTML 中的 lentille-context JSON
- 手动处理洛谷的 302 重定向 + Cookie 反爬虫机制
- 统一的错误码和 HTTP 状态映射

---

### 题库模块重构

**功能描述**：重构题库模块，实现三端（学生、教师、管理端）的题库功能，支持私有题库和公共题库。

**核心功能**：
- 私有题库：学生和教师都可以创建私有题目，只有自己能看到和编辑
- 公共题库：管理端可以创建公共题目，所有人可见
- 代码复用：三端使用共享组件，只是权限不同

**数据库修改**：
- `Problem` 模型添加 `visibility` 字段（private/public）
- `Problem` 模型添加 `ownerType` 字段（teacher/student/admin）
- 移除 `owner` 外键关联（因为 owner 可能是 Teacher、Student 或 Admin）

**后端修改**：
- `apps/server/src/routes/problems.ts` - 统一权限逻辑，支持学生和管理员

**前端共享组件**（新建）：
- `apps/web/src/components/problem/ProblemList.tsx` - 列表组件
- `apps/web/src/components/problem/ProblemDetail.tsx` - 详情组件
- `apps/web/src/components/problem/ProblemForm.tsx` - 表单组件
- `apps/web/src/components/problem/ProblemNote.tsx` - 思路记录组件

**前端页面修改**：
- 教师端：使用共享组件
- 学生端：新建完整的题库页面（列表、详情、创建、编辑、思路记录）
- 管理端：新建完整的题库页面，支持创建公共题目

**权限逻辑**：
| 角色 | 可见范围 | 可创建 | 可编辑/删除 |
|------|----------|--------|-------------|
| teacher | 私有(自己) + 公共 | 私有题目 | 自己的私有题目 |
| student | 私有(自己) + 公共 | 私有题目 | 自己的私有题目 |
| admin | 全部 | 私有/公共题目 | 全部题目 |

### 题目绑定功能

**功能描述**：在题目编辑和创建页面的"发布设置" Tab 中添加 OJ 题目绑定功能。

**核心功能**：
- 支持绑定外部 OJ 平台题目（最多3个，可选）
- 平台选择：洛谷、CodeForces、AtCoder、LOJ、POJ、HDU、SPOJ、UVa、Vijos、BZOJ、Gym、其他
- 详情页显示 OJ 绑定链接，点击可跳转到对应题目

**数据格式**：
```json
[
  { "platform": "luogu", "problemId": "P1001" },
  { "platform": "codeforces", "problemId": "1234A" }
]
```

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 ojBindings 字段
- `apps/server/src/routes/problems.ts` - 处理 ojBindings 字段
- `apps/web/src/app/teacher/problems/new/page.tsx` - 创建页面添加绑定 UI
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 编辑页面添加绑定 UI
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 详情页显示绑定链接

### 私有题库发布按钮移除

**功能描述**：移除题目详情页的发布按钮，改为通过编辑页面的"发布设置" Tab 修改状态。

**修改内容**：
- 移除详情页的"发布"按钮
- 移除 `handlePublish` 函数
- 保留编辑页面的状态选择功能（草稿/已发布）

**修改文件**：
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 移除发布按钮和相关函数

**用户体验**：
- 用户点击"编辑"按钮进入编辑页
- 在"发布设置" Tab 中可以修改题目状态（草稿/已发布）

### 私有题库编辑页面 Tab 布局与内容保留

**功能描述**：优化私有题库的创建和编辑页面，使用 Tab 布局，并解决切换题面/题解类型时内容丢失的问题。

**核心功能**：
- 编辑/创建页面使用 Tab 布局：题面、题解、发布设置
- 基本信息栏始终显示在顶部
- 题面/题解支持编辑/预览切换
- 切换题面/题解类型时保留之前的内容

**修改文件**：
- `apps/server/src/routes/problems.ts` - 创建时始终保存内容，更新时只保存匹配类型的内容
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 编辑页面 Tab 布局
- `apps/web/src/app/teacher/problems/new/page.tsx` - 创建页面 Tab 布局
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 详情页面保存逻辑修复

**技术要点**：
- **编辑场景**：后端只在类型匹配时才更新对应字段，前端只在类型匹配时才发送对应内容
- **创建场景**：前端始终发送内容（如果有），后端始终保存内容（如果有）
- 详情页面、编辑页面、创建页面全部修复
- 避免切换类型时清空其他类型的内容

### 私有题库思路记录功能

**功能描述**：为私有题库实现思路记录功能，教师可以在查看题目时记录解题思路。

**核心功能**：
- 全屏分栏布局：左侧题目，右侧编辑器
- 支持 Markdown 编辑/预览/分栏三种模式
- 自动保存（2秒 debounce）+ 手动保存
- 显示保存状态和时间

**修改文件**：
- `apps/server/src/routes/problems.ts` - 添加思路记录 API
- `apps/web/src/app/teacher/problems/[id]/note/page.tsx` - 思路记录全屏页面
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 添加入口按钮

---

## 2026-03-23

### 思路记录模式实现

**功能描述**：实现学生在比赛做题时能够一边看题一边记录思路过程的功能。

**核心功能**：
- 分栏布局：左侧题目描述，右侧 Markdown 编辑器
- 支持 Markdown 和 LaTeX 数学公式
- 自动保存（debounce 1秒）
- 编辑/预览/分栏三种显示模式
- 按题目存储思路记录

**新建文件**：
- `apps/server/src/routes/contest-notes.ts` - 思路记录 API
- `apps/web/src/app/student/contests/[id]/practice/[problemId]/page.tsx` - 思路记录页面
- `apps/web/src/components/ui/MarkdownEditor.tsx` - Markdown 编辑器组件

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 ContestProblemNote 模型
- `apps/server/src/index.ts` - 注册 contest-notes 路由
- `apps/web/src/app/student/contests/[id]/page.tsx` - 添加「开启思路记录模式」按钮

**技术要点**：
- 使用 `upsert` 实现创建或更新笔记
- 使用 `useEffect` + `debounce` 实现自动保存
- MarkdownEditor 组件支持编辑/预览/分栏三种模式

**API 端点**：
- `GET /api/contests/:contestId/problems/:problemId/note` - 获取思路记录
- `PUT /api/contests/:contestId/problems/:problemId/note` - 保存思路记录

**影响范围**：
- 新增模块，不影响现有功能

---

### PDF 跨域显示问题修复

**问题描述**：私有题库的 PDF 文件无法在页面上嵌入显示，因为前端在 3000 端口，PDF 在 3001 端口，浏览器阻止跨域资源嵌入。

**解决方案**：创建 Next.js API 代理路由，让 PDF 从 3000 端口提供。

**新建文件**：
- `apps/web/src/app/api/problems/pdf/[...path]/route.ts` - PDF 代理 API

**修改文件**：
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 将 `getStaticUrl` 改为 `getPdfUrl`，使用代理路径
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 同上

**技术要点**：
- 代理路由接收文件名，转发到后端 `/uploads/problems/` 目录
- 响应设置 `Content-Disposition: inline` 确保嵌入显示
- PDF 使用 `<object>` 标签嵌入，支持 fallback 链接

**影响范围**：
- 私有题库 PDF 显示功能

---

### 私有题库功能实现

**功能描述**：实现教师私有题库功能，支持创建、编辑、管理私有题目。

**核心功能**：
- 题目自动编号（P000001 格式）
- 题面/题解支持 Markdown 或 PDF
- 时间限制（秒）、内存限制（MB）
- 难度等级（简单/中等/困难）
- 草稿/发布状态管理
- 显示题目所有者姓名

**新建文件**：
- `apps/server/src/routes/problems.ts` - 题目 CRUD API、PDF 上传
- `apps/web/src/app/teacher/problems/page.tsx` - 题库列表页（私有/公有 Tab）
- `apps/web/src/app/teacher/problems/new/page.tsx` - 新建题目页
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 题目详情页
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 题目编辑页

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 Problem 模型
- `apps/server/src/index.ts` - 注册 problems 路由

**技术要点**：
- 题号生成：查询数据库最大编号 + 1，格式 `P${String(nextNum).padStart(6, '0')}`
- 权限控制：只有所有者可编辑/删除
- PDF 上传：使用 Multer，存储到 `uploads/problems/` 目录
- Markdown 渲染：复用现有 MarkdownRenderer 组件

**API 端点**：
- `GET /api/problems` - 题目列表
- `POST /api/problems` - 创建题目
- `GET /api/problems/:id` - 题目详情
- `PUT /api/problems/:id` - 更新题目
- `DELETE /api/problems/:id` - 删除题目
- `POST /api/problems/:id/statement-pdf` - 上传题面 PDF
- `POST /api/problems/:id/solution-pdf` - 上传题解 PDF
- `POST /api/problems/:id/publish` - 发布题目

**影响范围**：
- 新增模块，不影响现有功能

---

### 团队邀请功能 Bug 修复

**问题描述**：教师通过用户名邀请学生后，邀请在教师端的"待处理邀请"列表显示，但学生端看不到邀请。

**根因分析**：

`team.service.ts` 中 `getStudentTeams` 和 `getSchoolTeams` 方法错误调用 `findMembers(studentId)`：

```typescript
// 错误：findMembers 第一个参数是 teamId，不是 userId
const memberRecords = await this.repo.findMembers(studentId)
```

这导致查询条件变成 `WHERE teamId = studentId`，永远查不到正确结果。

**修复方案**：

1. 在 `team.repository.ts` 新增 `findMembersByUser()` 方法：
   ```typescript
   async findMembersByUser(userId: string, userType?: MemberType, status?: MemberStatus)
   ```

2. 修改 `team.service.ts` 调用：
   ```typescript
   // 修复后：正确使用 userId 查询
   const memberRecords = await this.repo.findMembersByUser(studentId, 'student')
   ```

**验证结果**：
- 教师邀请学生 → ✅ 成功
- 学生查看邀请列表 → ✅ 能看到 pending 邀请

**修改文件**：
- `apps/server/src/modules/team/team.repository.ts` - 新增 `findMembersByUser` 方法
- `apps/server/src/modules/team/team.service.ts` - 修复调用

**影响范围**：
- 学生端邀请列表功能
- 学校团队列表成员查询

---

### 团队模块代码结构重构

**目标**：将过大的 `routes/teams.ts`（2707 行）拆分为分层架构，提高代码可维护性。

**现状分析**：
- 单文件 2707 行，职责混杂
- 路由、业务逻辑、数据访问混杂
- 辅助函数重复、内联逻辑多
- 难以单独测试业务逻辑

**新增内容**：

1. **模块化结构**（`src/modules/team/`）：
   - `team.types.ts`：类型定义（~300 行）
   - `team.utils.ts`：工具函数（~100 行）
   - `team.repository.ts`：数据访问层（~600 行）
   - `team.service.ts`：业务逻辑层（~500 行）
   - `team.routes.ts`：路由层（~300 行）

2. **向后兼容**：
   - `routes/teams.ts` 改为重导出入口
   - 导出类型、服务、仓库保持 API 兼容

3. **测试辅助修复**：
   - `tests/helpers/testRequest.ts` 改用 ESM 导入

**新建文件**：
- `apps/server/src/modules/team/team.types.ts`
- `apps/server/src/modules/team/team.utils.ts`
- `apps/server/src/modules/team/team.repository.ts`
- `apps/server/src/modules/team/team.service.ts`
- `apps/server/src/modules/team/team.routes.ts`

**修改文件**：
- `apps/server/src/routes/teams.ts` - 改为重导出入口
- `apps/server/tests/helpers/testRequest.ts` - ESM 导入修复

**影响范围**：
- 团队模块所有 API（30+ 端点）
- 测试框架导入方式

**风险与缓解**：
- 风险：拆分可能引入回归 bug
- 缓解：保持原有 API 签名不变，运行测试验证

---

### 测试体系补齐

**目标**：建立基础的测试基础设施并编写关键测试用例，为项目提供回归测试保障。

**现状分析**：
- 无测试框架配置
- 无测试文件
- 无测试脚本

**新增内容**：

1. **Vitest 测试框架配置**：
   - 新建 `vitest.config.ts`
   - 配置覆盖率报告（v8 provider）
   - 配置测试环境为 Node.js

2. **测试辅助工具**（`tests/helpers/`）：
   - `testUser.ts`：创建测试用户、学校、团队
   - `testToken.ts`：生成测试 JWT Token
   - `testRequest.ts`：创建测试 Express 应用

3. **测试脚本**（`package.json`）：
   - `pnpm test`：运行所有测试
   - `pnpm test:watch`：监视模式
   - `pnpm test:coverage`：覆盖率报告

4. **测试用例**：
   - `auth.test.ts`：登录、注册、密码修改（14 个用例）
   - `permissions.test.ts`：资源级权限检查（20+ 个用例）
   - `transactions.test.ts`：事务完整性测试（5 个用例）
   - `teams.test.ts`：团队操作测试（12 个用例）
   - `regression.test.ts`：基础回归测试（10 个用例）

**新建文件**：
- `apps/server/vitest.config.ts`
- `apps/server/tests/setup.ts`
- `apps/server/tests/helpers/index.ts`
- `apps/server/tests/helpers/testUser.ts`
- `apps/server/tests/helpers/testToken.ts`
- `apps/server/tests/helpers/testRequest.ts`
- `apps/server/tests/auth.test.ts`
- `apps/server/tests/permissions.test.ts`
- `apps/server/tests/transactions.test.ts`
- `apps/server/tests/teams.test.ts`
- `apps/server/tests/regression.test.ts`

**修改文件**：
- `apps/server/package.json`：添加 vitest、supertest、coverage 依赖

**验证方式**：
```bash
cd apps/server
pnpm test
```

---

### 安全中间件、运行环境校验与基础防护

**目标**：将项目从"开发环境能跑"提升到"更接近生产可用"，补齐基础安全防护。

**发现的问题**：

| 检查项 | 现状 | 风险 |
|--------|------|------|
| helmet | ❌ 未使用 | 缺少 X-Frame-Options、X-Content-Type-Options 等安全头 |
| CORS | 硬编码 localhost:3000 | 生产环境无法使用 |
| JSON body | ❌ 无大小限制 | 可被大请求拖垮 |
| 比赛资料上传 | ❌ 无限制 | 可被滥用存储或拖垮服务器 |
| 全局限流 | ❌ 无 | 可被 DDoS 攻击 |
| 启动校验 | ⚠️ 仅 JWT_SECRET | 缺少关键配置也能启动 |

**修复内容**：

1. **安装 helmet 安全中间件**：
   - 添加 `X-Frame-Options: DENY`（防止点击劫持）
   - 添加 `X-Content-Type-Options: nosniff`（防止 MIME 嗅探）
   - 添加其他安全响应头

2. **动态 CORS 配置**（新建 `config/cors.ts`）：
   - 开发环境：允许 `localhost:3000`、`127.0.0.1:3000`
   - 生产环境：从环境变量 `CORS_ORIGINS` 读取白名单
   - 拒绝未授权来源时记录日志

3. **请求体大小限制**：
   - JSON body 限制为 1MB
   - 比赛资料上传限制为 20MB + 文件类型白名单（PDF/ZIP/TXT/MD）

4. **全局 API 限流**（修改 `rateLimiter.ts`）：
   - 限制：每分钟最多 100 次请求
   - 目的：防止 DDoS 和恶意滥用

5. **环境变量启动校验**（新建 `config/env.ts`）：
   - 必须：`DATABASE_URL`
   - 生产必须：`JWT_SECRET`、`CORS_ORIGINS`
   - 缺少配置时拒绝启动并输出错误

6. **错误信息优化**：
   - 生产环境隐藏详细错误信息
   - 统一处理 Multer 上传错误（文件大小、数量、类型）
   - 统一处理 CORS 错误

**新建文件**：
- `apps/server/src/config/env.ts` - 环境变量校验和工具函数
- `apps/server/src/config/cors.ts` - CORS 动态配置

**修改文件**：
- `apps/server/package.json` - 添加 helmet 依赖
- `apps/server/src/index.ts` - 注册安全中间件、启动校验、错误处理优化
- `apps/server/src/middleware/rateLimiter.ts` - 添加 globalLimiter
- `apps/server/src/routes/contests.ts` - 添加上传大小和类型限制
- `apps/server/.env.example` - 添加 CORS_ORIGINS、NODE_ENV

**环境区分**：

| 配置项 | 开发环境 | 生产环境 |
|--------|----------|----------|
| CORS | 允许 localhost | 白名单（CORS_ORIGINS） |
| JWT_SECRET | 可省略（有警告） | **必须配置** |
| CORS_ORIGINS | 不需要 | **必须配置** |
| 错误信息 | 显示详细 | 隐藏详情 |

---

### 日志、审计与问题定位能力建设

**目标**：建立基础的结构化日志和关键操作追踪能力，解决日志方式原始、缺少请求级定位能力、审计日志覆盖不全的问题。

**新增基础设施**：

1. **统一 Logger 模块**（`lib/logger.ts`）：
   - 结构化 JSON 格式日志输出
   - 支持 info、warn、error、audit、security 五个日志级别
   - 统一字段：timestamp、level、requestId、userId、role、action、target、metadata、error
   - 开发环境友好输出，便于调试

2. **请求追踪中间件**（`middleware/requestLogger.ts`）：
   - 为每个请求生成唯一 requestId
   - 记录请求入口（method、path、query、userId、ip）
   - 记录请求出口（status、duration）
   - 提供 `updateRequestContext` 供登录后更新用户信息

3. **审计日志表**（schema.prisma）：
   - `LoginLog`：登录审计（成功/失败原因、IP、User-Agent）
   - `TeamOperationLog`：团队操作审计（成员变更、角色变更、所有权转移）

**登录审计埋点**（auth.ts）：
- 登录成功 → LoginLog (result=success)
- 用户不存在 → LoginLog (result=failed_user_not_found)
- 密码错误 → LoginLog (result=failed_wrong_password)
- 账号禁用 → LoginLog (result=failed_account_disabled)
- 角色不匹配 → LoginLog (result=failed_role_mismatch)
- 密码修改成功 → 结构化审计日志

**团队操作审计埋点**（teams.ts）：
- 成员添加 → TeamOperationLog (action=member_add)
- 成员移除 → TeamOperationLog (action=member_remove)
- 角色变更 → TeamOperationLog (action=role_change)
- 所有权转移 → TeamOperationLog (action=ownership_transfer)
- 团队删除 → TeamOperationLog (action=team_delete)
- 邀请发送/接受/拒绝 → TeamOperationLog
- 加入申请批准/拒绝 → TeamOperationLog

**权限拒绝记录**（permissions.ts）：
- 所有权限检查函数（canAccessSchool、canManageSchool、canViewStudent 等）
- 权限拒绝时记录 security 级别日志
- 包含：userId、role、resourceType、resourceId、reason

**全局错误处理**（index.ts）：
- 捕获未处理异常
- 记录 requestId、path、method、userId
- 返回统一错误响应

**console.log 迁移**：
- auth.ts：移除敏感日志，替换为 logger
- teams.ts：39 处 console.error 替换为 logger.error

**新建文件**：
- `apps/server/src/lib/logger.ts` - 统一日志模块
- `apps/server/src/middleware/requestLogger.ts` - 请求追踪中间件

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 LoginLog、TeamOperationLog
- `apps/server/src/index.ts` - 注册中间件、全局错误处理
- `apps/server/src/routes/auth.ts` - 登录审计埋点
- `apps/server/src/routes/teams.ts` - 团队操作审计埋点
- `apps/server/src/middleware/permissions.ts` - 权限拒绝日志

**日志字段规范**：
| 字段 | 类型 | 说明 |
|------|------|------|
| timestamp | string | ISO 8601 时间戳 |
| level | string | info / warn / error / audit / security |
| requestId | string | 请求唯一标识 |
| userId | string? | 当前用户 ID |
| role | string? | 当前用户角色 |
| action | string | 操作类型 |
| target | string? | 操作目标 |
| message | string | 日志消息 |
| metadata | object? | 附加信息 |
| error | object? | 错误详情 |

**验证方案**：
1. 发起请求，观察日志中的 requestId 贯穿整个请求生命周期
2. 使用错误密码登录，检查 LoginLog 表记录
3. 添加/移除团队成员，检查 TeamOperationLog 表记录
4. 尝试越权操作，检查安全日志输出

---

### 数据库索引优化

**目标**：为高频查询路径补充数据库索引，提升查询性能。

**新增索引**：

| 模型 | 索引字段 | 用途 |
|------|----------|------|
| User | `role`, `status`, `createdAt` | 用户列表筛选、角色/状态查询 |
| Teacher | `schoolId`, `status`, `createdAt` | 学校教师列表、状态筛选 |
| Student | `schoolId`, `headTeacherId`, `rating`, `enrollmentYear` | 学生列表、排名、"我的学生"筛选 |
| Student | `schoolId, headTeacherId` (复合) | 按学校+主教练联合查询 |
| Team | `schoolId`, `isPublic`, `createdAt` | 学校团队列表、公有团队筛选 |
| Team | `schoolId, isPublic` (复合) | 学生浏览可加入团队 |
| TeamMember | `teamId, status, role` (复合) | 成员列表查询、权限检查 |
| TeamMember | `userId, userType, status` (复合) | "我的团队"查询 |
| TeamMember | `teamId, role` (复合) | 查找团队所有者/管理员 |
| TeamMember | `status` | 待处理邀请查询 |
| Contest | `teamId`, `status`, `scope`, `contestDate` | 比赛列表筛选、日期排序 |
| Contest | `teamId, status` (复合) | 团队比赛状态筛选 |
| ContestResult | `studentId`, `createdAt` | 学生成绩历史、成绩统计 |
| Milestone | `studentId`, `teacherId`, `milestoneDate` | 学生里程碑、教师创建记录 |
| TaskList | `createdBy`, `createdAt` | 教师题单列表 |
| TaskProgress | `studentId`, `status` | 学生进度查询、状态筛选 |

**影响评估**：
- 索引数量增加，写入性能略有下降（可忽略）
- 查询性能显著提升，尤其是大数据量场景
- SQLite 索引已自动创建，无需手动维护

**SQLite 适用边界评估**：
- 当前 MVP 阶段完全够用
- 预期支撑：单校 1000 学生、50 教师以内
- 瓶颈预测：10-20 并发写入、单表 10万-100万条数据
- 建议迁移时机：跨校推广或商业化前

**涉及文件**：
- `apps/server/prisma/schema.prisma` - 添加索引声明

**注意事项**：
- 需要停止开发服务器后运行 `pnpm prisma:generate`
- 索引已通过 `prisma db push` 应用到数据库

---

### 查询性能优化

**目标**：系统性优化现有模块的查询性能，重点解决全量查询+内存分页、内存排序、N+1 查询等问题。

**发现的问题**：

1. **students.ts GET /**：全量查询 + 内存排序 + 手动分页
   - 查询所有符合条件的学生（可能数千条）
   - 在内存中完成全部排序
   - 手动 slice 分页，只使用了其中 20 条数据

2. **students.ts GET /rankings**：全量查询 + 内存排序 + N+1 查询
   - 全量查询后在内存中按 rating 排序
   - `include { contestResults: { take: 1 } }` 对每个学生产生额外查询

3. **teams.ts GET /**：严重 N+1 查询
   - 10 个团队 = 40 次数据库查询（1 + 10×3 + 10×1）
   - 每个团队额外查询 owner、adminCount、teacherMembersCount

4. **teams.ts GET /school/:schoolId**：N+1 查询
   - 每个团队额外 2 次查询（owner + getUserName）

5. **teams.ts GET /student/:studentId**：N+1 查询
   - 循环中查询 owner 和 getUserName

6. **schools.ts GET /**：N+1 查询
   - 每个学校额外查询一次负责人信息

**修复内容**：

1. **students.ts GET /**：
   - 使用 Prisma 的 `skip`/`take` 实现数据库级分页
   - 使用 `orderBy` 实现数据库级排序
   - 移除"主教练优先"的特殊排序（简化为统一的入学年份排序）

2. **students.ts GET /rankings**：
   - 使用 `orderBy: { rating: 'desc' }` 数据库级排序
   - 使用 `groupBy` 批量获取最近成绩时间点
   - 批量查询最近成绩的 ratingChange

3. **teams.ts GET /、GET /school/:schoolId、GET /student/:studentId**：
   - 在初始查询中 `include` 成员信息
   - 批量收集所有 owner ID
   - 批量查询教师和学生姓名（2 次查询）
   - 在内存中组装结果

4. **schools.ts GET /**：
   - 收集所有 principalTeacherId
   - 批量查询所有负责人（1 次查询）
   - 创建 ID -> principal 的映射，在内存中组装结果

**性能提升**：

| 端点 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| GET /students | 全量查询+内存排序 | 数据库分页 | 内存占用 ↓ 95% |
| GET /teams (10条) | ~40 次查询 | ~3 次查询 | 查询数 ↓ 92% |
| GET /schools (20条) | ~21 次查询 | ~2 次查询 | 查询数 ↓ 90% |
| GET /students/rankings | N+1 查询+内存排序 | 3 次查询+数据库排序 | 查询数 ↓ 97% |

**修改文件**：
- `apps/server/src/routes/students.ts` - GET / 和 GET /rankings 性能优化
- `apps/server/src/routes/teams.ts` - GET /、GET /school/:schoolId、GET /student/:studentId 性能优化
- `apps/server/src/routes/schools.ts` - GET / 性能优化

---

### 数据一致性与事务安全修复

**目标**：系统性修复关键创建/修改流程的数据一致性问题，确保多步写入操作的原子性。

**发现的问题**：

1. **学校创建**（schools.ts）：4 步操作无事务保护
   - 创建 User → Teacher → School → 更新 Teacher.schoolId
   - 风险：部分失败导致孤儿数据

2. **学校负责人创建**（schools.ts）：3 步操作无事务保护
   - 创建 User → Teacher → 更新 School.currentPrincipalTeacherId
   - 风险：部分失败导致孤儿数据

3. **学生创建**（students.ts）：2 步操作无事务保护 + 密码安全隐患
   - 创建 User → Student
   - 密码使用 `'default'` 字符串（非有效 bcrypt 哈希）
   - 风险：部分失败 + 学生无法登录

4. **学生更新**（students.ts）：2 步操作无事务保护
   - 更新 User → 更新 Student
   - 风险：数据不一致

**修复内容**：

1. **学校创建**：使用 `prisma.$transaction` 包裹所有操作

2. **学校负责人创建**：使用 `prisma.$transaction` 包裹所有操作

3. **学生创建**：
   - 使用 `prisma.$transaction` 包裹所有操作
   - 新建密码工具函数 `utils/password.ts`
   - 使用 `generateTempPassword()` 生成安全随机临时密码
   - 使用 `hashPassword()` 生成正确的 bcrypt 哈希

4. **学生更新**：使用 `prisma.$transaction` 包裹所有操作

**新建文件**：
- `apps/server/src/utils/password.ts` - 密码工具函数

**修改文件**：
- `apps/server/src/routes/schools.ts` - 学校创建、负责人创建添加事务
- `apps/server/src/routes/students.ts` - 学生创建、更新添加事务 + 密码修复

---

### 认证链路与账号安全修复

**目标**：系统性修复认证模块的安全隐患。

**发现的问题**：

1. **敏感日志泄露**：登录接口输出完整 `req.body`，包含密码明文
2. **JWT Secret 硬编码**：6 处使用不安全的默认值
3. **认证逻辑重复**：多个接口手动解析 token，未使用统一中间件
4. **开放注册风险**：注册接口允许前端传入任意角色
5. **缺少速率限制**：登录、注册、密码修改无防暴力破解机制

**修复内容**：

1. **删除敏感日志**：移除 `auth.ts` 中的密码明文输出

2. **统一 JWT Secret 获取**（新建 `lib/jwtSecret.ts`）：
   - 生产环境：强制要求配置 `JWT_SECRET`
   - 开发环境：使用默认值但输出警告

3. **统一认证逻辑**：
   - `GET /me`、`PUT /profile`、`POST /avatar`、`PUT /password` 统一使用 `authenticate` 中间件
   - 删除冗余的手动 token 解析代码

4. **收紧注册接口**：
   - 限制只能注册学生角色
   - 其他角色返回 400 错误

5. **添加速率限制**（新建 `middleware/rateLimiter.ts`）：
   - 登录：5 次/分钟
   - 注册：3 次/小时
   - 密码修改：3 次/小时
   - 密码重置：3 次/小时

**涉及文件**：
- 新建：`apps/server/src/lib/jwtSecret.ts`
- 新建：`apps/server/src/middleware/rateLimiter.ts`
- 修改：`apps/server/src/middleware/auth.ts`
- 修改：`apps/server/src/routes/auth.ts`
- 修改：`apps/server/src/routes/users.ts`
- 修改：`docs/KNOWN_ISSUES.md`（更新 JWT Secret 问题状态）

---

### 资源级权限控制修复

**目标**：系统性排查并修复所有只做了登录校验、但没有做资源级鉴权的接口。

**发现的问题**：

1. **学校模块**（6 个接口）：任何登录用户可查看任意学校数据
2. **学生模块**（3 个接口）：任何登录用户可查看/删除任意学生数据
3. **团队模块**（2 个接口）：任何登录用户可查看任意学校/学生的团队列表
4. **静态文件**：`/uploads/*` 完全公开（记录为已知问题）

**修复内容**：

1. **新建权限中间件**：`apps/server/src/middleware/permissions.ts`
   - `canAccessSchool` - 判断用户是否可访问学校数据
   - `canManageSchool` - 判断用户是否可管理学校
   - `canViewStudent` - 判断用户是否可查看学生详情
   - `canManageStudent` - 判断用户是否可管理学生
   - `canViewTeacher` - 判断用户是否可查看教师详情
   - `canManageTeacher` - 判断用户是否可管理教师
   - `canViewTeam` - 判断用户是否可查看团队
   - `canManageTeam` - 判断用户是否可管理团队

2. **学校模块修复**（schools.ts）：
   - `GET /:id/teachers` - 添加本校用户检查
   - `GET /:id/student-rankings` - 添加本校用户检查
   - `GET /:id/students-by-grade` - 添加本校用户检查
   - `GET /:id` - 非本校用户只返回基本信息
   - `GET /:id/stats` - 添加本校用户检查
   - `GET /:id/principal-logs` - 添加本校用户检查

3. **学生模块修复**（students.ts）：
   - `GET /:id` - 学生只能查看自己，教师可查看本校学生
   - `GET /rankings` - 限制只返回本校学生
   - `DELETE /:id` - 添加资源归属检查

4. **团队模块修复**（teams.ts）：
   - `GET /school/:schoolId` - 添加本校用户检查
   - `GET /student/:studentId` - 使用统一权限判断

**权限规则**：
| 角色 | 学校数据 | 学生数据 | 团队数据 |
|------|----------|----------|----------|
| super_admin | 全部 | 全部 | 全部 |
| school_principal | 本校 | 本校全部 | 本校 |
| teacher | 本校 | 本校/自己的 | 本校/所属 |
| student | 本校 | 自己 | 所属团队 |

**涉及文件**：
- `apps/server/src/middleware/permissions.ts`（新建）
- `apps/server/src/routes/schools.ts`
- `apps/server/src/routes/students.ts`
- `apps/server/src/routes/teams.ts`
- `docs/KNOWN_ISSUES.md`（添加静态文件权限问题）
- `docs/current-task.md`

---

### 文档一致性修复

**目标**：检查并修复过时的项目文档，确保文档与代码一致。

**修复内容**：

1. **DATABASE_MODELS.md**：
   - 添加缺失的 `Admin` 模型文档
   - 删除不存在的 `StudentTeam`、`TeamAdmin` 模型描述
   - 添加 `TeamMember` 模型文档（实际使用的团队成员表）
   - 修正 `Team` 模型（移除不存在的 `ownerId` 字段）
   - 修正 `Contest` 模型（移除不存在的 `createdBy` 字段）
   - 更新 ER 图

2. **COMPONENTS.md**：
   - 添加缺失的 17 个组件文档
   - 添加 `team/` 目录组件（10个）
   - 添加 `profile/` 目录组件（2个）
   - 添加 `ui/` 目录组件（Empty, ConfirmModal）
   - 添加根目录组件（Providers, Loading, ContestDetail）
   - 移除 UserManagement "未使用"的错误标注

3. **API_REFERENCE.md**：
   - 移除不存在的子文档引用（auth.md, users.md 等）
   - 添加"文档待完善"警告
   - 补充缺失的 API：
     - 认证接口（/me, /profile, /avatar, /password）
     - 用户管理接口（/:id/logs, /platform-admin）
     - 学校管理接口（principal-logs 等）
     - 团队管理接口（约 25 个端点）
     - 比赛管理接口（题目、资源、成绩导入）
     - 任务进度接口（3 个端点）
     - 里程碑接口（5 个端点）
     - 统计接口（3 个端点）

4. **README.md**：
   - 移除不存在的文档引用
   - 添加文档状态表
   - 更新快速导航

**涉及文件**：
- `docs/database/DATABASE_MODELS.md`
- `docs/components/COMPONENTS.md`
- `docs/api/API_REFERENCE.md`
- `docs/README.md`

---

### CLAUDE.md 文档路径修正

**问题**：CLAUDE.md 中引用的文档路径与实际文件位置不一致，部分引用的文档不存在。

**修复内容**：
1. 修正文档路径：
   - `@docs/DATABASE_MODELS.md` → `@docs/database/DATABASE_MODELS.md`
   - `@docs/API_REFERENCE.md` → `@docs/api/API_REFERENCE.md`
   - `@docs/COMPONENTS.md` → `@docs/components/COMPONENTS.md`
2. 移除不存在的文档引用：
   - `@docs/ENVIRONMENT.md`
   - `@docs/DATA_FLOW.md`
   - `@docs/DECISIONS.md`
3. 调整同步更新文档的指引，使用实际存在的文档

**涉及文件**：
- `CLAUDE.md`

---

### 头像上传功能修复

**问题**：`ProfileEditor.tsx` 调用了 `apiClient.postFile()` 方法，但 `apiClient` 类未定义该方法，导致头像上传静默失败。

**修复**：在 `apiClient` 类中添加 `postFile` 方法，复用现有 FormData 处理逻辑。

**涉及文件**：
- `apps/web/src/lib/apiClient.ts`

---

### 后端安全与并发止损重构（第三轮）

**目标**：针对团队模块进行权限边界检查和写操作原子性修复。

**修复的权限边界问题**：
1. `/api/teams?view=mine` 移除未使用的 `teacherId`/`studentId` query 参数，明确只信任 JWT 身份

**修复的并发风险**：
1. **创建团队**：count 检查移入事务，防止并发创建超限
2. **团队转移**：所有检查和更新在一个事务中完成，防止并发转移导致双所有者
3. **批准申请**：使用 `updateMany` 条件更新 + `upsert` 保证幂等性，防止双击重复审批
4. **邀请成员**：添加 P2002 唯一约束异常处理，友好的错误提示

**关键改动**：
- 导入 `PrismaClientKnownRequestError` 用于捕获唯一约束冲突
- 创建团队：count 检查从事务外移入事务内
- 团队转移：重构为单一事务，包含所有权限验证和更新
- 批准申请：使用 `updateMany({ where: { status: 'pending' } })` 实现幂等
- 邀请成员：catch P2002 返回 409 Conflict

**涉及文件**：
- `apps/server/src/routes/teams.ts`

**风险评估**：
| 风险项 | 修复前 | 修复后 |
|--------|--------|--------|
| view=mine 越权 | 低（代码已正确） | 无 |
| 创建团队超限 | 高 | 低 |
| 团队转移竞态 | 高 | 低 |
| 批准申请重复 | 中 | 低 |
| 异常信息泄露 | 中 | 低 |

---

### 遗留直连 API 调用迁移（第二批 - 完成）

**目标**：将所有页面和组件中的硬编码 `http://localhost:3001` 迁移到 `apiClient`。

**修改范围**：

1. **教师端页面**（3个文件）：
   - `app/teacher/contests/page.tsx` - 比赛管理
   - `app/teacher/classes/page.tsx` - 班级管理（已废弃，重定向到团队）
   - `app/teacher/task-lists/page.tsx` - 题单管理（5处硬编码）

2. **教师端学校组件**（5个文件）：
   - `app/teacher/school/components/HomeTab.tsx` - 4处
   - `app/teacher/school/components/TeachersTab.tsx` - 6处
   - `app/teacher/school/components/StudentsTab.tsx` - 多处
   - `app/teacher/school/components/RankingsTab.tsx` - 1处
   - `app/teacher/school/components/EditSchoolModal.tsx` - 1处
   - `app/teacher/school/page.tsx` - 2处

3. **学生端页面**（5个文件）：
   - `app/student/school/page.tsx` - 学校信息
   - `app/student/rating/page.tsx` - Rating 历史
   - `app/student/scores/page.tsx` - 成绩记录
   - `app/student/task-lists/page.tsx` - 题单进度（5处）
   - `app/student/team/browse/page.tsx` - 浏览团队（2处）

4. **公共组件**（3个文件）：
   - `components/profile/ProfileEditor.tsx` - 个人信息编辑（2处）
   - `components/profile/PasswordEditor.tsx` - 密码修改（1处）
   - `components/business/UserManagement.tsx` - 用户管理组件（3处）

5. **个人主页**（2个文件）：
   - `app/profile/student/[id]/page.tsx` - 学生个人主页
   - `app/profile/teacher/[id]/page.tsx` - 教师个人主页

6. **超管端页面**（6个文件）：
   - `app/admin/schools/[id]/page.tsx` - 学校详情（3处）
   - `app/admin/schools/[id]/edit/page.tsx` - 编辑学校（5处）
   - `app/admin/schools/new/page.tsx` - 创建学校（1处）
   - `app/admin/users/page.tsx` - 账号管理（3处）
   - `app/admin/users/[id]/page.tsx` - 用户详情（1处）
   - `app/admin/users/new-platform-admin/page.tsx` - 创建平台管理员（1处）

7. **平台管理员页面**（2个文件）：
   - `app/platform-admin/users/page.tsx` - 账号管理（3处）
   - `app/platform-admin/page.tsx` - 控制台首页（1处）

**修改统计**：
- 共修改 **26 个文件**
- 替换 **约 50 处** 硬编码 URL
- 统一使用 `apiClient` 进行 API 调用

**验证结果**：
- 运行 `grep -r "http://localhost:3001" apps/web/src` 仅剩 2 个文件：
  - `config/env.ts` - 配置文件中的默认值（正确）
  - `lib/apiClient.ts` - 使用 ENV.API_URL（正确）

---

### 遗留直连 API 调用迁移（第一批）

**目标**：将核心文件的硬编码 `http://localhost:3001` 迁移到统一配置。

**修改文件**：

1. `apps/web/src/components/AuthProvider.tsx`
   - `/api/auth/me` 改用 `ENV.API_URL`
   - `/api/auth/login` 改用 `ENV.API_URL`

2. `apps/web/src/hooks/data/useTeamDetail.ts`
   - `/api/teams/:id` 改用 `apiClient`
   - `/api/teams/:id/join-requests` 改用 `apiClient`

3. `apps/web/src/app/student/team/page.tsx`
   - `/api/teams/student/:id` 改用 `apiClient`
   - `/api/teams/invitations/:id/accept` 改用 `apiClient`
   - `/api/teams/invitations/:id/reject` 改用 `apiClient`
   - `/api/teams` (POST) 改用 `apiClient`

**sessionKey 机制验证**：
- ✅ AuthProvider.tsx - 正确计算并导出 sessionKey
- ✅ ProtectedRoute.tsx - 使用 sessionKey 作为 key 强制重新挂载
- ✅ useFetch.ts - 支持 sessionKey 依赖和 AbortController
- ✅ useList.ts - 正确传递 sessionKey
- ✅ useTeams.ts - 正确传递 sessionKey
- ✅ useStudents.ts - 正确传递 sessionKey
- ✅ useTeamDetail.ts - 支持 sessionKey 和请求取消
- ✅ teacher/teams/page.tsx - 传递 sessionKey 给 useTeams
- ✅ teacher/students/page.tsx - 传递 sessionKey 给 useStudents
- ✅ student/team/page.tsx - 传递 sessionKey 给 useTeams

---

### 文档体系"接管视角"增强

**目标**：建立完善的文档体系，使任何人都能快速理解并接手项目。

**新增文档**：
1. `docs/SYSTEM_MAP.md` - 系统全景图
   - 项目结构、角色与入口
   - 前端页面路由完整列表
   - 后端 API 路由完整列表
   - 数据库模型关系
   - 前端组件架构
   - 快速定位指南

2. `docs/RUNBOOK.md` - 本地开发运维手册
   - 环境要求和首次启动
   - 测试账号列表
   - 常用命令速查
   - 数据库操作指南
   - 环境变量配置
   - 常见问题排查

3. `docs/AUTH_AND_PERMISSION.md` - 认证与权限系统
   - 角色体系详解
   - 认证流程（JWT）
   - 权限控制机制
   - 各角色权限详解
   - 数据隔离机制
   - 权限检查速查表

4. `docs/MODULE_INDEX.md` - 业务模块索引
   - 模块总览与状态
   - 各模块功能说明
   - 前后端代码位置
   - API 列表
   - 模块依赖关系
   - 新增模块开发指南

5. `docs/KNOWN_ISSUES.md` - 已知问题与技术债务
   - 架构层面问题
   - 功能层面问题
   - 安全层面问题
   - 性能层面问题
   - 代码质量问题
   - 优先级说明

6. `docs/HANDOVER.md` - 项目交接指南
   - 30 分钟快速上手
   - 核心概念速记
   - 关键文件定位
   - 常见任务示例
   - 开发规范
   - 项目状态

**更新文档**：
- `docs/README.md` - 更新文档目录结构
- `docs/PROJECT_OVERVIEW.md` - 添加相关文档链接

---

### 统一配置层建立

**目标**：移除业务代码中的硬编码地址，建立统一配置层。

**新增文件**：
1. `apps/web/src/config/env.ts` - 编译时环境配置
2. `apps/web/src/config/runtime.ts` - 运行时配置
3. `apps/web/src/lib/assets.ts` - 资源 URL 辅助函数

**修改内容**：
- 所有 Next.js API Routes（24个）改用 `ENV.API_URL`
- 所有资源 URL（9个组件）改用 `getAssetUrl()`
- 配置文件（5个）改用 `ENV.API_URL`

**遗留问题**：
- 部分页面仍直接使用 `fetch('http://localhost:3001/api/...')`
- 需后续迁移到 `apiClient` 统一调用

---

## 2026-03-22

### 账号切换后的私有数据隔离重构（sessionKey 机制）

**问题描述**：之前虽然修复了团队列表显示错误账号数据的问题，但根本原因在于**前端数据获取没有与登录身份强绑定**。切换账号后，页面可能显示上一个账号的数据，或者旧请求可能覆盖新数据。

**解决方案**：引入 `sessionKey` 机制，基于当前登录身份生成唯一标识符，用于：
- 标识私有数据的归属
- 触发数据重新获取
- 清理旧数据
- 取消旧请求

**sessionKey 生成逻辑**：
```typescript
const sessionKey = `${role}:${userId}:${teacherId || studentId || adminId}`
// 例如: "teacher:xxx-xxx:e914dff8..." 或 "student:xxx-xxx:e2976392..."
```

**修改内容**：

1. **AuthProvider.tsx** - 新增 sessionKey 计算，导出给组件使用
2. **useFetch.ts** - 支持 sessionKey 依赖，添加 AbortController 请求取消机制
3. **useList.ts** - 传递 sessionKey 到 useFetch
4. **useTeams.ts** - 接收并传递 sessionKey
5. **useStudents.ts** - 接收并传递 sessionKey
6. **useTeamDetail.ts** - 支持 sessionKey 和请求取消
7. **teacher/teams/page.tsx** - 使用 sessionKey 调用 useTeams
8. **student/team/page.tsx** - 使用 sessionKey 调用 useTeams
9. **teacher/students/page.tsx** - 使用 sessionKey 调用 useStudents
10. **TeamDetailPage.tsx** - 使用 sessionKey 调用 useTeamDetail
11. **teams.ts (后端)** - 禁止 query 参数覆盖 JWT token 中的身份
12. **ProtectedRoute.tsx** - 使用 sessionKey 作为 key，强制组件重新挂载

**核心改动**：
- `useFetch` 在 sessionKey 变化时清空数据并取消旧请求
- `ProtectedRoute` 使用 `key={sessionKey}` 确保账号切换时组件完全重新挂载
- 后端只信任 JWT token 中的身份，忽略 query 参数

**涉及文件**：
- `apps/web/src/components/AuthProvider.tsx`
- `apps/web/src/components/ProtectedRoute.tsx`
- `apps/web/src/components/team/TeamDetailPage.tsx`
- `apps/web/src/hooks/data/useFetch.ts`
- `apps/web/src/hooks/data/useList.ts`
- `apps/web/src/hooks/data/useTeams.ts`
- `apps/web/src/hooks/data/useStudents.ts`
- `apps/web/src/hooks/data/useTeamDetail.ts`
- `apps/web/src/app/teacher/teams/page.tsx`
- `apps/web/src/app/teacher/students/page.tsx`
- `apps/web/src/app/student/team/page.tsx`
- `apps/server/src/routes/teams.ts`

---

### 严重 Bug 修复：团队列表显示错误账号数据

**问题描述**：用户切换账号后，团队列表有时显示其他账号的团队数据，刷新几次才会正确显示，然后又变回去。

**根本原因**：
1. `clearAuth()` 函数漏删 `studentId`，导致退出登录时学生的 ID 没有被清除
2. 后端 `/api/teams` 只从 query 参数获取 studentId，完全忽略了 JWT token 中的 studentId
3. 学生端团队页面使用 localStorage 获取 studentId，而不是使用 AuthProvider 中的用户状态
4. `useTeams` 把 `null` 转换成 `undefined`，导致 `useList` 发起了无参数请求
5. `useFetch` 和 `useList` hooks 在参数未准备好时仍然会发起请求

**修复内容**：
1. `auth.ts` - 在 `clearAuth()` 中添加 `localStorage.removeItem(STUDENT_ID_KEY)`
2. `teams.ts` (后端) - 优先使用 JWT token 中的 studentId/teacherId，而不是只依赖 query 参数
3. `student/team/page.tsx` - 使用 `useAuth()` 获取用户信息，而不是直接从 localStorage 读取
4. `teacher/teams/page.tsx` - 同上修复
5. `useFetch.ts` - 支持 `url` 为 `null`，当 `url` 是 `null` 时不发起请求
6. `useList.ts` - 当 `filters` 是 `null`/`undefined`/空对象时，返回 `null` URL
7. `useTeams.ts` - 修复 `filters ?? undefined` 改为直接传 `filters`

**涉及文件**：
- `apps/web/src/lib/auth.ts`
- `apps/server/src/routes/teams.ts`
- `apps/web/src/app/student/team/page.tsx`
- `apps/web/src/app/teacher/teams/page.tsx`
- `apps/web/src/hooks/data/useFetch.ts`
- `apps/web/src/hooks/data/useList.ts`
- `apps/web/src/hooks/data/useTeams.ts`

---

### 个人卡片功能（页面导航版）

**需求**：点击成员头像或姓名，跳转到个人主页查看用户信息

**功能**：
- 页面展示：头像、姓名、用户名、角色（教师/学生）、学校、个人简介
- 入口：团队成员列表、学校学生列表、学校教师列表
- 可见范围：所有登录用户可见
- 导航方式：独立页面（/profile/student/[id] 或 /profile/teacher/[id]）

**改动内容**：

1. **后端 API**（保持不变）：
   - `GET /api/users/:userId/profile?userType=teacher|student` 获取用户公开信息

2. **前端页面**（新实现）：
   - `/profile/student/[id]/page.tsx` - 学生个人主页
   - `/profile/teacher/[id]/page.tsx` - 教师个人主页

3. **代码清理**：
   - 删除 `ProfileCard.tsx` 弹窗组件
   - 删除 `ProfileCardProvider.tsx` 上下文
   - 删除 `profile/index.ts`
   - 移除 `AppShell.tsx` 中的 Provider 包裹

4. **入口更新**：
   - `TeamMemberList.tsx` - 使用 Next.js Link 导航
   - `StudentsTab.tsx` - 使用 router.push 导航
   - `TeachersTab.tsx` - 使用 router.push 导航

**涉及文件**：
- `apps/web/src/app/profile/student/[id]/page.tsx` - 新建
- `apps/web/src/app/profile/teacher/[id]/page.tsx` - 新建
- `apps/web/src/components/profile/` - 删除整个目录
- `apps/web/src/components/AppShell.tsx` - 移除 Provider
- `apps/web/src/components/team/TeamMemberList.tsx` - 使用 Link 导航
- `apps/web/src/components/team/TeamDetailPage.tsx` - 移除 useProfileCard
- `apps/web/src/app/teacher/school/components/StudentsTab.tsx` - 使用 router.push
- `apps/web/src/app/teacher/school/components/TeachersTab.tsx` - 使用 router.push

---

### 个人信息编辑功能

**新增功能**：右上角头像下拉菜单，包含个人信息和账号安全入口

**改动内容**：

1. **后端 API**：
   - 新增 `PUT /api/auth/password` 修改密码接口
   - 验证当前密码、新密码格式校验
   - 上传头像时同步更新 User、Teacher/Student 表（保证团队模块头像一致）

2. **AppShell 头像下拉菜单**：
   - 右上角显示用户头像（无头像则显示用户名首字母）
   - 点击头像显示下拉菜单：个人信息、账号安全、退出登录
   - 根据用户角色跳转到对应页面

3. **公共组件**：
   - `ProfileEditor.tsx` - 个人信息编辑组件（头像、姓名、手机号、邮箱、简介）
   - `PasswordEditor.tsx` - 密码修改组件（当前密码、新密码、确认密码）
   - 支持密码显示/隐藏切换
   - 上传头像后自动刷新全局用户状态（头像在右上角、团队模块同步更新）

4. **AuthProvider 增强**：
   - 新增 `refreshUser()` 方法，用于刷新用户信息
   - 头像修改后自动同步到右上角和团队模块

4. **页面文件**：
   - 学生端：`/student/profile`、`/student/security`
   - 教师端：`/teacher/profile`、`/teacher/security`
   - 管理端：`/admin/profile`、`/admin/security`

**涉及文件**：
- `apps/server/src/routes/auth.ts` - 添加修改密码 API
- `apps/server/src/routes/teams.ts` - getMemberDetails 优先使用 User.avatar
- `apps/web/src/components/AppShell.tsx` - 头像下拉菜单
- `apps/web/src/components/profile/ProfileEditor.tsx` - 新建
- `apps/web/src/components/profile/PasswordEditor.tsx` - 新建
- `apps/web/src/components/profile/index.ts` - 新建
- `apps/web/src/components/team/TeamMemberList.tsx` - 修复所有者头像显示
- `apps/web/src/app/student/profile/page.tsx` - 重构
- `apps/web/src/app/student/security/page.tsx` - 新建
- `apps/web/src/app/teacher/profile/page.tsx` - 新建
- `apps/web/src/app/teacher/security/page.tsx` - 新建
- `apps/web/src/app/admin/profile/page.tsx` - 新建
- `apps/web/src/app/admin/security/page.tsx` - 新建

### 头像同步 Bug 修复

**问题**：团队模块中成员头像与个人信息页面头像不一致

**修复内容**：
1. **后端修复**：`getMemberDetails` 函数优先使用 `User.avatar` 而非 `Teacher.avatar`/`Student.avatar`
2. **前端修复**：`TeamMemberList.tsx` 所有者头像从 `undefined` 改为 `team.owner.avatar`

---

### 团队头像上传功能

**需求**：团队头像上传功能（仅所有者可用）

**改动内容**：

1. **后端修改**：
   - `POST /api/teams/:id/avatar` 权限从 `isAdmin` 改为只有 `isOwner` 可以上传

2. **前端修改**：
   - `TeamHeader` 组件添加头像上传按钮（📷图标）
   - 仅所有者可见上传按钮
   - 上传成功后通过 `onAvatarUpdate` 回调更新显示

**涉及文件**：
- `apps/server/src/routes/teams.ts` - 修改权限检查
- `apps/web/src/components/team/TeamHeader.tsx` - 添加头像上传功能
- `apps/web/src/components/team/TeamDetailPage.tsx` - 添加头像状态管理

---

### 学校模块 Bug 修复

**修复内容**：

1. **TeachersTab - 移除状态列**
   - 删除教师列表的"状态"列（正常/禁用）
   - 移除未使用的 Badge 组件导入

2. **RankingsTab - 添加分页**
   - 添加客户端分页功能
   - 每页默认 20 条，支持切换 10/20/50/100
   - 翻页时保持正确的排名序号

3. **TeamsTab - 添加分页**
   - 添加分页状态，传入 useTeams hook
   - 每页默认 20 条，支持切换

4. **年级分布缺失问题**
   - 根因：学生年级为"未设置"或"未入学"时，未归类到"其他"
   - 修复：后端 API 将"未设置"和"未入学"也转换为"其他"

**涉及文件**：
- `apps/web/src/app/teacher/school/components/TeachersTab.tsx`
- `apps/web/src/app/teacher/school/components/RankingsTab.tsx`
- `apps/web/src/app/teacher/school/components/TeamsTab.tsx`
- `apps/server/src/routes/schools.ts`

---

### 团队模块彻底统一 - 移除教师/学生端功能区分

**核心原则**：
- 只有一个角色：**TeamMember**
- 所有功能差异只基于**权限(permission)**控制
- 前端页面层不允许出现 userType 条件判断

**改动内容**：

1. **TeamDetailPage.tsx 修改**：
   - 移除 `showApplyButton` 中的 `userType === 'student'` 条件
   - 移除获取邀请数量时的 `userType === 'teacher'` 条件
   - 移除所有"仅教师端"/"仅学生端"注释

2. **最终效果**：
   - 非成员访问公有团队 → 两端都显示"申请加入"按钮
   - 管理员 → 两端都能看到邀请列表、申请列表
   - 所有者 → 两端都能管理团队

**涉及文件**：
- `apps/web/src/components/team/TeamDetailPage.tsx`

---

### 团队模块代码统一化

**核心改动**：教师端和学生端团队详情页合并为同一套代码

**改动内容**：

1. **创建 TeamDetailPage 公共组件**：
   - 文件：`components/team/TeamDetailPage.tsx`
   - 接受 `userType` 参数区分教师端和学生端
   - 功能差异通过权限控制，不由 userType 控制

2. **简化页面文件**：
   - 教师端：`app/teacher/teams/[id]/page.tsx` 从 ~487 行简化为 ~17 行
   - 学生端：`app/student/team/[id]/page.tsx` 从 ~276 行简化为 ~17 行
   - 两者都使用 TeamDetailPage 组件

3. **申请加入按钮位置调整**：
   - 从列表页移到详情页内部
   - 在 TeamHeader 中显示，仅非成员 + 公有团队时可见
   - 移除 TeamCard 和 TeamListPage 中的申请按钮相关代码

4. **类型更新**：
   - TeamDetail 接口添加 `requestStatus` 字段
   - TeamHeader 接口添加 `onApplyJoin`、`applyStatus`、`applying` 字段

**涉及文件**：
- `apps/web/src/components/team/TeamDetailPage.tsx` - 新建
- `apps/web/src/components/team/TeamHeader.tsx` - 添加申请按钮
- `apps/web/src/components/team/TeamCard.tsx` - 移除申请按钮
- `apps/web/src/components/team/TeamListPage.tsx` - 移除申请相关 props
- `apps/web/src/components/team/index.ts` - 导出新组件
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 简化为组件调用
- `apps/web/src/app/student/team/[id]/page.tsx` - 简化为组件调用
- `apps/web/src/app/student/team/page.tsx` - 移除申请相关代码
- `apps/web/src/hooks/data/useTeamDetail.ts` - 添加 requestStatus 字段

---

### 团队模块界面测试与修复

**测试结果**：发现并修复以下问题

**问题1：删除团队功能**
- 状态：✅ 已移除
- 说明：功能不需要，移除 TeamHeader 和教师端详情页中的删除按钮和相关代码

**问题2：管理员可以操作其他管理员**
- 状态：✅ 已修复
- 原因：`canRemove = permission.canRemove` 对管理员也是 true
- 修复：添加判断 `(permission.isOwner || member.role === 'member')`
- 结果：所有者可以操作管理员，管理员只能操作普通成员

**问题3：学生端编辑按钮无效**
- 状态：✅ 已修复
- 原因：`handleEditTeam` 是空函数，没有弹窗
- 修复：添加 TeamEditModal 弹窗和相关状态

**问题4：学生端成员 Tab 重复标题**
- 状态：✅ 已修复
- 原因：页面和 TeamMemberList 组件都有"团队成员"标题
- 修复：移除页面中多余的 h2 标题

**问题5：全部团队Tab缺少申请加入按钮**
- 状态：✅ 已修复
- 原因：TeamListPage 没有传递申请相关的 props
- 修复：
  - TeamListPage 添加 `onApplyJoin` 和 `applyStatusMap` props
  - 在全部团队Tab下传递 `showApplyButton`、`applyStatus`、`onApply` 给 TeamCard
  - 学生端团队列表页传递申请相关 props

**问题6：成员列表用角色标签区分不够清晰**
- 状态：✅ 已修复
- 原因：用户要求用分组标题区分所有者/管理员/成员
- 修复：TeamMemberList 重构为三个分组显示，移除角色标签

**涉及文件**：
- `apps/web/src/components/team/TeamListPage.tsx` - 添加申请按钮支持
- `apps/web/src/components/team/TeamMemberList.tsx` - 分组显示成员
- `apps/web/src/app/student/team/page.tsx` - 传递申请相关 props

---

## 2026-03-21 (续)

### 团队模块界面修复

**核心改动**：
1. 移除删除团队功能
2. 修复管理员权限问题：管理员不能操作其他管理员

**改动内容**：

1. **移除删除团队功能**：
   - `TeamHeader`：移除 `onDeleteTeam` 和 `canDelete` 属性
   - 教师端详情页：移除 `handleDeleteTeam` 函数和相关代码

2. **修复管理员权限问题**：
   - `TeamMemberList`：修改 `canRemove` 和 `canSetAdmin` 的逻辑
   - 管理员现在只能操作普通成员，不能操作其他管理员
   - 所有者仍然可以操作所有成员

3. **移除公告 Tab**：
   - 公告已在 TeamHeader 中显示，不需要单独的 Tab
   - 默认 Tab 改为"成员"

**涉及文件**：
- `apps/web/src/components/team/TeamHeader.tsx` - 移除删除团队支持
- `apps/web/src/components/team/TeamMemberList.tsx` - 修复管理员权限
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 移除删除功能、移除公告Tab
- `apps/web/src/app/student/team/[id]/page.tsx` - 移除公告Tab

---

### 教师端团队详情页重构 - 使用公共组件

**核心改动**：教师端团队详情页从 ~1800 行重构为 ~380 行，复用公共组件

**改动内容**：

1. **扩展公共组件**：
   - `TeamHeader`：添加 `onDeleteTeam` 和 `canDelete` 属性，支持删除团队
   - `TeamMemberList`：添加邀请成员、邀请列表、申请管理等功能

2. **抽取管理弹窗组件**（放在 `components/team/` 目录）：
   - `TeamInviteModal.tsx` - 邀请成员弹窗
   - `TeamInviteListModal.tsx` - 邀请列表弹窗
   - `TeamTransferModal.tsx` - 转移所有者弹窗
   - `TeamEditModal.tsx` - 编辑团队弹窗

3. **重构教师端详情页**：
   - 使用 `TeamHeader` 组件替代头部自定义实现
   - 使用 `TeamMemberList` 组件替代成员管理自定义实现
   - 引用抽取的弹窗组件
   - 保留 Tab 导航和内容区域

**涉及文件**：
- `apps/web/src/components/team/TeamHeader.tsx` - 扩展删除团队支持
- `apps/web/src/components/team/TeamMemberList.tsx` - 扩展邀请和申请管理
- `apps/web/src/components/team/TeamInviteModal.tsx` - 新建
- `apps/web/src/components/team/TeamInviteListModal.tsx` - 新建
- `apps/web/src/components/team/TeamTransferModal.tsx` - 新建
- `apps/web/src/components/team/TeamEditModal.tsx` - 新建
- `apps/web/src/components/team/index.ts` - 导出新组件
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 重构使用公共组件

---

### 团队模块前端统一化 - 类型标签位置调整和用户名显示

**核心改动**：
1. 类型标签（教师/学生）移至名字旁边显示
2. 名字后面用括号显示用户名

**改动内容**：

1. **类型定义更新**：
   - `TeamMember` 接口添加 `username` 字段
   - `TeamAdmin` 接口添加 `username` 字段
   - `TeamDetail.owner` 添加 `username` 字段
   - `JoinRequest.student` 添加 `username` 字段
   - 移除 `rating`、`title`、`enrollmentYear` 等独有属性

2. **后端 API 更新**：
   - `getMemberDetails` 函数返回 `username` 字段
   - `available-members` API 返回 `username` 字段

3. **前端显示格式**：
   - 所有者显示：`张三 (zhangsan) [教师]`
   - 管理员显示：`李四 (lisi) [学生]`
   - 成员显示：`王五 (wangwu) [学生]`
   - 邀请列表显示：`赵六 (zhaoliu) [教师]`
   - 申请列表显示：`钱七 (qianqi) [学生]`

**涉及文件**：
- `apps/web/src/hooks/data/useTeamDetail.ts` - 类型定义更新
- `apps/web/src/components/team/TeamMemberList.tsx` - 显示格式更新
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 页面显示更新
- `apps/server/src/routes/teams.ts` - API 返回 username

---

### 团队模块前端统一化 - 移除教师/学生独有属性显示

**核心原则**：除成员列表名字旁的标签外，不允许显示任何教师/学生独有的属性

**教师与学生数据结构**：
- 教师独有：title（职称）、email、phone、bio
- 学生独有：rating、enrollmentYear、targetContest 等
- 公有：id、name、avatar、joinedAt

**改动内容**：

1. **移除所有 rating 显示**（学生独有）：
   - TeamMemberList 组件移除 rating 显示
   - 成员列表移除 rating 显示
   - 管理员列表移除 rating 显示
   - 申请列表移除 rating 显示
   - 邀请弹窗移除 rating 显示
   - 邀请列表移除 rating 显示

2. **移除所有 title 显示**（教师独有）：
   - 所有者信息移除 title 显示
   - 管理员列表移除 title 显示
   - 成员列表移除 title 显示
   - 邀请弹窗移除 title 显示
   - 邀请列表移除 title 显示

3. **成员信息只显示公有属性**：
   - 名字
   - 头像
   - 加入时间（如果有）
   - 类型标签（教师/学生）

**涉及文件**：
- `apps/web/src/components/team/TeamMemberList.tsx`
- `apps/web/src/app/teacher/teams/[id]/page.tsx`

---

### 团队模块前端统一化 - 彻底移除教师/学生区分

**核心原则**：除成员列表名字旁的标签外，任何地方都不得区分学生与教师，只能以 TeamMember 进行处理

**改动内容**：

1. **状态变量统一**：
   - `availableStudents` + `availableTeachers` → `availableMembers`
   - `selectedStudents` + `selectedTeachers` → `selectedMembers`（存储 `{id, memberType}` 对象）
   - `transferType` + `selectedTransferTarget` → `selectedTransferTarget`（存储 `{id, memberType}` 对象）

2. **头像颜色统一**：
   - 所有成员头像背景色统一为主题色 `var(--primary)`
   - 不再根据教师/学生使用不同颜色

3. **Rating 显示统一**：
   - 所有成员（教师和学生）都显示 Rating（如果有的话）
   - 不再只对学生显示 Rating

4. **邀请成员弹窗统一**：
   - 将分开的"教师"和"学生"选择区域合并为统一的成员列表
   - 成员名字旁用标签区分类型（教师/学生）
   - API 调用使用统一的 `members: Array<{id, type}>` 格式

5. **成员列表显示统一**：
   - 教师端详情页：将"教师成员"和"学生成员"两个区域合并为统一的"成员"列表
   - TeamMemberList 组件：将教师和学生合并为统一列表显示
   - 移除学生名字可点击跳转的区分（统一显示纯文本）

6. **邀请列表弹窗统一**：
   - 头像颜色统一
   - 显示格式统一（都显示 Rating 和职称，如果有的话）

**涉及文件**：
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 大规模重构，统一状态和显示
- `apps/web/src/components/team/TeamMemberList.tsx` - Rating 显示统一

---

### 团队模块类型定义修复

**改动**：修复 `@/types/team` 模块删除后的类型导入问题

**修复内容**：
1. 删除 `apps/web/src/types/team.ts` 文件（该文件导致类型定义重复）
2. 将类型定义整合到各自的 hook 文件中：
   - `useTeamPermission.ts` 定义并导出 `TeamPermission`、`UserType`、`MemberRole`、`TeamForPermission`
   - `useTeamDetail.ts` 定义并导出 `TeamDetail`、`TeamMember`、`TeamAdmin`
3. 更新导入路径：
   - `TeamMemberList.tsx` 从 `@/hooks/useTeamPermission` 和 `@/hooks/data/useTeamDetail` 导入类型
   - `student/team/[id]/page.tsx` 本地定义 `TeamTabType` 类型
   - `components/team/index.ts` 更新类型重新导出路径
4. 修复类型兼容性问题：
   - `TeamForPermission.owner.type` 改为 `string` 以兼容 `TeamDetail` 的类型定义
   - `useTeams` 的 `filters` 参数正确处理 `null` 值

**涉及文件**：
- `apps/web/src/types/team.ts` - 删除
- `apps/web/src/hooks/useTeamPermission.ts` - 类型定义内置化
- `apps/web/src/hooks/data/useTeams.ts` - 修复 null 参数处理
- `apps/web/src/components/team/TeamMemberList.tsx` - 更新导入
- `apps/web/src/components/team/index.ts` - 更新导出
- `apps/web/src/app/student/team/[id]/page.tsx` - 本地定义类型

**注意**：教师端团队详情页保持独立实现，作为标准版本。学生端使用公共组件。

---

### 团队模块代码重构 - 统一数据模型和权限逻辑

**核心改动**：清理数据库旧表，创建公共组件和 hook，统一团队权限判断逻辑

**1. 数据库旧表清理**：
- 删除 `StudentTeam`、`TeacherTeam`、`TeamAdmin` 模型（后端已完全使用 TeamMember）
- 删除 Team 模型中的 `ownerId`、`ownerType`、旧关联字段
- 所有者信息现在通过 TeamMember 表 `role='owner'` 查询

**2. 新增公共 hook**：
- `useTeamPermission` - 统一权限判断逻辑，支持教师端和学生端
  - 返回 `isOwner`、`isAdmin`、`isMember`、`role` 等权限标识
  - 返回 `canEdit`、`canInvite`、`canRemove`、`canTransfer`、`canDissolve` 操作权限
- `useTeamDetail` - 统一团队详情数据获取
  - 自动获取团队信息
  - 支持获取加入申请列表

**3. 新增公共组件**：
- `TeamHeader` - 团队头部信息展示（头像、名称、描述、公告）
- `TeamMemberList` - 成员列表展示（区分教师成员和学生成员）

**涉及文件**：
- `apps/server/prisma/schema.prisma` - 删除旧表
- `apps/web/src/hooks/useTeamPermission.ts` - 新建权限 hook
- `apps/web/src/hooks/data/useTeamDetail.ts` - 新建数据获取 hook
- `apps/web/src/components/team/TeamHeader.tsx` - 新建头部组件
- `apps/web/src/components/team/TeamMemberList.tsx` - 新建成员列表组件
- `apps/web/src/components/team/index.ts` - 更新导出

---

### 统一学生端和教师端团队列表界面

**改动**：
1. 抽取 `TeamListPage` 公共组件，实现教师端和学生端代码完全复用
2. 后端 `/api/teams` API 支持 `studentId` 参数，学生端和教师端使用同一 API
3. 学生端使用 `useTeams` hook，支持分页功能
4. TeamCard 组件添加 `showApplyButton` 和 `applyStatus` 属性，支持申请按钮
5. 所有"创建者"改为"所有者"

**涉及文件**：
- `apps/web/src/components/team/TeamListPage.tsx` - 新建公共团队列表组件
- `apps/web/src/components/team/TeamCard.tsx` - 添加申请按钮支持
- `apps/web/src/hooks/data/useTeams.ts` - 添加 studentId 支持
- `apps/web/src/lib/auth.ts` - 添加 getStudentId/setStudentId 函数
- `apps/web/src/app/teacher/teams/page.tsx` - 使用 TeamListPage 组件
- `apps/web/src/app/student/team/page.tsx` - 使用 TeamListPage 组件 + useTeams hook
- `apps/server/src/routes/teams.ts` - API 支持 studentId 参数
- `apps/server/prisma/seed.ts` - 术语修改

---

### 成员列表显示优化

**改动**：
1. 成员列表不再区分教师成员和学生成员，统一显示为一个列表
2. 在成员名字后面用标签区分类型（教师/学生）
3. 所有成员使用统一的主题色头像
4. 移除成员 API 支持 `memberType` 查询参数

**涉及文件**：
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 合并教师和学生成员列表
- `apps/server/src/routes/teams.ts` - 移除成员 API 支持 memberType

**API 变更**：
- `DELETE /api/teams/:id/members/:memberId` 支持 `memberType` 查询参数
  - 如果提供 `memberType=student|teacher`，则 `memberId` 被视为用户ID
  - 如果不提供，则 `memberId` 被视为 TeamMember 记录ID（兼容旧逻辑）

---

### 教师申请加入团队功能

**新增功能**：
1. 教师可以主动申请加入公有团队
2. 团队管理员可以审批/拒绝教师的加入请求
3. 团队卡片移除"查看详情"按钮（用户反馈太难看）

**涉及文件**：
- `apps/server/src/routes/teams.ts` - 新增教师申请加入 API、审批/拒绝 API
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 添加申请加入按钮、待审批教师请求列表
- `apps/web/src/components/team/TeamCard.tsx` - 移除查看详情按钮

**API 变更**：
- `POST /api/teams/:id/teacher-join-request` - 教师申请加入团队
- `POST /api/teams/teacher-join-requests/:memberId/approve` - 批准教师加入
- `POST /api/teams/teacher-join-requests/:memberId/reject` - 拒绝教师加入
- `GET /api/teams/:id` - 返回数据新增 `pendingTeachers` 字段

---

### 团队卡片和列表显示优化

**修复问题**：
1. 团队卡片现在显示所有者名字，而不是创建者类型
2. "全部团队"列表不再显示用户已加入的团队
3. 移除管理员API支持通过用户ID和用户类型进行操作

**涉及文件**：
- `apps/web/src/components/team/TeamCard.tsx` - 添加 ownerName, isPublic 属性
- `apps/web/src/app/teacher/teams/page.tsx` - 传递 ownerName, isPublic；修复前端请求参数
- `apps/server/src/routes/teams.ts` - 全部团队API排除已加入的团队；移除管理员API支持用户ID

**API 变更**：
- `DELETE /api/teams/:id/admins/:adminId` 现在支持 `adminType` 查询参数
  - 如果提供 `adminType`，则 `adminId` 被视为用户ID
  - 如果不提供，则 `adminId` 被视为 TeamMember 记录ID（兼容旧逻辑）

---

## 2026-03-21

### 团队成员数据模型重构（TeamMember 统一模型）

**核心改动**：将分散在多个表（TeamAdmin, StudentTeam, TeacherTeam）的团队成员信息统一到新的 `TeamMember` 模型。

**新数据模型设计**：
```prisma
model TeamMember {
  id        String    @id @default(uuid())
  teamId    String
  userId    String    // 学生ID或教师ID
  userType  String    // 'teacher' | 'student'
  role      String    // 'owner' | 'admin' | 'member'
  status    String    @default("active")  // 'pending' | 'active'
  joinedAt  DateTime  @default(now())
  invitedBy String?   // 邀请人ID
  team      Team      @relation(...)

  @@unique([teamId, userId, userType])
}
```

**主要变更**：

1. **seed.ts 重写**：
   - 创建团队时同时创建所有者的 TeamMember 记录（role='owner'）
   - 使用 TeamMember 表替代 StudentTeam/TeacherTeam/TeamAdmin 表

2. **teams.ts API 完全重写**：
   - 所有成员查询使用 TeamMember 表
   - 新增辅助函数 `getUserName`, `getMemberDetails`, `getMemberRole`, `isTeamAdmin`
   - API 返回 `owner.type` 字段标识所有者类型
   - 成员列表按角色分组：owner, admins, teachers, students

3. **删除用户时的所有者转移逻辑**：
   - `students.ts`：删除学生时，如果其是团队所有者，按优先级转移：
     - 教师管理员 > 学生管理员 > 教师成员 > 学生成员
     - 无成员则解散团队
   - `teachers.ts`：新增删除教师 API，所有者转移优先级：
     - 学校负责人 > 教师管理员 > 学生管理员 > 教师成员 > 学生成员
     - 无成员则解散团队

4. **前端页面更新**：
   - `student/team/[id]/page.tsx`：兼容新 API 响应格式，使用 `owner.type` 判断所有者类型
   - `teacher/teams/[id]/page.tsx`：同上

**涉及文件**：
- `apps/server/prisma/seed.ts`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/routes/teams.ts`
- `apps/server/src/routes/students.ts`
- `apps/server/src/routes/teachers.ts`
- `apps/web/src/app/student/team/[id]/page.tsx`
- `apps/web/src/app/teacher/teams/[id]/page.tsx`

**注意事项**：
- 旧表（StudentTeam, TeacherTeam, TeamAdmin）临时保留，待数据迁移完成后删除
- Team.ownerId 和 Team.ownerType 临时保留，迁移完成后删除

---

## 2026-03-21

### 学生团队模块权限和显示修复
- **问题1**：学生团队详情页管理员检查不完整，可能误匹配教师管理员
- **问题2**：学生团队列表成员数统计只显示学生成员，不包含所有者、管理员、教师
- **问题3**：学生团队详情页成员 Tab 不显示教师成员
- **问题4**：学生作为所有者/管理员的团队不显示在"我的团队"列表中
- **修复内容**：
  - `student/team/[id]/page.tsx`：`isAdmin` 检查添加 `adminType === 'student'` 条件
  - `teams.ts`：学生团队列表 API 返回完整的 `_count`（members, teacherMembers, admins）
  - `student/team/page.tsx`：成员数计算改为 `1 + admins + teacherMembers + members`
  - `student/team/[id]/page.tsx`：添加教师成员列表显示（绿色头像）
  - `teams.ts`：`GET /api/teams/student/:studentId` API 修复
    - 查询学生作为所有者的团队
    - 查询学生作为管理员的团队
    - 查询学生作为成员的团队
    - 合并去重后返回完整列表
    - 同时返回待处理的成员邀请和管理员邀请
- **涉及文件**：
  - `apps/server/src/routes/teams.ts`
  - `apps/web/src/app/student/team/page.tsx`
  - `apps/web/src/app/student/team/[id]/page.tsx`

### 团队成员退出功能
- **需求**：团队每个成员都应有退出按钮，所有者只能在团队无人时退出（解散）
- **新增 API**：`POST /api/teams/:id/leave` - 退出团队
- **逻辑实现**：
  - 所有者退出：检查团队是否有其他成员（学生+教师+管理员），有则拒绝，无则删除团队
  - 非所有者退出：从 StudentTeam/TeacherTeam/TeamAdmin 表中移除记录
- **前端更新**：
  - 教师端团队详情页添加退出/解散按钮
  - 学生端团队详情页添加退出/解散按钮
  - 按钮文案根据角色动态显示（所有者显示"解散团队"，其他显示"退出团队"）
- **涉及文件**：
  - `apps/server/src/routes/teams.ts`
  - `apps/web/src/app/teacher/teams/[id]/page.tsx`
  - `apps/web/src/app/student/team/[id]/page.tsx`

### 教师端学生列表排序优化
- **需求**：主教练优先显示自己的学生，然后按年级由低到高显示
- **修改**：
  - 后端 `GET /api/students` API 排序逻辑优化
  - 排序规则：1. 主教练优先显示自己的学生 2. 按入学年份降序（年级低的在前）
- **涉及文件**：`apps/server/src/routes/students.ts`

### 安全修复：被禁用用户登录限制
- **问题**：被禁用的用户（status = 'disabled'）仍然可以正常登录系统
- **修复**：
  - 登录 API (`POST /api/auth/login`) 添加用户状态检查
  - 被禁用用户登录时返回 401 错误："该账号已被禁用，请联系管理员"
  - `/api/auth/me` API 添加状态检查，已登录用户被禁用后会被强制登出
  - 前端 `AuthProvider.tsx` 的 `login` 函数返回错误信息（而不仅是 boolean）
  - 登录页面显示后端返回的具体错误信息
- **涉及文件**：
  - `apps/server/src/routes/auth.ts`
  - `apps/web/src/components/AuthProvider.tsx`
  - `apps/web/src/app/login/page.tsx`

## 2026-03-20

### 团队成员模型统一
- **新增 TeacherTeam 模型**：支持教师作为普通成员加入团队
- **邀请成员 API 更新**：`POST /api/teams/:id/members` 支持 `teacherIds` 参数
- **团队详情 API 更新**：返回结果包含 `teachers` 字段（教师成员列表）
- **前端更新**：
  - 邀请弹窗移除"将被设为管理员"文案
  - 成员列表分别显示教师成员和学生成员

### 团队列表页面重构（之前完成）
- **Tab 切换**：默认显示"我的团队"Tab，第二个是"全部团队"Tab
- **我的团队**：包含我创建的团队 + 我是管理员的团队
- **创建团队弹窗**：添加团队描述、公有/私有选项
- **后端 API**：新增 `GET /api/teams/my-admin-teams` 获取我作为管理员的团队列表

### 团队详情页优化
- **编辑弹窗**：点击"编辑"按钮打开弹窗，可编辑名称、描述、公有/私有
- **移除学校链接**：学校名称只显示文本，不再可点击
- **修复返回导航**：使用 `router.back()` 返回上一页，从学校详情页进入时正确返回

### 邀请成员弹窗优化（之前完成）
- **UI 简化**：移除"邀请学生"和"邀请教师"的 Tab 切换
- **统一列表**：教师和学生显示在同一个列表中，分别用标签标识类型
- 教师邀请后自动设为管理员（保持原有逻辑）
- 学生邀请为普通成员

### 团队设置功能
- **公有/私有切换**：所有者可点击切换团队类型（公有/私有）
- **编辑团队**：所有者可编辑团队名称
- **删除团队**：所有者可删除团队（只有所有者有此权限）
- **团队列表权限修复**：非所有者在团队列表页不再显示编辑/删除按钮
- 新增后端 API：`PUT /api/teams/:id`（编辑团队）、`DELETE /api/teams/:id`（删除团队）

### 学生管理员功能（重要）
- **核心改动**：学生和教师在团队管理方面拥有完全一致的功能，唯一区别是团队数量限制
  - 学生最多创建5个团队
  - 教师最多创建50个团队
- **TeamAdmin 模型更新**：
  - 移除 `teacherId` 字段，改用 `adminId` 和 `adminType` 字段
  - `adminType` 支持 `'student'` 和 `'teacher'` 两种类型
  - 学生和教师都可以成为团队管理员
- **后端 API 更新**：
  - `GET /api/teams/:id` 返回管理员信息时包含 `adminType` 字段
  - `POST /api/teams/:id/admins` 接受 `memberId` 和 `memberType` 参数
  - `DELETE /api/teams/:id/admins/:adminId` 支持移除学生或教师管理员
  - `GET /api/teams/admin-invitations` 支持学生和教师查看自己的管理员邀请
  - `GET /api/teams/:id/pending-invites` 正确显示学生和教师管理员邀请
  - 所有团队管理操作（邀请成员、审批申请等）学生管理员也可执行
- **前端更新**：
  - 团队详情页管理员列表显示管理员类型标签（学生/教师）
  - 成员列表"设置为管理员"按钮现在可以正常工作
  - 转移所有权时使用管理员实际的类型（而非固定为教师）

### 团队管理功能完善（续）
- **转移所有者功能**：
  - 后端 `POST /api/teams/:id/transfer` API 添加团队数量限制检查
  - 转移给学生时检查学生团队数量上限（5个）
  - 转移给教师时检查教师团队数量上限（50个）
  - 前端添加转移所有者弹窗，支持选择学生或教师作为新所有者
- **成员列表优化**：
  - 把"学生"改为"成员"
  - 移除所有者旁边的"转移所有权"按钮
  - 在每个管理员和成员旁边添加独立的操作按钮（转移所有权、移除）
- **教师管理员邀请流程优化**：
  - 新增 `GET /api/teams/admin-invitations` API 获取教师的管理员邀请列表
  - 新增 `POST /api/teams/admin-invitations/:id/accept` 接受管理员邀请
  - 新增 `POST /api/teams/admin-invitations/:id/reject` 拒绝管理员邀请
  - 邀请教师为管理员时改为 `pending` 状态，等待教师确认
- **API 修复**：
  - 修复 `GET /api/teams/student/:studentId` 返回的所有者信息问题
  - 修复 `GET /api/teams/school/:schoolId` 返回的所有者信息问题
  - 根据 `ownerType` 正确获取所有者（教师或学生）信息

### 团队管理功能完善
- **邀请列表功能**：
  - 新增 `GET /api/teams/:id/pending-invites` API 获取待处理邀请列表
  - 新增 `DELETE /api/teams/:id/invites/:inviteId` API 取消学生邀请
  - 新增 `DELETE /api/teams/:id/admin-invites/:inviteId` API 取消管理员邀请
  - 教师端团队详情页添加"邀请列表"按钮，可查看和取消待处理邀请
- **邀请教师为管理员**：
  - 邀请成员弹窗支持 Tab 切换（邀请学生/邀请教师）
  - 可搜索并选择本校教师，将其设为团队管理员
- **代码优化**：
  - 清理未使用的状态变量
  - 优化邀请弹窗组件结构

### 团队管理功能重构（重要）
- **核心改动**：重构团队管理模块，支持完整的团队生命周期管理
- **新增数据模型**：
  - `Team.avatar`：团队头像
  - `Team.announcement`：团队公告（Markdown）
  - `Team.isPublic`：公有/私有类型
  - `TeamAdmin`：团队管理员模型
  - `TeamJoinRequest`：学生加入申请模型
  - `StudentTeam.status/invitedAt/joinedAt/invitedBy`：邀请状态机制
- **团队角色机制**：
  - 所有者（Owner）：团队创建者，可删除团队、切换公有/私有、添加/移除管理员
  - 管理员（Admin）：由所有者任命的教师，可编辑公告、邀请/移除成员、处理申请
  - 学生成员：只能查看，无管理权限
- **邀请与申请机制**：
  - 邀请：管理员邀请 → 学生确认/拒绝
  - 申请：学生申请加入公有团队 → 管理员审批
- **添加成员方式**：
  - 下拉框搜索选择本校学生
  - 输入逗号分割的用户名批量邀请
- **权限控制**：
  - 学校负责人/超管默认只能**查看**团队，不能操作（除非被任命为管理员）
  - 只有所有者和管理员可以进行团队管理操作
- **前端页面**：
  - 学生端团队列表页：已加入团队 + 待处理邀请 + 可申请团队
  - 学生端浏览团队页面：查看公有团队并申请加入
  - 学生端团队详情页：公告/成员/模拟赛/训练赛/题单 Tab
  - 教师端团队详情页：支持公告编辑、成员管理、申请审批
- **其他改动**：
  - 更新 AuthProvider 支持 studentId
  - 将 Team.leaderId 改为 Team.ownerId
  - 修复 GET /api/teams/:id 的 grade 字段问题

### 问题修复
- **修复教师端团队列表显示问题**：
  - 前端 `useTeams.ts` 使用 `owner` 替代 `leader` 字段
  - 前端 `teams/page.tsx` 列配置更新为 `owner.name` 和 `_count.members`
  - 后端 API 响应格式统一为 `{list: [...], total: ...}`
- **修复邀请成员功能**：
  - 邀请弹窗添加 Tab 切换（邀请学生/邀请教师）
  - 支持邀请教师作为管理员加入团队
  - 同时获取可邀请的学生和教师列表

### 团队功能增强
- **支持学生创建团队**：
  - Team 模型添加 `ownerType` 字段（"student" | "teacher"）
  - 学生可以作为团队所有者创建团队
  - 学生最多创建5个团队，教师最多创建50个团队
- **新增转移所有者 API**：
  - `POST /api/teams/:id/transfer` - 转移团队所有权
  - 支持转移给学生或教师
- **学生端添加创建团队按钮**：
  - 学生团队列表页添加"+ 创建团队"按钮
  - 创建团队弹窗支持输入名称和描述

## 2026-03-19

### 年级计算重构（重要）
- **核心改动**：重构年级计算模块，前后端统一使用 `packages/shared/src/utils/grade.ts`
- 新增 `calculateGrade` 统一接口，支持 `enrollmentStage`（入学阶段）+ `educationSystem`（学制）+ `schoolType`（学校类型）
- 支持预备役学生：入学前的学生根据入学阶段往前推算（小学入学往前推幼儿园、初中入学往前推小学等）
- 修复幼儿园年级计算逻辑：幼儿园固定 3 年，与学制无关（6-3-3 和 5-4-3 的幼儿园都是 3 年）
- 后端 stats 接口使用共享模块计算年级分布，解决前后端计算不一致问题
- 前端统一从 `@/lib/grade` 导入，内部引用共享模块，保持向后兼容
- **新增 `calculateStudentGrade` 函数**：统一的学生年级计算，自动从学生对象提取所需参数
- 后端 students API 和 student-rankings API 返回学生数据时包含学校的 `educationSystem` 和 `schoolType`
- 前端 Student 类型新增 `enrollmentStage` 和学校学制信息字段
- **修复学校类型过滤逻辑**：年级分布严格按学校类型显示，初中+高中类型不再显示小学年级
- **完善年级计算转换逻辑**：
  - 当学校不包含学生的入学阶段时，按学校最低学段重新计算年级
  - 例如：初中入学 + 学校只有高中 → 按高中入学计算
  - 例如：小学入学 + 学校只有初中 → 按初中入学计算

### 学生端学校页面重构
- **修复学生端学校页面无内容问题**：原页面使用了不存在的 `/api/schools/me` API
- 重构学生端学校页面，与教师端保持一致的 Tab 结构（主页、教师、学生、Rating 排名、团队）
- 后端登录 API 支持返回学生的 schoolId（JWT payload 和 /api/auth/me）
- 更新 JwtPayload 类型定义，新增 studentId 字段，schoolId 同时支持教师和学生

### 问题修复
- 修复教师端 TeachersTab.tsx 组件因后端 API 响应格式变更（从数组改为分页格式 `{list, total, page, pageSize}`）导致的 `teachers.filter is not a function` 错误
- 修复年级分布逻辑：根据学校类型（小学/初中/高中/9年一贯制/初高中连体/完全中学）限制年级显示范围
- 优化年级分布颜色为统一彩虹色谱配色（含幼儿园幼一/幼二/幼三）
- 修复年级计算不一致问题：统一使用 `calculateStudentGrade` 函数，确保全校年级计算逻辑一致
- 修复预备役年级显示问题：初中+高中类型的学校，预备役学生显示"未入学"而非小学年级
- **修复学生列表排序**：按入学年份排序，入学年份大的（低年级）在前
- **修复学校信息编辑后刷新问题**：学制或学校类型变更时自动刷新年级分布和排名数据
- **修复超管端学校编辑页面**：`teachers.map is not a function` 错误（API 返回格式变更后前端未同步更新 `data.data.list`）

## 2026-03-18

### 数据模型更新
- **重要变更**：学生表 schoolId 字段改为必填，确保所有学生必须关联学校
- 修复已存在的无学校学生数据（将"许波"分配到"第一中学"）
- 后端 API 增加学生创建时的学校必填验证
- 后端 API 增加学生更新时的学校必填验证（防止 schoolId 被清空）

### 文档更新
- 创建 `docs/README.md` - 文档导航
- 创建 `docs/PROJECT_OVERVIEW.md` - 项目概述
- 创建 `docs/database/DATABASE_MODELS.md` - 数据库模型文档
- 创建 `docs/api/API_REFERENCE.md` - API 接口文档
- 创建 `docs/components/COMPONENTS.md` - 前端组件文档
- 更新 `README.md` - 项目主文档
- 创建 `docs/context.md` - 项目上下文
- 创建 `docs/current-task.md` - 当前任务
- 创建 `docs/change-log.md` - 变更日志

### 功能新增
- 添加教师联系方式必填验证（邮箱或手机号至少一个）
- 为平台管理员账号管理页面添加分页功能
- 支持 Markdown 和 LaTeX 渲染（学校公告等）
- 优化年级分布显示（进度条、百分比）
- 支持 5-4-3 和 6-3-3 学制动态计算年级

### 问题修复
- 修复学校负责人教师管理页面操作按钮显示问题
- 修复 Rating 排名 Top 10 显示空数据问题
- 修复"不包含已毕业"筛选后显示不足 10 人问题
- 统一超管和平台管理员使用同一套账号管理代码
- 为超管端学校详情页学生列表添加分页功能
- 超管端学校详情页学生列表移除团队列
- 添加旧路由 /super_admin 重定向到 /admin/schools（解决 404 问题）
- 为教师端学校学生列表添加分页功能
- 实现超管端学校详情页教师列表功能并添加分页
- 修复 ProtectedRoute 组件不支持数组类型 requiredRole 的问题
- 修复超管端学校详情页默认显示学生列表改为显示首页
- 修复年级分布逻辑：只有已毕业的学生显示为"其他"，其余正常显示年级

### 代码优化
- 为所有现有教师添加随机邮箱
- 后端 API 验证联系方式必填
- 前端表单验证联系方式必填
- 年级分布根据学制动态计算

### 2026-04-14: 评测记录鉴权修复 + 进程清理脚本

**修改文件**:
- `apps/server/src/routes/submissions.ts` — GET / 列表按学校过滤；GET /:id 详情按学校鉴权
- `apps/server/src/routes/problems.ts` — GET /:id 新增私有题目权限检查
- `apps/web/src/components/submission/SubmissionList.tsx` — 评测记录中私有题目不可点击
- `scripts/kill-ports.sh` — 新增端口清理脚本
- `package.json` — dev 脚本集成端口清理

**修复内容**:
- 评测记录列表：教师/学生只能看到本学校的评测记录，管理员可看所有
- 评测记录详情：教师/学生只能查看本学校用户的提交详情
- 题目详情页：私有题目对非管理员/非 owner 返回 403
- 前端评测记录表格：私有题目不再显示可点击链接
- 重启服务时自动清理 3000/3001/3002 端口旧进程

---

## 2026-04-15

### 重构后全面错误探索与修复

**背景**: 之前路由拆分到 `modules/` 目录后，发现存在多个错误：前端页面/路由错误、脚本数据创建错误、数据库模型字段约束问题。

**修复内容**:

#### 1. 后端动态导入路径修复（P0）

路由文件从 `routes/` 移动到 `modules/problem/`、`modules/training/`、`modules/school/` 后，相对路径深度从 1 级变为 2 级，导致 3 处动态导入路径错误：

| 文件 | 行号 | 修复 |
|------|------|------|
| `modules/problem/problem.routes.ts` | 1188, 1299 | `../lib/ai-translate` → `../../lib/ai-translate` |
| `modules/training/training.routes.ts` | 903 | `../ws/judge` → `../../ws/judge` |

#### 2. Prisma Schema 字段约束完善

- 所有 `id String @id` 字段添加 `@default(cuid())`（44 个模型）
- 所有 `updatedAt DateTime` 字段添加 `@updatedAt`
- 这使得 Prisma 可以自动生成 ID 和更新时间戳，无需手动干预

#### 3. Prisma 关联字段名修复（FIELD_CONTRACT）

根据 `docs/api/FIELD_CONTRACT.md` 规范，修复多处使用小写关联字段名导致的 500 错误：

| 文件 | 修复内容 |
|------|----------|
| `routes/problem-lists.ts` | `Sections` → `ProblemListSection`, `Entries` → `ProblemListEntry`, `Shares` → `ProblemListShare` |
| `routes/school-problem-lists.ts` | `_count.Sections` → `_count.ProblemListSection`, `Section` → `ProblemListSection` |
| `routes/team-problem-lists.ts` | 同上 |
| `tests/helpers/problemListHelpers.ts` | `Sections` → `ProblemListSection` |

#### 4. 测试辅助函数 ID 生成修复

`tests/helpers/testUser.ts` 中所有 `prisma.create()` 调用添加显式 `crypto.randomUUID()` ids：
- User、Teacher、Student、Admin 创建
- School 创建
- TeamMember 创建

`tests/helpers/problemListHelpers.ts` 中 ProblemListShare 创建添加显式 id。

#### 5. 测试验证

- 所有 230 个测试通过
- 后端服务器正常运行（端口 3002）
- 前端应用正常运行（端口 3000）
- 种子数据正确加载

**修改文件**:
- `apps/server/src/modules/problem/problem.routes.ts` — 动态导入路径修复
- `apps/server/src/modules/training/training.routes.ts` — 动态导入路径修复
- `apps/server/prisma/schema.prisma` — @default(cuid()) + @updatedAt
- `apps/server/src/routes/problem-lists.ts` — Prisma 关联字段名修复
- `apps/server/src/routes/school-problem-lists.ts` — Prisma 关联字段名修复
- `apps/server/src/routes/team-problem-lists.ts` — Prisma 关联字段名修复
- `apps/server/tests/helpers/testUser.ts` — 显式 ID 生成
- `apps/server/tests/helpers/problemListHelpers.ts` — 显式 ID 生成 + 关联字段名修复

**待确认事项**:
- Schema provider 仍为 `sqlite`，但 docs/RUNBOOK.md 显示 PostgreSQL 迁移已完成。需确认实际使用的数据库类型。

---

### PostgreSQL 全环境迁移（续）

**背景**: 用户要求所有环境统一使用 PostgreSQL。

**安装配置**:
1. 安装 PostgreSQL 服务（Ubuntu 20.04）
2. 创建数据库 `oi_manager` 和用户 `oi`
3. 配置密码 `oi_password`

**Schema 更新**:
- `schema.prisma` provider 从 `sqlite` 改为 `postgresql`
- 测试环境使用独立 `test` schema 隔离（`DATABASE_URL="postgresql://oi:oi_password@localhost:5432/oi_manager?schema=test"`）

**测试 setup 修复**:
- `tests/setup.ts` 新增 `beforeAll` 创建平台学校（系统管理员必须绑定学校）
- `afterEach` 清理改用 Prisma `deleteMany`（正确处理外键约束）
- 保留平台学校 `platform-school-00000000` 不被清理

**验证结果**:
- **230/230 测试全部通过** ✅
- 后端（端口 3002）正常响应
- 前端（端口 3000）返回 200

**涉及文件**:
- `apps/server/prisma/schema.prisma` — provider 改 postgresql
- `apps/server/tests/setup.ts` — 新增平台学校创建 + deleteMany 清理
- `apps/server/tests/setup-env.ts` — 测试环境 DATABASE_URL 使用 test schema

---

### 2026-04-17: 训练提交弹窗对齐题库提交弹窗

**改了什么**:
- 训练模块提交弹窗新增提交方式选择（机器人账号/我的账号/归档）
- 训练后端提交 API 支持 HDU 机器人提交（复用 submitToHdu 逻辑）
- Submission schema updatedAt 添加 @updatedAt

**为什么改**:
- 训练模块 HDU 题目无法通过机器人提交，外部 OJ 题目只是标记 pending_review
- 提交弹窗 UI 与题库不一致

**影响模块**:
- 训练模块（提交功能）
- 全局评测记录（Submission 表）

**涉及文件**:
- `apps/web/src/components/training/TrainingDetailPage.tsx`
- `apps/server/src/modules/training/training.routes.ts`
- `apps/server/prisma/schema.prisma`

### 2026-04-25

**训练删除按钮**
- 在训练详情页编辑按钮旁添加红色"删除"按钮
- 使用 ConfirmModal 确认，提示"评测记录会保留"
- 调用已有 `DELETE /api/trainings/:id` API
- 删除成功后跳转回训练列表
- 修改文件：`apps/web/src/components/training/TrainingDetailPage.tsx`
