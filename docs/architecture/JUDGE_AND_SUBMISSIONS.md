---
status: current
audience: development, operations
last_verified: 2026-09-08
source_of_truth: apps/server/src/ws/judge.ts, apps/judge/src/client.ts
---

## 题目级双赛制评测

题目评测配置通过 YAML 的 `mode` 字段选择赛制：`acm` 为通过制，`oi` 为分数制。未设置该字段时，含有子任务的历史配置按 OI 解释，其余按 ACM 解释。

ACM 模式按测试点串行执行；首个非 Accepted 结果后，尚未开始的测试点返回 `Skipped`，题目总分为全通过 100 分，否则 0 分。编译失败不产生测试点，System Error 终止整题。

OI 模式保留子任务、依赖及 `min`、`max`、`sum` 计分语义。当前阶段不启用题目级测试点并发。

# 评测机与提交

## 提交类型

- 本地代码提交：`oj/problemId` 只记录题目来源，`submitMethod=local` 选择本站 Judge；Carits、
  Codeforces、洛谷、HDU 等来源题统一走该路径。
- 远程归档：平台绑定同步创建 `submitMethod=archive` 的只读历史记录。归档可展示，但不进入
  本地 Judge、比赛排名、最佳成绩或重新评测。
- 训练提交：额外关联 `trainingId`，按训练、作业或比赛权限控制可见性。
- 全局提交：题库上下文中的个人提交，按题目所有权和角色决定可见性。

代码提交要求题目已有本地 `judgeConfig` 和测试数据记录；任一缺失时接口返回
`409 LOCAL_JUDGE_NOT_CONFIGURED`，不会回退为远程评测。旧客户端传入的 `robot` 或
`myAccount` 会兼容规范为 `local`，`archive` 必须使用独立同步接口。

训练提交列表、详情和排行榜使用同一套 Current `JudgeRun` 状态事实，不以 `cases` 是否存在作为“已评测”
的可见条件。因此 OLE、CE、RE、Judge Error 等没有测试点明细的终态记录仍可查询；Queuing/Judging
可显示为进行中。比赛题目标识统一返回 `TrainingProblem.id`，源题号仅用于兼容旧记录。

## 提交列表详情与个人工作区权限

评测记录列表的非交互区域点击在当前列表页打开详情弹窗；题目和用户链接保持各自导航，不触发行弹窗。
校园评测记录由服务端同时按 `workspaceScope=campus` 和当前 `organizationId` 过滤；学生只读取自己的提交，教师/负责人只能查看当前学校有效成员的提交。同一账号在多个学校的记录不得因为 `userId` 相同而跨学校出现，详情读取执行同样的组织校验。前端不需要也不能用当前页数据自行模拟这一隔离。
`/personal/submissions/[id]`、组织和管理端对应的独立详情页继续作为可分享、可书签的深链入口。

列表筛选字段使用可见标签明确用户、平台、题号、结果和语言语义；学生视图不展示无效的用户筛选。
筛选控件覆盖共享表单控件的全宽默认值，桌面按字段并排，900px 以下两列、520px 以下单列，
操作按钮始终留在筛选容器内。

个人工作区对普通账号统一执行“仅本人提交”规则，不因账号的全局角色是学生、教师或校园负责人而扩大；
查看他人个人提交统一返回 404。校园工作区仍按当前组织隔离：学生只看本人，教师和校园负责人可查看
当前组织的有效成员提交，全局管理员继续使用全量管理视图。

列表弹窗和独立详情页共用 `useSubmissionDetail`、同一 DTO 和同一内容组件，只在 Queuing/Judging
状态轮询；列表本身在当前页存在进行中记录时每五秒刷新，并在详情进入终态后立即同步。终态或 OI
隐藏状态立即停止。401/403/404 等永久失败同样停止，页面只提供关闭或返回，不显示无意义的重试；
网络、超时、限流和 5xx 临时错误保留局部重试，并显示可供排障的请求编号。

