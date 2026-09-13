---
status: current
audience: development
last_verified: 2026-09-13
source_of_truth: apps/server/src/modules/training-engine, apps/server/src/modules/assignment, apps/server/prisma/schema.prisma
---

# 教练训练、作业与比赛

## 领域边界

教练训练已经从旧 `Training.type` 拆为独立 `TrainingSession` 聚合，作业已拆为独立 `Assignment` 聚合。比赛暂时仍由旧活动模块承载。不得再为新教练训练或新作业写入 `Training(type=training|homework)`。

| 领域 | 聚合根 | 用途 |
|---|---|---|
| 教练训练 | `TrainingSession` | 阶段、聚焦、课堂控制、草稿、提示、过程报告 |
| 独立作业 | `Assignment` | 固定 Revision、名单快照、迟交、订正、反馈与成绩发布 |
| 比赛 | `Contest` 规范聚合 + `Training` 子表兼容投影 | 固定时间活动、题目 Revision、榜单、Rating 和赛后结果 |

旧训练使用受保护的 `/api/admin/migration/training-engine` check/apply 幂等迁移为一个自由训练阶段；旧作业使用 `/api/admin/migration/assignments` 幂等迁移为独立作业。两条迁移都不删除旧记录、不改历史成绩。

比赛发现与跨领域查询只有一个规范入口：`Contest/ContestProblem`。每个运行比赛通过唯一
`Contest.runtimeTrainingId` 关联暂存于 `Training(type=contest)` 的提交、参与者等运行子表；Rating 配置、榜单快照和结算批次已通过
规范 `contestId` 直接归属 Contest，同时保留 `trainingId` 作为滚动升级兼容键。Rating、平台与组织列表、榜单、
Submission Context、Data Market、Dashboard、Blog 引用和比赛详情均必须经过
`modules/contest/contest-query.facade.ts`。生产 767 个运行比赛已全部建立映射，查询 Facade 不再返回裸
`Training(type=contest)`；映射缺失会记录 `contest_aggregate_missing` 并 fail closed。普通 Training 仍可由共享
活动读取方法返回，不会被误判成比赛。

比赛创建、基本信息、状态、起止时间、题目增删改排和 Rating 终结状态统一经 Contest Command Service，
在比赛 advisory lock、CAS 与数据库事务中先写 `Contest/ContestProblem`，再生成兼容 Training 投影。Rating
结算、赛后重放和待结算顺序只读取 Contest 的规范时间与终结状态，不再解释 Training 投影。除首次创建外，命令必须
从已存在的规范 Contest 聚合定位 RuntimeTraining；映射缺失时 fail closed，不修改裸 `Training(type=contest)`，
也不在请求路径中自动补聚合。Training 之外的业务域不得直接写双模型，静态架构门禁同时禁止查询回退、
命令回退和越界写入。题目聚合保存相同的固定 TestSet Revision。
受保护的 `/api/admin/migration/contest-aggregates` check/apply 仅用于幂等回填和一致性审计，并报告 Rating 三类事实的
缺失/错配数量，不重写比赛结果。

维护功能同样不能绕过该边界。演示比赛的时间重置先对整批目标校验规范映射和未终结状态，再在同一事务内写 Contest
并投影 Training；后台提交可见性修复只从 Contest 的规范终态发现比赛。领域状态门禁只允许普通 Training CRUD 与 Contest
Command/Projection Service 写入 Training 聚合，迁移、演示和管理工具不得自行增加例外。

## 训练结构

```text
TrainingSession
├─ Stage[]
│  └─ StageProblem[] → pinned ProblemTestSetRevision
├─ Group[]
├─ Participant[]
│  └─ ProblemProgress[]
├─ Command[] / Overlay[] / UserOverride[]
├─ ProblemDraft[] / Hint[] / ScoreEvent[]
└─ durable Event[]
```

内置模板覆盖 OI 标准训练、OI 分数递进、ACM 顺序训练、ACM 策略训练和课堂统一训练。阶段模式包括自由、顺序、聚焦、分数递进、讲解、复盘和模拟比赛；推进方式包括手动、计时、完成度和混合推进。

