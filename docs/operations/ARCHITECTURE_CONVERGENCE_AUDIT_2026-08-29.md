---
status: current
audience: development, operations
last_verified: 2026-08-29
source_of_truth: remote main, Prisma schema, generated architecture inventory, production runtime and current test reports
---

# 架构收口逐项完成审计（2026-08-29）

本文把 2026-08-29 架构评审中的每一项建议映射到当前代码、测试和线上证据。它不是新的实施计划；仍未完成且必须依赖外部输入的事项继续以
[未完成事项执行总表](REMAINING_WORK_2026-08-27.md)和
[外部依赖清单](EXTERNAL_DEPENDENCIES_2026-08-28.md)为准。

## 结论

- 仓库内架构收口项已经完成：领域边界、Judge 生命周期、状态机、Candidate、Strangler、BlobStore、Scheduler/Executor、SLO 分段、架构事实清单和账号级 capability UI 均已实现并有防回退门禁。
- 当前生产运行的是模块化单体 Server + 独立 Judge Runtime，没有引入微服务、Kafka、CQRS 或全量 Event Sourcing。
- Production v1 仍不能宣布完成：TLS/浏览器安全、真实外部告警、异机留存、阿里云控制台审计和正式库覆盖恢复演练缺少外部目标、权限或明确授权。
- `Submission` 兼容执行字段和 SLO 仍处观察期：前者已有 2518/2518 零差异对账；后者当前 24 小时窗口没有完整阶段样本，门禁维持未满足。两项都不能通过删除字段、降低门槛或伪造生产样本提前结束。

## 逐项证据矩阵

| 原评审事项 | 当前结论 | 权威实现或证据 |
|---|---|---|
| 产品拆为教育管理域与评测域 | 已完成 | `README.md`、`docs/guide/PROJECT_OVERVIEW.md`、`docs/architecture/SYSTEM_OVERVIEW.md` 明确双核心域和模块化单体边界。 |
| `Submission` 拆分 | 已完成写入和读取切换；兼容字段待观察期后删除 | Prisma `JudgeRun`、`JudgeAttempt`、`RejudgeBatch`；`modules/judge/application/judge-run.service.ts`；`judge-read-projection.ts`。生产 2518/2518 投影零差异。 |
| Judge/Hack 统一状态机 | 已完成 | `modules/judge/domain/judge-state.ts`、`modules/problem/problem.hack-state.ts`；`scripts/audit-domain-state-writes.mjs` 当前报告 Hack 直接写入 0。 |
| Hack 与正式数据晋升分离 | 已完成 | Prisma `TestcaseCandidate` 与 `TestcaseCandidateStatus`；`problem.testcase-candidate.service.ts`；Candidate 与 Revision 晋升在同一事务终结。 |
| `routes/` → `modules/` Strangler | 已完成 | `scripts/audit-route-boundaries.mjs` 当前 60 个 adapter 的 Prisma/transaction/filesystem/Judge Runtime 均为 0，零基线门禁阻止新增债务。 |
| String State → Domain Enum/Transition | Judge/Hack 核心域完成 | Prisma JudgeRun/JudgeAttempt/RejudgeBatch/TestcaseCandidate 枚举与显式 transition API 已覆盖核心并发路径；非核心展示型字符串不属于本轮破坏性迁移范围。 |
| 架构文档与拓扑事实源 | 已完成 | `SYSTEM_OVERVIEW.md` 反映 Router、3302/3303、Scheduler、Executor、Judge 与 Docker；`generate-architecture-inventory.mjs --check` 校验模型、路由、systemd 和环境变量清单。 |
| Local File → Blob/Object abstraction | 已完成抽象，线上对象仍为本地实现 | `modules/storage/blob-store.ts` 提供 Local/S3/Aliyun OSS adapter；Revision 使用内容寻址不可变对象。外部 OSS 迁移依赖真实 bucket/凭据，不冒充已完成。 |
| Scheduler 单例 / Executor 并行 | 已完成并上线 | `oi-manager-worker.service` 运行 leader scheduler；`oi-manager-executor@.service` 运行并行任务，生产两类 unit 独立 active。 |
| Judge 延迟分段与 SLO | 已完成采集和门禁，观察中 | Attempt 保存 queue/dispatch/compile/run/persist/total；`check-judge-slo.ts` 执行 24h/50 样本门禁。当前 24 小时窗口为 0/50，门禁正确失败且没有 stuck attempt。 |
| Domain ownership + API contract | 已完成当前边界 | 领域 application/query/infrastructure 分层、318 endpoint 认证审计、自动 API/模型清单和 route adapter 零债务共同构成当前契约。 |
| capability-driven UI | 已完成账号级入口 | `apps/web/src/lib/capabilities.ts` 统一账号级能力；关键 Shell、工作区和提交入口已迁移；UI 门禁拒绝复合管理员角色判断回退。资源级授权仍由后端决定。 |
| 生产 P0 | 仓库准备完成，外部启用阻塞 | TLS 配置生成和真实 Nginx 语法验证、nonce CSP、生产严格 CSRF、告警适配器、日志上传与远端读回校验、受保护恢复命令均已具备；真实启用仍需要域名/证书、收件人、异机目标、云权限或明确覆盖授权。 |

