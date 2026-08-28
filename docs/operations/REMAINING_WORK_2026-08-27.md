---
status: current
audience: development, operations
last_verified: 2026-08-28
source_of_truth: remote main worktree, production runtime inspection, current test and deployment scripts
---

> 2026-08-29 最新路由边界：60 个 adapter，Prisma 66 / transaction 5 / filesystem 14 / Judge Runtime 0。题目 AI 翻译、格式化和用量查询已迁入 application service；AI 结果与用量日志同事务写入，并以题目动作级锁及事务内重复检查防止并发重复版本。正文中的 83/5/14 是本轮开始时快照，以本注的 66/5/14 为当前值。
>
> 同日全局评测记录路由完成收口，当前进一步降至 Prisma 50 / transaction 5 / filesystem 14 / Judge Runtime 0；管理员全平台可见性和校园/个人隔离均已通过定向回归。

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

### 0. 架构收口

- [x] `Submission + JudgeRun + JudgeAttempt + RejudgeBatch` 已完成安全增量建模、dual-write、读写切换和陈旧回传 fencing；历史 `Submission` 执行字段暂作兼容投影。
- [x] Judge 和 Hack 核心流程均通过领域状态机 + CAS 转换，陈旧回传不能跳过所有权状态或复活终态。
- [x] Hack 技术判定与 `TestcaseCandidate` 晋升已分离；Revision/Testdata 内容已使用 `BlobStore` port，本地实现可直接替换 S3/OSS adapter。
- [x] Scheduler 单例和 Executor 可并行任务已分离，生产 systemd 中两类进程独立运行。
- [x] 架构模型、路由、systemd 和环境变量清单由脚本生成并由 `architecture:check` 校验。
- [ ] `routes/` Strangler 仍有存量债务：当前 60 个 adapter 中基线为 Prisma 83 / transaction 5 / filesystem 14 / Judge Runtime 0。认证、题目 CRUD/详情/题库创建者/Hack 配置与记录/Judge Config/Checker/个人题面题解/多题面版本、题库提交/笔记/TestSet Revision/Test Graph、活动根作用域/CRUD/概览/内容读取/内容快照选择与编辑/多题面矩阵/提交/题目完整读写/笔记/比赛记录/排名/TestSet 更新、OJ 账号池、OJ Fetcher、平台绑定、Organization 成员、管理员数据维护、超级管理员学校治理、Dashboard、Workspace、全局 User、用户归档题目、团队题单、通知、贡献统计、Carits 币、全局排名和测试数据管理已迁入 application/query service；对应已迁移路由不再直接持久化。题目创建/更新与官方题面、题解版本现在同事务写入，Hack 配置使用 revision CAS 防止并发覆盖，Checker 替换/删除使用可回滚文件提升且拒绝伪装二进制源码，个人 PDF 写入失败会回收新文件且公开个人题面仍受原题目校园边界约束；活动自然结束的状态更新与比赛提交公开已使用同一事务，补题复制失败会回滚活动和复制文件，单题内容读取按活动与题目联合归属校验，内容 PDF 上传失败会回收临时文件和新文件，多题面矩阵用 selection revision 拒绝陈旧覆盖并在事务竞争时再次校验，测试版本更新在 Serializable 事务中执行冻结检查。OJ Fetcher 旧持久化与 API 内后台执行已删除。新增债务已阻断。
- [ ] `Submission` 兼容执行投影字段需经过至少一个稳定观察周期后才能删除；当前生产首次对账为 2518 条、0 差异、0 条无 Run 本地提交，且已纳入 5 分钟监控。观察期内不做破坏性清理。

### 1. 隔离写入、并发与长稳压测

- [x] 真实 go-judge 连续完成 30 轮、每轮 100 条本地提交，3000/3000 Accepted；每轮均验证无卡住任务和沙箱文件归零。
- [x] 100 路首次 Revision 创建复用同一个赢家，100 路同基线发布只有一个 CAS 成功且无 pending 目录。
- [x] Hack 并发晋升和相同输入重试去重已有定向事务测试；失败竞争者安全回到队列，不生成半成品文件。
- [x] 系统程序编译缓存 500 个并发租约只编译一次，引用计数从 500 回到 0 并完成产物清理。
- [x] 比赛范围重测与普通提交竞争已通过隔离 E2E：20 个并发重测只重置原有 3 条一次，正常提交保留为第 4 条；重测与 Judge 回传竞争不会留下 `judging`，旧回传不能覆盖终态。
- [x] Test Graph 保存与 Hack 晋升竞争、CAS 冲突及冲突后重排/去重 5/5 通过；只生成一个下一 Revision，不残留 pending 文件或重复 Testcase。
- [x] 单实例定向测试和双 API 隔离栈各执行 100 个并发 finalization；重复/旧 Judge 回传不能覆盖终态，成绩同步只发生一次。
- [x] 压力工具已记录逐提交端到端延迟；100/100 Accepted，P50 29990ms、P95 50925ms、P99 52932ms、最大 52945ms，API/Judge RSS 增量为 0 且沙箱文件归零。