全局 `/api/submissions/:id` 与活动 `/api/trainings/:id/submissions/:submissionId` 委托同一个详情策略。
训练/比赛提交即使从全局端点访问，也必须重新验证活动成员、开始时间、本人/管理权限、题目身份隐藏和
OI 赛中脱敏，不能通过切换 URL 绕过活动规则。OI 隐藏响应固定为 `hidden=true`、
`displayResult=pending`，真实 result、score、资源指标、测试点、Subtask、错误和远端 ID全部置空。
活动管理者与提交本人以统一的 `canViewCode` 字段决定代码可见性，HTTP route 不再各自拼装详情 DTO。

## 提交级文件 IO Adapter

传统 `freopen` 程序的文件名属于一次提交的执行意图，不属于测试数据或 TestSet Revision。题库提交、
活动提交和 Hack 证明程序都可独立选择标准输入/文件输入与标准输出/文件输出；四种组合均由同一
IO Adapter 执行。`Submission` 固化用户选择，创建 `JudgeRun` 时再次复制，任务领取后只读取
`JudgeRun` 快照；重新评测沿用原 Submission 的 IO，不允许改变历史执行意图。

文件名只允许 1～128 位 ASCII 字母、数字、点、下划线和连字符，禁止路径、`..`、输入输出同名以及
`main`、`stdin`、`stdout`、`stderr` 等沙箱保留文件。交互、通信、提交答案和客观题传入文件名会返回
`422 SUBMISSION_IO_UNSUPPORTED`。文件输出缺失时以空 Candidate Output 进入 Checker，并在对应测试点
记录 `outputFileMissing`；TLE/MLE/RE 优先保留，已确认存在却无法读取才是 System Error。stdout、stderr
和命名输出分别按 UTF-8 字节数执行输出上限，命名输出不能绕过 OLE。

每个测试点拥有独立沙箱文件系统，本地开发 fallback 也会复制编译产物到独立临时目录，避免上一个
测试点遗留输出污染后续结果。命名输出模式下 `stdout` 仍表示交给 Checker 的内容，程序真实标准输出
限长保存在 `capturedStdout` 供诊断。STD、Validator、Generator、Classifier 和 Checker 始终使用标准 IO。

历史 `judgeConfig.filename` 仅供 `ioAdapterVersion=0` 的旧任务兜底。超级管理员通过
`GET/POST /api/admin/submission-io/migration` 检查并幂等回填旧 Submission/JudgeRun；新任务为 version 1，
完全忽略 Revision 中的旧文件名前缀。迁移不修改 Revision、活动快照、历史结果、成绩或排行榜。

## 比赛远程提交 ID 可见性

训练和比赛提交可能会在 `Submission.ojRemoteId` 保存运行用的远程提交 ID。训练或比赛 API 只向拥有对应管理权限的用户返回该标识。非管理参与者在提交详情中会收到 `ojRemoteId: null`、`hideRemoteId: true`，列表接口同样返回 `ojRemoteId: null`。

此规则适用于所有比赛赛制和状态，并独立于 OI 赛中结果隐藏。OI 赛中还可能隐藏分数、结果、时间、内存、测试点和子任务；而每种比赛赛制都会向非管理者隐藏远程提交 ID。

提交独立页和比赛/训练弹窗复用同一 `SubmissionJudgeResult`。展示模式只取题目提交时的
`judgeMode`：OI 显示总分、Subtask、测试点分数、耗时、内存和 checker message；ACM 显示最终
Verdict、首个失败测试点、耗时和内存，不显示点分或子任务分数。比赛 format 只参与权限与赛中脱敏，
不决定评测结果布局。

