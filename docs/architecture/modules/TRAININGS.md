---
status: current
audience: development
last_verified: 2026-09-08
source_of_truth: apps/server/src/modules/training-engine, apps/server/prisma/schema.prisma
---

# 教练训练、作业与比赛

## 领域边界

教练训练已经从旧 `Training.type` 拆为独立 `TrainingSession` 聚合。比赛与作业继续由旧活动模块承载，直到各自后续迁移；不得再为新教练训练写入 `Training(type=training)`。

| 领域 | 聚合根 | 用途 |
|---|---|---|
| 教练训练 | `TrainingSession` | 阶段、聚焦、课堂控制、草稿、提示、过程报告 |
| 比赛/作业 | `Training` | 固定时间活动、榜单、赛后结果和补题 |

旧训练只读兼容，使用受保护的 `/api/admin/migration/training-engine` check/apply 幂等迁移为一个自由训练阶段；不修改旧记录、成绩和提交。

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
- 发布时，如果已显式配置名单则只加入名单；否则以当前学校或团队有效成员为默认名单。
- 非名单用户不可查看训练；迟到加入遵循 `CURRENT_STAGE/FROM_BEGINNING/TEACHER_ASSIGN`。
- 顺序模式默认要求前一题 AC，也可组合分数、时间、尝试次数或教练解锁条件。
- 硬暂停禁止编辑与提交；软暂停允许保留编辑但禁止提交。
- Locked/Exam Focus 会遮蔽非当前题，Exam Focus 同时禁止提示。
- 教练对用户、组、团队或全员发布命令；命令使用 `statusRevision` 乐观锁和数据库事务。

## 过程状态与可靠性

- 草稿按用户和题目隔离，30 秒自动保存，切题与聚焦前主动保存，revision 冲突返回 409。
- 心跳只在页面可见且编辑器聚焦时累计活跃时间；不会把后台挂页计为训练时长。
- 提交使用 `submitScope=training_engine`，评测完成后幂等写入 Progress 与 ScoreEvent。
- 当前最佳分、Verdict、尝试次数、首次 AC、提示层级和卡题状态形成训练报告。
- Scheduler 只由单例后台进程运行，按计划启动训练，并按 TIME/COMPLETION/HYBRID 自动推进。
- 命令和事件是追加式记录；SSE 支持 `Last-Event-ID`/`afterSeq` 补偿，客户端断线后重新读取权威 Workspace，不把前端缓存当事实源。

## API 与 UI

主要接口为 `/api/training-sessions`、`/structure`、`/roster`、`/publish`、`/commands`、`/drafts`、`/heartbeat`、`/submit`、`/hints`、`/coach-dashboard`、`/report` 和 `/events`。所有接口重新校验账号状态、学校/团队范围和训练身份。

- `/personal/training-sessions`：账号参与的训练列表。
- `/org/:organizationId/training-sessions`：校园训练管理与参与入口。
- `.../training-sessions/:id`：学员训练工作台与教练控制台共用权威状态。

工作台提供阶段/题目导航、题面、代码草稿、提交、实时进度、名单管理和课堂命令。它不复用比赛榜单、比赛题面选择或比赛时间冻结行为。

## 迁移与回退

迁移 API 只选择 `type=training`，按固定 Revision 创建独立 Session/Stage/Participant/Progress，并给旧提交补充新训练关联；比赛和作业不进入迁移。异常范围或缺失 Revision 的训练进入报告，不猜测修复。迁移用 `legacyTrainingId` 唯一键保持幂等，旧活动表仍保留，因此可在切换期回退到旧页面且不会丢历史数据。
