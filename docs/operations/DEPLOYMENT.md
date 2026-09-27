---
status: current
audience: operations
last_verified: 2026-09-20
source_of_truth: deploy/systemd/*.service, scripts/install-systemd-services.sh, scripts/promote-api.sh, scripts/promote-preview.sh, offline invariant audits and scheduler services
---

# 部署与回滚

当前线上使用 systemd 管理 Web、稳定 API Router、蓝绿 API、单例 Scheduler、可并行 Executor 和 Judge。PM2/Nix/开发 watch 进程不属于现行部署链。详细 unit 参数见 [SYSTEMD_DEPLOYMENT.md](SYSTEMD_DEPLOYMENT.md)。

仓库不再提供旧 PM2 ecosystem manifest 或 `start:production` 入口；`architecture:check` 会拒绝重新引入 PM2 生产脚本或 manifest。生产安装、提升和回滚必须使用 `deploy/systemd` 与对应脚本。

域名和证书到位后的 HTTPS、Secure Cookie、HSTS 与 nonce CSP 分阶段切换见 [TLS 与严格浏览器安全发布](TLS_ROLLOUT.md)。

## 服务拓扑

```text
公网 80/443 → Nginx → loopback `127.0.0.1:3000` oi-manager-web
本机 3002 → oi-manager-api-router → 3302 或 3303
                                  ↘ WebSocket /ws/judge
oi-manager-worker → Scheduler leader advisory lock
oi-manager-executor@N → per-task advisory lease
oi-manager-judge  → Router 3002 → 当前 API
go-judge 5050、PostgreSQL 5432 均只监听 127.0.0.1
```

Router 活动端口由 `.run/api-active-upstream` 原子文件决定，只接受允许列表中的 3302/3303。候选实例必须先通过 `/api/readiness`；部署编排可用 `API_STARTUP_READY_FILE` 在整个候选栈就绪前阻止 HTTP 流量。

## 发布前门禁

```bash
pnpm install --frozen-lockfile
pnpm --filter server test
pnpm --filter @oi-manager/judge test
pnpm --filter server exec vitest run tests/chat.test.ts
pnpm test:chat:race
pnpm test:chat:release
pnpm test:stress:blue-green
pnpm db:install-paths:verify
pnpm build
pnpm docs:check
pnpm runtime:audit
pnpm security:audit
```

双 API 演练只允许使用显式 `schema=e2e` 数据库、独立端口和带所有权标签的独立 go-judge 容器。演练覆盖重复结果 CAS、Worker 单例、Router 切换/回滚、旧 API drain、Judge 1012 重连和客户端 RST。

## Server/API 发布

1. 确认 Git 工作区只包含本批交付文件，提交并推送 `main`。
2. 使用 `scripts/backup-db.sh` 创建并校验新备份。
3. 执行标准 Prisma `migrate deploy`；禁止修改历史 migration 或校验和。
4. 构建 Server，并在非活动端口启动候选实例。
5. 检查候选 `/api/health`、`/api/readiness`、数据库投影一致性和日志。
6. 使用 `scripts/promote-api.sh` 原子切换 Router 指针。
7. 旧实例收到 drain 信号后向 Judge 发送 1012，等待连接和在途请求退出。
8. 重启唯一 `oi-manager-worker.service` Scheduler 和 Executor 实例；第二个 Scheduler 必须被 leader lock 拒绝，多个 Executor 通过逐任务 lease 协作。
9. 验证 Judge 已重新注册、队列继续消费且没有残留 `judging/finalizing` 任务。

### TestSet 双槽不可兼容迁移

删除 TestSet Revision 的 migration 不支持旧 API 双运行，必须使用一次性停写切换：

1. 完成备份并停止 Router 新写入、两套 API、Worker、Executor 与 Judge；确认没有 QUEUED/RUNNING JudgeRun，也没有 RUNNING/PAUSED Contest。
2. 执行 `prisma migrate deploy`；migration 会在阻断条件不满足时 fail closed，并将每题当前正式数据映射为 Stable，需要贡献能力的题同时建立 Evolving。
3. 在任何 API/Judge 启动前执行：
```bash
pnpm --filter server migrate:testset-slots:materialize
```
4. 核对每个数据库槽都有对应 `slots/stable` 或 `slots/evolving` manifest，旧 `ProblemTestSetRevision*` 表和 revisionId 列不存在。
5. 启动候选 API、Worker、Executor 和 Judge，验证 Stable Practice、Evolving Training、Contest Stable Reader 以及 Promotion 闭环后再恢复 Router 流量。
6. 本迁移删除旧表且不保留双读；失败时只能保持停写并按已验证备份整体恢复，不允许让旧 API 连接新 Schema。

### 经济闭环扩展发布

涉及 Contribution Reward、Carits 账本或 Evaluation Credits Schema 时，必须在 API 提升前额外执行：

1. 验证 `CaritsTransaction.requestFingerprint`、付费钱包/Reservation 表、外键和账本触发器已由新 migration 安全扩展。
2. 在 API 提升前运行服务器离线经济闭环审计，确认孤儿 Evaluation Ledger、不平衡交易、旧预占和系统账户均无阻塞；HTTP 不提供维护迁移入口。
3. 候选阶段使用 `CONTRIBUTION_REWARD_MODE=observe` 核对拟投递记录；核对通过前不得启用真实发币。
4. 提升 API 后启用单例奖励 Worker，同时确认 Evaluation Reservation 30 秒对账器在 Scheduler 中正常运行。
5. 发布验收必须包含：差异幂等请求被 409 拒绝、购买响应丢失重试不重复扣款、
   终态/孤儿 Reservation 可对账、已冲正奖励仍计入当日毛发放上限。

详细处置与不变性检查见 [Runbook](RUNBOOK.md#贡献奖励与-evaluation-credits)。

## Web 发布

生产机首次启用消息闭环探针时执行：

```bash
pnpm chat:probe:provision
pnpm exec playwright install chromium
```

该命令幂等创建两个无组织/团队关系的专用账号，并将随机凭据以 `0600` 权限保存到 `.run/chat-probe.env`，不得复制到仓库、日志或普通用户环境。

```bash
pnpm preview:build
pnpm preview:canary
pnpm preview:health
pnpm preview:promote
```

Validator / Classifier / STD / Generator 改动发布后，使用短期超级管理员
Session Token（通过 Cookie 发送） 在不可见的草稿题上执行一次完整线上闭环。探针会创建初始 OI
Stable 槽、异步编译并预检四类程序、激活版本、生成 Candidate 更新 Evolving，
再验证 Promotion 原子更新 Stable，并确认 Classifier 命中 Subtask：

```bash
BASE_URL=http://127.0.0.1:3002 SESSION_TOKEN='<short-lived token>' pnpm judge:workflow:live
```

探针不输出认证信息或程序源码，只输出草稿题 ID、槽 fencing token、程序版本 ID 和候选
阶段。草稿题保留为发布审计证据，不出现在普通题库；不得使用真实用户题目代替
探针题。

生产 systemd 环境中的 `preview:promote` 会在 3200 候选和 3000 正式端口各执行一次双浏览器消息闭环；候选失败时不切换，正式探针失败时自动恢复 `.next-previous`。提升脚本只把 mode-600 凭据文件路径交给低权限探针进程，并由进程内部加载，禁止把探针密码写入命令行参数或进程清单。提升后核对 `.next-current/BUILD_ID` 与候选构建 ID 完全一致。Web 失败使用 `pnpm preview:rollback`，不会修改 API 指针或数据库。

## 回滚

- API 代码失败：Router 原子切回旧 slot，再停止候选实例；已经执行的向前兼容 Schema 扩展通常保留。
- Web 失败：恢复上一 `.next` 构建并重启 Web unit。
- 只有数据库 Schema 或数据已经不可向后兼容时才执行数据库恢复；恢复前必须停止所有写入进程并获得明确授权。
- 回滚后必须重新检查 Router readiness、Judge 注册、Worker 单例、提交队列和公网关键流程。

## 当前正式投产缺口

开发预览仍使用 HTTP/IP 入口。域名、DNS、TLS、Secure Cookie、HSTS、严格 CSP、外部通知和异机日志完成前，不得把当前状态描述为正式生产入口。
