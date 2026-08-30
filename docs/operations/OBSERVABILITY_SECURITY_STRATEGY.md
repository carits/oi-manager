---
status: current
audience: operations, development, security
last_verified: 2026-08-30
source_of_truth: scripts/monitor-services.sh, runtime telemetry snapshots, incident evidence tooling, backup and restore drills
---

# 可观测性、事故恢复与长期安全基线

## 目标和边界

本基线保证系统出现延迟、错误、队列阻塞、Judge 断连、数据投影分叉或主机异常时，能够发现、保留证据、
恢复服务并追溯原因。仓库内能力不等于外部能力：真实域名/TLS、异机告警、异机归档和云账号侧监控只有在
所有者提供对应资源并完成故障注入后才可标记完成。

任何遥测都遵守数据最小化原则：不记录密码、Cookie、Authorization、密钥、完整环境变量、用户源码、
测试数据或数据库转储内容。浏览器错误只记录脱敏消息、路由、构建 ID、资源来源和不可逆指纹，原始堆栈只
参与本地指纹计算，不写入结构化日志。

## 信号覆盖

| 层级 | 核心信号 | 持久证据 | 首要恢复动作 |
|---|---|---|---|
| Web | 构建 ID、静态资源可达、浏览器 error/rejection/resource failure | Web journal、客户端错误指纹 | 回切上一 `.next` 构建 |
| API | health/readiness、端点 2xx/4xx/5xx、P50/P95/P99、RSS/Heap、事件循环、审计/安全事件 | `.run/metrics-<port>.json`、journald | Router 回切上一 API slot |
| Scheduler/Executor | 领取、执行、重试、终态、陈旧任务 | operational snapshot、journald | drain 后重启单个执行单元 |
| Judge | WebSocket 连接/认证、最后消息、在途任务、任务耗时、缓存、RSS、事件循环 | `.run/judge-metrics.json`、Judge/go-judge 日志 | 停止领取、重连或受控重启 |
| 数据域 | JudgeRun/Attempt/Batch/Hack/Candidate/OJ Fetch 状态、陈旧记录、Revision 投影差异 | `.run/operational-state.json` | 先取证，再按状态机恢复 |
| 数据库 | readiness、连接利用率、长事务/锁等待、容量、备份新鲜度、真实恢复校验 | verified custom dump、`restore-verification.json`、恢复演练报告 | 按 DR 手册恢复到隔离库并校验 |
| 主机 | 磁盘/inode/内存/进程/端口暴露/重启/内核、全部 systemd 单元及 restart delta | incident evidence bundle | 隔离故障单元，禁止盲目清理数据 |
| 安全 | SSH、Session/CSRF、文件权限、Secret 长度与轮换可行性、依赖漏洞 | security audit、配置哈希、SSH journal | 收敛入口、吊销/轮换、保留证据 |

## 快照契约

快照使用原子临时文件 + rename 写入，权限为 `0600`。Schema 通过 `schemaVersion` 演进；消费者必须拒绝
过期、缺字段或无法解析的快照，不能把“没有数据”解释为健康。

- API：活动蓝绿端口对应 `.run/metrics-3302.json` 或 `.run/metrics-3303.json`。
- Judge：`.run/judge-metrics.json`。
- 业务状态：`.run/operational-state.json`。

API 使用 5 分钟滚动窗口，Judge 使用 1 分钟滚动窗口；窗口结束时把状态族、延迟、错误、安全事件、客户端
错误、基础设施重试和连接异常写入快照与结构化日志，然后清空窗口计数。这样单次事故会在下一窗口恢复，
不会永久污染进程生命周期比例。长期趋势由结构化日志和异机归档承担；未来接入 Prometheus/云监控时必须
保留相同字段语义，避免出现第二套定义。

## 告警等级和默认阈值