### 2. Judge、容器和应用安全边界

- [x] go-judge 已补齐 CPU、内存、PID、NOFILE、只读根、512 MiB 临时盘和 Docker 日志轮转上限；题目级时间、内存、输出和文件大小限制继续由 Judge 配置强制。
- [x] 保留 go-judge 建立 cgroup 沙箱所需的 `privileged`，同时启用只读根和 `no-new-privileges`；隔离真实评测与生产运行时审计均通过。进一步移除 capability/seccomp 例外需要更换沙箱实现，不能在保留当前 go-judge cgroup 模式时伪装完成。
- [x] Router、API、Worker、Judge、Web 已补齐 `TasksMax`、`LimitNOFILE`、停止超时和 60 秒/10 次重启频率保护。
- [x] 不输出原文的安全审计已验证 JWT、Judge 和账号加密密钥均为 64 字符、互相独立、Judge Token 一致，两个环境文件及备份为 mode 600；两个 OJ 账号已事务重加密并完成二次解密。
- [x] CORS 已固定为当前单一 HTTP 来源且无通配符；PostgreSQL、go-judge、Router 和蓝绿 API 均只监听回环地址。
- [ ] Cookie Secure、CSRF 最终跨域复验和 CSP Report-Only/严格策略必须与 HTTPS/TLS 一起完成。

### 3. 外部告警、日志与故障注入

- [ ] 接通 `MONITOR_ALERT_COMMAND` 的真实外部通知，并验证故障与恢复消息。
- [x] 告警适配器和失败重试契约已完成：URL 从 mode-600 文件读取，failed/recovered 回环 HTTP 通过；没有真实收件人时不标记外部送达完成。
- [ ] 在云控制台复核告警联系人、阈值、主机重启通知和安全组。
- [ ] 将 journald、Docker、Nginx 与部署日志复制到异机或对象存储，配置明确保留期。
- [x] 日志采集、manifest、SHA-256、本地 spool、可信上传命令和“仅清理已上传归档”已实现并通过独立目录验收；仍需真实异机/对象存储凭据完成最终一跳。
- [x] 已在隔离栈注入 API、Worker、Judge WebSocket、go-judge 和 PostgreSQL 连接故障；任务不丢失、不误判，Worker/Judge 自动恢复，本地 failed/recovered 通知契约生效。真实外部通知仍由本节第一项跟踪。

### 4. 全新安装迁移链

- [x] 未修改任何历史 migration 或校验和；新增仅空库可用的事务 bootstrap，使用当前 Prisma Schema、Prisma 无法表达对象 supplement 和每个历史 SQL 原始 SHA-256 建库。
- [x] 全新空库完成 79 张表、29 个唯一 migration、32 个种子用户；正式 14MiB 备份恢复库完成正常 `migrate deploy/status` 后为 32 条迁移记录和 20186 个用户。
- [x] 两条路径的 `public` 规范结构签名完全一致，覆盖表、列、默认值、约束、部分索引、Enum、函数、触发器、序列、视图与 RLS；正式非空库调用 bootstrap 在任何 DDL 前被拒绝。
- [x] API、Judge、Hack 与 Revision 的跨进程写入已纳入蓝绿和故障注入验收：同一 Hack 结果并发到达两个 API 进程只晋升一个 Revision；PostgreSQL 断连期间 Hack 最终化自动重试，恢复后只生成一个 Testcase/Revision，且无 pending 文件。证据见 `CROSS_PROCESS_CONSISTENCY_2026-08-28.md`。

### 5. 蓝绿、恢复与整机演练

- [x] 在独立 e2e schema/端口/go-judge 中验证候选 slot、readiness、Router 原子切换、Judge 1012 重连、Worker 单例锁、旧实例 drain、失败回滚和 50 次客户端 RST；生产随后完成 3302→3303 提升、新 Router 成功重启和 Judge 自动重新注册。
- [x] 最新正式备份已恢复到独立 PostgreSQL 容器/15435；恢复数据只读检查和隔离 `e2e` 写入层的登录、权限、真实 Judge、Hack 晋升、Revision 固定/更新/冻结 2/2 通过，详见 `RESTORE_DRILL_2026-08-28.md`。
- [x] 受控 ECS 重启已完成：Docker/PostgreSQL/go-judge/Router/API/Worker/Judge/Web/云 Agent 自动恢复，稳定 API/Web 端到端 RTO 48 秒，详见事故文档和 `STATUS.md`。
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

当前仍需外部账号、目标、域名或破坏性授权的输入与主机侧证据，统一记录在 `EXTERNAL_DEPENDENCIES_2026-08-28.md`。
