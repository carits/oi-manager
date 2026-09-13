---
status: current
audience: operations, development
last_verified: 2026-09-10
source_of_truth: scripts, deploy/systemd/*.service, docker-compose.yml, runtime health endpoints, economy-loop migration and scheduler services

---

## Automated database backup

The versioned backup script writes verified PostgreSQL custom-format archives to
`/data/backups/oi-manager/automatic` by default. It uses a non-blocking lock, an atomic temporary file,
`pg_isready`, and `pg_restore -l` verification before publishing the archive. Retention only deletes matching
automatic `.dump` files in that exact directory; migration/pre-change backups elsewhere are untouched.

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

The production schedule is provided by persistent systemd timers: a database dump at 03:00 and an incremental attachment/testdata snapshot at 03:15, both with 14-day retention. Weekly Sunday 04:00/04:30 jobs restore the newest database and the complete asset snapshot into isolated temporary locations and atomically write mode-600 verification states; missed calendar runs are executed after the host returns. The service monitor rejects disabled/failed timers as well as missing, failed or stale proof. Override the documented `BACKUP_*` and `ASSET_*` variables in the mode-600 operations environment when provisioning. Backup directories are mode 700 and dumps/logs/state are mode 600. A
zero-byte or unverified archive is never promoted to the final filename.
`backup:verify` restores the newest archive into an exact `oi_manager_restore_audit_<pid>` temporary database,
validates the dump SHA-256 and creation-time counts for tables, migrations, users, problems, submissions, files and TestSet Revisions, then removes both the temporary database and copied container archive. Asset verification copies all files and checks every manifest SHA-256. Neither verifier
restores over `oi_manager`.

For an actual disaster restore, select a database dump and an asset snapshot whose `metadata.json.databaseBackupSha256`
matches that dump. Restore the database using the existing guarded `pnpm disaster:restore -- ...` workflow, then restore
the paired assets:

```bash
sudo pnpm disaster:restore:assets -- \
  --snapshot /data/backups/oi-manager/assets/snapshots/snapshot-YYYYMMDDTHHMMSSZ \
  --database-sha256 <the-selected-dump-sha256> \
  --confirm-root /data/oi-manager-response-refactor/apps/server \
  --apply
```

The asset command first performs a full isolated verification, creates a pre-restore asset snapshot, stops application
writes, replaces only the exact `testdata` and `uploads` roots, verifies every file and symlink, and restarts readiness.
If replacement or readiness fails it restores the pre-restore snapshot before restarting services. Never mix an asset
snapshot with a database dump whose SHA-256 does not match its metadata.

## Service monitor

`scripts/monitor-services.sh` checks the loopback optimized preview (`127.0.0.1:3000`), API (`3002`), go-judge
(`5050`), PostgreSQL readiness, the currently served Next.js build, root/data disk usage and automatic-backup age.
It exits non-zero on any failure and records state changes in `.run/service-monitor.state`.
The public `/api/health` contract is versioned JSON with `schemaVersion=1`, `status=ok`, `service=api` and an ISO timestamp.
The monitor parses JSON and validates this contract; it never relies on display text. Compatibility `success/message`
fields remain only for one client release.

```bash
pnpm monitor
sudo pnpm operations:timers:install
systemctl list-timers --all 'oi-manager-*.timer'
journalctl -u oi-manager-operations@monitor.service -n 50 --no-pager
```

The persistent monitor timer runs every five minutes and suppresses repeated healthy lines. Its sandbox reads an optional mode-600
`$HOME/.config/oi-manager/operations.env` before invoking the monitor. Set `MONITOR_ALERT_COMMAND` to
`/data/oi-manager-response-refactor/scripts/send-monitor-alert.sh` and store the HTTPS endpoint in a separate mode-600
file referenced by `MONITOR_ALERT_WEBHOOK_URL_FILE`; the secret URL is read inside Node and is never placed in process
arguments or logs. The alert command must be an absolute executable path; shell fragments are rejected. The command
receives `MONITOR_STATUS` and `MONITOR_MESSAGE` and is invoked only when the state
changes. A failed delivery does not advance the state file, so the next monitor run retries both failure and recovery
notifications.

No external alert channel is configured on the current server, so failures are currently retained in journald and incident evidence. Do not mark external alerting complete until a real recipient has confirmed both an injected
failure and its recovery. `pnpm monitor:verify` uses a loopback HTTP receiver solely to verify payload and retry
contracts; it is not external-delivery evidence.

The legacy `install-*-cron.sh` commands remain only as a rollback path. Do not run Cron and the systemd timers together; `install-operation-timers.sh` removes only the known duplicate entries after a successful monitor execution.

### GitHub off-host uptime workflow

`.github/workflows/external-uptime.yml` provides a five-minute external HTTP probe and a deduplicated GitHub Issue for failure/recovery. It is currently disabled because GitHub refused Run `33290187717` before runner allocation due to account Billing/spending-limit status. Do not describe it as active until Billing is repaired and the following commands succeed:

```bash
gh workflow enable external-uptime.yml
gh workflow run external-uptime.yml --ref main
gh run list --workflow external-uptime.yml --limit 1
gh run watch <run-id> --exit-status
```

After a healthy run, perform one approved failure/recovery injection and confirm the workflow creates exactly one incident Issue and closes it on recovery. If Billing remains unavailable, keep the workflow disabled and use a real external monitor instead.

The monitor also validates rolling API/Judge metrics, browser/security/server error spikes, Judge infrastructure errors,
every required systemd unit, restart deltas, loopback-only restricted ports, database connection/transaction/lock state,
database and asset snapshot/restore proofs, endpoint 5xx/P99 thresholds, stale domain workflows and immutable Revision consistency. On the first
transition into failure it captures a mode-600 incident evidence bundle before alert delivery. Thresholds and the
capture command are configured in `deploy/observability/operations.env.example`; do not disable a check merely to
silence an alert.

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

The complete signal, severity, retention, RTO/RPO and long-term security contract is documented in
[`OBSERVABILITY_SECURITY_STRATEGY.md`](OBSERVABILITY_SECURITY_STRATEGY.md).

The weekly security baseline records an independently hash-checked private report for runtime secret contracts,
stored OJ credential decryption, network exposure, service limits, TLS tooling and production dependencies:

```bash
pnpm security:baseline
pnpm security:baseline:install
cat /data/backups/oi-manager/security-baseline/security-baseline.json
```

The monitor rejects a failed, missing, stale or hash-mismatched report. Detailed reports are mode 600 and retained for
90 days; they contain audit output but never secret values. Every individual check is terminated after
`SECURITY_BASELINE_CHECK_TIMEOUT_SECONDS` (600 seconds by default), and the corresponding report log records an
explicit timeout. A registry or other external dependency outage therefore fails the baseline without leaving a
permanently running audit process. Verify the timeout contract after changing this runner with
`pnpm security:baseline:verify` on Linux.

The baseline invokes only its embedded runtime-limit audit with
`RUNTIME_AUDIT_REQUIRE_MONITOR_SUCCESS=0`. This breaks the circular dependency in which a stale failed baseline makes
the monitor fail while the replacement baseline waits for that monitor to be healthy. Unit definitions, timers,
container limits and every other runtime check remain mandatory. Standalone `pnpm runtime:audit` does not set this
override and still requires the latest monitor operation to have succeeded; run it after the new baseline and monitor
have both completed.
The optimized production preview has no HMR listener; development environments may explicitly set
`MONITOR_HMR_URL=http://127.0.0.1:3001` when HMR is intentionally running. The current host has no SLS Logtail,
CloudMonitor Agent or ECS RAM Role, so cloud contacts, thresholds and log delivery must be provisioned explicitly.

## Off-host log archive

`scripts/archive-operations-logs.sh` creates a bounded archive containing the previous 24 hours of OI Manager systemd
units, PostgreSQL/go-judge Docker logs, the most recent Nginx lines, monitor/backup logs and a build/commit manifest.
The archive and SHA-256 remain in a local spool until `LOG_ARCHIVE_COMMAND` successfully copies them to an off-host
machine or object store and `LOG_ARCHIVE_VERIFY_COMMAND` independently reads the remote object and verifies its size
and SHA-256. Only archives that pass both commands receive an `.uploaded` marker and become eligible for retention
cleanup. A failed verifier leaves the only local copy and checksum untouched.

```bash
mkdir -p "$HOME/.config/oi-manager"
install -m 600 deploy/observability/operations.env.example \
  "$HOME/.config/oi-manager/operations.env"
# Fill in a real HTTPS webhook file plus trusted upload and remote-verification executables.
pnpm monitor:verify
pnpm logs:archive
pnpm logs:archive:install
```

Both commands must be absolute executable files; shell fragments are rejected. They receive `LOG_ARCHIVE_PATH`,
`LOG_ARCHIVE_CHECKSUM_PATH`, `LOG_ARCHIVE_NAME`, `LOG_ARCHIVE_SHA256`, `LOG_ARCHIVE_SIZE` and `LOG_ARCHIVE_HOST`.
The verifier must read or download the remote object rather than trust the uploader's exit status. Credentials belong
in provider-owned mode-600 configuration, never in Git or command-line arguments. A local copy or loopback test is not
accepted as off-host retention evidence.

## Runtime resource audit

After changing Docker Compose or any application systemd unit, run:

```bash
docker-compose config >/dev/null
sudo systemd-analyze verify deploy/systemd/*.service
pnpm runtime:audit
pnpm sandbox:smoke
```

The audit verifies go-judge CPU, memory, PID, NOFILE, read-only root, bounded `/tmp` tmpfs, loopback port and Docker log
rotation, plus the memory, task, file-descriptor, stop-timeout and restart-frequency limits of every application unit.
It intentionally does not inspect or print runtime secrets. Never use `docker-compose down -v`; the old named Judge
scratch volume may be removed only in a separately verified cleanup, while the PostgreSQL volume must be retained.

## Runtime secret audit and rotation

The security audit reports only file metadata, secret lengths and boolean comparisons. It never prints secret values:

```bash
pnpm security:audit
pnpm security:rotate:check
pnpm security:rotate:verify
```

`security:rotate:check` decrypts every stored OJ account in memory and performs no writes. `security:rotate:verify`
restores the newest backup into a uniquely named temporary database, applies a real rotation to a mode-600 temporary
environment file, decrypts every account again with the new key, and removes the database/files through a trap. A production rotation must
first create and verify a database backup, then prove `--apply` against a restored isolated database and a temporary
environment file. The apply path creates a mode-600 environment backup, rotates JWT and the 64-hex AES account key,
re-encrypts OJ passwords with compare-and-swap inside a transaction, and replaces an old deployment symlink with a
mode-600 file in the current repository. Do not print, copy into Git, or include either environment file in logs.

After a successful production apply, immediately blue/green promote the API and restart the singleton Worker. Existing
JWT sessions are intentionally invalidated and users must sign in again. Verify `pnpm security:audit`, both OJ account
decryptions, login, API readiness and Judge authentication before declaring the rotation complete.

## SSH hardening

The repository baseline disables password and keyboard-interactive authentication, keeps public-key authentication,
and limits root to public-key access. The installer refuses to proceed unless the invoking sudo user has an active
`authorized_keys`, correct 700/600 permissions and sudo access; invalid `sshd` configuration is rolled back.

```bash
cd /data/oi-manager-response-refactor
bash -n scripts/install-ssh-hardening.sh
sudo scripts/install-ssh-hardening.sh
ssh -o BatchMode=yes -o PasswordAuthentication=no alias true
sudo sshd -T | grep -E '^(pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries) '
```

## Controlled load smoke

`scripts/load-smoke.sh` provides a bounded read-only concurrency check. For safety it only accepts the explicitly
listed loopback URLs on ports `3000` and `3002`, rejects more than 5,000 requests or concurrency above 100, and
never targets login mutations, submissions, Judge queues or other write operations.

```bash
pnpm load:smoke
LOAD_REQUESTS=1000 LOAD_CONCURRENCY=25 \
  LOAD_URL=http://127.0.0.1:3000/api/platform-bindings/platforms pnpm load:smoke
LOAD_REQUESTS=300 LOAD_CONCURRENCY=15 \
  LOAD_URL=http://127.0.0.1:3000/login pnpm load:smoke
```

The output includes total/success/failed counts, elapsed time, throughput, average, maximum, P50 and P95 latency.
Run the service monitor and inspect application logs after each load smoke. This is a bounded operational smoke,
not a production capacity claim or a substitute for an isolated soak test.

## Dependency security audit

Run the production dependency audit after every dependency or framework update:

```bash
pnpm audit --prod --audit-level low
pnpm build
pnpm --filter server test
pnpm --filter web test
pnpm --filter @oi-manager/judge test
```

The current Web application does not import `next/image`; the optional Sharp dependency is deliberately excluded until
its patched release is supported by the installed Next.js line. Do not remove the pnpm security overrides without first
confirming the resolved lockfile still passes `pnpm audit --prod`.

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

首次启用经济闭环必须采用 expand 迁移，不能跳过受保护的迁移检查：

1. 按发布流程创建并验证数据库备份，再执行 Prisma `migrate deploy`。
2. 只在候选 API slot 临时开启 `ENABLE_MAINTENANCE_API=true`，调用
   `GET /api/admin/migration/economy-loop` 取得检查报告。
3. 报告中存在孤儿 Evaluation Ledger、不平衡的 posted Carits 交易或无法解释的旧预占时停止；
   不得手工改流水绕过检查。
4. 复核报告后将原 `reportHash` 提交给 `POST /api/admin/migration/economy-loop`，
   幂等创建 `REWARD_POOL` 和 `RESOURCE_SINK` 系统账户。
5. 关闭候选 slot 的维护 API，先以 `CONTRIBUTION_REWARD_MODE=observe` 启动单例 Scheduler。
   observe 模式只计数到期奖励，不领取、不入账。
6. 对照贡献事件、待投递数、拟发金额和账本不变性后，再切换为 `enabled` 并重启单例 Scheduler。

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
