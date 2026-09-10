---
status: current
audience: development, product, operations
last_verified: 2026-09-09
source_of_truth: apps/server/prisma/schema.prisma, apps/server/src/modules/rating, apps/server/src/modules/training
---

# 比赛 Rating 领域

## 领域边界

Rating 只消费比赛结束后的不可变 `ContestStandingSnapshot`，不直接读取实时榜单作为历史事实。当前活动模型仍为
`Training(type=contest)`；旧 `Contest.countRating`、用户资料上的旧 rating 字段不参与新链路。

系统按赛制和范围建立相互独立的池：

- Track：`OI`、`IOI`、`ACM`。
- Scope：`GLOBAL` 或 `ORGANIZATION`；比赛配置可选 `NONE/ORGANIZATION/GLOBAL/BOTH`。
- `RatingAccount` 的唯一身份为 `poolId + userId`。转校不会移动旧组织 Rating，重新加入原组织继续原账户。

学校管理者只能启用组织 Rating；`GLOBAL/BOTH` 必须由平台管理员配置。Rating 比赛不能与同 Track、同池的其他
Rating 比赛时间重叠。配置使用 revision CAS，比赛开始或产生首个合法提交时永久锁定。

所有新比赛都会显式创建默认 `NONE` 配置，不以“缺少配置行”表达关闭状态。组织管理员创建的比赛只能选择
`NONE/ORGANIZATION`；平台管理员与超级管理员可在独立平台比赛工作台创建 `GLOBAL/BOTH` 比赛。团队 ACM
比赛首版固定为 `NONE`，避免把团队名次错误计入个人 ACM Rating。

## 比赛计分适配

计分先生成最终排名，再交给 Rating 算法：

- OI/IOI 按冻结的 `problemPolicy` 选择 `LAST_SUBMISSION/BEST_SUBMISSION`，按冻结的 `judgeMaxScore` 映射比赛题目分值，并按 `tiePolicy` 决定是否使用满分题数破同分；默认仍为 OI 最后提交、IOI 最好提交。
- ACM 按解题数和罚时排序，错误罚时秒数、产生罚时的 Verdict、CE 是否计罚时及 Rating 并列规则全部读取比赛开始时冻结的 `scoringRules`，不读取以后代码中的默认值。
- 生成或重放榜单前重新规范化冻结规则并校验 `rulesHash`；合法 SHA-256 哈希不一致时 fail closed，拒绝生成不可重放的 Rating 事实。

管理员处置保存在参赛者快照：

- `NORMAL`：正常展示并计 Rating。
- `KEEP_RESULT`：保留比赛结果但不计 Rating。
- `EXCLUDE`：不进入最终榜单与 Rating。
- `FORCE_LAST`：保留并参与 Rating，但固定在正常参赛者之后；必须保存处置人、时间和原因。

只有至少产生一次合法比赛提交的用户进入 `RATING_LOCKED`。只有报名、没有提交的用户结束时成为 `NO_SHOW`，
不会损失 Rating。组织归属在首次提交时写入 `organizationIdSnapshot`，以后成员关系变化不改写历史。

平台 `BOTH` 比赛中，同时属于多个有效组织的用户必须在首次提交前显式选择本场计入的组织。该选择可在首交前
修改，首次提交后与 Rating 配置一起冻结；服务端不会根据当前工作区或事后成员关系猜测。只有一个可用组织时
自动固定；`GLOBAL` 比赛允许不选择组织；固定组织比赛始终使用比赛所属组织。

## Carits Multi-player Elo V1

V1 将一场 N 人比赛展开为两两 Elo 比较：

```text
P(i beats j) = 1 / (1 + 10 ^ ((Rj - Ri) / 400))
delta = K(96) × weight × (actualPerformance - expectedPerformance)
```

并列的实际结果为 `0.5`。最终使用 largest-remainder balanced rounding，使同一 Batch 的整数变化总和严格为 0。
新账户从 1500 开始；完成少于 5 场时标为 provisional。组织池默认至少 5 人，全局池默认至少 20 人；不足时
保存 `SKIPPED/NOT_ENOUGH_PARTICIPANTS` Batch，不静默伪造变化。

