---
status: current
audience: development, operations
last_verified: 2026-08-27
source_of_truth: remote main worktree, production runtime inspection, current test and deployment scripts
---

# 未完成事项执行总表（2026-08-27）

本文件是当前收口阶段的唯一未完成事项清单。已经完成的业务能力不在这里重复规划；历史聊天、归档计划和旧测试快照不能替代本表。

## 执行规则

- 远程 `/data/oi-manager-response-refactor` 的 `main` 分支是唯一项目事实源。
- 每个批次都要完成相关测试、文档、Git 提交、远程推送和线上部署或明确说明无需部署。
- 生产数据只允许只读验收；写入、Judge、Hack 和 Revision 压测使用独立 E2E schema、端口与存储。
- 整机重启、正式库覆盖恢复、云控制台审计和域名/TLS 需要单独维护窗口或云平台权限。

## 已完成的线上动态验收

- [x] 超级管理员严格只有 `/admin` 工作区。
- [x] 平台管理员严格只有 `/platform-admin` 工作区，并能读取 `scope=all` 的全局评测记录。
- [x] `teacher1` 可进入第一中学组织工作区。
- [x] 1158 IOI 排名可从 `oi20260815_07` 的 A 题打开提交列表和 #3678 详情；列表和详情显示分数、Subtask 与测试点得分。
- [x] 1157 ACM 排名可从同一用户的 A 题打开提交列表和 #3677 详情；列表和详情不显示测试点分值。
- [x] 两级弹窗按 Escape 逐层关闭，页面根滚动被锁定，无页面横向溢出、控制台 error、page error 或 5xx。

上述验收由 `e2e/live/role-workspaces.spec.ts` 与 `e2e/live/contest-20260815.spec.ts` 直接访问公网 3000 完成，不写生产数据。

## 待完成批次

### 1. 隔离写入、并发与长稳压测

- [x] 真实 go-judge 连续完成 30 轮、每轮 100 条本地提交，3000/3000 Accepted；每轮均验证无卡住任务和沙箱文件归零。
- [x] 100 路首次 Revision 创建复用同一个赢家，100 路同基线发布只有一个 CAS 成功且无 pending 目录。
- [x] Hack 并发晋升和相同输入重试去重已有定向事务测试；失败竞争者安全回到队列，不生成半成品文件。
- [x] 系统程序编译缓存 500 个并发租约只编译一次，引用计数从 500 回到 0 并完成产物清理。
- [ ] 比赛范围重测与普通提交同时发生时的重复入队、结果覆盖和统计一致性。
- [ ] Test Graph 保存与 Hack 晋升竞争、CAS 冲突及自动重试。
- [ ] 单实例和双 API 实例各执行 100 个并发 finalization，证明没有 lost update 或重复入队。
- [ ] 在压力工具中补充逐提交延迟分位数；现有 29 分钟长稳报告已记录吞吐、成功率、RSS 与 go-judge 文件数量。

### 2. Judge、容器和应用安全边界

- [x] go-judge 已补齐 CPU、内存、PID、NOFILE、只读根、512 MiB 临时盘和 Docker 日志轮转上限；题目级时间、内存、输出和文件大小限制继续由 Judge 配置强制。
- [x] 保留 go-judge 建立 cgroup 沙箱所需的 `privileged`，同时启用只读根和 `no-new-privileges`；隔离真实评测与生产运行时审计均通过。进一步移除 capability/seccomp 例外需要更换沙箱实现，不能在保留当前 go-judge cgroup 模式时伪装完成。
- [x] Router、API、Worker、Judge、Web 已补齐 `TasksMax`、`LimitNOFILE`、停止超时和 60 秒/10 次重启频率保护。
- [ ] 仅检查 JWT、Judge 和账号加密密钥的存在、长度与独立性，不输出原文。
- [ ] 验证生产 CORS、Cookie/CSRF 和公网端口；CSP 先以 Report-Only 方式清理兼容问题。

### 3. 外部告警、日志与故障注入

- [ ] 接通 `MONITOR_ALERT_COMMAND` 的真实外部通知，并验证故障与恢复消息。
- [ ] 在云控制台复核告警联系人、阈值、主机重启通知和安全组。
- [ ] 将 journald、Docker、Nginx 与部署日志复制到异机或对象存储，配置明确保留期。
- [ ] 注入 API、Worker、Judge WebSocket、go-judge 和数据库短时故障，证明不丢任务且恢复告警生效。

### 4. 全新安装迁移链

- [ ] 在不修改已执行 migration 校验和的前提下处理 `20260429_rename_to_id_v2` 空库重放问题。
- [ ] 验证全新空库安装和现有生产备份升级两条路径。
- [ ] 对两条路径运行 Prisma、种子、API、Judge、Hack 与 Revision 集成测试，并比较最终 Schema。

### 5. 蓝绿、恢复与整机演练

- [ ] 验证候选 slot、readiness、Router 原子切换、Judge 1012 重连、Worker 单例锁、旧实例 drain 和失败回滚。
- [ ] 再次从正式备份恢复到隔离库并运行核心业务与评测检查。
- [ ] 获得维护窗口后执行受控 ECS 重启，验证所有服务自动恢复和实际恢复时间。
- [ ] 获得明确授权后执行覆盖正式库的灾难恢复演练。
- [ ] 通过阿里云实例事件和 ActionTrail 核对 2026-08-19 重启原因。

### 6. 正式入口

- [ ] 获得域名、DNS 和证书后配置 TLS、HTTP 跳转、Secure Cookie 与 HSTS。
- [ ] 完成严格 CSP 后重新执行公网浏览器、安全头和跨域验收。

## 明确不作为缺陷修复的历史数据

- 8 个没有本地测试数据、Judge Config 或本地提交的历史 HDU/洛谷活动题继续返回 `LOCAL_JUDGE_NOT_CONFIGURED`，不能伪造 Revision。
- 无法证明历史评测版本的远程归档和旧个人提交保持 `legacy unpinned`。
- 交互题、通信题和提交答案题的 ACM 失败后提前停止属于后续性能优化，不影响当前判定正确性。

## 完成条件

本表所有适用项必须有当前代码、测试输出、运行时记录或云平台证据。需要外部权限的事项只有在实际执行并记录后才能勾选，不能用“已设计”或“已有脚本”代替完成。