每一道 `StageProblem` 固定题库当时的 TestSet Revision。OI 专项训练可保存后端生成的 Subtask 投影；提交时该投影同时固化到 `Submission` 和 `JudgeRun`，Judge 不会误用完整题目配置。题库后续 Revision、Hack 或数据编辑不影响已经发布的训练。

## 权限解析

所有页面和写接口调用同一个服务端权限解析器，优先级如下：

```text
教练权限 / 个人 override
→ 当前 Overlay
→ 当前 Stage
→ Session 默认规则
```

- DRAFT 仅管理者可见。
- 新建校园训练必须显式声明参与范围；发布时，如果已显式配置名单则只加入名单，团队范围才允许从当前有效学生生成名单。历史上缺少范围元数据的旧记录只在兼容读取中保留，不得经公共创建 API 再产生。学校教师、负责人和团队中的非学生成员永远不能被自动加入训练。
- 创建草稿时必须明确选择团队学生、全校学生或自定义学生。教师只能选择自己可管理的团队或自定义学生；只有学校负责人和超级管理员可以选择全校学生。前端隐藏选项、创建接口校验、发布名单解析和迟到加入资格使用同一套学生边界。
- 未显式配置名单的已发布训练允许范围内迟到成员发现并加入；显式名单不能由手工 API 绕过。迟到加入遵循 `CURRENT_STAGE/FROM_BEGINNING/TEACHER_ASSIGN`。
- 顺序模式默认要求前一题 AC，也可组合分数、时间、尝试次数或教练解锁条件。
- 硬暂停禁止编辑与提交；软暂停允许保留编辑但禁止提交。
- Locked/Exam Focus 会遮蔽非当前题，Exam Focus 同时禁止提示。
- 教练对用户、组、团队或全员发布命令；不同目标的 Focus、消息、禁交与提示 Overlay 相互隔离，结束后恢复每名学员原题。命令使用 `statusRevision` 乐观锁和数据库事务。

## 过程状态与可靠性

- 草稿按用户和题目隔离，30 秒自动保存，切题、聚焦与页面离开前主动保存，revision 冲突返回 409；硬暂停在服务端禁止修改草稿。
- 心跳只在训练运行、页面可见且编辑器聚焦时累计活跃时间；不会把暂停或后台挂页计为训练时长，也不会覆盖已经完成/跳过的状态。
- 提交使用 `submitScope=training_engine`，评测完成后幂等写入 Progress 与 ScoreEvent；OI 达到阶段或题目目标分即视为完成，不要求最终 Verdict 必须 AC。
- 当前最佳分、Verdict、尝试次数、首次 AC、提示层级和卡题状态形成训练报告。
- Scheduler 只由单例后台进程运行，按计划启动训练，并按 TIME/COMPLETION/HYBRID 自动推进；HYBRID 必须同时满足时长与完成度。
- ACM 策略训练按有效做题时间提示重新评估，强制换题模式由服务端暂时停止当前题提交，打开其他题后才重置连续做题计时。
- `rankingMode` 与 `peerVisibility` 分离：训练默认只展示完成进度，服务端按 NONE/PROGRESS/SCORE/FULL 裁剪同学数据，不能从 API 读取被隐藏的分数、提交次数或详细进度。
- 命令和事件是追加式记录；SSE 支持 `Last-Event-ID`/`afterSeq` 补偿，客户端断线后重新读取权威 Workspace，不把前端缓存当事实源。

## API 与 UI

主要接口为 `/api/training-sessions`、`/design`、`/structure/validate`、`/structure`、`/roster`、`/publish`、`/commands`、`/drafts`、`/heartbeat`、`/submit`、`/hints`、`/coach-dashboard`、`/peer-progress`、`/report` 和 `/events`。所有接口重新校验账号状态、学校/团队范围和训练身份。

训练创建的对象确认使用 `/api/training-sessions/participant-preview`。该接口与创建、发布共享 `training-roster.service.ts`，前端不得自行估算全校、自定义名单或团队人数。训练列表、题目池、学生选择和题单均使用服务端搜索与分页，跨页选择由稳定 ID 保存，不能通过固定 `take` 或只过滤当前页制造静默截断。

