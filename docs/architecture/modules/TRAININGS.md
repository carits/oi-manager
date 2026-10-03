---
status: current
audience: development
last_verified: 2026-10-04
source_of_truth: apps/server/src/modules/training-engine, apps/server/prisma/schema.prisma, packages/contracts/src/training.ts
---

# 训练课堂产品模型与内部引擎

训练模块已经完成 V3 硬切。系统不保留旧训练数据、旧接口、旧路由、模板、设计器或字段回退。

## 产品流程

教师只有一条主流程：

```text
创建训练
  -> 单页填写基本信息、训练对象、赛制、总时长和题目
  -> 创建为待开始，或创建并立即开始
  -> 进入课堂工作台
  -> 题目调整 / 聚焦题目 / 调整分组 / 下一步
```

创建页和课堂页不展示内部状态机、版本号或数据库概念。

## 领域模型

- `TrainingSession`：训练聚合根，状态仅有 `READY / RUNNING / PAUSED / ENDED / ARCHIVED`，保存总时长、有效运行时间和当前轮次。
- `TrainingSessionProblem`：`sessionId + problemId` 唯一的稳定题目身份。移出当前轮次不会删除该身份，重新加入后历史提交、草稿、进度和最好成绩仍指向同一记录。
- `TrainingSessionRound`：有序课堂轮次，生命周期仅有 `PENDING / RUNNING / ENDED`。待开始轮次及其题目对普通学员不可见，切换必须由教师明确执行。
- `TrainingSessionGroup`：训练内稳定分组。
- `TrainingRoundProblemAssignment`：轮次、分组与稳定训练题目的分配关系。当前有效题集只能通过统一解析器得到。
- `TrainingSessionParticipant`：学员及其当前分组、在线状态和活跃时间。
- `TrainingSessionProblemProgress`、`TrainingSessionProblemDraft`、`TrainingSessionScoreEvent`：全部绑定稳定训练题目身份。
- `TrainingSessionCommand`、`TrainingSessionEvent`、`TrainingSessionOverlay`：课堂控制、事件补偿和临时聚焦记录。

## 有效题集规则

服务端唯一解析器按以下顺序计算当前用户能看到和操作的题目：

1. 定位训练当前 `RUNNING` 轮次。
2. 定位学员当前分组；教师管理视图可显式指定分组。
3. 读取该轮次、该分组中 `active = true` 的分配。
4. 按 `orderIndex` 返回稳定 `TrainingSessionProblem`。

保存草稿、提交、心跳、排名、教师面板和聚焦校验都必须复用该解析器，不允许自行拼接查询。

## 生命周期与计时

- `READY` 可由教师开始，也可由后台调度在计划时间自动开始。
- 暂停时累计整场和当前轮有效时间并清空 `runningSince`；恢复后从新时间点继续。
- 整场总时长到期自动结束训练。
- 轮次时长到期只结束当前轮，等待教师准备并执行“下一步”，不会静默切轮。
- 下一轮在开始前可替换或删除；开始后成为历史事实，不可回滚。

## 排名

- `GENERAL`：完成题数、最好分和活跃时间。
- `OI`：各题最后一次已完成提交计分。
- `ACM`：通过题数、错误尝试与罚时。

排名从提交和当前训练事实动态计算，不保存可漂移的旧榜单快照。

## 硬切边界

- 不存在训练草稿发布流程、训练模板、Stage、Hint、必做/选做、旧 Designer 路由或兼容接口。
- 数据库迁移若发现旧训练场次或旧训练提交会立即终止，不猜测转换。
- 创建、调整题目、分组、切轮和运行控制全部使用 `statusRevision` 做并发校验。
