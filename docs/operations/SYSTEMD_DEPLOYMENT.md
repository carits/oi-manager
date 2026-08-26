---
status: current
audience: operations
last_verified: 2026-08-27
source_of_truth: deploy/systemd/*.service and scripts/install-systemd-services.sh
---

# systemd 恢复部署

当前开发服务器使用稳定 Router、蓝绿 API 实例、单例后台 Worker 及两个应用服务：

- `oi-manager-api-router.service`：稳定监听 `127.0.0.1:3002`，每个 HTTP/WebSocket 连接固定转发到活动实例。
- `oi-manager-server@3302.service` / `@3303.service`：蓝绿 API 实例；任一时刻一个活动，另一个用于候选启动。
- `oi-manager-worker.service`：唯一运行 Cron、旧远程提交轮询和 OJ 账号自动验证；持有 PostgreSQL
  session advisory lock，第二个 Worker 无法同时启动。
- `oi-manager-judge.service`：运行 Judge 客户端并自动重连 API。
- `oi-manager-web.service`：运行已发布的 `.next-current` 预览产物，监听 `3000`。

PostgreSQL 与 go-judge 继续由 Docker Compose 管理。应用运行不再依赖 PM2 或 Nix。所有应用服务均以
`ecs-user` 运行，日志进入 journald，异常退出后自动重启，并按当前 3.7 GiB 主机容量设置内存上限。

API slot 仅提供 HTTP/WebSocket 与实例内请求指标，不运行可变后台任务。Cron、远程提交轮询和 OJ 自动
验证只由 Worker 执行；Worker 的 PostgreSQL session advisory lock 是误启动双实例时的第二道保护。

## 安装或修复

先确认构建产物存在，再在服务器执行：

```bash
cd /data/oi-manager-response-refactor
sudo bash scripts/install-systemd-services.sh
```

安装脚本会先启动 3302 并通过 `/api/readiness`，再停用旧的直连 3002 Server，启动稳定 Router，最后
启动单例 Worker 并重启 Judge/Web。脚本不会构建代码，也不会修改数据库。

后续 API 发布使用：

```bash
sudo bash scripts/promote-api.sh
```

脚本在非活动端口启动候选、检查数据库与 Revision 投影 readiness、原子切换 Router 指针，再向旧实例发送
`SIGUSR2`。旧实例停止领取新任务，等待在途 Judge/Hack 后以 1012 关闭 WebSocket，Judge 自动重连新实例；
HTTP 切换完成后只重启一份 Worker。候选未就绪时不会切换。

## 验证

```bash
systemctl --no-pager --full status oi-manager-api-router 'oi-manager-server@*' oi-manager-worker oi-manager-judge oi-manager-web
ss -ltnp | grep -E ':3000|:3002|:3302|:3303'
curl -fsS http://127.0.0.1:3002/api/health
curl -fsS http://127.0.0.1:3002/api/readiness
curl -I http://127.0.0.1:3000/login
curl -fsS http://127.0.0.1:5050/version
sudo journalctl -u oi-manager-worker.service --since '-10 min' --no-pager
docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' oi-postgres oi-judge
```

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
`oi-manager-server@<port>` 启动并通过 readiness，然后重启唯一 Worker。前端继续使用 preview rollback。
不要执行 `docker compose down -v`，否则会删除数据库卷。

前端 Canary 日志固定保存在项目 `.run/oi-web-canary.log`，不使用 `/tmp` 中可能由其他运行身份创建的
固定文件名。这避免 Linux `fs.protected_regular` 在粘滞目录中拒绝跨用户覆盖旧日志。
