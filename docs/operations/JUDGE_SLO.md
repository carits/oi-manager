---
status: current
audience: development, operations
last_verified: 2026-08-28
source_of_truth: JudgeAttempt phase metrics and apps/server/scripts/check-judge-slo.ts
---

# Judge SLO

每个终态 `JudgeAttempt` 持久化以下分段耗时，单位均为毫秒：

- `queueLatencyMs`：Attempt 创建至领取。
- `dispatchLatencyMs`：Server 发出任务至 Judge 收到。
- `compileLatencyMs`：用户程序编译。
- `runLatencyMs`：Judge 总执行减去用户编译，包含测试点与 Checker。
- `persistLatencyMs`：Server 收到结果至事务最终化。
- `totalLatencyMs`：Attempt 创建至最终化。

默认 24 小时窗口和训练场景目标：

| 指标 | P95 目标 |
|---|---:|
| Queue | `< 5s` |
| Dispatch | `< 1s` |
| Compile | `< 3s` |
| Run | `< 10s` |
| Persist | `< 1s` |
| Total | `< 20s` |

基础设施错误率目标 `< 0.1%`，超过 15 分钟的活动 Attempt 必须为 0。`pnpm judge:slo` 始终输出当前报告；`pnpm judge:slo:check` 在每项达到 50 个样本后执行门禁，样本不足时也会拒绝正式 SLO 验收。阈值与窗口可用 `JUDGE_SLO_*` 环境变量覆盖。

旧 Submission 与迁移回填 Attempt 没有伪造分段数据。指标从本迁移之后的真实评测开始累计。
