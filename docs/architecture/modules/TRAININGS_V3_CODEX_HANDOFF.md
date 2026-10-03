---
status: current
audience: development
last_verified: 2026-10-04
source_of_truth: apps/server/src/modules/training-engine, apps/server/prisma/schema.prisma, packages/contracts/src/training.ts
---

# 训练模块 V3 实施记录

## 当前结论

训练模块按开发期硬切方案实施。目标分支为 refactor/training-session-problem-model，完成验证后合并到 main 并部署。

## 已完成

### 数据模型

- TrainingSession 使用 READY / RUNNING / PAUSED / ENDED / ARCHIVED。
- 新增 TrainingSessionProblem 稳定题目身份。
- 新增 TrainingSessionRound。
- 新增 TrainingRoundProblemAssignment。
- Participant、Progress、Draft、ScoreEvent、Overlay、Submission 全部关联稳定训练题目。
- Submission 可选关联训练轮次。
- 删除旧训练设计、策略、模板、提示和阶段相关模型。
- 新迁移在发现旧训练数据时直接终止。

### 后端

- 新增唯一有效题集解析服务。
- 训练服务与路由重写为 V3 API。
- 实现创建、开始、暂停、继续、结束与归档。
- 实现当前轮题目调整、下一轮保存和明确切轮。
- 实现即时分组调整，以及全部或分组聚焦。
- 实现整场与本轮独立延时。
- 实现草稿、心跳、提交和评测同步。
- 实现 GENERAL、OI、ACM 动态排名。
- 实现教师课堂进度和训练报告。
- 后台调度支持定时开始、整场到时结束、本轮到时等待。

### 前端

- 创建训练为单页表单。
- 支持创建 READY 和创建并开始。
- 使用 ProblemListEditor 维护第一轮题目。
- 删除训练设计器及其路由。
- 删除训练草稿、复制训练和旧状态筛选。
- 课堂页主操作固定为题目调整、聚焦题目、调整分组、下一步。
- 学生只渲染后端返回的有效题集。
- 课堂页集成代码草稿、文件 IO 和提交。
- 桌面与窄屏使用同一信息结构。

### 测试

- Contracts 运行时契约更新为 V3。
- 有效题集解析覆盖分组、轮次、停用与重新加入。
- 浏览器流程覆盖创建、稳定题目身份、下一轮隐藏与切换、聚焦校验和移动端。
- E2E seed 使用 SessionProblem、Round 与 Assignment。

## 发布前检查

1. 格式化并运行 git diff --check。
2. 运行 Prisma generate、validate 和迁移演练。
3. 运行 Server build 与 Training 单元测试。
4. 运行 Web type check、全量单元测试和 build。
5. 初始化隔离 E2E 数据库并运行 Training V3 E2E。
6. 启动候选端口并用真实浏览器检查创建页和课堂页。
7. 确认训练活跃代码没有旧字段、旧状态和旧设计页。
8. 提交当前分支，合并到 main，推送 GitHub。
9. 在生产目录执行迁移、构建、重启并检查 3000 健康接口。

## 不允许回退

- 不恢复多步骤训练设计器。
- 不恢复模板入口。
- 不恢复必做/选做。
- 不恢复提示、卡点策略和完成条件。
- 不恢复以轮次分配记录作为题目身份。
- 不恢复旧路由或字段转换层。
- 不绕过统一有效题集解析器。
