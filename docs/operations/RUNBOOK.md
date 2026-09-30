---
status: current
audience: operations, development
last_verified: 2026-10-01
source_of_truth: scripts, deploy/systemd/*.service, docker-compose.yml, runtime health endpoints, economy-loop migration and scheduler services

---

> 本手册面向当前开发/生产运维。TestSet 已取消历史 Revision：每道题最多有 Stable 与 Evolving 两个当前数据槽；文中“槽”均指当前数据，不代表可恢复的历史版本。

## 自动数据库备份

版本化备份脚本默认将经过校验的 PostgreSQL custom-format 归档写入
`/data/backups/oi-manager/automatic`。脚本使用非阻塞锁和原子临时文件，在发布归档前执行
`pg_isready` 与 `pg_restore -l` 校验。清理任务只删除该目录中匹配的 automatic `.dump` 文件；其他目录中的迁移/变更前备份不受影响。

```bash
cd /data/oi-manager-response-refactor
bash -n scripts/backup-db.sh scripts/backup-assets.sh scripts/verify-backup-restore.sh scripts/verify-assets-restore.sh scripts/install-operation-timers.sh
scripts/backup-db.sh
pnpm backup:verify
pnpm backup:assets
pnpm backup:assets:verify
sudo pnpm operations:timers:install
systemctl list-timers --all 'oi-manager-*.timer'
tail -n 50 /data/backups/oi-manager/automatic/backup.log
```

生产计划由持久化 systemd 定时器提供：03:00 备份数据库，03:15 增量快照附件/测试数据，均保留 14 天。每周日 04:00/04:30 会把最新数据库和完整资源快照恢复到隔离临时位置，并以权限 600 原子写入校验状态；主机恢复后会补执行错过的日历任务。服务监控会拒绝已禁用或失败的定时器，也会拒绝缺失、失败或过期的证明。部署时在权限 600 的运维环境中覆盖文档所列 `BACKUP_*` 和 `ASSET_*` 变量。备份目录权限为 700，转储、日志和状态文件权限为 600。零字节或未校验的归档永远不会晋升为最终文件名。
`backup:verify` 会把最新归档恢复到精确命名的 `oi_manager_restore_audit_<pid>` 临时数据库，
校验转储 SHA-256 以及创建时的表、迁移、用户、题目、提交、文件和 Stable/Evolving 测试数据槽数量，随后删除临时数据库和复制到容器中的归档。资源校验会复制所有文件并检查每个清单 SHA-256。两种校验都不会覆盖 `oi_manager`。

执行真实灾难恢复时，选择一个数据库转储，并选择其 `metadata.json.databaseBackupSha256`
与该转储匹配。使用现有受保护的 `pnpm disaster:restore -- ...` 流程恢复数据库，然后恢复配对资源：

```bash
sudo pnpm disaster:restore:assets -- \
  --snapshot /data/backups/oi-manager/assets/snapshots/snapshot-YYYYMMDDTHHMMSSZ \
  --database-sha256 <the-selected-dump-sha256> \
  --confirm-root /data/oi-manager-response-refactor/apps/server \
  --apply
```

资源命令先执行完整隔离校验，创建恢复前资源快照，停止应用写入，仅替换准确的 `testdata` 和 `uploads` 根目录，校验每个文件和符号链接后恢复 readiness。如果替换或 readiness 失败，会在重启服务前恢复恢复前快照。绝不能把 SHA-256 与元数据不匹配的资源快照和数据库转储混用。

## 服务监控

`scripts/monitor-services.sh` 检查回环优化预览（`127.0.0.1:3000`）、API（`3002`）、go-judge
（`5050`）、PostgreSQL readiness、当前提供的 Next.js 构建、根盘/数据盘使用量以及自动备份年龄。
任一项失败都会以非零状态退出，并在 `.run/service-monitor.state` 记录状态变化。
公开 `/api/health` 契约是带版本的 JSON，包含 `schemaVersion=1`、`status=ok`、`service=api` 和 ISO 时间戳。
监控程序解析 JSON 并校验契约，绝不依赖展示文本。兼容字段 `success/message` 仅为一个客户端发布周期保留。

```bash
pnpm monitor
sudo pnpm operations:timers:install
systemctl list-timers --all 'oi-manager-*.timer'
journalctl -u oi-manager-operations@monitor.service -n 50 --no-pager
```

持久化监控定时器每五分钟运行，并抑制重复的健康日志。沙箱会在调用监控程序前读取可选的权限 600
`$HOME/.config/oi-manager/operations.env`。将 `MONITOR_ALERT_COMMAND` 设置为
`/data/oi-manager-response-refactor/scripts/send-monitor-alert.sh`，并把 HTTPS 端点存放在权限 600 的独立文件中，
由 `MONITOR_ALERT_WEBHOOK_URL_FILE` 指向；Node 在进程内读取密钥，绝不会把它放进进程参数或日志。告警命令必须是绝对路径可执行文件，Shell 片段会被拒绝。命令接收 `MONITOR_STATUS` 和 `MONITOR_MESSAGE`，仅在状态变化时调用。送达失败不会推进状态文件，因此下一次监控会同时重试故障和恢复通知。

当前服务器没有配置外部告警通道，因此故障目前只保存在 journald 和事故证据中。在真实收件人确认一次注入的
故障及其恢复通知后，才能将外部告警标记为完成。`pnpm monitor:verify` 只使用回环 HTTP 接收器校验负载和重试契约，不能作为外部送达证据。

旧的 `install-*-cron.sh` 命令仅作为回滚路径保留。不要同时运行 Cron 和 systemd 定时器；`install-operation-timers.sh` 只有在监控成功后才会删除已知的重复项。

### GitHub 主机外可用性工作流

`.github/workflows/external-uptime.yml` 提供每五分钟一次的主机外 HTTPS 探针，并为故障/恢复创建去重后的
GitHub Issue。默认目标是 `https://www.carits.top`；仓库变量 `OI_MANAGER_PUBLIC_ORIGIN` 可在迁移域名时显式覆盖。
探针使用正常证书校验，因此证书过期、域名错误、HTTP/API 不可用都会失败。

启用或复核工作流：

```bash
gh workflow enable external-uptime.yml
gh workflow run external-uptime.yml --ref main
gh run list --workflow external-uptime.yml --limit 1
gh run watch <run-id> --exit-status
```

只有 `gh run watch` 成功且探针日志显示正式域名的 `/api/health` 与 `/login` 均通过，才能把外部 HTTPS
探针标记为已启用。若 GitHub 账单或 Runner 仍拒绝运行，必须明确记录为未启用，并使用真实外部监控
覆盖该缺口；不能以回环 `pnpm monitor:verify` 代替公网证书监控。

监控还会校验滚动 API/Judge 指标、浏览器/安全/服务器错误峰值、Judge 基础设施错误、所有必需的 systemd 单元、重启增量、仅回环可访问的受限端口、数据库连接/事务/锁状态、数据库与资源快照/恢复证明、端点 5xx/P99 阈值、过期域工作流以及 Stable/Evolving 槽一致性。首次进入故障状态时，会在发送告警前以权限 600 捕获事故证据包。阈值和捕获命令配置在 `deploy/observability/operations.env.example`；不要为了静默告警而禁用检查。

```bash
pnpm operations:snapshot
pnpm operations:check
pnpm network:audit
pnpm backup:verify
pnpm backup:assets:verify
jq . .run/operational-state.json
jq . ".run/metrics-$(cat .run/api-active-upstream).json"
jq . .run/judge-metrics.json
INCIDENT_REASON='manual investigation' pnpm incident:capture
pnpm incident:verify
```

完整的信号、严重级别、留存、RTO/RPO 和长期安全契约记录在
[`OBSERVABILITY_SECURITY_STRATEGY.md`](OBSERVABILITY_SECURITY_STRATEGY.md).

每周安全基线会为运行时密钥契约、
OJ 凭据解密、网络暴露、服务限制、TLS 工具和生产依赖生成独立校验哈希的私有报告：

```bash
pnpm security:baseline
pnpm security:baseline:install
cat /data/backups/oi-manager/security-baseline/security-baseline.json
```

监控会拒绝失败、缺失、过期或哈希不匹配的报告。详细报告权限为 600，保留 90 天；只包含审计输出，绝不包含密钥值。每项检查在 `SECURITY_BASELINE_CHECK_TIMEOUT_SECONDS`（默认 600 秒）后终止，报告日志会明确记录超时。因此，Registry 或其他外部依赖中断会使基线失败，并留下明确的失败证据。
不会留下永久运行的审计进程。修改此运行器后，在 Linux 上用 `pnpm security:baseline:verify` 验证超时契约。

基线只在 `RUNTIME_AUDIT_REQUIRE_MONITOR_SUCCESS=0` 下调用内置运行时限制审计，打破“过期失败基线导致监控失败，而替换基线又等待监控健康”的循环依赖。单元定义、定时器、容器限制和其他运行时检查仍然必须通过。独立运行 `pnpm runtime:audit` 不会设置此覆盖，仍要求最近一次监控成功；应在新基线和监控都完成后再运行。
生产依赖审计也有独立上限：完整 Registry 请求最多重试 `SECURITY_DEPENDENCY_AUDIT_ATTEMPTS` 次（默认 3），每次由 `SECURITY_DEPENDENCY_AUDIT_ATTEMPT_TIMEOUT_SECONDS` 限制（默认 180 秒）。这可以容忍 npm advisory 端点的暂时失败，但 Registry 仍不可用或报告漏洞时必须 fail closed。总重试时长必须小于 `SECURITY_BASELINE_CHECK_TIMEOUT_SECONDS`。
优化后的生产预览没有 HMR 监听器；确需运行 HMR 的开发环境可以显式设置 `MONITOR_HMR_URL=http://127.0.0.1:3001`。当前主机没有 SLS Logtail、CloudMonitor Agent 或 ECS RAM Role，因此云联系人、阈值和日志送达必须显式配置。

## 主机外日志归档

`scripts/archive-operations-logs.sh` 会生成有界归档，包含过去 24 小时的 OI Manager systemd 单元、PostgreSQL/go-judge Docker 日志、最近 N 行 Nginx 日志、监控/备份日志以及构建/提交清单。归档和 SHA-256 会留在本地 spool，直到 `LOG_ARCHIVE_COMMAND` 成功复制到主机外机器或对象存储，且 `LOG_ARCHIVE_VERIFY_COMMAND` 独立读取远端对象并校验大小和 SHA-256。只有两个命令都通过的归档才会得到 `.uploaded` 标记并进入留存清理；校验失败时本地唯一副本和校验和保持不变。

```bash
mkdir -p "$HOME/.config/oi-manager"
install -m 600 deploy/observability/operations.env.example \
  "$HOME/.config/oi-manager/operations.env"
# 填入真实 HTTPS webhook 文件，以及受信任的上传器和远端校验器可执行文件。
pnpm monitor:verify
pnpm logs:archive
pnpm logs:archive:install
```

两个命令都必须是绝对路径可执行文件，Shell 片段会被拒绝。它们接收 `LOG_ARCHIVE_PATH`、
`LOG_ARCHIVE_CHECKSUM_PATH`、`LOG_ARCHIVE_NAME`、`LOG_ARCHIVE_SHA256`、`LOG_ARCHIVE_SIZE` 和 `LOG_ARCHIVE_HOST`。
校验器必须读取或下载远端对象，不能只信任上传器的退出状态。凭据应放在
凭据只能放在服务商管理的权限 600 配置中，不能进入 Git 或命令行参数。本地复制或回环测试不能作为主机外留存证据。

## 运行时资源审计

修改 Docker Compose 或任一应用 systemd 单元后运行：

```bash
docker-compose config >/dev/null
sudo systemd-analyze verify deploy/systemd/*.service
pnpm runtime:audit
pnpm sandbox:smoke
```

审计会验证 go-judge 的 CPU、内存、PID、NOFILE、只读根目录、有界 `/tmp` tmpfs、回环端口和 Docker 日志轮转，以及每个应用单元的内存、任务、文件描述符、停止超时和重启频率限制。它不会检查或打印运行时密钥。绝不能使用 `docker-compose down -v`；旧命名 Judge scratch 卷只能在单独校验的清理中删除，而 PostgreSQL 卷必须保留。

## 运行时密钥审计与轮换

安全审计只报告文件元数据、密钥长度和布尔比较，绝不打印密钥值：

```bash
pnpm security:audit
pnpm security:rotate:check
pnpm security:rotate:verify
```

`security:rotate:check` 会在内存中解密所有已保存的 OJ 账号，不写入任何数据。`security:rotate:verify`
会把最新备份恢复到唯一命名的临时数据库，对权限 600 的临时环境文件执行真实轮换，使用新密钥再次解密所有账号，最后通过 trap 删除数据库和文件。生产轮换必须先创建并校验数据库备份，再在隔离恢复库和临时环境文件上证明 `--apply`。应用路径会创建权限 600 的环境备份，轮换 JWT 和 64 位十六进制 AES 账号密钥，在事务内通过 CAS 重新加密 OJ 密码，并把旧部署软链接替换为当前仓库中的权限 600 文件。不得打印、复制到 Git 或将任一环境文件写入日志。

生产应用成功后，立即蓝绿提升 API 并重启单例 Worker。现有 JWT 会话会有意失效，用户必须重新登录。声明轮换完成前，验证 `pnpm security:audit`、两个 OJ 账号解密、登录、API readiness 和 Judge 认证。

## SSH 加固

仓库基线禁用密码和键盘交互认证，保留公钥认证，并限制 root 只能使用公钥访问。除非执行 sudo 的用户拥有有效 `authorized_keys`、正确的 700/600 权限和 sudo 权限，安装器不会继续；无效的 `sshd` 配置会回滚。

```bash
cd /data/oi-manager-response-refactor
bash -n scripts/install-ssh-hardening.sh
sudo scripts/install-ssh-hardening.sh
ssh -o BatchMode=yes -o PasswordAuthentication=no alias true
sudo sshd -T | grep -E '^(pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries) '
```

## 受控负载冒烟

`scripts/load-smoke.sh` 提供有界只读并发检查。为安全起见，它只接受明确列出的 `3000` 和 `3002` 回环 URL，拒绝超过 5,000 请求或超过 100 并发，并且绝不访问登录写操作、提交、Judge 队列或其他写入接口。

```bash
pnpm load:smoke
LOAD_REQUESTS=1000 LOAD_CONCURRENCY=25 \
  LOAD_URL=http://127.0.0.1:3000/api/platform-bindings/platforms pnpm load:smoke
LOAD_REQUESTS=300 LOAD_CONCURRENCY=15 \
  LOAD_URL=http://127.0.0.1:3000/login pnpm load:smoke
```

输出包含总数、成功/失败数、耗时、吞吐量、平均/最大延迟以及 P50/P95 延迟。每次负载冒烟后运行服务监控并检查应用日志。这是有界运维冒烟，不代表生产容量，也不能替代隔离的长时间 soak test。

## 依赖安全审计

每次依赖或框架更新后运行生产依赖审计：

```bash
pnpm audit --prod --audit-level low
pnpm build
pnpm --filter server test
pnpm --filter web test
pnpm --filter @oi-manager/judge test
```

当前 Web 应用不导入 `next/image`；在当前 Next.js 版本支持修复版前，有意不引入可选 Sharp 依赖。删除 pnpm 安全覆盖前，必须确认解析后的 lockfile 仍能通过 `pnpm audit --prod`。

# 运行手册

当前服务器项目目录为 `/data/oi-manager-response-refactor`，运行的是开发环境。

## 状态检查

```bash
cd /data/oi-manager-response-refactor
git status --short
docker-compose ps
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP -iTCP:3002 -sTCP:LISTEN
lsof -nP -iTCP:5050 -sTCP:LISTEN
curl -fsS http://127.0.0.1:3002/api/health
curl -I http://127.0.0.1:3000/login
```

`3000` 只允许优化预览进程监听在 loopback，不得出现公网 listener；`3001/3002` 也只允许 loopback 开发/路由进程。
多个父级 `pnpm` 进程不一定代表冲突，以监听 PID、仓库 `.run/*.pid` 和进程树为准。

## 启动与重启

```bash
cd /data/oi-manager-response-refactor
pnpm run restart
pnpm preview:build
pnpm preview:start
pnpm preview:health
tail -f /tmp/oi-dev.log
tail -f /tmp/oi-web-preview.log
```

`restart` 只停止 `.run/oi-dev.pid` 记录且工作目录匹配的进程组，随后启动 PostgreSQL、
go-judge、`3001` HMR、`3002` Server 和 Judge。`preview:start` 独立持有 `3000`；
两个命令遇到未知端口占用都会失败并报告，不会执行广泛 `pkill` 或 `kill -9`。

`pnpm restart` 会触发 pnpm 的 `stop → restart → start` 生命周期；版本化脚本会自动延后第一阶段 stop，
先准备 PostgreSQL 和 go-judge，再执行应用进程切换。当前仍是单 API 实例，实测切换约 16 秒；重大活动期间
不要主动重启。零停机需要部署双实例和 Nginx upstream 切换后才能宣称完成。

首次启动或依赖变化前执行：

```bash
pnpm install --frozen-lockfile
pnpm compose -- up -d db judge
pnpm run restart
```

`pnpm dev`、`pnpm dev:dirty`、根构建和 Server `prebuild` 都会自动执行
`prisma generate`。日志出现 `PrismaClientValidationError` 或 `Unknown argument` 时，
按[故障排查](TROUBLESHOOTING.md#prisma-client-与-schema-不一致)手动重新生成并受控重启。

## 停止

```bash
pnpm stop
pnpm preview:stop
pnpm compose -- stop db judge
```

`pnpm stop` 停止应用开发进程；Docker 基础设施需要单独停止。不要在仍有数据库写入时
停止 PostgreSQL。`scripts/compose.sh` 固定使用生产历史项目名 `oi-manager`，避免仓库目录改名后创建
第二套空网络和卷。当前服务器使用 `/usr/bin/docker-compose`。不要执行 `docker-compose down -v` 或
`docker compose down -v`，这两个命令都会删除数据库卷。

## 端口冲突

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP -iTCP:3002 -sTCP:LISTEN
ps -fp <PID>
pstree -ap <PID>
```

不要重复运行多个 `nohup pnpm dev`。旧的 `pnpm kill-ports` 已删除；统一使用
`pnpm run restart` 与 `pnpm preview:start/stop`，并在启动后检查监听 PID、健康接口和日志。

## 日志

| 对象 | 命令或位置 |
|------|------------|
| 开发应用 | `tail -f /tmp/oi-dev.log` |
| 优化预览 | `tail -f /tmp/oi-web-preview.log` |
| PostgreSQL | `docker logs -f oi-postgres` |
| go-judge | `docker logs -f oi-judge` |
| 生产 Web / Router / API / Scheduler / Executor / Judge | `journalctl -u 'oi-manager-*'` |

日志可记录请求 ID、用户 ID、资源 ID 和 Judge ID，不应打印 Cookie、JWT、Judge
Token、账号密码或完整源码。

## 数据库

```bash
# 连接与健康
docker exec oi-postgres pg_isready -U oi -d oi_manager
docker exec -it oi-postgres psql -U oi -d oi_manager

# Schema 状态
pnpm --filter server exec prisma validate
pnpm --filter server exec prisma studio
```

任何 `prisma push`、迁移、恢复或维护接口调用前先核对 `DATABASE_URL`。当前开发数据在
`public` schema；测试只能使用 `test/e2e`。

## 贡献奖励与 Evaluation Credits

首次启用经济闭环必须先创建并验证数据库备份，再执行 Prisma `migrate deploy`。迁移检查与系统账户初始化通过服务器离线审计脚本完成：脚本必须输出孤儿 Evaluation Ledger、不平衡 posted 交易、旧预占和系统账户状态；存在阻塞项时立即停止，不得手工改流水。审计通过后先以 `CONTRIBUTION_REWARD_MODE=observe` 启动单例 Scheduler，核对拟发金额与账本不变性，再切换为 `enabled`。HTTP 不提供维护迁移入口。

日常运行中：

- `evaluation_reservations_reconciled` 表示 30 秒对账任务补做了结算/释放或遇到错误。
  对账一轮最多 100 条；孤儿预占有 10 分钟安全窗口。
- `evaluation_reservation_reconciler_failed` 是调度器级失败；应检查 Scheduler、数据库和对应任务终态，
  不要直接改 `availableCredits/reservedCredits`。
- 单日额度按毛发放统计；已冲正奖励仍占用当日额度。`deferred_budget` 属于预期延迟，不是投递故障。
- 奖励连续失败 5 次后停在 `failed`。调查根因后，由超级管理员使用平台贡献审计页或
  `POST /api/platform/contributions/:id/retry-reward` 重入队；不得手工把状态改回 pending。
- 购买响应丢失后必须复用原 `Idempotency-Key`。如同键改了套餐或 Carits 交易载荷，
  `IDEMPOTENCY_KEY_REUSED` 是正确的 fail-closed 结果，不应重置或删除原交易。

对账时最低检查以下不变性：

- 每条 posted Carits 交易至少有两条分录，且分录合计为 0。
- 同一 Carits 幂等键不得对应不同 `requestFingerprint`。
- 当日 Evaluation Credit 账户满足
  `limitCredits + SUM(EvaluationCreditLedgerEntry.amount) = availableCredits`。
- `reservedCredits` 与仍为 `reserved` 的 Reservation 投影一致；已结算/释放记录不得计入当前预占。

## 备份

```bash
mkdir -p /data/backups/oi-manager
docker exec oi-postgres pg_dump -U oi -Fc oi_manager \
  > /data/backups/oi-manager/oi_manager_$(date +%Y%m%d_%H%M%S).dump
tar -C /data -czf /data/backups/oi-manager/storage_$(date +%Y%m%d_%H%M%S).tar.gz \
  oi-manager-data
```

存储目录以实际 `STORAGE_ROOT` 为准；上例目录必须先核对。恢复属于破坏性操作，应先
停写、创建二次备份并在独立数据库演练。

## 磁盘

```bash
df -h
du -xhd1 /data | sort -h
du -xhd1 /data/oi-manager-response-refactor | sort -h
docker system df
```

清理前确认路径和归属。不要删除数据库卷、当前 `STORAGE_ROOT`、测试数据或未知的
未跟踪文件。
