---
status: current
audience: operations
last_verified: 2026-08-30
source_of_truth: deploy/systemd/*.service, deploy/systemd/*.timer, scripts/install-systemd-services.sh
---

## 持久化运维定时器

监控和备份计划随应用服务安装，并通过加入允许列表的
`oi-manager-operations@.service` 模板运行。生产环境启用六个定时器：每五分钟监控、每日数据库和资源备份、每周数据库和资源恢复校验，以及每周安全基线。
每个定时器都使用 `Persistent=true`，主机中断后会补执行错过的日历任务。任务服务以
`ecs-user` 运行，启用资源限制和 `NoNewPrivileges`，以只读方式挂载仓库，只允许写入
`.run` 和 `/data/backups/oi-manager`。

```bash
sudo pnpm operations:timers:install
systemctl list-timers --all 'oi-manager-*.timer'
systemctl show oi-manager-operations@monitor.service --property=Result,ExecMainStatus
pnpm operations:timers:verify
pnpm runtime:audit
```

主机外日志归档定时器已经安装，但在真实上传命令和独立远端回读校验器均配置前保持禁用。安装器会先成功运行监控，再删除对应的旧 Cron 项；如果迁移失败，旧调度器会保留。

# systemd 恢复部署

当前开发服务器使用稳定 Router、蓝绿 API、单例 Scheduler、可并行 Executor 及两个应用服务：

- `oi-manager-api-router.service`：稳定监听 `127.0.0.1:3002`，每个 HTTP/WebSocket 连接固定转发到活动实例。
- `oi-manager-server@3302.service` / `@3303.service`：蓝绿 API 实例；任一时刻一个活动，另一个用于候选启动。
- `oi-manager-worker.service`：兼容名称保留，实际是唯一 Scheduler，只运行 Cron 和 OJ 账号自动验证；持有 PostgreSQL session advisory leader lock。
- `oi-manager-executor@1.service`：执行可并行的旧远程提交轮询；每条任务使用 PostgreSQL session advisory lease，增加 `@2` 等实例不会重复处理同一记录。
- `oi-manager-judge.service`：运行 Judge 客户端并自动重连 API。
- `oi-manager-web.service`：运行已发布的 `.next-current` 预览产物，只监听 `127.0.0.1:3000`。

PostgreSQL 与 go-judge 继续由 Docker Compose 管理。应用运行不再依赖 PM2 或 Nix。所有应用服务均以
`ecs-user` 运行，日志进入 journald，异常退出后自动重启，并按当前 3.7 GiB 主机容量设置内存上限。
PostgreSQL 和 go-judge 容器都使用 `unless-stopped`，保证 Docker 在主机重启后重新拉起基础设施。API 与
Worker 显式依赖 Docker 并在启动前等待 PostgreSQL health；Judge 还会等待 go-judge `/version` 和稳定 API
`/api/readiness`。等待上限默认 120 秒，避免 systemd 在基础设施尚未就绪时耗尽启动频率额度。
Router、API、Worker、Judge 与 Web 同时设置 `TasksMax`、`LimitNOFILE`、停止超时和 60 秒内最多 10 次
启动的频率保护。go-judge 设置 1.5 CPU、1536 MiB 内存、256 PID、65536 NOFILE、只读根文件系统、
`no-new-privileges` 和 512 MiB 临时文件系统；宿主内核没有 swap accounting 时，Docker 只能强制内存
上限而不能独立强制 memory+swap 上限。

基础设施命令统一通过 `pnpm compose -- <args>` 调用；包装脚本把 Compose project 固定为历史生产值
`oi-manager`。不要在当前 `oi-manager-response-refactor` 目录直接运行裸 `docker-compose`，否则会创建
第二套空网络/卷并与固定容器名冲突。

API slot 仅提供 HTTP/WebSocket 与实例内请求指标，不运行可变后台任务。Cron 和账号验证由 Scheduler leader 执行；远程轮询由 Executor 执行，并以逐任务 lease 支持多实例。

Web unit 显式使用 `CSP_MODE=off` 作为当前 HTTP 兼容基线。CSP 是 Next.js middleware 的构建输入；启用 report-only 或 enforce 时必须以对应 `CSP_MODE` 重新执行 preview build/promote，不能只修改 unit 后复用旧构建。完整流程见 [TLS_ROLLOUT.md](TLS_ROLLOUT.md)。

## 安装或修复

先确认构建产物存在，再在服务器执行：

```bash
cd /data/oi-manager-response-refactor
sudo bash scripts/install-systemd-services.sh
```

首次安装会启动 3302 并通过 `/api/readiness`，再停用旧的直连 3002 Server，启动稳定 Router，最后
启动单例 Worker 并重启 Judge/Web。重复执行时不会把活动端口强行改回 3302，而是保留当前指针、使用
正常蓝绿流程启动另一端口并 drain 原实例。脚本不会构建代码，也不会修改数据库。

后续 API 发布使用：

```bash
sudo bash scripts/promote-api.sh
```

脚本在非活动端口启动候选、检查数据库 readiness、原子切换 Router 指针，再向旧实例发送
`SIGUSR2`。旧实例停止领取新任务，等待在途 Judge/Hack 后以 1012 关闭 WebSocket，Judge 自动重连新实例；
HTTP 切换完成后只重启一份 Worker。候选未就绪时不会切换。

CurrentJudgeRun 投影一致性不属于流量 readiness，由 `pnpm judge:projection:check` 与运维定时任务独立报警；TestSet 槽只检查 Stable/Evolving Reader/Writer 屏障。

## 验证

```bash
systemctl --no-pager --full status oi-manager-api-router 'oi-manager-server@*' oi-manager-worker 'oi-manager-executor@*' oi-manager-judge oi-manager-web
ss -ltnp | grep -E ':3000|:3002|:3302|:3303'
curl -fsS http://127.0.0.1:3002/api/health
curl -fsS http://127.0.0.1:3002/api/readiness
curl -I http://127.0.0.1:3000/login
curl -fsS http://127.0.0.1:5050/version
pnpm runtime:audit
pnpm sandbox:smoke
sudo journalctl -u oi-manager-worker.service --since '-10 min' --no-pager
sudo journalctl -u oi-manager-executor@1.service --since '-10 min' --no-pager
docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' oi-postgres oi-judge
docker inspect -f '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}}' oi-postgres oi-judge
```

`runtime:audit` 只读取容器与 systemd 的公开运行参数，不读取环境文件或输出密钥。它会在任一资源上限、
回环绑定、只读根、临时盘或日志轮转配置缺失时返回非零。
`sandbox:smoke` 只允许回环地址，执行一个有 CPU/内存/进程/输出限制的短命令，并确认 go-judge 文件清单
前后相同；它不创建提交、不连接数据库。

For failure evidence use `journalctl -u <unit> -b`, `journalctl -k -b`, and `journalctl -b -1`. Do not include environment files, tokens, cookies, or source code in incident reports.

## 2026-08-19 异常重启记录

- 旧启动周期在 `2026-08-19 14:02:17 +08:00` 非正常结束，新启动周期从
  `2026-08-19 14:17:43 +08:00` 开始。
- 新启动时 `/dev/vdb` 报告 `recovering journal` 并清理 orphaned inode，EFI 分区报告
  `Fs was not properly unmounted`，说明上一次没有正常卸载文件系统。
- 事故窗口没有 OOM、kernel panic、磁盘 I/O error 或正常 shutdown 记录；选手程序的
  `main` 段错误属于评测沙箱内失败，不能据此认定其导致 ECS 重启。
- 服务器内部证据只能确认异常掉电或强制 reset，无法区分控制台强制重启与阿里云基础设施事件；
  最终归因需要检查阿里云控制台 `14:02–14:18` 的 ECS 实例事件和操作审计。
- 重启后业务未自动恢复是独立问题：旧 `pm2-root.service` 写死了已经不存在的 Nix 路径并返回
  `203/EXEC`。现已改为仓库内可追踪的 systemd units。

完整时间线、证据边界、已完成处置和后续待办见
[`INCIDENT-2026-08-19-REBOOT.md`](INCIDENT-2026-08-19-REBOOT.md)。该事故文档保持
`status: open`，直到云平台审计、独立监控、日志持久化、受控重启演练、评测沙箱资源治理、
SSH 暴露面复核及备份恢复演练全部完成或明确关闭。

## 回滚

API 回滚时将 `.run/api-active-upstream` 原子改回仍在运行的旧端口；若旧实例已经停止，先用对应
`oi-manager-server@<port>` 启动并通过 readiness，然后重启 Scheduler/Executor。前端继续使用 preview rollback。
不要执行 `docker compose down -v`，否则会删除数据库卷。

前端 Canary 日志固定保存在项目 `.run/oi-web-canary.log`，不使用 `/tmp` 中可能由其他运行身份创建的
固定文件名。这避免 Linux `fs.protected_regular` 在粘滞目录中拒绝跨用户覆盖旧日志。
已安装 `oi-manager-web.service` 时，`promote-preview.sh` 和 `rollback-preview.sh` 必须使用 `sudo`；脚本会先停止
systemd Web，原子切换 `.next-current/.next-previous`，再重启并按 BUILD_ID 校验，不再依赖旧 PID 文件。
正式提升还要求 `.run/chat-probe.env` 存在且启用。`promote-preview.sh` 在候选和正式端口执行专用账号消息发送、SSE 接收、已读与回复闭环；正式探针失败沿用同一回滚分支恢复上一 BUILD_ID，并保留 Playwright 失败证据。