- `/personal/training-sessions`：账号参与的训练列表。
- `/org/:organizationId/training-sessions`：校园训练管理与参与入口。
- `.../training-sessions/:id`：学员训练工作台与教练控制台共用权威状态。
- `.../training-sessions/:id/design`：仅 DRAFT 和训练管理员可用的独立编排器。阶段时间线、阶段内题目链和可用题目池是结构编辑的唯一 UI；运行工作台只处理学员、提示与训练运行。

校园训练列表按当前成员能力分为学习视图和管理视图。学习视图只展示本人可参加的校级训练及本人所属团队训练；管理视图展示可管理的校级训练和团队训练，并可按团队筛选。创建区明确展示“团队学生 / 全校学生 / 自定义学生”范围与实际名单，不再用隐含组织范围代替参与者名单。普通训练卡片使用题目数、学生数和截止时间描述任务，只有教练带练模式才展示阶段数量，避免把内部 Stage 模型暴露给普通布置流程。管理视图与创建权限分别建模，不能再把组织上下文或“可以创建”当作“可以查看全部管理信息”的替代判断。

### 设计一致性

- 创建模板只产生 Stage 骨架，题目必须由管理员在题目池中显式分配。
- Stage 与 StageProblem 使用稳定 ID 差异更新。同阶段重排或跨阶段移动不更换 Assignment ID，因此不会破坏 Hint 引用。
- 保存使用 PostgreSQL advisory transaction lock 与 `statusRevision` CAS；客户端不提供 `orderIndex` 事实，服务端按数组顺序连续生成。
- 题目加入时固定 TestSet Revision，题库出现更新只做提示；管理员显式更新前不改变训练评测语义。
- 发布后结构永久冻结，调整顺序必须复制成新训练。

工作台提供阶段/题目导航、题面、代码草稿、提交、实时进度、名单管理和课堂命令。它不复用比赛榜单、比赛题面选择或比赛时间冻结行为。

旧活动域中的比赛列表按真实开始和结束时间计算生命周期：进行中按最近结束优先，即将开始按开始时间升序，已结束按结束时间倒序；标题和标题中的数字不参与排序。校园比赛的团队选择必须显式限定当前 `organizationId`。团队进入比赛、训练和题单列表时统一使用 `teamId` 查询参数；旧团队比赛深层 URL 只负责重定向到个人或校园比赛的规范详情页，不再维护第二套详情。比赛创建和编辑使用“基本信息 → 赛制与 Rating → 题目 → 可见性 → 发布前检查”五步流程；Rating 默认关闭，只有选择计分范围后才显示权重和最低人数。题目使用分区选择器并在创建时固定 TestSet Revision；最后一步集中呈现时间、空题、Rating 和可见性问题。比赛详情把列表和题面合并为一个题目工作台，一级入口只保留题目、提交记录、题解和排名，附件由题目资料入口访问。

### 旧活动域退出约束

- `Training(type=training|homework)` 已冻结为只读兼容来源；新训练只写 `TrainingSession`，新作业只写 `Assignment`。
- `Training(type=contest)` 暂时保留为比赛运行子表宿主与兼容投影，新增比赛能力必须先通过 Contest facade/command service，不允许页面或其他领域直接新增旧 Training 状态写路径。
- Contest 查询与命令兼容回退均已移除，生产代码不存在 `source: legacy`、`contest_query_legacy_fallback` 或 `contest_command_legacy_fallback`；下一阶段只继续收口运行态存储，不恢复任何裸比赛读写路径，也不改历史外键。
- 架构门禁持续禁止 `Contest/ContestProblem` 越界写入；旧活动 API 只接受兼容修复，不再承载训练、作业或全新产品能力。

## 迁移与回退

Training Engine 迁移 API 只选择 `type=training`；Assignment 迁移 API 只选择 `type=homework`。两者分别按固定 Revision 创建新聚合，并给旧提交补充对应上下文。异常范围、失效成员或缺失 Revision 的记录进入报告，不猜测修复。迁移用各自的 `legacyTrainingId` 唯一键保持幂等，旧活动表仍保留，因此切换期不会丢历史数据。独立作业的详细约束见 [ASSIGNMENTS.md](ASSIGNMENTS.md)。
