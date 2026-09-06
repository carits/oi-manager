---
status: current
audience: development, operations
last_verified: 2026-09-05
source_of_truth: package.json, deploy/systemd/*.service, deploy/systemd/*.timer, docker-compose.yml, Prisma schema, Playwright configuration
---

- 2026-09-06: 一对一聊天动作级验证已收口并部署：E2E 使用 `chat_sender/chat_receiver/chat_outsider` 隔离账号执行搜索、联系申请、SSE 接收、接受、建会话、发送、未读、回复、已读和刷新恢复，并在浏览器移除 `crypto.randomUUID` 验证 HTTP 降级；响应已成功但客户端收到 503 时保留草稿并复用幂等键，数据库只落一条消息。修复普通全局 `user` 被账号/个人页面权限壳错误重定向的问题。生产发布探针使用两个无组织/团队、不可被发现的专用账号，候选和正式 Web 均真实完成发送、SSE 接收、回复与已读闭环。Server 73 文件/588 用例、Chat 19/19、四项竞态 10 轮、Web 64/64、Chromium 桌面 8/8、紧凑视口 7/7、Firefox 8/8、三端构建及 UI/API/架构/文档门禁通过；提交 `4037aea` 已推送，Web BUILD_ID `QdHV_MBCtFlhP4XDwex_m` 已提升。

- 2026-09-05: 修复并部署 HTTP 环境私信发送无响应：生产客户端遥测确认 `crypto.randomUUID is not a function`，且 teacher1/teacher2 会话已创建但消息和事件均未落库。消息及其他浏览器幂等请求改用兼容 HTTP 的 `createClientUUID()`，发送异常保证恢复 loading 并显示错误；Web 63/63、生产构建及 UI/文档/架构门禁通过。提交 `476a66f` 已推送，Web BUILD_ID `v_dHMnaNbaYLtspzJb-VK` 已提升。

- 2026-09-05: 一对一聊天正确性、实时性与生命周期完成最终并发审计并部署：消息事件及双方成员按稳定顺序加锁，已读/清空/归档与发送共享会话锁序，联系申请处理与拉黑共享有序用户对 advisory lock；消息、联系申请和举报的持久限流在事务内串行计数，数据库瞬态冲突仅对完整幂等消息事务有界重试。举报终态重试保持幂等且不重复审计。Server 73 文件/584 用例、聊天 15/15、竞态重复 5 轮、Web 61/61、Server/Judge/Web 构建及 UI/API/架构/文档门禁通过。提交 `ea87788` 已推送 `main`，API 活动 slot 为 3302，Judge/Worker/Executor 已重启，Web BUILD_ID `5E91W4lE0MwI1SKTCKElt` 已提升；线上 readiness、登录态会话/未读接口和 SSE ready/heartbeat 均正常，发布后无数据库死锁、未处理异常或 5xx。

- 2026-09-05: 好友前置的一对一私信已实现并部署：账号级用户发现默认保护跨关系账号，好友申请通过后才能建立会话；删除好友保留历史并禁发，拉黑解除好友和待处理申请。消息使用会话内序号、幂等键、事务未读投影和持久 `ChatUserEvent`，PostgreSQL LISTEN/NOTIFY + 周期补偿驱动 SSE，流式客户端同时支持 Cookie 与 Bearer、携带恢复游标且不继承组织请求头，蓝绿退出发送重启事件。普通用户拥有消息/好友/申请/黑名单工作台；超级管理员和平台管理员可审核举报，但证据访问必须写平台审计。单方清空只影响自己，双方清空 30 天后由 Worker 清理未举报消息。生产迁移前备份 `oi_manager_20260905_142831.dump`（SHA-256 `e43dfda…38a0e3`）已校验，迁移 41/41；Server 全量回归中 574/575 通过，唯一陈旧通知断言修正后 Chat/Notification 定向 10/10，Web 58/58、三端生产构建及 UI/API/架构/文档门禁通过。API 活动 slot 为 3302，Web BUILD_ID `WjaW8nMU1yJrXhTenAtpR` 已提升；线上 readiness、七项服务、账号级未读/隐私接口及公网 SSE `ready` 事件均正常。浏览器扩展因公网仍为 HTTP 而被企业安全策略禁止访问，未绕过安全控制。

- 2026-09-05: 学校目录治理已部署：`School.directoryStatus` 区分 verified/pending/hidden/legacy，公开目录、本人组织、工作区、组织认证和加入流程统一隔离 legacy。生产 check/apply 将 4,901 个测试/临时学校隔离、第一中学设为 verified、平台内部学校设为 hidden，18,865 个成员关系、942 个团队、552 个活动和 780 个题单引用保持不变；二次 apply 变更为 0。超管学校页支持状态筛选、引用摘要和有审计的恢复/隐藏/隔离。定向 Server 11/11、三端构建、Prisma/UI/API/架构/文档门禁通过；备份 `oi_manager_20260905_115001.dump`（SHA-256 `e98e804c…a25f26a2bde`）已校验，API 活动 slot 为 3303，Web BUILD_ID `qfGQBna1fp-VWGNOvhZXc`。线上目录只返回第一中学，legacy 直接组织上下文返回 404。

- 2026-09-05: 组织创建申请已上线。普通账号可在个人组织页提交/撤销学校创建申请，超管在学校管理中审核；批准使用 Serializable 事务和 advisory lock 原子创建 Organization、School、`school_principal/employee` Membership、TeacherProfile、负责人指针、平台/组织审计与通知，不改写申请人全局角色。支持单 pending、24 小时 3 次限制、拒绝同名 24 小时冷却、名称 NFKC 防重和并发审批 409；生产历史 `student/teacher/school_principal` 账号作为普通账号兼容。学校管理的加入策略已从邀请列表拆到独立“加入设置”。空库安装为 109 表/39 迁移，隔离创建流程 7/7、加入回归 6/6、Web 57/57、三端构建、Prisma/UI/API/架构/文档门禁通过。正式迁移前备份 `oi_manager_20260905_070802.dump` 为 31 MiB，SHA-256 `0368dada7d72bbf614d72296b731df40e3160fb672e107abf7b0b88de62e4ee7`；备份克隆检测到 4,903 条历史 School 中 8 组/875 条标准化重名，因此按规则未回填、未合并，新写入以有界旧名扫描防止绕过。API 活动 slot 为 3302，Web BUILD_ID `l6pi2JoGHAEMSgUVVb4uA`，真实超管/历史负责人列表均 200，readiness 与服务健康。

- 2026-09-04: 组织申请与加入功能已部署。新增学校加入策略、主动申请、独立邀请、组织审计、账号/组织通知上下文、个人组织页、学校审核/邀请管理和消息中心；旧 pending Membership 与 campus 通知提供受保护的 check/apply 迁移。生产备份克隆迁移和 5/5 定向测试通过，全新安装与备份升级均为 107 张表，结构 SHA-256 `ab451b69cf0c87784d71dfe055eaf97a8ecabe7fc57ef9f5bd71e7c55a6e5d00`；发布探针发现的 Router 认证越界已由 `591fc36` 修复并增加回归。迁移前 31 MiB 备份已校验；生产 check/apply 为旧邀请 0、组织通知解析 43、安全退役 43、遗留 0。API 活动 slot 为 3302，Web BUILD_ID `O-16nqPRAhL2BZapkVbku`，组织三类读取接口 200，Worker/Executor/Judge/Web/Router 健康且 Judge 已重新认证注册。

- 2026-09-03: Carits 平台题库与其他题库分区已恢复并部署。个人题库默认进入“Carits 平台题库”，教师在“校内题库 / 平台题库”之下使用相同来源分区；“其他题库”单独提供洛谷、Codeforces 等平台筛选，关键词跨标签保留，平台筛选与页码重置。服务端 `sourceGroup=carits|external` 在数据库分页前过滤，旧无参数请求继续兼容混合结果；校内题库和平台管理后台未改变。Server 定向 11/11、Web 57/57、隔离 Chromium 桌面/紧凑视口 10/10、Server/Web 构建及 UI/文档/架构门禁通过。提交 `23759aa`、`8c2853d` 已推送 `main`，API 3302→3303，Web BUILD_ID `1OkXkhjAW_xrnoWvmGEG3` 已提升至公网 3000；无数据库迁移，readiness 和后台服务健康。

- 2026-09-01: 比赛、训练和作业内的评测记录筛选布局已修复并部署。全宽控件逐项占行改为带“题目、用户名、评测结果、语言”持续标签的响应式 Grid；管理员桌面端单行紧凑排列，`960px` 以下两列、`560px` 以下单列等宽，参与者继续按权限省略用户名或隐藏题目来源。Web 57/57、类型检查、生产构建、UI/文档/架构门禁通过；服务器隔离 Chromium 的独立桌面/手机筛选回归连同登录准备 7/7 通过且无页面横向溢出。提交 `ee84792`、`c457f3d` 已推送 `main`，Web BUILD_ID `L7aAQfpP-KxwfX5ZZ3uc_` 已提升至公网 3000；本批未修改 API，readiness 与 Web/Router/Worker/Executor/Judge 服务健康。

- 2026-09-01: 提交详情测试点折叠与来源信息优化已部署。ACM/OI 测试点默认折叠，保留总 Verdict、OI 总分和 ACM 首个失败点，Disclosure 支持鼠标、Enter、Space 与 ARIA；来源显示活动固定快照或题库来源的“平台 · 原始题号”，隐藏比赛不返回来源，界面不再显示远端记录但后端远程 ID 保持。Server 权限/详情 21/21、OI 原题隐藏 1/1、Web 57/57、隔离 Chromium 10/10、三端构建和 UI/文档/架构门禁通过；提交 `ba6ee1a` 已推送 `main`，API 3303→3302，Web BUILD_ID `4rLL5mW5zC7ZWDwN5JxWr` 已提升至公网 3000。生产 #3677 只读验证来源为 `Carits平台 · 1033`、20 个测试点且远程 ID 仍保留；readiness、全部服务和监控健康。

- 2026-09-01: 评测记录与提交详情强一致性重构已部署。全局与活动详情共用同一访问/脱敏 DTO，修复全局端点绕过 OI 赛中隐藏和 teacher1 个人提交 #3824 弹窗错误返回 403；弹窗与独立页共用 Hook/内容组件，403/404 不再提供误导重试，代码使用弹窗外层单纵向滚动，进行中列表自动同步。Server 提交权限 21/21、OI 原题隐藏定向 1/1、Web 57/57、隔离 Chromium 10/10、Server/Web 构建及 UI/文档/架构门禁通过；提交 `4e4b19d` 已推送 `main`。生产 Schema 37 个迁移均为最新，API 蓝绿由 3302 提升到 3303，Web BUILD_ID `VxV3DoXrP-Ole9yMHoVa5` 已提升至公网 3000；真实生产数据只读验证 teacher1 的 #3824 返回 Accepted，readiness、全部服务和监控健康。

- 2026-09-01: 评测记录筛选和列表详情弹窗首批 Web 部分已部署。个人页显示平台/题号/评测结果/语言，管理员按权限增加用户名；字段在宽屏同排、1180/760/520px 以下依次降为三列/两列/单列，空选项中文化，Enter 与按钮共用 URL 筛选，表格行焦点不再出现浏览器默认黑线。Web 57/57、隔离 Chromium 10/10、类型检查、构建、导航/UI/文档门禁均通过；提交 `09204f5` 已推送，BUILD_ID `Y6VnrxGmIxELCjtl3BKge` 已提升至公网 3000。该批次未提升的个人 teacher/school_principal Server 权限修复，已由上方 `4e4b19d` 完成部署。

- 2026-08-31: 提交级文件 IO Adapter 已部署。题库、活动提交和 Hack 证明程序可分别选择 stdin/文件输入与 stdout/文件输出；Submission/JudgeRun 固化实际 IO，重测沿用原配置。生产迁移检查为 2518 条可解析、183 条 FileIO、0 条异常，apply 与二次检查后 version 0 为 0；迁移前后 2586 条历史提交的 Verdict/分数分布完全一致。真实题库 1041 四组合均 Accepted，三条文件模式通过重测验证原 IO 快照不变；缺失命名输出按空输出得到 WA 并记录点级诊断，路径穿越返回 422。Server 全量 547/547 + 当前迁移/IO 定向 32/32、Judge 30/30、Web 45/45、三端生产构建、361 端点匿名审计和监控均通过。提交 `2f85f61` 已推送 `main`，API 活动 slot 为 3302，Judge 已重启注册，Web BUILD_ID `2lhep8Ied7CIZOrw7KVGm` 已提升至公网 3000。

- 2026-08-31: 贡献数据前置状态与任务进度已统一并部署：readiness、Candidate POST、Hack POST 与任务执行共用 STD/Validator/Classifier/Corpus 判定；STD/Validator 非 ACTIVE 时硬阻断，OI 缺 Classifier、Corpus 或渐进评估器时分别安全停在等待分类、等待语料或等待评估，不再伪造价值晋升。Validator DSL 激活会物化不可变程序版本；直接数据与 Generator 立即返回贡献任务 ID并展示逐阶段、逐子结果时间线，普通用户响应不暴露其他贡献者、Kill Vector、Holdout 或隐藏 Feature。Server 全量 533/533、Judge 22/22、Web 45/45、三端生产构建、UI/API/架构/文档门禁均通过；真实 `teacher1` 会话验证 readiness 与任务接口 200 且阻断信息正确。提交 `4fc8ff6` 已推送 `main`，API 蓝绿由 3302 提升至 3303，Judge 重新认证注册，Web BUILD_ID `1wwzeAwMoc3rMfesRogTc` 已提升至公网 3000。

- 2026-08-31: 有界 Candidate 基础链路已部署：数据贡献/Generator/Hack 共用 Candidate、用户与平台双层 Evaluation Credits、Candidate 全局并发 1、Judge `8:1:1` 调度、全局 Blob 引用与延迟 GC、Validator DSL/Feature/Subtask Rule、私有 Corpus bootstrap、Selector 预览和平台资源视图均已实现。技术有效 Hack 通过 Selector 策略与每题每小时 3 次上限晋升；其他 Candidate 在行为 Corpus 的渐进 L1/L2/Holdout 执行器完成前只停留于有界池，不会误发布。生产 schema 迁移正常，Server 全量 529/529 + 最终边界定向 10/10、Judge 20/20、Web 45/45、三端构建与 UI/API/架构/文档门禁通过。提交 `9c95028` 已推送 `main`，API 蓝绿由 3303 提升至 3302，Judge 重新注册，Web BUILD_ID `U5-dMerIgwkJMw9v0A8Xb` 已提升至公网 3000。

- 2026-08-30: GitHub 异机公网探针及去重 Issue 故障/恢复状态机已提交，静态契约验证通过；真实 workflow_dispatch Run `33290187717` 在任何步骤启动前被 GitHub Billing 拒绝，注解明确为近期付款失败或消费上限不足。工作流当前安全禁用，未宣称异机探针已运行；修复 Actions Billing 后需重新启用并完成一次健康运行及一次受控故障/恢复。

- 2026-08-30: 主机内运维调度已从不可观测的用户 Cron 迁移为六个持久化 systemd timers：五分钟监控、每日数据库/资产备份、每周数据库/资产恢复验证和安全基线均记录最近结果、下次执行与 journald 日志，主机停机错过的日历任务可补跑。任务通过白名单 dispatcher 以 `ecs-user` 和只读仓库沙箱运行；生产安装先成功执行监控再移除重复 Cron。六类任务已在真实沙箱逐项执行成功，Timer 也已连续自动触发健康监控。Timer fail-closed 故障注入、运行时审计、监控和文档门禁通过。日志异机归档 Timer 已安装但未启用，等待真实上传与独立验证目标。

- 2026-08-30: 题目评测资产与数据生成闭环已完成：STD/Validator/Classifier/Generator 使用不可变程序版本，C++17/Python3 Generator 与直接输入通过独立 Judge 队列生成候选点，管理员检查后以 CAS 发布下一 TestSet Revision；ACM 顺序、OI Official Group、Hack Gate 只读、固定活动和历史提交边界保持不变。DeepSeek Validator 仅从官方 Markdown 生成并使用内置 testlib 编译，AI 翻译/格式化/Validator 已统一按真实供应商 Token 经平台总池预占、结算和审计。平台管理员新增 Token 管理页，题目评测设置新增程序、导入、生成、候选和正式版本工作台。迁移前 31 MiB 备份已恢复校验，生产和测试 schema 均已更新；Server 全量 520/520 + 最新定向 19/19、Web 45/45、Judge 20/20、三端类型检查及 UI/路由/文档/架构门禁通过。

- 2026-08-30: 完整恢复覆盖扩展到数据库之外：`apps/server/testdata` 与 `uploads` 纳入每日增量快照，快照保存逐文件 SHA-256、文件/链接数、字节数及对应数据库备份与创建清单哈希；每周在隔离目录完整复制并验签。数据库备份新增不可分离的创建清单，最新生产恢复证明精确匹配 90 张表、37 条迁移、20186 个用户、69 道题、2586 条提交、32 个文件记录与 73 个 TestSet Revision。生产资产恢复要求快照与数据库 SHA 配对、明确目标确认和 `--apply`，停写替换后验签，失败自动从预恢复快照回滚。监控同时检查数据库/资产备份新鲜度、两类真实恢复证明和哈希；同类故障详情变化不会重复触发事故包或告警。

- 2026-08-29: 全链路可观测性与事故恢复基线完成两轮反向审计：API/Judge 使用 5 分钟/1 分钟滚动快照，覆盖端点状态族/P95/P99、外部依赖、浏览器/安全/服务端错误、内存/事件循环、Judge 认证/心跳/基础设施错误；业务快照覆盖队列积压、陈旧任务、近期失败、数据库连接/长事务/锁等待和 Revision 投影。监控直接检查 Web/Router/API/Worker/Executor/Judge、真实 `NODE_ENV=production`、重启增量、端口暴露、磁盘/inode、备份和每周真实隔离恢复证明；首次故障先生成含 API/Judge/业务/网络/恢复状态的 `0600` 事故包。每周安全基线另外验证存量密文解密、TLS 工具和生产依赖并保留 90 天私有哈希报告。部署探针同时修复畸形 JSON 被误记为 500。Server 60 文件 518/518、Web 12 文件 45/45、Judge 7 文件 18/18、三端生产构建、UI/架构/文档门禁、依赖零已知漏洞及 security/operations/incident/monitor 验证通过。当前 `APP_ENV=development` 仅保留 HTTP 兼容语义；外部告警接收人、异机存储、域名/TLS、云监控和 WAL/PITR 仍明确依赖所有者资源，不伪造完成。

- 2026-08-29: HTTPS 切换前的 CSRF 契约完成收口：生产模式下带 Session Cookie 的非安全请求缺少 `Origin` 会默认返回 `403 CSRF_ORIGIN_REQUIRED`，显式兼容模式仅保留给当前 HTTP/非生产客户端；可信来源仍逐值匹配。安全审计会拒绝 `COOKIE_SECURE=true` 但未启用严格 Origin 校验、通配来源或 Secure Cookie 搭配 HTTP 来源。Server 58 文件 513/513、生产构建、安全审计和文档/架构门禁通过；当前 HTTP 环境继续保持兼容，待域名和证书到位后与 TLS 一起启用。

- 2026-08-29: 离站日志归档改为双阶段确认：上传器与远端校验器都必须是绝对路径可执行文件，归档只有在独立远端读取校验大小和 SHA-256 成功后才创建 `.uploaded` 保留标记；校验失败时本地归档和校验和继续保留，不能进入自动清理。故障注入覆盖成功读回和校验失败无标记路径。生产仍缺真实异机/对象存储目标，因此外部验收保持未完成。

- 2026-08-29: Judge 用户可见读取完成 Switch read：全局/活动/题目提交列表与详情、结果筛选、题目状态、个人概览、OI/ICPC 排名、平台/校园解题排名、管理统计和重测预览统一读取 CurrentJudgeRun，远程归档与无 Run 历史记录才回退兼容列。故意破坏 Submission 兼容字段的回归仍返回 Run 的 AC/100；Server 57 文件 509/509、Web 36/36、Judge 17/17、三端生产构建和文档/架构门禁通过。提交 `c554aa8` 已推送 `main` 并蓝绿提升至 API 3303；生产 2518/2518 投影对账零差异。
- 2026-08-29: 60 个 HTTP adapter 的 Prisma / transaction / filesystem / Judge Runtime 直接调用全部归零；路由边界和 Hack 状态写入门禁均为零违规。当前运行拓扑文档已统一到 systemd Web、稳定 Router、蓝绿 API、Scheduler/Executor、Judge 与 Docker 基础设施；PM2/watch/“正式配置仅为模板”等旧描述不再属于当前事实。
- 2026-08-29: 前端账号级权限入口改为 capability-driven：全局管理员工作区、个人/校园工作区、全量评测记录、组织管理和平台密钥能力由单一矩阵定义，关键导航与入口不再重复拼接角色判断；资源级权限仍以后端为唯一事实源。Web 11 文件 40/40、UI 状态与组件门禁、Web 生产构建通过。提交 `8776b5e` 已推送 `main`，公网 preview 构建 `pLLd_bBuL87zHDakelxvi` 已提升至 `3000`；Web、Router、API 3303、Worker、Executor、Judge 及公网 health/readiness 均正常。Codex 内置浏览器复验 `/login` 成功渲染，页面控制台无 warning/error。
- 2026-08-29: 原架构评审已形成逐项完成审计；ECS 元数据再次确认未绑定 RAM Role，Codex 内置浏览器与现有 Edge 会话均被阿里云控制台重定向到官方登录页。Edge 登录页已保留供所有者登录；未读取密码、Cookie 或浏览器存储，也未修改任何云配置。
- 2026-08-29: 删除仓库最后一个失效 PM2 生产入口 `start:production` 与旧 ecosystem manifest，运行手册日志入口统一为 systemd/journald；架构门禁现在会拒绝重新加入 PM2 package script 或 manifest，避免代码入口与线上蓝绿拓扑再次漂移。Server 57 文件 509/509、文档与架构门禁通过。
- 2026-08-29: TLS/严格浏览器安全的仓库侧发布能力已补齐：证书 SAN/有效期/私钥匹配校验、参数化 Nginx HTTPS 模板、隔离 `nginx -t`、nonce + `strict-dynamic` CSP report-only/enforce 模式及响应 nonce 复核均通过。Web 12 文件 44/44、普通与 report-only 两套生产构建通过。提交 `bba8e6f` 已推送 `main`，默认 `CSP_MODE=off` 的公网构建 `EilfIqQM_IwOJFYUKtfzk` 已提升；Web、Router、API 3303、Scheduler、Executor、Judge 及 health/readiness 正常，浏览器确认登录表单可渲染。公网仍保持 HTTP，不在缺少域名/证书时提前启用 CSP/HSTS/Secure Cookie。
- 2026-08-29: 活动根作用域与测试版本更新完成 Strangler 迁移：工作区 scope 查询移入 application service；活动 TestSet Revision 预览/更新移出路由，并在 Serializable 事务内重新检查开始时间与提交数量后更新，避免冻结检查竞态。Revision/活动/校园定向回归 117/117、Server 构建通过；路由债务降至 Prisma 167 / transaction 6 / filesystem 29 / Judge Runtime 0。
- 2026-08-29: 活动排名完成 Strangler 迁移：OI/IOI 最大分 SQL 聚合、ICPC 罚时与首 A、管理员排除和参与者身份合并全部迁入 `modules/training/application`，HTTP route 只保留请求与响应映射。排名/比赛/校园权限定向回归 116/116、Server 构建通过；路由债务降至 Prisma 174 / transaction 6 / filesystem 29 / Judge Runtime 0。
- 2026-08-29: 活动概览与内容读取完成 Strangler 迁移：概览、题解、附件、授权文件下载和批量题号解析迁入 `modules/training/application`，概览自然结束状态复用原子事务；单题题解/附件新增 `trainingId + trainingProblemId` 联合归属校验，堵住跨活动内容读取。定向回归 113/113、Server 构建通过；路由债务降至 Prisma 181 / transaction 6 / filesystem 29 / Judge Runtime 0。
- 2026-08-29: 活动 CRUD 完成 Strangler 迁移：团队活动列表/创建、详情状态同步、编辑、延时、立即开始/结束、删除及补题作业复制全部迁入 `modules/training/application`；比赛自然结束的状态更新与提交公开改为同一事务，补题复制失败会回滚活动并清理已复制文件。训练/比赛/补题/权限/事务定向回归 137/137、Server 构建通过；路由债务降至 Prisma 198 / transaction 6 / filesystem 29 / Judge Runtime 0。
- 2026-08-28: 题单条目层完成 Strangler 迁移：单条添加、批量题号解析、编辑、删除和事务排序均迁入 `modules/problem-list/application`，保留学校题目归属、重复条目和乐观锁规则；排序新增条目所属章节校验，禁止跨章节改序。题单回归 45/45、Server 构建通过；路由债务降至 Prisma 490 / transaction 9 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: 题单章节层完成 Strangler 迁移：章节新增、编辑、至少一章删除保护、乐观锁和事务排序均迁入 `modules/problem-list/application`；排序新增服务端归属校验，不能再用其他题单 section ID 进行跨题单改序。题单回归 44/44、Server 构建通过；路由债务降至 Prisma 502 / transaction 10 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: 题单 CRUD 完成 Strangler 迁移：列表/权限分页、创建默认章节、详情与学生脱敏、元信息乐观锁更新、收录保护删除均迁入 `modules/problem-list/application`。题单回归 43/43、Server 构建通过；路由债务降至 Prisma 510 / transaction 11 / filesystem 70 / Judge Runtime 0，题面文件、章节、条目、分享和发布作业继续分批迁移。
- 2026-08-28: 最大遗留路由 `problem-lists.ts` 开始分层收口：题单 ID 分配、权限合并、校园/团队收录授权、章节/条目归属、乐观锁和受管文件引用解析已迁入 `modules/problem-list/application`。题单回归 43/43、Server 构建通过；路由债务降至 Prisma 525 / transaction 11 / filesystem 70 / Judge Runtime 0，CRUD/章节/条目/分享仍按后续批次继续迁移。
- 2026-08-28: 团队题单路由完成 Strangler 迁移：团队题单读取、校园展示名解析、owner/admin/教师添加和按添加者/owner 删除规则均迁入 `modules/team/application`，团队作用域错误保持明确 4xx。题单/团队联合回归 62/62、Server 构建通过；路由债务降至 Prisma 533 / transaction 11 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: 用户归档题目路由完成 Strangler 迁移：列表/统计/详情、幂等新增、更新、单删和批删均迁入 `modules/archived-problem/application`，同时修复历史分页响应将 `page/pageSize/total` 错位的问题。归档隔离与分页回归 2/2、Server 构建通过；路由债务降至 Prisma 548 / transaction 11 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: 全局 User 路由完成 Strangler 迁移：个人/校园资料读取、全局账号分页、平台管理员创建、账号状态事务与管理员密码重置均迁入 `modules/user/application`，角色保护策略由应用层统一执行。权限/事务定向 22/22 和 Server 构建通过；路由债务降至 Prisma 562 / transaction 11 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: Dashboard/Workspace 路由完成 Strangler 迁移：个人概览、个人/校园比赛与作业、全局/学校统计、工作区枚举、校园邀请和接受/拒绝事务已迁入 application services。身份/校园/事务定向 77/77、新增 Dashboard/Workspace 回归 3/3 和 Server 构建通过；路由债务降至 Prisma 577 / transaction 12 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: 超级管理员学校治理路由完成 Strangler 迁移：学校列表/详情/创建/编辑、负责人创建与转移、师生列表及其事务已迁入 `modules/organization/application`，route 只保留超级管理员鉴权、分页与 HTTP 映射。Server 全量回归和构建通过；路由债务降至 Prisma 605 / transaction 13 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: 管理员数据维护路由完成 Strangler 迁移：全量本地重测、旧 Carits 提交修复、统计、远程 ID/内存/可见性修复、训练提交清理、密码重置和参与者回填已迁入 `modules/admin-data/application`。Judge/管理员/事务定向 22/22、Server 构建和 318 端点认证审计通过；路由债务降至 Prisma 633 / transaction 17 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: Organization 成员路由完成 Strangler 迁移：校园资料/公告、作业/比赛、学生与教师档案、密码、状态、归档和负责人转移均迁入 `modules/organization/application`，组织上下文和 HTTP 响应仍由 route adapter 管理。权限/事务定向 48/48、Server 构建通过；路由债务降至 Prisma 655 / transaction 17 / filesystem 70 / Judge Runtime 0。
- 2026-08-28: OJ 账号池完成 Strangler 迁移：原 `routes/oj-accounts.ts` 中的 Prisma、密码加解密、HDU 验证/登录、批量验证与自动验证调度已全部迁入 `modules/oj-account/application`，Scheduler 不再反向依赖 HTTP route。OJ 账号与后台编排 18/18、Server 构建通过；路由边界基线从 Prisma 710 降至 689，transaction 24 / filesystem 70 / Judge Runtime 0 保持不增。
- 2026-08-28: Judge 兼容投影开始进入可量化观察期：生产 2518 条已绑定 Run 的本地提交中，Submission ↔ current JudgeRun ↔ current JudgeAttempt 的所有权、result、score、cases、subtasks、error、时间、内存和 metric 差异均为 0，且不存在无 Run 的本地提交。新增 `judge:projection:audit/check`，生产 5 分钟监控将差异视为故障；稳定观察期结束前仍不删除 Submission 兼容字段。
- 2026-08-28: Hack 核心状态写入已统一收口到 `HackAttemptStateMachine`：排队、Judge 认领、最终化、并发重排、失败重试和 API 重启恢复全部使用显式转换 + CAS，终态不能复活、不能跳过所有权状态。题库提交/重评命令从 `routes/submit.ts` 迁入 application service，HTTP adapter 不再依赖 Prisma 或 Judge Runtime；路由债务基线降至 Prisma 710、Judge Runtime 0。定向回归 37/37、Server 全量 49 文件 471/471 通过。
- 2026-08-28: Judge 六段 SLO 已在生产真实链路验收：公网 API 创建的 #3825 最终 Accepted，Attempt 持久化 `queue/dispatch/compile/run/persist/total = 44/2/3026/201/10/3315 ms`。24 小时报告能读取样本，基础设施错误 0、卡住 Attempt 0；样本数未达 50 时保持 `collecting`，不伪报 SLO 达标。
- 2026-08-28: Judge SLO 从单一总耗时扩展为 Attempt 级 `queue/dispatch/compile/run/persist/total` 六段指标；Server 分发时间、Judge 单调时钟和结果最终化事务共同产生真实数据，不为历史 Attempt 伪造样本。新增 24 小时 SLO 报告/强制门禁，默认 P95 目标依次为 5s/1s/3s/10s/1s/20s，基础设施错误率 `<0.1%` 且卡住 Attempt 为 0。协议与持久化定向 14/14、Judge 17/17 通过；生产迁移、真实提交采样与 SLO 读取已完成。
- 2026-08-28: 后台进程边界从“所有任务塞进单例 Worker”拆为 Scheduler/Executor：`oi-manager-worker` 兼容 unit 只运行持有 leader lock 的 Cron 与账号验证，`oi-manager-executor@N` 运行可并行远程轮询，并以逐任务 PostgreSQL session advisory lease 防止多实例重复处理。新增自动架构事实清单与 HTTP adapter 边界门禁；60 个现有 adapter 的 Prisma/事务/文件/Judge Runtime 债务被记录为只减不增基线，新 adapter 默认不得引入这些依赖。定向编排/租约 3/3 和 Server 构建通过，systemd 安装与生产演练完成后方可标记上线。
- 2026-08-28: Hack 技术判定与正式测试版本晋升完成第一阶段拆分：新增 `TestcaseCandidate` 独立记录已验证候选内容、内容对象、基线 Revision、命中 Subtask 和晋升终态；重复数据记为 `REDUNDANT`，并发失败记为 `STALE`，只有 Candidate 与 Hack Attempt 在 Revision 事务内同时变为 `PROMOTED/accepted`。测试数据内容读写已通过统一 `BlobStore` port，现有本地内容寻址实现保持兼容，并提供可注入的 S3/阿里云 OSS adapter 边界。并发 Hack 5/5、BlobStore 2/2 与 Server 构建通过；生产迁移和全量回归完成后方可标记上线。
- 2026-08-28: Judge 领域写路径切换完成：Consumer 从 current `JudgeAttempt` 领取任务，Judge 回传携带 `judgeRunId + judgeAttemptId + fencingToken` 并在事务内终结 Attempt/Run、同步 Submission 兼容投影；断连、租约过期和 API 重启创建新的 Attempt，不再重开旧终态。单条和比赛范围重测分别创建新 Run 与持久化 RejudgeBatch。100 路重复结果仍只有一个拥有最终化权限，陈旧 token 无法覆盖成绩；第二条增量迁移负责收敛第一阶段部署窗口中的投影差异。空库/最新正式备份迁移链为 82 表、31/34 条迁移、20186 用户且结构签名一致；Server 46 文件 463/463、Judge 6 文件 17/17 通过。Switch read 与旧执行字段清理仍待稳定发布周期后完成。
- 2026-08-28: Judge 领域模型进入安全增量迁移第一阶段：新增 `JudgeRun`、`JudgeAttempt`、`RejudgeBatch`、四组 Prisma Domain Enum 和显式状态转换；新普通/活动本地提交在同一事务创建 Submission、首个 Run 和首个 Attempt，远程归档不创建本地生命周期。旧 Submission 执行字段继续作为兼容投影，消费、回传和重测尚未切换，未删除历史字段。空库/正式备份恢复迁移验证得到 82 表、30/33 条迁移、20186 用户且结构签名一致；Server 46 文件 460/460 通过。
- 2026-08-28: 受控 ECS 整机重启演练完成：重启前新建并恢复验证 14MiB 备份 `oi_manager_20260828_015754.dump`（SHA-256 `fd0d1b94b1f3cac543e7cb17836fab81d4c12789d061133f38b6931c618b676b`，79 表/32 迁移/20186 用户）；01:58:43 发出重启，01:59:09 新内核启动，01:59:25 数据库与沙箱就绪，01:59:30 Judge 重新注册，01:59:31 稳定 API/Web 同时健康，端到端 RTO 48 秒。Docker、PostgreSQL、go-judge、Router、API、Worker、Judge、Web、CloudMonitor/Aegis 均自动恢复，运行时审计、监控和公网 BUILD_ID 验收通过，无人工补启动。
- 2026-08-28: 受控整机重启预检发现并修复 PostgreSQL 不会随 Docker 自动启动的问题：数据库和 go-judge 现在均为 `unless-stopped`；API/Worker/Judge 显式依赖 Docker，API/Worker 等待数据库 healthy，Judge 继续等待沙箱和稳定 API readiness。运行时审计新增数据库/沙箱 restart policy 与 systemd 依赖等待契约，避免未来配置回退。CloudMonitor 4.0 Agent 的 63 项指标持续成功发送，但云端下发的进程、HTTP 和脚本探测均为空，告警联系人/阈值仍需云控制台权限配置。
- 2026-08-28: 最新正式备份完成第二层隔离恢复演练：`oi_manager_20260827_230448.dump`（SHA-256 `7142d45c57d8600242f242651882c30c7fb403178c5a46c6db7f32c1121754de`）在独立 PostgreSQL `15435` 恢复并应用当前迁移，得到 79 张表、32 条迁移、20186 个用户，恢复耗时 11618ms。恢复的 `public` 数据只读检查以及独立 `e2e` 写入层的四角色登录、管理员单工作区、真实 go-judge AC/WA、有效 Hack 自动晋升 Revision、历史提交/活动版本固定、草稿手动升级和已开始活动冻结均通过；临时数据库、沙箱容器和写入数据全部自动清理。
- 2026-08-28: 基础设施故障注入完成：双 API 切换/回滚和 Judge 1012 重连再次通过；Worker SIGTERM 后替代进程取得同一单例锁，100 条已完成记录不变；go-judge 编译连接被 reset 后任务立即重排并最终 Accepted；PostgreSQL 连接被全部断开且拒绝 3 秒时，结果持久化保留所有权并重试，恢复后只落库一次。普通评测和 Hack 的沙箱传输错误不再被误判为用户 CE/RE 或最终 Hack System Error，断连恢复增加 `result/status + judgeId` 条件，技术注入全过程只使用独立数据库、端口和容器。
- 2026-08-28: 外部可观测性接入基础已完成但尚未冒充真实送达：监控状态只有在外部命令成功后才原子推进，发送失败会在下一轮重试；新增 mode-600 HTTPS webhook/邮件适配器、journald/Docker/Nginx/监控/备份日志归档与 SHA-256、可信上传命令和只清理已上传包的保留策略。回环 HTTP 已验证 failed/recovered 两条通知，独立接收目录已验证归档和校验和。当前服务器仍无真实 webhook 收件人、异机存储、CloudMonitor Agent 或 ECS RAM Role，外部验收继续保持未完成。
- 2026-08-27: 隔离并发与延迟收口完成：比赛题目范围 20 个并发重测与普通提交竞争时，原有 3 条只重置一次且新提交保留；重测与 Judge 终态回传竞争不留下 `judging`，旧回传不能覆盖最终状态。OI Test Graph 保存与 Hack 晋升竞争 5/5 通过，只允许一个下一 Revision 且无半成品文件。真实 go-judge 100/100 Accepted，端到端延迟 P50/P95/P99 为 29990/50925/52932ms，API/Judge RSS 增量均为 0，沙箱文件归零；Judge 压测命令已与蓝绿套件彻底分离。
- 2026-08-27: Judge 结果所有权和双 API 蓝绿一致性完成隔离及生产验收：Submission 终态按 `judging + judgeId` CAS 写入，Hack 先认领 `finalizing`，Revision 发布与 Attempt 晋升同事务提交。100 条记录由两个 API 同时回传仍只落库一次，50 次客户端 RST 不会终止 Router；Worker 单例锁、blue→green、green→blue 回滚、旧实例 drain、Judge 1012 重连全部通过。提交 `8697c80` 已推送并将生产 API 从 3302 提升到 3303；新 Router 受控重启成功退出且不再出现 `ECONNRESET`，Judge 自动重新注册。迁移前 14 MiB 备份已校验，Server 44 文件 452/452、Judge 4 文件 14/14、双 API E2E 1/1、318 端点匿名审计和三端生产构建通过。
- 2026-08-27: 全新空库安装链已绕开不可重放的历史 `20260429_rename_to_id_v2`，且未修改任何历史 migration/checksum：事务 bootstrap 从当前 Prisma Schema、非 Prisma Check/部分索引/函数/触发器 supplement 及 29 个原始 SQL SHA-256 建库。空库得到 79 张表、29 条迁移、32 个种子用户，正式备份恢复库在正常 migrate deploy 后为 79 张表、32 条历史记录、20186 个用户；两条路径 `public` 语义签名 SHA-256 均为 `24eae42c9432f22d83202863811b500624c625b7c9bbf522d5e7133dc21aa599`，bootstrap 非空保护保持生效。
- 2026-08-27: 运行时密钥完成受控轮换：最新 14MiB PostgreSQL 备份恢复校验为 79 张表、31 条迁移、20186 个用户；隔离恢复库真实轮换和新密钥二次解密通过后，生产 2 个 OJ 账号事务重加密。Server 环境从旧项目软链接迁移为当前仓库 mode-600 文件，JWT/Judge/账号密钥均为 64 字符且互相独立，CORS 为一个明确来源；安全审计零 violation，Judge 重新认证，新会话公网回归 4/4。HTTP 阶段仍保留 Cookie Secure warning，等待 TLS。
- 2026-08-27: 生产 go-judge 已设置 1.5 CPU、1536 MiB 内存、256 PID、65536 NOFILE、只读根、`no-new-privileges`、512 MiB 临时盘和 20 MiB × 5 日志轮转；Router/API/Worker/Judge/Web 的 TasksMax、NOFILE、停止超时和重启频率保护由 `pnpm runtime:audit` 校验。systemd 重复安装保持当前蓝绿 slot，不再无条件重置到 3302。
- 2026-08-27: 新增隔离 Judge 长稳与并发一致性基线：真实 go-judge 连续 30 轮处理 3000 条本地提交，3000/3000 Accepted，历时 1747.722 秒、吞吐 1.72 条/秒，每轮均无卡队列且沙箱文件回到 0；结束时 API/Judge RSS 分别比基线低 8564/8620KB。100 路首次 Revision 创建、100 路同基线 CAS 发布、Hack 并发晋升/重复输入和 500 路编译缓存租约定向测试通过；容器资源限制下的 10 条复验同样通过。详见 `docs/operations/JUDGE_STRESS_2026-08-27.md`。
- 2026-08-27: 新增公网只读动态验收：一个 `teacher1` 会话依次验证 1158 IOI 与 1157 ACM 的“排行榜题目格 → 用户题目提交列表 → 提交详情”闭环，#3678 按 OI 显示分数/Subtask/测试点得分，#3677 按 ACM 隐藏分值；嵌套弹窗逐层关闭且根页面滚动锁定。连同超级管理员、平台管理员和学校负责人的严格工作区验收共 4/4 通过，过程中无 5xx、控制台 error、page error 或页面横向溢出。当前剩余工作统一登记在 `docs/operations/REMAINING_WORK_2026-08-27.md`。
- 2026-08-27: 1158 的 median、balloon、string 已通过受保护 API 从迁移期旧 MIN 固定恢复到数据资产相同的 SUM Revision，67 条历史提交指针同步更新；1157/1158 各 89 条全量重测后，89 组同用户/同题/同源码哈希结果不一致为 0。三轮 267 个配对观测的逐用户逐题报告见 `docs/operations/ACM_IOI_TIMING_2026-08-27.md`。
- 2026-08-27: Server 全量回归为 43/43 文件、444/444 用例、0 跳过、0 失败；文档与 318 个 HTTP 端点认证审计通过。生产监控不再误查退役 HMR，成功/故障注入通过且状态为 `ok`；SSH 已禁用密码和键盘交互认证，root 仅允许公钥，新的 `ecs-user` 公钥连接复验通过。
- 2026-08-27: 资源所有权矩阵补齐活动、团队、平台题、校内题和全局提交，定向 3/3 通过；
  真实生产 Web 使用 `admin`/`platform_admin`/`teacher1` 完成 3/3 角色工作区验收，两类全局管理员
  都只有一个严格隔离的管理工作区，平台管理员评测记录 API 返回 `scope=all`。
- 2026-08-27: 补登记 20260815 资产并恢复 1005–1014 服务器既有 `.in/.ans + config.json`、
  1015–1019 既有演示数据后，69 道题中 42 道生成 73 个正式 Revision，301 个活动题中 293 个已固定版本，
  2582 条提交中 2361 条固定版本；迁移连续两次复跑保持幂等，检查结果 42 valid / 0 invalid。
  剩余 8 个活动题均为没有 Judge Config、测试文件或本地提交的历史 HDU/洛谷引用，继续返回
  `LOCAL_JUDGE_NOT_CONFIGURED`，不伪造 Revision；68 条远程归档及其他无法证明历史配置的记录保持
  `legacy unpinned`。
  `median` 以及使用 F 盘官方 `subset.cpp` 的 ACM Testlib、IOI Lemon 题库提交均为 20/20、Accepted、100；
  这三条 Practice 验证不进入比赛排名。Server 40 文件 436/436、Judge 4 文件 13/13 和两端生产构建通过。
- 2026-08-26: TestSet Revision 首次线上迁移基线为 24 道题、43 个正式 Revision、104 个固定活动题和
  570 条固定提交；后续 2026-08-27 资产修复后的现行数量见上一条。
- 2026-08-26: 题库测试数据改为不可变 TestSet Revision；题库 Practice 使用最新版，比赛、训练和作业添加题目时固定当时 Revision，活动开始或出现提交后永久禁止切换。有效 ACM/OI Hack 只自动晋升题库下一 Revision，不再直接传播到活动。Revision 固化测试点、Checker/Interactor/Manager 与 Judge 投影；PostgreSQL advisory lock + CAS 防止 Test Graph/Hack 并发覆盖。API 增加 3002 稳定 Router 与 3302/3303 蓝绿实例、Judge drain/reconnect，系统程序编译增加 TTL/LRU 缓存。Server 433/433、Web 36/36、Judge 11/11 与三端生产构建通过。
- 2026-08-26: OI Test Graph 已从 JSON textarea 收口为“Subtask → Group → Testcase”三栏工作台；旧 Subtask/测试数据入口在 OI 模式隐藏，Hack 配置只保留系统程序。新增题目管理员单题显式迁移、测试点注册、结构化校验、revision 409 和测试数据引用保护。Server 39 文件 430/430、Web 36/36、Judge 9/9、Chromium `1280×720` 与 `1440×900` E2E 均通过；提交 `7002e8d` 已推送 `main`，公网构建 `yWNYBecXwn49NS0LJhzwS` 已完成健康提升。
- 2026-08-25: Hack 历史详情权限保持“题目管理者可查看全部、普通用户仅查看本人”；列表中的“查看程序”入口已前移到程序语言之后，避免宽表格末端入口不可发现。提交 97ee230 已部署为公网构建 zqmtCul8BqfkMjyMkx8fU，线上权限复验为管理员 200 且含完整源码、其他用户访问他人详情 404。
- 2026-08-24: 新增 ICPC/OI/IOI 完整破坏性闭环，真实创建比赛、切换 ACM/OI 题目快照、提交并通过
  Judge WebSocket 回传、校验赛中/赛后排名与详情后清理。审计修复远程归档进入排行榜、Judge 结果后
  立即断线被恢复排队、重测统计与自身更新竞争三个问题。核心破坏性流程联合 21/21；Server/Web/Judge
  全量分别 426/426、34/34、6/6，E2E 清单 22 文件、268 条，根生产构建通过。Edge 可接管 1158
  页面并确认 URL/标题，但 DOM 与截图读取连续超时，视觉复验仍明确待补。
- 2026-08-24: Codeforces 远程归档同步增加参数前置校验、上游失败 502 契约和单次最近 1000 条上限，
  避免远端故障被误报为空成功及无界分页放大。新增归档幂等、Judge/排名隔离、失败与上限测试，
  Server/Web/Judge 全量分别 424/424、34/34、6/6，远程归档 UI E2E 7/7，E2E 清单为 21 文件、267 条，
  根生产构建通过；提交 `1dcf362` 已部署为公网构建 `BWcB26mt5NrhD5un0to-E`，统一监控和
  3000/3002 两套匿名 303/303 矩阵通过。
- 2026-08-24: Edge 发现活动题面矩阵的官方语言/格式共享行误用第一道题标题，造成跨题错配的视觉误导；
  已改为通用官方标签。新增活动题面选择与编辑破坏性 E2E，覆盖三题选择、学生 403、参与者读取、
  revision 1→2、陈旧写入 409、活动内创建 404 和真实页面渲染。与核心/Judge/Hack/重测联合 19/19，
  定向单元 7/7、根生产构建通过；E2E 清单为 20 文件、266 条。提交 `6ac52dd` 已部署为公网构建
  `ZUNj-cof6YGn9gkUrGKDN`，统一监控和 3000/3002 两套匿名 303/303 矩阵通过。
- 2026-08-24: 新增比赛题目范围重测破坏性 E2E，覆盖管理员权限、普通用户 403、排队/评测中跳过、
  远程归档排除和其他题目结果不变；修复无测试点明细的终态提交详情不显示 Verdict，并把发布作业、
  补题作业测试迁移到显式组织上下文和当前活动接口。核心 + Judge + Hack + 重测联合 18/18，
  Server/Web/Judge 全量分别 420/420、34/34、6/6，根生产构建通过；E2E 清单为 19 文件、265 条。
  提交 `3d06912` 已部署为公网构建 `Y1Nc3hNxHVKLRi2vil5hP`，两套匿名 303/303 矩阵和统一监控通过。
- 2026-08-24: 隔离 E2E 已补齐独立 `test-results/testdata`、确定性 ACM 配置和测试点，消除 Judge 流程对残留数据的顺序依赖；新增有效 Hack 入库且历史提交不重测的破坏性流程。全新 schema 下 Judge 8/8、Judge + Hack 联合 9/9，通过清单为 18 个 E2E 文件、264 条用例。提交 `da24952` 已部署为公网构建 `yl9YyYjjo3cSTnOQUGMvB`。
- 2026-08-24: 六种身份已分别完成 303 个文档端点的认证健壮性矩阵，共 1818 次请求且无 5xx；无效团队、未绑定外部账号、缺失导入批次、非法提交 ID 和不存在的拉题任务均返回稳定 4xx，预期客户端错误不再污染 error 日志。Server 全量回归为 37 文件 420/420；提交 `a2bb119` 已部署为公网构建 `OP9c7Uk_sz75WSE7etrIz`。
- 2026-08-24: 题目级 ACM Hack 已补齐空 STD 输出拦截、结构化失败阶段、列表摘要/按权限详情分离、并发重试保护
  和失败时的两文件原子清理；数据库迁移 25/25，公网预览构建为 `8fxNjMc1nbC96bWmMLqlt`。
- 2026-08-24: 全平台审计已启动；首轮端口检查发现并修复 PostgreSQL `5432` 与 go-judge
  `5050` 及 Server API `3002` 对公网监听，三者现均仅绑定本机回环地址。
- 2026-08-24: 超级管理员、平台管理员全部页面和校园学生主要页面已完成 Edge 首轮验收；学生校园评测记录
  入口由无效重定向修复为本人提交列表，管理模块仍保持隔离。
- 2026-08-24: E2E 页面审计监听器已改为逐检查窗口解绑，并区分 Next.js 已回退完整导航的推测 RSC 预取取消；
  学生个人工作区静态页面已完成 Edge 首轮验收；登录权限与全角色内部链接两组 E2E 合并复跑 20/20 通过。
- 2026-08-24: 学生校园评测记录可访问且仅显示本人记录；无权访问的校内题库题号不再呈现为内部链接。
- 2026-08-24: 当前公网预览构建为 `dy1igmvi3TtWEAwIDKzlN`；学生评测记录入口及本人详情已完成 Edge 部署复验。
- 2026-08-24: 普通教师全部一级模块和主要动态详情已完成 Edge 首轮审计；非比赛管理员进入题面选择的永久加载/重复 403 已修复。
- 2026-08-24: 非比赛管理员题面选择权限定向 E2E（含六种身份初始化）7/7 通过。
- 2026-08-24: Playwright 路由测试从无法收集恢复为 251 条，E2E 隔离种子已迁移到统一组织身份模型；
  负责人 Edge 已完成校园九个一级模块、团队/比赛/题目/提交等详情工作台首轮验收。组织题单详情、
  嵌套提交弹窗单滚动条与逐层关闭已修复并完成线上 Edge 复验。
- 2026-08-24: E2E 旧 `/teacher`、`/student` 页面与 `/api/schools` 排名依赖已迁移到组织工作区；
  Chromium 56 条全量冒烟通过。组织导航、学生模块边界、账号中心错误预取和题目 AI 权限 404 已修复。
- 2026-08-23: 题目级 ACM Hack 已实现独立队列、STD/Validator、直接数据与 C++17/Python3 生成器、双完整评测和有效数据自动入库；历史提交不重测。
- 2026-08-22: multi-statement routes are loaded by the restarted Server process; authenticated statement-version listing was verified with a real organization-scoped session.
- 2026-08-22: activity pages are selection-only for statements and solutions; managers can edit immutable activity snapshots, while participant creation APIs are removed. Targeted snapshot tests pass 7/7.

# 当前状态

## 阶段

OI Manager 已使用生产式 systemd/蓝绿运行拓扑承载公网流量。公网 `3000` 运行已发布的 Next.js 优化构建；稳定 API Router
监听 `127.0.0.1:3002` 并将每个 HTTP/WebSocket 连接固定转发到 `3302/3303` 中的活动实例。
Web、Router、活动 API slot、单例后台 Worker 和 Judge 均由 systemd 管理，不再依赖 `pnpm dev`、PM2 或 Nix。
业务环境仍为 `APP_ENV=development` 的 HTTP 兼容配置，不代表已经完成域名、TLS、严格浏览器安全、
外部告警和异机留存等 Production v1 外部验收条件。

| 服务 | 开发端口 | E2E 端口 | 说明 |
|------|----------|----------|------|
| Web preview | `3000` | `3100` | systemd 管理 `.next-current`；HMR 不作为线上常驻服务 |
| Server/API | Router `3002` → blue/green `3302/3303` | `3102` | Express + Prisma；Router 固定入口，候选实例通过 readiness 后原子切换 |
| PostgreSQL | `127.0.0.1:5432` | 同实例 `e2e` schema | Docker Compose 基础设施，仅本机访问 |
| go-judge | `127.0.0.1:5050` | `5050` | 高权限评测沙箱，仅本机访问 |

## 已实现能力

- 五类角色：超级管理员、平台管理员、学校负责人、教师、学生。
- 学校、用户、教师、学生、团队、邀请、申请和成员管理。
- 团队成员管理使用紧凑管理面板，申请审核、邀请成员和邀请列表窗口已统一视觉层级。
- 平台题库与学校私有题库；学校题按学校隔离并仅向教师和负责人开放。
- 题单、学校/团队题单、作业、比赛、训练、补题和排名。
- 比赛管理员可通过受鉴权 API 立即开始未开始比赛或提前结束已开始比赛；结束比赛会公开此前
  赛中隐藏的比赛提交。
- 提供 API-only 演示数据脚本，可幂等创建含题解、附件、测试数据、真实评测提交的
  OI、IOI、ICPC 三种赛制样例，禁止直接连接默认数据库。
- 比赛/训练列表由后端统一排序：进行中优先，同状态按现有标题数字级别降序，再按时间兜底。
- 作业排名仅管理员可见；普通学生作业详情不显示排名入口，接口也会拒绝非管理员访问。
- 学校负责人、教师和学生可在岗位工作区与个人工作区间切换；超级管理员与平台管理员严格只有
  各自独立管理工作区。个人团队、题单、训练、提交、排名和缓存按作用域隔离，个人身份只显示用户名。
- 认证会话使用 `workspaceMode` 区分 `work` 与 `personal`；登录兼容旧 `mode` 和旧 JWT 的
  `studentMode`。`schoolId` 仅代表 `School.id`，组织请求上下文使用 `organizationId`。
- 外部 OJ 题目抓取、平台绑定、远程提交归档和 AI 翻译；归档记录只展示，不参与本站计分或重测。
- 所有登录用户可为有权访问的题目维护多份独立命名的 Markdown/PDF 题面，题面可私有或
  全平台公开，并能从可访问版本独立派生；题解仍为每人每题一份。活动管理员通过独立矩阵
  为每题选择多份题面和唯一默认项，内容以不可变 revision 快照固化。
- 所有来源题统一使用本地提交、评测队列、Judge WebSocket、详情和重新评测；来源平台不再决定
  评测后端，比赛提交优先使用 `judgeConfigSnapshot`。
- 普通批处理源码提交与 Hack 证明程序支持提交级 stdin/stdout、文件输入和文件输出任意组合；
  Submission 与 JudgeRun 双重固化 IO，重测不改变原文件名。旧题文件名前缀只用于迁移和首次提交建议，
  新任务不再由 TestSet Revision 的 `filename` 决定执行方式。
- 超级管理员和平台管理员的评测记录页提供全平台全量视图，包含所有用户、个人区、校园区和比赛提交，支持总数、范围提示和 20/50/100 条分页浏览。
- 题目评测支持 ACM / OI 双赛制；ACM 首个失败后跳过未执行测试点并按 0/100 计分，OI 保留子任务部分分及依赖语义，同时兼容未声明 mode 的历史配置。
- OI 题目的关系型 Test Graph 是 Subtask、Official Group、Hack Gate 与 Testcase 的唯一编辑事实源；题目管理者通过三栏工作台上传/配对数据、注册测试点、设置依赖和聚合方式，YAML 仅由服务端生成 Judge 投影。
- 正式测试集合使用题库级不可变 Revision；历史 Revision 和评测资产可只读复现，数据工作台每次保存创建下一 Revision。所有活动固定 Revision，题库 Hack 与学校/团队活动没有直接关系。
- ACM/OI 传统源码批处理题（`default`/历史 `standard`）可配置题目级 Hack；客观题、交互题、
  通信题和提交答案题不能启用。ACM 有效性取决于最终 Verdict 变化；OI 由 Classifier 分类并要求
  总分严格下降。有效数据仅影响后续新提交，历史提交、成绩和排行榜不自动重测。
- 比赛赛中隐藏原题身份时，页面使用“题目 A/B/…”作为隐私安全的活动标签，不显示缺失占位符，
  也不泄露原题标题、平台或题号；题目时间限制统一按数据库的毫秒单位展示。
- 比赛评测记录与全局评测记录共用同一结果/语言筛选选项；PE、OLE、Queuing、Judging 及系统/远程错误
  均可筛选。活动附件按实际非空文件判断空状态，而不是按题目键数量判断。
- 独立提交详情页与活动提交弹窗共用 `SubmissionJudgeResult`：OI/IOI 展示总分、Subtask 和测试点得分，
  ACM 展示 Verdict、首个失败点、耗时和内存而不显示测试点分值；赛中隐藏和源码权限仍由服务端控制。
- 比赛提交列表、详情和排行榜已统一纳入 OLE/CE/RE 等无测试点明细终态；Queuing/Judging 可查询，ACM 不把进行中记录计入失败次数。
- 平台管理员和超级管理员可在独立平台工作区管理平台题目、评测配置和 Checker；学校题仍按组织隔离。通用文件上传已启用类别/归属类型白名单，Checker API 不泄露绝对路径。
- 外部 OJ 下载已增加公网 URL、重定向和响应大小限制；不再向非可信目标发送平台 Cookie。
- 学校组织生命周期 API 已收紧为超级管理员专属，平台管理员仅保留平台题库、评测记录、OJ 运营能力。
- 隔离的 PostgreSQL 单元测试与 Playwright 全 UI 测试。

## 最近验证

以下数字是最近一次相关验证快照，不作为永久常量：

- 2026-08-13 完成 OI、IOI、ICPC 排名矩阵重构：三种赛制使用独立成绩语义，列宽按题目数量分档调整，少题榜单适度放宽居中，多题榜单内部滚动并固定排名与参赛者列；Chromium 桌面与窄屏回归测试通过。
- 2026-08-13 通过受鉴权 API 创建演示竞赛数据：三种赛制各有进行中、已结束、未开始比赛，
  每场 5 题、5 名演示学生；六场可参与比赛的排名与评测记录均已核验，未开始三场为零提交。
- 2026-08-12 新增路由静态巡检：当前识别 112 个页面路由，阻断问题为 0；其余手写跳转会保留在机器可读报告中，需逐步迁移到统一路由函数。
- 2026-08-12 负责人、普通教师、校园学生和个人学生分别完成 Chromium 可见内部链接实际点击巡检；覆盖模块页和动态详情页返回链路，未出现 404、500、未处理控制台异常或页面错误。

- 根构建按 `shared → Prisma Client → server → web → judge` 顺序通过。
- 2026-08-18 认证接口测试 `36/36` 通过。`teams.test.ts` 当前为 `5/19`，其余 14 项仍直接
  使用已移除的团队成员/学校实体契约，待按 OrganizationMembership 模型迁移；不能把该旧套件
  视为认证修改的回归。
- 2026-08-02 Server Vitest 完整主跑 472/472 通过；校内题库新增 8 项隔离测试，覆盖
  双学校、草稿、教师编辑、负责人管理、学生教学活动授权、平台管理员隔离、复制去重及
  私有文件/评测配置/AI 入口。
- Prisma Schema 校验、`test` schema 同步及 `e2e` schema 重建/fixture 写入通过。
- 全角色工作区 Chromium 测试 18/18、旧学生模式隔离 11/11、Firefox 工作区与隔离冒烟
  21/21 通过。
- 109 条页面路由在 Chromium `1440×900` 全部通过；`1280×720` 紧凑桌面项目 115/115
  通过。桌面主跑中 2 项旧测试辅助契约失败已单独复跑通过，不属于页面路由失败。
- 根构建、Server/Web TypeScript 检查、Web Vitest 23/23、Judge Vitest 2/2、UI 状态守卫与
  文档检查均通过。
- 2026-08-24 Server 权限 helper 已增加真实组织学生/教师档案 ID，过时的学校权限测试已迁移为
  当前组织与工作区模型；本人、同组织、跨组织、负责人、班主任和团队角色/上下文共 13/13 通过，
  Server TypeScript 检查通过。其余旧 Server 套件仍按模块迁移中，尚未宣称全量回归通过。
- 2026-08-24 API 认证边界审计已覆盖文档清单中的全部 303 个端点：296 个认证端点、7 个显式公开端点；
  新增匿名端点或陈旧公开策略都会阻断 `docs:check`。资源级角色/组织矩阵仍按模块继续补齐。
- 2026-08-24 运行时匿名请求矩阵 303/303 通过；由该矩阵发现并修复空登录请求返回 500，6 项畸形凭据
  回归通过。受保护端点全部先返回 401，公开端点无鉴权泄漏或 5xx。
- 2026-08-24 校园提交已增加不可变 `organizationId` 归属；历史 2576 条校园记录全部回填且无空值，
  迁移 26/26。多校园列表/详情、本人重评、代码重新抓取与训练隔离 16/16 通过，迁移前备份已校验。
- 2026-08-23 题目级 Hack 定向测试 Server 2/2、Judge 3/3 通过；真实 go-judge 沙箱分别以
  直接输入和 Python3 生成器验证 `Accepted → Wrong Answer`，Validator、STD、候选点优先及
  双完整评测链路通过。Server/Judge/Web 生产构建通过。
- 2026-08-02 统一左侧导航改造后，远端隔离 UI 冒烟 28/28 通过，覆盖 Chromium、Firefox、
  五种角色的个人工作区、默认隐藏、人工展开、侧栏记忆和左下账号菜单。
- 校内题库远端隔离 E2E 14/14 通过，包含 Chromium 双桌面视口和 Firefox 冒烟；教师、
  学校负责人、校园学生和平台管理员的入口与权限均已覆盖。
- Codex 内置浏览器使用教师账号实测校园 → 个人 → 校园切换、个人首页、团队和排名；
  `1440×900` 与 `1280×720` 均无横向溢出，个人身份只显示用户名，浏览器无 warning/error。
- 教师与管理员顶栏已增加明确的“工作区切换”标签；管理员管理 → 个人、退出和恢复上次
  工作区均已实测通过，Hook 顺序修复后没有新增浏览器错误。
- 2026-08-01 线上接口隔离矩阵：24/24 断言通过，临时验证数据清理完成。
- UI 套件覆盖 Chromium `1440×900`、Chromium `1280×720`、Firefox 冒烟及
  `1 Mbps`、`5 Mbps` 网络节流。
- 页面清单：109 个 App Router 页面，其中 16 个全角色个人工作区页、3 个共享账号页。
- Prisma Schema：63 个模型。
- HTTP 接口清单：258 个端点；文档检查随本轮新增路由、模型与端点同步。

## 2026-08-21 远端部署快照

- OI / IOI 题目级 Hack 已完成代码与安全增量 Schema：有效性仅比较两次完整评测的总分，Classifier
  自动返回全部命中 Subtask，候选数据进入系统维护的 `hack_gate` Group；官方 Group 原分数、依赖和
  题目总分保持不变。进行中/已结束比赛默认冻结，管理员手动同步后也不会自动重测历史记录。
- 测试图迁移只允许超级管理员通过受保护 API 执行；先 `check` 报告文件缺失、分值不闭合等异常，再
  幂等 `apply` 成功题目。题目仍保留旧 YAML 双读兼容，关系图作为新编辑事实源并生成 Judge 投影。
- 当前 Prisma 迁移为 27/27；4 道现有 OI 题已通过受保护 API 迁移，复查为 4 道已迁移、0 道异常；本轮迁移前备份为
  `/data/backups/oi-manager/automatic/oi_manager_20260825_133857.dump`（5.2MB，`pg_restore -l` 校验通过）。

- 2026-08-24 端口与依赖监测提交 `1292dca` 已实装：在线成功路径 healthy，关闭端口故障注入返回非零；
  每 5 分钟 cron 已安装并在健康状态保持静默。当前服务器未配置邮件或 webhook 告警凭据，外部告警
  通过标准命令钩子预留，本地失败日志继续保留。

- 2026-08-24 运维审计确认当前用户 cron 仍每小时调用已不存在的旧项目路径，自动数据库备份实际未运行。
  修复提交 `a36ccb8` 已实装：生成并通过 `pg_restore -l` 校验 5.2MB 自动备份，模拟容器缺失返回非零且
  无临时文件；cron 已切换为每日 03:00 调用当前仓库脚本，迁移前手工备份目录不受保留策略影响。

- 2026-08-24 文件存储安全批次 `f6ddc95` 已部署为公网构建 `gRRkDA9MqSWR-StqiXCOf`：修复路径前缀穿越、硬删除未复用安全路径、
  团队文件缺少 active/校园作用域校验、全局管理员越权普通文件、软删除元数据可见及伪造二进制上传；
  文件安全回归 6/6、相关权限与敏感接口共 23/23、Server 类型及 3000/3002 两套 303/303
  匿名端点矩阵通过。

- 2026-08-24 题目级 Hack 题型边界修复 `851ca0e` 已部署，当前公网预览构建为
  `rKIqHKJvX7wNvf2ibf5gW`；客观题不再暴露或允许启用 Hack，Judge 测试不再收集 `dist`。
- 2026-08-24 隐藏原题身份标签与时间单位修复 `f2acba5` 已部署，当前公网预览构建为
  `AehXHfPqGZHMu5vpiCKWx`；Edge 已复验 1158 题目列表和题面，无缺失标题、秒单位误标或横向溢出。
- 2026-08-24 活动附件空状态与评测筛选统一修复 `933cb26` 已部署，当前公网预览构建为
  `yAOIk_SAEjxP3QmmqzxiF`；Edge 已复验“暂无附件”和包含 OLE/PE/队列状态的 16 项结果筛选。
- 2026-08-24 提交详情共享结果组件修复 `be83577` 已部署，当前公网预览构建为
  `YFyBItVMM7t35S7z9XQE-`；学生 Edge 已复验 IOI #3682 的 Subtask/20 个测试点、ACM #3681 的
  Fast-Fail 失败点、ACM #3677 的 20 个 Accepted 测试点，以及两种赛制的排行榜两级弹窗、隐私与键盘交互。
- 2026-08-24 权限测试迁移 `59f4597` 已部署，当前公网预览构建为 `cLM4IQTMUJofnTy88pd_F`；
  3200/3000 健康检查、Server TypeScript、组织权限 13/13 和文档门禁均通过。
- 2026-08-24 API 认证门禁与登录空请求修复 `9eda8c5` 已部署，当前公网预览构建为
  `ywaWmTvM6CM5X2HamOmSM`；3002 API 与 3000 同源代理的匿名矩阵均为 303/303。
- 2026-08-24 校园提交组织隔离 `39b857b` 已部署，当前公网预览构建为 `_3YRjoz8eLKRo8vT_gr0s`；
  迁移 26/26、历史空组织数 0、提交隔离 16/16、双入口匿名矩阵 303/303 和健康检查通过。
- 开发服务器当前运行题目级 ACM Hack 功能提交 `44ad7c4`、兼容修复 `f3a56fc` 和详情收口
  `a36c1f8`，公网优化预览构建为 `ubx1GgM3v7m0hPeZKng7g`，公网优化预览为
  `http://47.99.222.76:3000`，API 为 `3002`；
  项目仍处开发阶段，不代表正式投产。
- 数据库迁移 24/24；题目级 Hack 迁移前的 PostgreSQL 16 完整备份为
  `/data/backups/oi-manager/oi_manager_pre_problem_hack_20260823_2355.dump`，已通过容器内
  `pg_restore -l` 校验。含 Python3 的 go-judge 镜像 ID 为
  `sha256:03be41256057e38005d0acee9710d12ddb6cba83bf19183193d7ae01980cad8b`。
  VJudge 式多题面迁移前的 PostgreSQL 16 完整备份为
  `/data/backups/oi-manager/oi_manager_pre_vjudge_statements_20260821_1900.dump`，已通过容器内
  `pg_restore -l` 校验。301 道历史活动题均生成一组 statement set 和默认 snapshot。
  用户内容迁移前的 PostgreSQL 16 完整备份为
  `/data/backups/oi-manager/oi_manager_pre_user_content_20260821044529.dump`，已通过容器内同版本
  `pg_restore -l` 校验。301 个历史活动题均已生成题面和题解 revision 1（301/301）。
  校内题库迁移前的完整备份为
  `/data/backups/oi-manager/oi_manager_pre_school_library_20260802_145336.dump`，已通过
  PostgreSQL 16 `pg_restore -l` 校验。
- 现有 42 道题完成确定性归属：27 道进入平台题库，15 道进入学校私有题库；历史学校题
  文件迁移完成，本批数据没有需要移动的旧文件。
- `3200` 候选检查、`3000` 提升后检查、Server/Judge/Web 构建均通过；Judge 已完成令牌认证并注册。
- 题目级 ACM Hack 已完成迁移、沙箱镜像、Server、Judge 和 Web 部署；负责人浏览器通过 SSH
  隧道检查学校传统题评测设置，Hack 页签、STD/Validator 编辑器和启用开关正常，控制台无错误。
- 外部来源题统一本地评测已部署；Codeforces/洛谷归档与本地队列隔离。新增定向测试 8/8、
  训练兼容 37/37、Server Judge 协议 2/2、Judge 客户端 2/2 通过，文档检查识别 271 个端点。
- 用户专属题面/题解与活动内容选择已部署；学生活动题面入口和负责人活动编辑选择器已用
  真实浏览器会话验收，控制台无 warning/error。文档检查当前识别 287 个端点。
- 活动内容版本入口已从通用活动编辑弹窗迁移到“题面”页的当前题目管理操作，避免多题版本
  选择器挤占题目排序表格；快照数据和权限规则不变。负责人真实浏览器复核确认旧位置计数为
  0，新弹窗能读取题面、题解和当前 revision，控制台无 warning/error。
- 本机浏览器通过 SSH 隧道访问远端部署：根地址直接进入登录页；教师只看到本校已发布题，
  负责人可管理本校草稿，学生没有校内题库入口，平台管理员不能进入学校题库；浏览器控制台无错误。
- 所有工作区均改为默认隐藏的左侧抽屉导航；展开状态按账号与工作区分别记忆。账号头像、
  用户名和工作区位于展开侧栏左下角，账号菜单向上弹出且不会遮挡底部操作。
- 公网 IP 经本机 VPN/系统代理可能出现 `502`；相同请求在服务器本机经 `3000` 与 `3002` 均正常。排障时应先
  关闭代理或使用 SSH 隧道复核，再判断服务端故障。

## 安全边界

- 公开静态服务只挂载 `STORAGE_ROOT/public`；私有文件必须通过鉴权 API。所有数据库文件路径在读取、
  移动和硬删除前均按真实路径边界校验，上传的二进制签名必须与扩展名匹配。
- 团队和比赛文件权限同时绑定当前个人/校园工作区、校园组织及 active 成员状态；全局管理员不自动
  获得任意用户或团队私有文件权限。

- OJ Cookie 配置只允许 `super_admin` 读写，读取结果不返回 Cookie 原文。
- OJ 全局任务允许 `super_admin` 和 `platform_admin` 管理。
- 平台管理员和超级管理员只管理平台题库，不能读取学校题内容。
- 学生不能进入校内题库；学校题及文件只能通过已授权教学活动上下文读取。
- 维护迁移接口只允许 `super_admin`，且 `ENABLE_MAINTENANCE_API` 默认关闭。
- Judge 必须使用与 Server 一致的 `JUDGE_TOKEN`；无令牌模式只允许显式本机测试。
- 正式环境必须设置严格 CORS、独立 JWT/Judge/加密密钥。

## 当前限制
- 2026-08-28 `problem-lists.ts` 已完成 Strangler 收口：访问、CRUD、章节、条目、分享、授权题面文件与发布作业均迁入 application service，路由不再直接访问 Prisma 或文件存储。分享新增跨校园/身份错配及跨题单删除隔离；作业与题目快照改为同事务创建并校验时间范围。题单定向回归 51/51、相关双文件回归 51/51 通过，路由边界基线降至 Prisma 471 / transaction 9 / filesystem 70 / Judge Runtime 0。
- 2026-08-28 `problem.files.routes.ts` 已完成 Strangler 收口：PDF、题面版本和附件的授权、元数据与文件生命周期迁入 application service，Multer 临时目录配置迁入基础设施模块。失败上传会清理临时/新文件，替换和删除回收旧文件，统一 PDF 的 Statement/Problem 兼容字段在同一事务更新。Server 构建与文件/题库隔离回归 16/16 通过，路由边界基线降至 Prisma 447 / transaction 9 / filesystem 54 / Judge Runtime 0。
- 2026-08-28 通知与贡献路由已迁入 application service：通知列表、单条已读、全部已读均按当前用户和 personal/campus scope 操作，定向回归 3/3；贡献汇总、事件和全局/校园排名查询不再由 HTTP adapter 直接访问 Prisma。本轮完整 Server 回归为 51 个文件、486/486 通过；路由边界基线降至 Prisma 431 / transaction 9 / filesystem 54 / Judge Runtime 0。
- 2026-08-28 Carits 币个人、校园、流水和平台审计只读查询已迁入 application service，校园查询继续要求 active 教师或负责人关系，金额仍只以字符串输出避免 BigInt 精度丢失。Server 构建通过，路由边界基线降至 Prisma 423 / transaction 9 / filesystem 54 / Judge Runtime 0。
- 2026-08-28 个人 Rating/过题排名与校园 Rating/过题/年级过滤查询已迁入 application service；HTTP adapter 只保留个人/组织上下文门禁和响应映射，既有分页、毕业过滤和去重过题语义不变。Server 构建通过，路由边界基线降至 Prisma 415 / transaction 9 / filesystem 54 / Judge Runtime 0。
- 2026-08-28 `testdata.ts` 已完成 Strangler 收口：ZIP 解包、路径边界、暂存、流式哈希和下载进入存储基础设施；授权、列表、冲突替换、删除、Test Graph 引用与下载解析进入 application service。替换/删除持有题目 PostgreSQL advisory transaction lock，并在数据库失败时恢复旧文件。真实 multipart、配对、冲突、替换、下载、跨题隔离和删除回归 4/4，相关测试 22/22 通过；路由边界基线降至 Prisma 396 / transaction 8 / filesystem 34 / Judge Runtime 0。
- 2026-08-28 OJ Fetcher 第一批已迁移平台 Cookie 配置和任务管理应用服务，批量任务去重、重置与新建处于同一事务，路由继续只负责触发后台处理。SSRF/权限边界回归 7/7 和 Server 构建通过；路由边界基线降至 Prisma 386 / transaction 8 / filesystem 34 / Judge Runtime 0。后台队列、远程资产与题目持久化继续在后续批次拆分。
- 2026-08-28 OJ Fetcher 队列已从 API 请求触发改为唯一后台 Worker 轮询；任务使用数据库 compare-and-set 领取，蓝绿实例重叠时同一任务只能被一个执行者获得，超过 15 分钟的中断任务会自动重新排队。题目附件授权与替换元数据进入 application service，替换先建立新记录再回收旧文件。Server 构建、队列并发和 SSRF 定向回归 6/6 通过；路由边界基线降至 Prisma 377 / transaction 8 / filesystem 34 / Judge Runtime 0。远程下载执行与题目主体持久化仍需从路由拆出。
- 2026-08-28 OJ Fetcher 新的默认持久化路径已把题目元数据与多语言题面放入同一数据库事务，再处理图片和附件，最后才把队列任务置为成功；附件部分失败会留下明确状态而不会把半写入题目当作完整成功。保留 `OJ_FETCHER_LEGACY_PERSISTENCE=1` 作为本发布周期的紧急兼容回退，待稳定观察后连同路由内旧实现一起删除。路由边界当前为 Prisma 375 / transaction 8 / filesystem 34 / Judge Runtime 0。
- 2026-08-28 平台绑定 HTTP adapter 已清零直接 Prisma 访问：Codeforces 归档凭据读取与校验、远程提交去重、语言/结果规范化、题目关联修复和 Carits 旧测试记录事务清理均迁入 application service；不支持的维护 action 返回 400。Server 构建及归档、权限、安全回归 10/10 通过，路由边界降至 Prisma 349 / transaction 8 / filesystem 34 / Judge Runtime 0。
- 2026-08-28 依赖恢复后 Playwright 可选 `headless-shell` 缓存缺失的问题已收口：浏览器管理器优先使用显式可执行路径，其次使用包内路径，最后复用缓存中最新完整 Chromium。真实 headless 启动/关闭冒烟通过，避免远程 OJ 浏览器抓取因可选下载包缺失而不可用。
- 2026-08-28 活动题目新增、两阶段排序、别名/分值更新和删除文件回收已迁入 application service；题目访问范围、初始 TestSet Revision、内容快照创建与失败回滚保持原语义，并新增重复排序值校验。训练权限与兼容回归 80/80 通过；路由边界降至 Prisma 335 / transaction 7 / filesystem 34 / Judge Runtime 0。
- 2026-08-28 活动题目列表、个人提交状态和题面详情读模型也已迁入 query service，`training.problems.routes.ts` 已成为纯 HTTP adapter；OI 赛中脱敏、来源隐藏、题面快照、笔记和文件上下文化保持不变。兼容回归 37/37 通过；路由边界降至 Prisma 320 / transaction 7 / filesystem 34 / Judge Runtime 0。
- 2026-08-29 OJ Fetcher 收口完成：远程 SSRF/DNS 校验、受限重定向、流式大小上限、图片/附件存储与替换进入 remote asset service；拉取执行进入唯一 Worker application service，HTTP route 只保留鉴权、输入和响应映射。旧 `OJ_FETCHER_LEGACY_PERSISTENCE` 分支已删除，预览 GET 不再产生伪 owner 文件。Server 构建及队列、SSRF、后台服务和权限回归 10/10 通过；路由边界降至 Prisma 303 / transaction 7 / filesystem 34 / Judge Runtime 0。
- 2026-08-29 题库提交、个人笔记、TestSet Revision 和 Test Graph 四个路由已迁入统一 problem application service；访问范围、工作区提交隔离、Revision spec、显式模式迁移、旧图迁移和活动 graph revision 回填语义保持不变。题目访问、提交、Test Graph 和 Revision 回归 31/31 通过；路由边界降至 Prisma 284 / transaction 7 / filesystem 34 / Judge Runtime 0。
- 2026-08-29 活动题目笔记和比赛记录读写已迁入 training user-content service，并补上 `trainingProblemId + trainingId` 归属校验，避免利用其他活动题目 ID 读写笔记。训练兼容回归 37/37 通过；路由边界降至 Prisma 272 / transaction 7 / filesystem 34 / Judge Runtime 0。
- 2026-08-29 认证路由已完成 Strangler 收口：登录审计、注册事务、全局角色/校园成员解析、个人工作区、资料/组织档案更新、头像上传替换回滚和密码修改进入 auth application service；Multer 临时目录与清理进入基础设施模块。管理员角色、Cookie/CSRF、工作区、密码和文件安全回归 52/52 通过；路由边界降至 Prisma 245 / transaction 7 / filesystem 29 / Judge Runtime 0。
- 2026-08-29 活动提交路由已完成收口：本地提交配置检查、列表范围/用户名/题目筛选、展示名、详情、管理员提交用户、重测预览与候选快照进入 training submission query service；HTTP 层继续负责脱敏和响应映射。训练兼容与提交权限回归 53/53 通过；路由边界降至 Prisma 220 / transaction 7 / filesystem 29 / Judge Runtime 0。
- 2026-08-29 活动内容选择、版本预览、Markdown/PDF 快照编辑及受控下载已迁入 training content application service；HTTP adapter 不再直接访问 Prisma 或文件系统。PDF 临时文件在权限失败与异常路径均清理，新上传文件在快照编辑失败时软删除。Server 构建及完整 53 文件、493/493 回归通过；路由边界降至 Prisma 164 / transaction 6 / filesystem 26 / Judge Runtime 0。
- 2026-08-29 活动多题面选择矩阵、当前选择集合和参与者题面/PDF 读取已迁入 training statement application service；保存请求携带 selection revision，陈旧管理员页面返回 `409 STATEMENT_SELECTION_STALE`，事务写入前再次校验当前集合，避免并发覆盖。参赛者响应不再泄露个人题面作者。Server/Web 构建与定向 3 文件、89/89 回归通过；路由边界降至 Prisma 160 / transaction 5 / filesystem 26 / Judge Runtime 0。
- 2026-08-29 题目列表、创建、详情、更新、归档、题库创建者与学校副本入口已迁入 problem CRUD application service；题目与官方题面/题解版本改为同事务创建和更新，非法内容不会留下半成品题目或已提交一半的标题变更。Server 构建与题库权限/归档定向 3 文件、13/13 回归通过；路由边界降至 Prisma 139 / transaction 5 / filesystem 26 / Judge Runtime 0。
- 2026-08-29 Hack 配置、发起、记录、详情和系统错误重试编排已迁入 problem Hack application service；Hack Attempt 仍只通过现有状态机/CAS 转换，配置保存新增 revision CAS，两个管理员并发保存只允许一个成功。Server/Web 构建与 Hack、Revision、并发定向 5 文件、25/25 回归通过；路由边界降至 Prisma 117 / transaction 5 / filesystem 26 / Judge Runtime 0。
- 2026-08-29 Judge Config 与 Checker 列表、上传、替换、下载、删除已迁入 problem Judge application/storage service；Checker 仅接受安全文本形态的 `.cpp/.cc/.cxx`，替换与删除在数据库失败时恢复原文件，权限失败会清理 Multer 临时文件。Server 构建，Judge/文件安全/Revision/权限回归合计 21/21 通过，新增 API 定向 3/3 复跑通过；路由边界降至 Prisma 106 / transaction 5 / filesystem 20 / Judge Runtime 0。
- 2026-08-29 个人题解与多题面版本的查询、编辑、公开范围、PDF 替换、下载和软删除已迁入 problem content application service，共用受控 PDF 上传基础设施。新文件在数据库失败时回收，旧文件在成功切换后回收；公开个人题面 PDF 也必须先通过原题目校园访问边界。Server 构建及个人内容、学校隔离、文件安全 3 文件、25/25 回归通过；路由边界降至 Prisma 83 / transaction 5 / filesystem 14 / Judge Runtime 0。
- 2026-08-29 题目 AI 翻译、格式化和用量查询已迁入 problem AI application service；外部模型调用完成后的题面写入与用量日志在同一事务提交，并通过题目动作级 advisory lock 和事务内重复检查避免并发重复版本。格式化未显式指定题面时会记录实际处理的题面 ID。Server 构建及 AI、题库隔离 6 文件、60/60 回归通过；路由边界降至 Prisma 66 / transaction 5 / filesystem 14 / Judge Runtime 0。
- 2026-08-29 全局评测记录列表、详情和 Codeforces 归档代码重抓已迁入 submission query service；管理员继续使用全平台视图，普通用户、校园成员与比赛管理者的工作区/组织边界保持不变。列表总数与当前页在同一读事务取得，排序增加 ID 稳定项；重抓失败会恢复旧代码，平台管理员和超级管理员不再被个人工作区条件误挡。Server 构建和提交权限回归 16/16 通过；路由边界降至 Prisma 50 / transaction 5 / filesystem 14 / Judge Runtime 0。
- 2026-08-29 通用文件上传、下载、公开读取、元数据、按归属列表和软删除已迁入 file application service，Multer 暂存目录与清理进入独立基础设施模块；业务归属权限继续按题目、比赛、团队或本人校验，平台管理员不能借通用接口浏览任意用户文件。Server 构建及文件安全/题库隔离 2 文件、16/16 回归通过；路由边界降至 Prisma 41 / transaction 5 / filesystem 6 / Judge Runtime 0。
- 2026-08-29 团队 ID 检查、头像生命周期、邀请接受/拒绝、成员移除、管理员角色变更和加入申请审批已迁入 team operations service；邀请、角色、申请与操作日志使用条件更新和同一事务，重复并发处理只允许一个成功。头像写库失败会软删除新文件，Multer 暂存清理由独立基础设施模块负责。Server 构建及团队回归 2 文件、22/22 通过；所有 HTTP adapter 的 transaction、filesystem 和 Judge Runtime 直接调用已清零，剩余仅 Prisma 26。
- 2026-08-29 受控演示场景、旧提交来源/状态维护迁移和 Test Graph 管理迁移的持久化已移入 maintenance application service；演示与维护 API 的既有环境开关、密钥及超级管理员门禁保持不变，旧提交范围更新增加条件写避免重复执行覆盖。Server 构建及认证、Revision、Test Graph、活动 pin repair 回归 4 文件、61/61 通过；60 个 HTTP adapter 的 Prisma / transaction / filesystem / Judge Runtime 直接调用全部清零，Strangler 路由边界收口完成。
- 2026-08-29 路由边界收口后的全量验收完成：Server 56 文件 503/503、Web 10 文件 36/36、Judge 6 文件 17/17 全部通过；根生产构建通过。JudgeRun/Submission 强制投影对账为 2518/2518、所有差异字段均为 0；UI 控件与弹窗契约 7 类债务均为 0，63 个页面路由、86 条导航发现无阻断问题，318 个 API 的认证审计和文档/架构检查通过。
- 2026-08-24 自动备份已完成真实隔离恢复演练：67 张表、29 条迁移、20186 个用户记录校验通过，临时数据库清理完成。恢复覆盖正式库的灾难演练仍必须在停写、二次备份和明确维护窗口下单独授权。
- 2026-08-27 Cron、旧远程结果轮询和 OJ 账号自动验证已从蓝绿 API slot 拆到
  `oi-manager-worker.service`；Worker 持有 PostgreSQL session advisory lock，调度器可停止且轮询不重叠。
  API slot 仅保留实例内 HTTP 指标，promote 在 HTTP 切换后重启唯一 Worker。
- 2026-08-24 生产依赖扫描已从 51 项漏洞清零；Next 15.5.21 兼容构建、Server 417/417、Web 34/34、Judge 6/6 和隔离浏览器 13/13 通过。提交 `2998473` 已部署为公网构建 `UhlTIrV7m4XFpXwf8DMsa`，响应头、303/303 双矩阵和服务监控复验通过。
- 当前 Nginx 入口仍为 HTTP，尚未配置域名/TLS；Web 基础安全响应头已进入待部署版本，严格 CSP 因现有内联脚本兼容性仍作为后续安全加固项。
- 2026-08-24 受控 loopback 负载冒烟共 2300/2300 请求成功：3002 API 直连约 95.45 req/s、P95 24.42ms；3000 API 代理约 74.59 req/s、P95 287.90ms；3000 登录页约 49.55 req/s、P95 346.62ms。该结果只代表当前开发服务器上的短时只读冒烟，不是容量承诺；持久化写入、提交和 Judge 压测仍须在隔离环境执行。
- 2026-08-24 请求指标路径修复已部署为构建 `2KH5mSH54QjEaNDtL9hy8`；在线 `request_end` 已确认保留完整嵌套路由路径。周期性 metrics 汇总将在积累真实流量后继续由日志巡检观察。
- 2026-08-21 用户专属题面/题解定向测试 4/4、补题作业 17/17、训练兼容 37/37 通过；
  根生产构建与文档检查通过。历史活动内容快照数据库迁移在部署阶段执行。
- 2026-08-21 多题面版本定向测试 4/4 通过，覆盖标准化同名、私有/公开权限、独立派生、
  跨题目作用域与活动多题面快照不可变；Server/Web 生产构建通过。
- 交互题、通信题和提交答案题目前沿用各自的测试点执行流程，赛制统一计分已覆盖，尚未提供 ACM 失败后的提前停止优化。

- 当前服务器已启用仓库内 systemd 部署配置，阿里云 CloudMonitor/Aegis 与本地服务监控均在运行，SSH 密码入口已关闭；业务环境仍为开发预览，域名/TLS、云端告警策略复核、日志异机保存、受控整机重启和隔离写入/长稳压测尚未完成。
- 外部 OJ 受登录状态、反爬策略和页面结构变化影响，真实连通性不作为 PR 门禁。
- 浏览器会话使用同域 HttpOnly Cookie；Bearer Token 仅作脚本和旧会话迁移兼容。
- 旧 `studentMode`、登录请求的 `mode` 与 `POST /api/auth/switch-mode` 仅保留一个开发周期；
  新客户端使用 `workspaceMode` 和 `POST /api/auth/switch-workspace`。
- 跨工作区资源详情返回 `404`；同一校园工作区内已确认存在但权限不足的操作继续返回
  `403`，避免混淆作用域隔离与岗位权限。
- 从生产备份恢复的完整数据库已验证 8/8 迁移成功；但历史迁移
  `20260429_rename_to_id_v2` 自身不能在全新空库上直接重放，原因是其旧版用户字段重命名
  会产生重复 `userId`。该问题不影响当前远端数据库升级，但干净安装链仍需单独修复，且
  不应改写已经在生产执行过的迁移校验和。
- 历史设计和调研仅供追溯，参见 [归档索引](archive/README.md)。