| 等级 | 条件 | 响应目标 | 处理原则 |
|---|---|---|---|
| SEV-1 | 数据不可用/可能损坏、数据库不可达、全站不可用、疑似密钥泄漏 | 5 分钟确认，15 分钟开始恢复 | 立即冻结变更、自动取证、通知所有者 |
| SEV-2 | API/Judge 持续不可用、任务陈旧、Revision 投影不一致、备份失效 | 15 分钟确认，30 分钟缓解 | 优先恢复服务，再完成根因分析 |
| SEV-3 | 单端点 5xx/高延迟、资源接近阈值、外部 OJ/AI 故障 | 4 小时内分诊 | 记录影响范围和趋势，安排修复 |
| SEV-4 | 非阻断安全/依赖提醒、容量趋势、低频客户端错误 | 下个维护窗口 | 纳入待办和复核周期 |

默认机器阈值由 `deploy/observability/operations.env.example` 记录：快照新鲜度、API/Judge RSS、事件循环
P99、端点最小样本、5xx 比例、端点 P99、浏览器/安全/服务端错误、Judge 基础设施错误、业务队列、数据库
连接/长事务/锁等待、备份与真实恢复年龄、systemd 重启、实际进程 `NODE_ENV=production`、磁盘和 inode。受限端口必须只监听回环地址，新增
公网监听必须进入显式允许清单。阈值只能依据至少一周的真实基线调整，
调整必须在变更记录中说明原因。监控使用稳定检查码而不是动态错误正文生成状态指纹；同一故障的年龄、计数或底层错误文本变化不会重复取证和通知。一次失败集合转换只发一次故障/恢复通知；通知失败不推进状态，从而自动重试。

## 自动事故取证

监控第一次从健康转为失败时，在发送告警前执行 `capture-incident-evidence.sh`。证据包包含：

- commit、Web 构建 ID、活动 API slot、原因和时间；
- 主机资源、监听端口、进程、重启和内核证据；
- 应用与基础设施 systemd 状态/journal、Docker 状态/日志；
- health/readiness、SLO、投影、运行态和安全审计；
- API/Judge/业务状态快照；
- 网络暴露审计、systemd/Nginx 配置哈希、备份清单和最近真实恢复状态。

证据包不包含环境文件、凭据、数据库内容、源码提交内容或测试数据。包内文件有独立校验清单，包外有
SHA-256；文件权限为 `0600`。自动取证失败不能阻止告警，但必须在监控日志中显式报告。

标准人工流程：

```bash
cd /data/oi-manager-response-refactor
INCIDENT_REASON='简短、无秘密的原因' pnpm incident:capture
pnpm incident:verify
```

## 恢复目标和决策

- Web/API 配置或版本回归：RTO 15 分钟，使用已有构建/蓝绿 slot 原子回切；不先做数据库回滚。
- Judge/Scheduler/Executor：RTO 30 分钟；先停止领取新任务，保留在途状态和证据，再受控重启。
- PostgreSQL：目标 RPO 24 小时（当前每日备份），RTO 4 小时；上线异地 WAL/更高频备份后再提高目标。
- 附件与测试数据：目标 RPO 24 小时，数据库备份后 15 分钟创建增量快照；每个快照固定关联数据库 dump 哈希，恢复时必须成对验证，不能只恢复数据库。
- 测试数据/Revision 对象：以不可变对象、Revision 引用和数据库备份联合恢复，禁止从活动快照猜测重建。
- 安全事件：先隔离入口和保留证据，再轮换 JWT/AES/OJ 凭据；轮换会话影响必须明确通知。

任何恢复都先在隔离库/候选 slot 验证。不得使用 `git reset --hard`、`docker-compose down -v`、删除数据库
volume、覆盖当前数据库或批量重测来“试试看”。恢复后依次验证 readiness、投影、业务状态、Judge 认证、
真实登录和关键只读流程。

## 保留与销毁