详细测试点默认折叠，总 Verdict、OI 总分和 ACM 首个失败点保持可见；用户通过带测试点数量的
Disclosure 展开完整表格，切换提交后恢复折叠。OI 赛中脱敏不返回测试点，也不显示 Disclosure。
详情来源统一为来源平台与原始题号：活动优先读取 `TrainingProblem` 固定的来源快照，题库提交读取
题目/提交来源；活动别名只用于活动标题。隐藏原题身份时来源字段从 DTO 中省略。远端提交 ID 仍供
归档抓取和授权业务使用，但不再显示在提交详情界面。

## ICPC 首 A 判定

ICPC 榜单按题目分别标记首 A。判定以当前评测结果为准：在计入该榜单的提交中，最早获得 `accepted` 或达到题目满分的用户取得该题首 A；先前的错误提交只影响该用户罚时，不影响首 A 的通过时刻。

- `includeAdminInRanking=false` 时，团队所有者/管理员以及校级比赛创建者/学校负责人不会进入榜单，也不会抢占首 A。
- 提交先按 `createdAt` 排序；同一毫秒内按递增的提交 ID 稳定决胜。
- 重新评测改变通过结果后，查询榜单时会根据当前有效结果重新计算首 A。
- 排名接口在对应题目数据中返回 `isFirstAccepted`；Web 只使用该字段展示首 A，不在浏览器内自行比较提交时间。
- 排名接口在每题数据中同时返回 `acceptedAtMinutes`，表示从比赛开始到有效通过提交的完整分钟数；未通过或未提交时为 `null`。该字段与包含错误罚时的 `penalty` 分开，前端不得从总罚时倒推通过时间。
- Web 排名矩阵以“提交次数/通过分钟”展示通过结果；首 A 使用深绿色白字，普通通过使用浅绿色，尝试但未通过使用浅红色并显示负提交次数（如 `-1`、`-2`），未提交保持空白。

## WebSocket 连接

Judge 连接 `ws://<server>/ws/judge`，流程如下：

1. 建立 WebSocket。
2. 10 秒内发送 `auth`，携带 `JUDGE_TOKEN`。
3. 收到 `auth_success` 后发送 `register`。
4. 收到 `registered` 后发送 `start` 和并发数。
5. Server 下发 `judge`，Judge 返回 `result`。

未认证连接不能发送其他消息。无效 Token、认证超时或缺少服务端 Token都会拒绝启动
或断开连接。

## 心跳与重连

- Judge 每 30 秒发送 `ping`。
- Server 收到有效 `ping` 或 `pong` 都刷新活跃时间，并在需要时回复 `pong`。
- Server 每 30 秒扫描，60 秒无心跳时关闭连接。
- Judge 断开后等待 5 秒重连。

## 原子领取

每个 Judge Consumer 在 PostgreSQL 事务内执行：

