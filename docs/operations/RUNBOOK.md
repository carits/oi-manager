---
status: current
audience: operations, development
last_verified: 2026-08-27
source_of_truth: scripts, deploy/systemd/*.service, docker-compose.yml, runtime health endpoints

---

## Automated database backup

The versioned backup script writes verified PostgreSQL custom-format archives to
`/data/backups/oi-manager/automatic` by default. It uses a non-blocking lock, an atomic temporary file,
`pg_isready`, and `pg_restore -l` verification before publishing the archive. Retention only deletes matching
automatic `.dump` files in that exact directory; migration/pre-change backups elsewhere are untouched.

```bash
cd /data/oi-manager-response-refactor
bash -n scripts/backup-db.sh scripts/install-backup-cron.sh
scripts/backup-db.sh
pnpm backup:verify
scripts/install-backup-cron.sh
crontab -l
tail -n 50 /data/backups/oi-manager/automatic/backup.log
```

Default schedule is daily at 03:00. Override with `BACKUP_SCHEDULE`, `BACKUP_DIR` and
`BACKUP_KEEP_DAYS` when provisioning. A zero-byte or unverified archive is never promoted to the final filename.
`backup:verify` restores the newest archive into an exact `oi_manager_restore_audit_<pid>` temporary database,
validates tables, migrations and users, then removes both the temporary database and copied container archive. It never
restores over `oi_manager`.

## Service monitor

`scripts/monitor-services.sh` checks the optimized preview (`3000`), API (`3002`), go-judge
(`5050`), PostgreSQL readiness, the currently served Next.js build, root/data disk usage and automatic-backup age.
It exits non-zero on any failure and records state changes in `.run/service-monitor.state`.

```bash
pnpm monitor
pnpm monitor:install
crontab -l
tail -n 50 /data/backups/oi-manager/monitor.log
```

The cron installer runs every five minutes and suppresses repeated healthy lines. Set `MONITOR_ALERT_COMMAND` to a
trusted local command when an external mail/webhook integration is provisioned; it receives `MONITOR_STATUS` and
`MONITOR_MESSAGE` and is invoked only when the state changes. No external alert channel is configured on the current
development server, so cron failures are currently retained in the local monitor log.
The optimized production preview has no HMR listener; development environments may explicitly set
`MONITOR_HMR_URL=http://127.0.0.1:3001` when HMR is intentionally running. Aliyun CloudMonitor/Aegis agents are
installed on the current host, but alert contacts and thresholds must still be verified in the cloud console.

## Runtime resource audit

After changing Docker Compose or any application systemd unit, run:

```bash
docker-compose config >/dev/null
sudo systemd-analyze verify deploy/systemd/*.service
pnpm runtime:audit
```

The audit verifies go-judge CPU, memory, PID, NOFILE, read-only root, bounded `/tmp` tmpfs, loopback port and Docker log
rotation, plus the memory, task, file-descriptor, stop-timeout and restart-frequency limits of every application unit.
It intentionally does not inspect or print runtime secrets. Never use `docker-compose down -v`; the old named Judge
scratch volume may be removed only in a separately verified cleanup, while the PostgreSQL volume must be retained.

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

`3000` 只允许优化预览进程监听，`3001/3002` 只允许一组 HMR/Server 开发进程监听。
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
| PM2 模板 | `pm2 logs` |

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
