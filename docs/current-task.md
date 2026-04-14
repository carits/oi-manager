# 当前任务

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
- 文档更新（change-log.md 等）

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