算法代码、版本、K、scale、比赛权重、计分规则和规则哈希均固化到配置、池、快照或 Batch，支持完整重放。

个人端 `/personal/rankings` 的 Rating 区域按全局/组织和 OI/IOI/ACM 展示账户、当前/峰值 Rating、暂定状态、比赛历史和曲线；历史链接仍指向原比赛运行态。

比赛端默认用自然语言显示计分范围、赛制 Track、影响强度、组织归属冻结以及未结算原因；底层 `GLOBAL/ORGANIZATION/BOTH` 和权重只放在规则详情。读取比赛 Rating 时为当前用户返回 `myChanges`，最终榜单可直接显示各范围的 `before → after (delta)`，不会改变不可变 Batch 或结算算法。

## 现有 Contest 聚合桥接

仓库已有 `Contest/ContestProblem/ContestResult` 方案，本轮不再创建重复比赛模型。当前判题运行态仍由 `Training(type=contest)` 承载；`Contest.runtimeTrainingId` 与 `ContestProblem.runtimeTrainingProblemId` 提供一对一桥接，并固定组织、时间、赛制、题目和 TestSet Revision。受保护的 `contest-aggregates` check/apply 迁移只为能可靠固定全部 Revision 的历史比赛建立映射，异常比赛进入报告且不猜测迁移。该桥接为后续逐步切换聚合事实源提供身份，不改变现有提交、榜单或 Rating 外键。

## 最终结算和重放

状态机：

```text
LIVE → JUDGING → FINALIZING → FINALIZED
                         ↘ FAILED
FINALIZED → HELD（赛后重测）→ FINALIZED（重放成功）
```

结算在比赛 advisory lock 和 Serializable 事务中完成：检查所有 JudgeRun 已终态，锁定规则，生成不可变榜单，
按范围创建 Batch/Change，并更新当前 Account 投影。重复结算返回同一快照，不重复变更 Rating。

后台调度器每 10 秒领取已到结束时间且仍为 `LIVE/JUDGING/FAILED` 的比赛，并按同一 RatingPool 的比赛结束时间、
比赛 ID 确定性顺序结算。若同池更早比赛尚未完成，后续比赛保持等待而不是越序写入历史。结算与管理员处置均在
Serializable 事务遇到 PostgreSQL `P2034` 时有界重试，每次重试重新获取 advisory lock 并重新读取事实，防止
蓝绿实例短暂并存时出现重复 Batch 或丢失处置。

已结算比赛发起重测时立即进入 `HELD`。重测完成后必须显式重放：

1. 根据当前 JudgeRun 生成下一版不可变榜单。
2. 锁定受影响的每个 RatingPool。
3. 从池的 base rating 按 `sequenceAt` 重放全部当前 Batch。
4. 创建新 `batchRevision` 和新 RatingChange，旧记录改为 `SUPERSEDED`。
5. 全部成功后一次切换 RatingAccount 当前投影和比赛最终榜单指针。

任何 JudgeRun 尚未结束时拒绝重放。包含全局池的重放只能由平台管理员执行。已生成最终榜单的比赛不能物理删除。

## 权限与读取

- 比赛参与者可以读取本人可访问比赛的 Rating 配置、最终榜单和变化。
- 比赛管理员可在开始前配置组织 Rating、结束后执行最终结算，并设置带原因的参赛者处置。
- 只有平台管理员可配置或重放全局 Rating。
- 个人 Rating 历史只向本人公开；组织榜只向有效组织成员开放；全局榜向登录账号开放。
- 排名接口只返回账户投影和公开用户身份，不返回其他用户提交源码或评测私有诊断。
- 榜单名次在完整过滤结果集上按竞赛排名计算，之后再分页；搜索用户名不会把命中的第一行错误显示为第 1 名。

## 发布与验证

数据库迁移是只增不删：旧比赛默认 `LIVE` 且不补算 Rating，旧用户资料字段保持兼容。上线前必须在隔离 schema
执行全部迁移和 `scripts/run-rating-isolated-test.sh`，验证结算幂等、池零和、配置冻结和重放历史保留，再执行
API 蓝绿和 Web canary/promote。上线不会自动为历史比赛生成榜单或 Rating。
