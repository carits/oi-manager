---
status: current
audience: development, testing, operations
last_verified: 2026-09-09
source_of_truth: apps/server/src/modules/assignment, apps/server/prisma/schema.prisma, apps/web/src/components/assignment
---

# 独立作业领域

## 边界

新作业由 `Assignment` 聚合承载，不再创建 `Training(type=homework)`。旧记录在受保护迁移完成前保持原样；迁移只建立新聚合和关联，不删除旧活动、不改历史评测结果。

所有当前产品写入通道均进入该聚合：作业工作台直接创建、题单“创建作业草稿”和已结束活动的“创建补题作业”都创建 `DRAFT Assignment`并固定题目当前正式 TestSet Revision。旧 `publish-homework` 和团队训练 `type=homework` 写入统一返回 `410 LEGACY_HOMEWORK_API_RETIRED`；历史 `Training(type=homework)` 仅保留读兼容与受保护迁移。

```text
Assignment
├─ AssignmentProblem → immutable ProblemTestSetRevision
├─ AssignmentRecipient → OrganizationMembership/User
│  ├─ AssignmentRecipientOverride
│  └─ AssignmentProblemProgress
├─ AssignmentCorrection / AssignmentFeedback
├─ AssignmentScoreAdjustment / AssignmentGradeSnapshot
└─ append-only AssignmentEvent
```

作业题目、名单、评分策略、迟交策略、订正策略和题解开放策略属于作业领域；比赛榜单、教练阶段和课堂 Overlay 不复用到作业。题面与题解仍走现有内容快照体系，测试数据始终由固定 TestSet Revision 决定。

## 生命周期与冻结

状态机为：

```text
DRAFT → SCHEDULED → OPEN → OVERDUE → CLOSED → REVIEWING
                                                ↓
                                  RELEASED → ARCHIVED
```

`DRAFT/SCHEDULED/OPEN/OVERDUE` 允许按规则取消。后台单例调度器只负责按时间推进，手工关闭、进入批改、发布成绩和归档均使用显式状态接口。

- DRAFT 使用 `statusRevision` 乐观锁和作业级 PostgreSQL advisory transaction lock。
- 题目加入时固定一个属于该题的 TestSet Revision，并同时固化 Judge 投影和哈希。
- 发布在一个 Serializable 事务内生成动态名单快照、校验结构、创建进度行并改变状态。
- 发布后题目、Revision 与名单永久冻结；题库后续 Revision 和成员变化不传播到作业。
- 所有评分、订正、反馈与状态动作写入追加式事件；调分只能追加和冲正，不能覆盖历史事实。

## 名单和权限

作业必须属于一个有效学校，可选地限制到该校团队。学校负责人可管理全校作业；普通教师只管理本人创建的学校作业或自己是 owner/admin 的团队作业。学生只能看到自己已被快照到且非 DRAFT 的作业。超级管理员可审计，平台管理员不获得校园作业管理权。

`SNAPSHOT` 名单在草稿中显式保存；`DYNAMIC` 在发布事务中从当时的学校或团队有效学生生成一次快照。发布后不会因成员后来停用、转班或离校而重写历史收件人。

## 提交与成绩事实

作业提交使用 `submitScope=assignment`，并把 `assignmentId`、`assignmentProblemId`、`assignmentRecipientId`、阶段（原始/迟交/订正）、TestSet Revision、Judge 投影哈希和提交级文件 IO 同时写入 `Submission` 与首个 `JudgeRun`。评测完成后 `syncAssignmentSubmission()` 在收件人/题目锁下从全部终态提交重建进度，因此重复结果通知不会增加尝试次数或漂移最佳成绩。

迟交是否允许及扣分由作业快照决定。订正任务、可见/内部反馈、人工调分和冲正均为独立不可变事实。关闭和发布成绩时生成带版本号的 `AssignmentGradeSnapshot`；历史提交和快照不自动重测。

成绩使用版本化的 V2 语义。每道题先按固定 TestSet Revision 的 Judge 满分把评测分数等比例映射到作业题目满分，再按题目权重计算必做题基础分；`OPTIONAL` 只在 `BONUS/BEST_N` 策略下计入选做加分，`CHALLENGE` 只在 `EXTRA_CREDIT` 下计入挑战加分，两者均不进入必做题分母。成绩快照同时保存基础、选做、挑战和人工调分证据。发布检查要求至少一道必做题，并检查计分策略与题目类别相符。

订正任务固定 `requiredScore`；只有本次订正创建后的终态提交达到该目标才可转为 `CORRECTED`。收件人完成状态要求所有必做题均存在进度且满足完成策略，不能因为部分必做题尚未产生进度行而提前完成；使用 `LATEST` 等可回退策略时，后续结果不再满足条件会恢复为进行中。

## API 与 Web

主要接口为 `/api/assignments`，以及 `/:id` 下的 `workspace`、`problems`、`roster`、`validate`、`publish`、`submit`、`progress`、`corrections`、`feedback`、`score-adjustments` 和状态转换接口。题单通过 `POST /api/problem-lists/:id/create-assignment` 创建草稿；活动补题兼容路由仍使用 `POST /api/trainings/:id/create-makeup-homework`，但返回的也是 Assignment 身份。

组织端 `/org/:organizationId/homeworks` 使用独立作业列表。教师在草稿工作台分别保存发布时间、开放/截止/关闭时间、评分策略、固定题目版本和学生名单，运行发布检查后冻结；每道题可显式配置类别、作业满分、目标分、权重和完成策略。学生在同一路径查看题目并提交；发布后教师看到服务端成绩矩阵。所有写接口都重新执行资源级权限、状态和 Revision 校验，前端隐藏按钮不是授权边界。

## 历史迁移

超级管理员使用 `/api/admin/migration/assignments` 的 check/apply：

1. check 固定旧 homework、成员关系、题目 Revision、参与者、进度和提交的规范化报告哈希；
2. 缺学校、创建人身份、有效学生、题目或可靠 Revision 的记录进入阻断报告，不猜测迁移；
3. apply 使用 advisory lock 和 Serializable 事务，按 `legacyTrainingId` 幂等创建作业；
4. 旧 `Training`、活动题目、提交、成绩和排行榜保持不变，提交只补充 Assignment 上下文；
5. 迁移验证完成后 Web 切到新域，旧写入口再单独退役。

隔离升级测试必须用当前生产基线 schema 加本迁移执行，不得在生产库试跑。仓库完整历史 migration 链当前另有旧版本 clean-bootstrap 债务，不能通过跳过 Assignment 迁移掩盖。
