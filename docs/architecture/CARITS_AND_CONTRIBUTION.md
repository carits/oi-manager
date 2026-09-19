---
status: current
audience: development, operations
last_verified: 2026-09-09
source_of_truth: apps/server/src/modules/contribution, apps/server/src/modules/carits, apps/server/src/modules/problem/problem.evaluation-budget.service.ts, apps/server/prisma/schema.prisma
---

# 贡献、Carits 与 Evaluation Credits

## 领域边界

三种单位彼此独立：

- 贡献值是不可消费的声誉事实。
- Carits 是可消费的平台资产，通过双向不可变账本记账。
- Evaluation Credits 是 Candidate/Hack 评估任务的计算资源，不是贡献值或货币。

唯一奖励起点是 Candidate 或 Hack Candidate 被 Selector 纳入正式不可变 TestSet Revision。
`ELIGIBLE`、技术 Hack 有效、重复数据、程序资产激活和 `admin_import` 都不产生奖励。

```text
Candidate/Hack 正式晋升
→ ContributionEvent
→ ContributionRewardDelivery
→ SYSTEM_REWARD_POOL → USER Carits
→ 用户购买固定 Evaluation Credits 套餐
→ USER → SYSTEM_RESOURCE_SINK
→ 免费日额度 / 已购钱包 / 平台日预算预占
```

## 贡献规则

| 来源 | 贡献值 | Carits |
|---|---:|---:|
| 普通数据或 Generator Candidate | 100 | 20 C |
| Hack Candidate | 150 | 30 C |

每个 Candidate 以稳定的 `candidateId + promoted` 事实键去重，命中多个 Subtask 或后续奖励规则升级也只产生
一条事件。事件把当时的 `ruleCode/ruleVersion`、分值、奖励金额和正式 Revision 证据固化；Worker 重放必须
使用事件中的奖励快照，不能按新规则重新计价。Candidate 记录的 `promotedRevisionId` 与调用证据不一致时
直接拒绝。自动选择直接进入
`accepted`；题目管理者紧急发布只创建 `pending` 事件，必须由超级管理员审核。
超级管理员和平台管理员的管理性操作不获得个人奖励。

贡献提交时可明确选择自己当时有效的组织，并将归因快照固定到生成任务、Hack Attempt 和 Candidate。
默认是个人贡献；不按事后成员关系推断。首版组织 Carits 匹配奖励固定为 0。

## Carits 账本

`CaritsLedgerService` 是唯一写入口。交易在 Serializable 事务中按账户 ID 排序加锁，聚合同一账户的分录，
更新余额并把 draft 交易转为 posted。数据库触发器额外强制：

- posted 交易至少两条分录且总和为 0。
- 一笔交易对同一账户最多一条聚合分录。
- posted 交易不能修改或删除，也不能追加分录。
- 系统发行账户可为负；普通用户消费前必须有足额可用余额。

账本幂等不只比较 `idempotencyKey`。服务端对交易类型、业务引用、操作人、组织以及排序后的
账户身份/金额分录计算 `requestFingerprint`。相同键和相同指纹返回原交易；相同键但业务载荷
不同时返回 `409 IDEMPOTENCY_KEY_REUSED`。迁移前交易的指纹可从已固化的交易和分录重建，不会因
新字段为空而绕过差异检查。

贡献奖励 Worker 使用持久租约、fencing token 和有界重试。每位用户 UTC 日自动奖励上限 200 C，
平台总上限 5000 C；合法超额奖励进入 `deferred_budget` 并在下一 UTC 日继续。
日限额按当日毛发放量统计，`posted` 后又冲正为 `reversed` 的奖励仍占用当日发行额，
不能通过“发放→撤销”反复腾出额度。租约终态更新必须同时匹配记录 ID、fencing token 和可预期状态；
连续失败 5 次后停在 `failed`，只有超级管理员才能通过审计接口重置重试。
超级管理员撤销贡献时新增反向交易，不改写原分录或正式 Revision。
如冲正导致负债，续发奖励会先抵扣负债，偿清前禁止购买资源。

## Evaluation Credits

兑换率固定为 `1 C = 500 Credits`，客户端只提交套餐代码：

| 套餐 | Carits | Credits |
|---|---:|---:|
| `EVAL_5K` | 10 C | 5,000 |
| `EVAL_20K` | 40 C | 20,000 |
| `EVAL_50K` | 100 C | 50,000 |

已购额度长期有效。每人每日最多使用 200 C 购买。任务预占顺序为用户当日免费账户、
已购钱包、平台当日总预算。结算优先消耗免费额度，未实际使用的已购额度全部释放。
预占记录固定创建日期，因此跨 UTC 午夜任务仍结算到原账户。

| 等级 | 贡献值 | 普通用户每日总使用上限 |
|---|---:|---:|
| L0 | 0–99 | 15,000 |
| L1 | 100–499 | 20,000 |
| L2 | 500–1,999 | 30,000 |
| L3 | 2,000–9,999 | 40,000 |
| L4 | ≥10,000 | 50,000 |

免费基础额度为 10,000。题目管理者现有 100,000 每日上限不变，购买不能突破该上限。
平台每日 250,000 总预算及 Judge 并发、CPU、内存、输出和 Candidate 容量上限仍是硬边界。

### 预占、结算与对账

生成任务或 Candidate 评估记录与 `EvaluationCreditReservation` 在同一 Serializable 事务内创建。
取消、资产失效、配置过期和正常/失败终态也在更新任务状态的事务中同步释放或按实际用量结算。
这避免了“已预占但无任务”和“任务终态但额度仍锁定”的可见半成品。

`EvaluationCreditLedgerEntry.amount` 记录对可用额度的变化：预占为负数，结算分录为未使用部分的正数退回。
因此单个当日账户应保持 `limitCredits + SUM(ledger.amount) = availableCredits`；已结算任务的
实际用量由 Reservation 的 `actualCredits` 表达，不能再将它作为第二次扣款分录。

Scheduler 每 30 秒运行一次有界对账，每轮最多检查 100 条 `reserved` 记录：

- 对已终态的数据生成/候选评估任务补做幂等结算。
- 对超过 10 分钟仍找不到对应任务的孤儿预占做全量释放。
- 对历史 `reserving` 评估记录标记失败后释放。
- 未知任务类型或仍在运行的任务只保留等待，不猜测扣款。

对账只是异常恢复网，不代替主路径的事务结算。

购买接口要求 UUID 格式的 `Idempotency-Key`。前端在得到明确成功响应前保持同一个键；
网络超时或响应丢失时重试不会重复购买。只有成功后或用户切换套餐时才更换键。

## 权限、迁移与运行

- 用户只能读取自己的账户、购买、额度和贡献。
- 平台管理员可读取贡献及经济审计，不能审批或撤销。
- 超级管理员可接受/拒绝紧急晋升事件，或填写原因后撤销已接受事件。
- 超级管理员可对已停在 `failed` 的奖励投递执行审计重试；其他状态不可人工重入队。
- 普通用户响应不返回 Hidden Holdout、Kill Vector、Corpus 源码或 Selector 内部权重。

`CONTRIBUTION_REWARD_MODE=observe` 可让 Worker 只统计待结算数量而不领取任务；正式开启使用 `enabled`。
账本与额度迁移必须通过服务器离线审计脚本执行；脚本先生成快照和报告，再在事务中应用。检测到异常账户、不平衡已入账交易或孤儿额度流水时 fail closed。
