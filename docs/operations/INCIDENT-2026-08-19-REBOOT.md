---
status: current
audience: operations, development
incident_date: 2026-08-19
last_verified: 2026-08-19
last_updated: 2026-08-28
source_of_truth: journald, systemd units, deployment logs, cloud audit records
severity: service interruption
---

# 2026-08-19 服务器异常重启事故记录

## 摘要

2026 年 8 月 19 日，`oi-manager` 所在 ECS 在旧启动周期结束后出现异常重启。服务器重启完成后，应用没有自动恢复，导致 Web、API 和 Judge 暂时不可用。当前已恢复服务，并将应用进程从失效的 PM2/Nix 启动链迁移到仓库内可追踪的 systemd units。

## 时间线（东八区）

| 时间 | 事件 |
|---|---|
| 2026-08-19 14:02:17 | 旧启动周期非正常结束；没有发现正常关机记录 |
| 2026-08-19 14:02–14:18 | 主机处于重启/不可用窗口 |
| 2026-08-19 14:17:43 | 新启动周期开始 |
| 新启动阶段 | `/dev/vdb` 出现 `recovering journal` 并清理 orphaned inode；EFI 分区报告 `Fs was not properly unmounted` |
| 重启后 | 旧 `pm2-root.service` 因指向不存在的 Nix 路径，返回 `203/EXEC`，应用未自动恢复 |
| 处置后 | API、Web、Judge、PostgreSQL、go-judge 恢复正常 |

## 已确认事实

- 文件系统恢复信息表明上一次关机没有完成正常卸载。
- 事故窗口未发现 OOM、kernel panic、磁盘 I/O error、硬件错误或正常 shutdown 记录。
- 评测沙箱中选手程序的 `main` 段错误只属于单个评测进程失败，不能解释整台 ECS 重启。
- 服务器内部日志只能确认“异常掉电或强制 reset”，无法区分云控制台操作与阿里云基础设施事件。
- 重启后应用未恢复是独立的启动配置问题，不应与主机重启原因混为一谈。
- 2026-08-28 复核确认 CloudMonitor 4.0 Agent 正常向阿里云发送 63 项主机指标，心跳和指标累计均无发送错误；但云端下发的进程、HTTP、脚本探测配置全部为空，主机也没有 RAM Role，因此 Agent 本身不能证明告警联系人、阈值或实例事件审计已经配置。
- `journalctl --list-boots` 再次确认旧 boot 最后边界为 14:02:17，新 boot 为 14:17:43；`last -xF` 没有对应 shutdown 记录。关机前最后可用内核日志停在 13:53:05，未发现 OOM、panic、I/O error、watchdog、thermal 或 hung-task 证据。

## 当前结论

事故的直接表现是 ECS 非正常重启，最可能的类别是异常掉电或强制 reset；仅凭现有主机日志无法进一步归因。需要结合阿里云实例事件和操作审计才能确认是否存在人工操作或平台侧事件。

应用未自动恢复的原因已经定位：旧 `pm2-root.service` 写死了已不存在的 Nix 可执行路径，systemd 因 `203/EXEC` 启动失败。现已使用仓库中的 `deploy/systemd/*.service` 和 `scripts/install-systemd-services.sh` 管理 API、Judge、Web。

## 已完成处置

- [x] 确认主机重启前后启动周期和文件系统恢复证据。
- [x] 排除 OOM、kernel panic、磁盘 I/O 错误等现有日志证据。
- [x] 停用失效的 `pm2-root.service` 启动链。
- [x] 部署仓库内的 `oi-manager-server.service`、`oi-manager-judge.service`、`oi-manager-web.service`。
- [x] 验证 PostgreSQL、go-judge、API、Judge 和 Web 均已恢复。

## 后续待办

以下事项暂不在本次事故记录阶段执行，后续逐项处理：

- [ ] **核对阿里云事件与审计**：检查 2026-08-19 14:02–14:18（+08:00）的 ECS 实例事件、系统事件、运维编排和操作审计，确认是否为人工重启、自动运维或平台故障。
- [ ] **建立独立主机监控**：阿里云 CloudMonitor/Aegis Agent 已启用且指标发送正常，本地每 5 分钟检查服务、数据库、go-judge、备份、磁盘和构建；云端当前没有下发进程或 HTTP 探测，仍需在云控制台配置并复核告警联系人、阈值和主机重启通知。
- [ ] **持久化事故日志**：将 journald、Docker、部署日志转发到独立存储，并保留跨重启的审计时间线。
- [ ] **完善启动恢复演练**：在维护窗口执行一次受控重启，验证 systemd 启动顺序、Docker 自启、健康检查和失败自动重启。
- [x] **治理评测沙箱资源**：go-judge 已设置 CPU、内存、PID、NOFILE、只读根、临时盘和日志轮转上限；应用 systemd units 已设置任务数、文件描述符、停止超时和重启频率保护，并由运行时审计阻止配置漂移。
- [x] **检查 SSH 暴露面**：`ecs-user` 公钥与目录权限已校验，密码和键盘交互登录已关闭，root 仅允许公钥，`MaxAuthTries=4`；新建 BatchMode 连接和 `sshd -t` 均通过。云安全组仍随阿里云事件审计一并复核。
- [x] **补充备份与恢复演练**：自动备份已恢复为每日执行，并在隔离临时数据库完成完整恢复与清理；
  覆盖正式库的灾难演练仍需单独维护窗口授权。
- [x] **统一部署入口**：Web、稳定 API Router、蓝绿 API slot 和 Judge 已统一使用仓库脚本与 systemd，
  不再依赖个人环境路径、PM2、Nix 或常驻 `pnpm dev`。
- [x] **修复容器启动链**：PostgreSQL 与 go-judge 均设置 `unless-stopped`；API、Worker 和 Judge 显式依赖 Docker，并在启动前等待数据库健康，Judge 额外等待 go-judge 与稳定 API readiness，防止主机启动顺序竞争耗尽 systemd 重试额度。

## 复核记录

完成上述云平台审计和重启演练后，更新本文件的 `status`、`last_updated`、当前结论及待办复选框。相关运行命令见 [`RUNBOOK.md`](RUNBOOK.md) 和 [`SYSTEMD_DEPLOYMENT.md`](SYSTEMD_DEPLOYMENT.md)。