| 数据 | 建议保留 | 删除条件 |
|---|---:|---|
| systemd/Docker 本机日志 | 7–14 天（受磁盘上限约束） | 已归档且远端独立读回校验成功 |
| 每日数据库备份 | 14 天 | 新备份通过 `pg_restore -l` 且保留策略命中；目录 `0700`、文件 `0600` |
| 每日附件/测试数据快照 | 14 天增量硬链接快照 | 快照清单、文件总数、字节数和关联数据库备份 SHA-256 均一致，且每周完整复制到隔离目录恢复成功 |
| 事故证据包 | 90 天；SEV-1/安全事件 1 年 | 所有者确认 RCA/合规要求结束且校验无误 |
| 监控快照 | 仅当前原子快照 | 新快照替换；长期趋势来自归档日志 |
| 浏览器错误指纹 | 随应用日志策略 | 不得转存原始堆栈/凭据 |
| 周安全基线报告 | 90 天 | 新报告、状态和 SHA-256 均验证成功后按明确文件模式清理 |

删除只能针对明确目录和明确文件模式。异机上传成功本身不足以删除本地副本，必须由独立 verifier 下载或读取
远端对象并核对大小和 SHA-256 后才创建 `.uploaded` 标记。

## 长期安全周期

### 每次发布

```bash
pnpm security:verify
pnpm network:audit
pnpm operations:check
pnpm monitor
pnpm docs:check
```

发布必须记录 commit、构建 ID、API slot、三端测试和监控结果。涉及数据库、认证、文件或 Judge 的变更需增加
定向故障测试。浏览器客户端错误的突增必须按 build ID 回溯。

### 每周

- 检查监控失败/恢复通知、systemd restart delta、端点错误与延迟、队列陈旧、数据库连接/锁、磁盘/inode 和备份年龄。
- 每周日自动把最新备份恢复到隔离临时数据库，按创建时清单核验表、迁移、用户、题目、提交、文件和 TestSet Revision 计数；随后完整复制附件与测试数据快照到隔离目录并逐文件核验 SHA-256，清理临时资源后原子更新两个私有恢复状态。
- 复核客户端错误指纹前十和新出现的资源加载失败。
- 运行生产依赖审计并对可利用性分级，不能只按 CVE 数量判断。
- 周一自动执行运行时安全契约、OJ 密文解密、网络暴露、资源限制、TLS 工具和生产依赖审计；结果、逐项日志和 SHA-256 以 `0700/0600` 私有报告保存并受监控。
- 确认本地日志归档确实由远端 verifier 读回。

### 每月

- 执行一次包含核心业务的扩展恢复演练，并复核每周隔离恢复记录；执行一次故障/恢复告警注入。
- 抽查事故证据包校验与恢复手册可执行性。
- 复核管理员账号、SSH key、OJ 绑定、系统服务权限、端口暴露和安全响应头。
- 审查容量趋势与阈值，任何调整进入变更记录。

### 每季度

- 完整 DR 演练（数据库 + 不可变测试对象 + Web/API/Judge）。
- 轮换或验证 JWT/AES/OJ 凭据轮换流程；撤销离职/不再需要的访问。
- 进行权限矩阵、CSRF/TLS/CSP、依赖供应链、文件上传、SSRF 和 Judge 沙箱威胁复审。
- 复核 RTO/RPO 是否由真实演练支撑。

## 尚需外部资源的事项

以下不能由仓库代码自行完成，并必须保持显式未完成状态：

1. 域名、有效证书、HTTPS Nginx 切换、HSTS/Secure Cookie/严格 Origin 正式启用。
2. 真实异机告警接收人及故障/恢复双向确认。
3. 真实异机或对象存储日志目标和独立远端校验器。
4. 云账号内的 CloudMonitor/RAM Role/安全组和磁盘快照策略。
5. 高于每日备份 RPO 的 WAL 归档或托管数据库能力。

这些事项完成前，系统具备本机发现、证据和恢复能力，但不能宣称具备完整的 Production v1 异地保障。