```sql
SELECT id
FROM "Submission"
WHERE result = 'queuing'
  AND "problemInternalId" IS NOT NULL
  AND (
    "submitMethod" IN ('local', 'demo_scenario')
    OR (oj = 'carits' AND "submitMethod" <> 'archive')
  )
ORDER BY "createdAt"
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

同一事务把任务更新为 `judging` 并记录 `judgeId/judgeStarted`。多个 Judge 不会领取
同一任务。新提交保存实际 `testSetRevisionId`；Judge 优先读取该不可变 Revision 的目录和投影，历史未固定提交才回退活动快照或当前题目配置。

## 状态恢复

- Judge 断线：该 Judge 正在处理的任务恢复为 `queuing`。
- Server 重启：遗留的 Carits `judging` 任务恢复为 `queuing`。
- 超过 5 分钟没有完成的任务由定时扫描恢复。
- 重新评测会清除旧 Judge 归属并重新进入队列。

## 沙箱

Judge 通过 `SANDBOX_HOST` 调用 go-judge，完成编译、运行、资源限制和 Checker。
Docker 服务需要 cgroup/privileged 能力才能可靠检测内存限制。测试数据路径由
`TESTDATA_DIR` 指定，不应与上传临时目录混用。

## 观测

重点日志事件包括认证失败、注册、任务派发、心跳超时、任务恢复、编译失败和结果写入。
日志可以记录 `judgeId/submissionId`，不得记录 Judge Token 或用户源码全文。

Checker 上传仅接受 C/C++ 源文件，`testlib.h` 由系统提供；下载接口只返回受鉴权的 API 地址，不返回服务器绝对路径，且题目目录必须位于 `TESTDATA_DIR` 下。
go-judge 模式下自定义 Checker 的 stdout/stderr 必须显式重定向为沙箱 `copyOut` 文件后再解析；
用户程序输出上限默认 64MB，可由题目或单个测试点的 `outputLimit` / `output_limit` 覆盖，数值按字节、
字符串支持 `B/KB/MB/GB`。

## 题目级 ACM / OI Hack

传统源码型 ACM/OI 批处理题（`default`，以及历史兼容名称 `standard`）可在评测设置中配置
C++17 标准程序和 Validator；OI 题还必须配置 Classifier。Validator 与 Classifier 可引用 Judge
内置的 `testlib.h`；启用前 Server 会通过 go-judge 编译检查全部系统程序。任何拥有该题提交权限的用户都可提交直接输入，或提交 C++17/Python3 生成器，
同时提供一份使用题目允许语言的被 Hack 程序。
客观题、交互题、通信题和提交答案题不进入该流程。

Hack 使用独立的 `ProblemHackAttempt` 队列，不创建 `Submission`：

1. 生成或读取候选输入，并在沙箱内通过 Validator。
2. 运行标准程序生成候选点答案。
3. 使用当前完整测试集评测被 Hack 程序，取得 baseline Verdict。
4. 把候选点放在最前面，再运行候选点和当前完整测试集。
5. 两次确定性最终 Verdict 不同时接受；测试点编号、耗时或 message 变化不算有效。

有效结果限定为 Accepted、WA、PE、TLE、MLE、RE 和 OLE；CE、System Error 或通信失败
不能构成有效 Hack。有效输入以 `hack_<attemptId>.in/.out` 自动晋升为题库下一正式 TestSet Revision，
ACM 中所有已接受 Hack 位于普通测试点之前。Hack 不查询或修改任何比赛、训练和作业；历史提交、成绩和排行榜不重新评测。

同一用户同题最多一个排队或评测中的任务，同一题最多一个正在评测的 Hack；PostgreSQL
部分唯一索引提供最终并发约束。配置 revision 或评测配置哈希变化会把旧任务标记为 stale，
不会写入数据。用户只可查看自己的完整记录，题目管理者可查看全部记录并重新执行系统错误
任务；其他用户只能看到有效 Hack 数量。列表接口只返回摘要，候选输入、生成器和被 Hack
源码必须通过单条详情接口按权限读取，避免历史记录较多时一次返回大量源码。失败记录使用
`failureStage` 标明输入、生成器、Validator、标准程序、baseline、candidate、配置一致性或
数据入库阶段；STD 未生成任何答案输出时按标准程序阶段系统错误处理，不能成为有效 Hack。
测试数据先以互斥创建方式写入两份暂存文件，再逐一提升并提交数据库事务；暂存写入、任一文件提升或事务
失败都会清理本次已经产生的暂存及最终文件，禁止留下半份 Hack 测试点。

接口为 `GET/PUT /api/problems/:id/hack-config`、`POST/GET /api/problems/:id/hacks`、
`GET /api/problems/:id/hacks/:hackId` 和 `POST /api/problems/:id/hacks/:hackId/retry`。
源码上限 256 KiB，候选输入和标准答案各 1 MiB。Judge WebSocket 使用独立的 `hack` /
`hack_result` 消息，并与普通提交交替领取，避免任一队列长期饥饿。

OI Hack 由 Classifier 返回候选数据命中的全部 Subtask，并把通过 Validator/STD/Checker 自检的数据
放入相应的系统 `hack_gate` Group。证明程序只有在加入候选点后总分严格下降才构成有效 Hack；历史
提交不自动重测。关系型 Test Graph 是 Subtask、Official Group、Hack Gate 和 Testcase 关系的唯一
编辑事实源，`Problem.judgeConfig` 仅为 Judge 执行投影。

## 不可变 TestSet Revision

- `Problem.latestTestSetRevisionId` 指向题库 Practice 使用的最新版；管理员保存数据、显式 ACM/OI 转换或经 Selector 入选的 Candidate 才创建下一 Revision，禁止原地修改。技术有效 Hack 本身不等于正式版本变更。
- 测试输入/答案使用 `(problemId, sha256)` 内容寻址对象；Revision 目录固化逻辑文件名和文件型 Checker/Interactor/Manager。输入输出由 `TestdataFile` 管理，Checker 由独立 `ProblemChecker` 管理，迁移审计不会混用两类元数据；旧 Revision 永久保持可复现。
- `TrainingProblem.testSetRevisionId` 在活动添加题目时固定。活动未开始且无提交时管理员可以手动更新；开始、结束或已有提交后统一返回 `409 TEST_SET_REVISION_FROZEN`。
- 发布使用 `pg_advisory_xact_lock(problemId)` 与 expected-latest CAS；Test Graph、Judge 投影、最新版指针、Candidate/Hack 状态和成员替换审计在同一事务提交。并发写入只能有一个 CAS 成功，不允许 Judge 回调直接拼接 YAML 或活动快照。
- 普通 Judge Config PUT 不允许隐式改变模式；`POST /api/problems/:id/judge-mode-transition` 创建保留历史的转换 Revision，并关闭 Hack 等待重新配置。
- 历史迁移接受数字测试点简写 `cases: [1]` 并映射为 `1.in/1.ans`，旧 `scoring` 字段与当前
  `type` 等价；其他缺少明确输入/答案文件名的结构拒绝迁移，不猜测文件。
- 同一题若历史上已有多个等价投影哈希，迁移固定复用 revision number 最大的版本；重复执行迁移不得
  再发布等价 Revision。已经发布的重复历史 Revision 保留为不可变审计记录，不做破坏性删除。
- 内容对象写入失败或 CAS 丢失留下的无引用对象超过 24 小时后由锁内 GC 删除。

## OI 数据与分组工作台

题目管理者在评测设置的“数据与分组”中使用三栏工作台维护 Subtask、Official Group 和 Testcase 池。
已迁移 OI 题不再允许旧 Subtask 表单或 JSON textarea 反向覆盖 Test Graph；Hack 配置页只维护 STD、
Validator 和 Classifier。未迁移历史题必须先查看检查结果并显式执行单题迁移，文件缺失、ID 非法或总分
不闭合时保持只读，不猜测修复。

测试数据上传后先按 `.in` 与 `.out/.ans` 配对，再注册为稳定 `ProblemTestcase`，同一测试点可以关联多个
Official Group。被 Group 或 Hack Gate 引用的文件返回 `409 TESTDATA_IN_USE`，不能直接删除；同名替换
保留文件 ID 并同步 Testcase 哈希。整图保存携带 revision，陈旧写入返回 `409 TEST_GRAPH_STALE`，结构
错误返回 `422 INVALID_TEST_GRAPH`，成功后重新生成 YAML 投影。

OI 正式图还有不可绕过的产品边界：最多 15 个 Subtask；每个 Subtask 在全部 Group 中去重后最多
10 个测试点；至少保留 3 个 Official Core。题目管理者可填写原因永久保护测试点。自动 Selector 在
Subtask 达到 10 点时执行 11 选 10，并保护手工点、新增 7 天点、有效 Hack 14 天点；退出成员只在
`TestcaseMembershipRetirement` 中记录，不删除旧 Revision 或内容对象。