## 当前验证快照

- Server：58 个测试文件，513/513；生产构建通过。
- Web：账号能力批次后 11 个测试文件，40/40；生产构建通过。
- Judge：6 个测试文件，17/17。
- `docs:check`：54 份活动文档、63 条页面路由、82 个 Prisma model、318 个 HTTP endpoint。
- API 认证审计：310 个需认证 endpoint、8 个明确公开 endpoint。
- 架构边界：60 adapters，四类直接依赖均为 0；Hack 状态直接写入为 0。
- 生产：Web、API Router、API 3302、Scheduler、Executor、Judge 均 active；health/readiness 正常。当前 HTTP 兼容模式允许缺失 Origin，但恶意跨域 Cookie 写请求返回 403；严格缺失来源拒绝已由生产模式回归覆盖。
- 公网 Web：构建 `EilfIqQM_IwOJFYUKtfzk`；Codex 内置浏览器确认 `/login` 可渲染。该构建默认 `CSP_MODE=off`，等待 HTTPS 后按 report-only → enforce 发布。

## 仍需外部输入的完成条件

| 输入 | 完成后可关闭的事项 |
|---|---|
| 域名、DNS 控制权和证书签发许可 | HTTPS、HTTP 跳转、Secure Cookie、HSTS、严格 CSP、最终 CSRF/跨域浏览器验收。 |
| HTTPS Webhook 或 SMTP 收件人及测试许可 | 一次真实 failed/recovered 外部告警送达。 |
| OSS/S3 bucket 或 SSH 异机目标、凭据/host key、保留期 | 日志归档上传、下载、SHA-256 复核和保留策略启用。 |
| 阿里云控制台登录或只读 RAM Role | 2026-08-19 实例事件、ActionTrail、CloudMonitor 联系人/阈值/重启通知和安全组审计。 |
| 精确备份路径、SHA-256、维护窗口和覆盖 `oi_manager` 的明确授权 | 正式数据库覆盖恢复演练与审计日志。 |
| 自然产生的真实评测流量和稳定发布观察期 | SLO 达到 50 个完整阶段样本；确认兼容投影长期零差异后再另行迁移删除旧字段。 |

## 复核命令

```bash
pnpm docs:check
pnpm architecture:check
pnpm judge:projection:check
pnpm judge:slo
pnpm runtime:audit
pnpm security:audit
```

这些命令只能证明仓库、主机和已有样本的当前状态；它们不能替代真实证书、外部收件回执、异机下载校验、云控制台记录或经授权的生产库覆盖恢复。
