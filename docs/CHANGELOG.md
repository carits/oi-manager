---
status: current
audience: development, operations
last_verified: 2026-09-10
source_of_truth: Git history
---

# 变更记录

本文件记录 2026-07 起的重要行为变化。更早的详细记录保存在[历史变更日志](archive/LEGACY_CHANGELOG.md)。

## 2026-09-10

### Assignment、Contest、Rating、题解风控与 Blog 差异收口

- Assignment 学生读取统一受 `publishAt` 约束；管理者可带版本和原因设置人工完成，关闭/逾期/批改会按冻结策略幂等生成自动订正。
- Training 比赛变更统一维护既有 `Contest/ContestProblem` 规范聚合，状态、时间、元数据和题目 Revision 不再依赖单独迁移后保持同步。
- Rating 规则升级为 V2，榜单并列排序与 Rating 并列分组使用独立策略，V1 历史重放保持兼容。
- 题解相似度检查改为持久异步任务和不可变指纹；审核必须等待 READY，失败或历史遗漏任务可由题目管理员重试/补建。
- Blog 新增 PLATFORM 站内发现和 PUBLIC 匿名知识广场；评论回复使用游标分页；提交只能经作者显式创建的脱敏不可变快照引用，直接引用 Submission/JudgeRun 继续拒绝。
- 修复匿名 Blog 发现被后置 Data Market 认证 Router 拦截的问题，并统一发现列表分页 DTO；业务 Router 不再通过全局 `use(authenticate)` 影响其后注册的公开路由。
- 最终收口审计发现新写链路已同步但历史 Contest 聚合桥接尚未应用；新建并校验生产备份 `/data/backups/oi-manager/automatic/oi_manager_contest_bridge_20260910_115023.dump`（32 MiB，SHA-256 `6d61f380e547594260d0a55707cdb434ceee5415b0a2ccbb5d2ad0a517af628b`）后，仅在非活动 3303 slot 临时开放维护接口，通过受保护 check/apply 原子映射 767 场历史比赛与 199 个比赛题目，0 阻断。复核确认 Training/TrainingProblem 未映射数和重复映射数均为 0；3303 随后停机且临时 override 已移除。
- 发布前生产备份 `/data/backups/oi-manager/automatic/oi_manager_20260910_113248.dump` 已通过清单和隔离恢复审计（32 MiB，SHA-256 `f0a4612e3ede62bd0ca0e3f652c0286127ff1d29c89f7570c9a1fc55affb3da1`）；生产备份克隆完成四个新增迁移并通过真实 Judge/Hack 固定 Revision 闭环 2/2。
- Server PostgreSQL 全量 89 文件/709 项、Web 25 文件/93 项、Judge 14 文件/44 项、四端生产构建和全部静态门禁通过。提交 `9afde73` 已推送 `main`；API 3303→3302，Worker/Executor/Judge active，Web BUILD_ID `XLTM2M2Hgbut1h43ySAu6` 经 canary 与正式双账号消息闭环探针后提升，匿名 Blog 公网 API 已复核为 200。

## 2026-09-09

### 作业评分、Rating 重放、题解风控与博客社区收口

- 修复 Assignment 正式评分链：固定 Judge 满分后按比例映射作业分值，必做题按权重归一化，选做/挑战按显式策略加分；多道必做题必须全部有完成进度才结束作业，订正必须达到固定目标分。
- 作业草稿 UI 补齐发布时间、基础/选做/挑战计分策略，以及逐题类别、满分、目标、权重与完成条件；成绩矩阵和快照返回分项证据。
- Rating Standing 现在真实消费并校验冻结的 `scoringRules/rulesHash`，ACM 罚时与 OI/IOI 提交选择均可历史重放；个人 Rating 页面新增多池账户、曲线和比赛变化历史。
- 题解投稿新增正文/代码归一化相似度检查，只向审核者展示匹配证据并明确仅作风险提示，不自动判定抄袭。
- Blog 新增评论/一层回复、喜欢/有帮助、收藏、举报、证据审计、治理动作和社区精选；平台与超管获得统一治理页面。
- 复用既有 `Contest/ContestProblem` 方案，以唯一运行态和 TestSet Revision 外键建立 Training 比赛桥接及受保护的幂等 check/apply，不创建第二套 Contest 模型。
- 发布前自动备份 `/data/backups/oi-manager/automatic/oi_manager_20260909_171333.dump` 已通过 `pg_restore` 清单和隔离恢复审计，SHA-256 为 `d021f3c4ccc16168257be1a421ecf3cc7144f4e004e9fec3ba41e6426cd8c2de`；恢复库的四个新迁移、真实登录、Judge、程序资产激活、Hack `Accepted → Wrong Answer` 晋升和活动 Revision 冻结闭环 2/2 通过。
- Server 基于当前结构运行 698/702，四项差异均定位为 `prisma db push` 不会创建生产不可变触发器；在隔离运行器补齐同源触发器后，对应 Carits/Evaluation Credits/题解/Blog 26/26 通过。Web 25 文件/93 项、Judge 15 文件/45 项、Blog PostgreSQL 7/7、Shared/Server/Judge/Web 生产构建和 Prisma/模板/UI/API/架构/文档/路由门禁通过。
- 四个增量迁移已应用到生产；提交至 `35ffe62` 已推送 `main`。API 3302→3303 蓝绿切换完成，Worker/Executor/Judge 均 active；Web BUILD_ID `eq1UOUVU7vXIBPik933GN` 在 3200 canary 与 3000 正式端口分别通过双账号消息发送、SSE、已读和回复闭环探针后提升。

### Rating、质量、知识与数据市场统一生产发布

- Rating、TestSet DQS/PQS、题解、Blog/知识域和 Revision 数据市场已随提交 `0547fd1` 统一推送 `main` 并完成生产发布；贡献、Carits 与 Evaluation Credits 闭环继续作为统一账本和预算底座。
- 发布前数据库备份 `/data/backups/oi-manager/automatic/oi_manager_20260909_132853.dump` 已通过恢复清单和隔离审计（33 MiB，SHA-256 `5a179f85a0ef59451d62513704a799fc90269057eb30085221cda2cff03b1e91`），6 个增量迁移成功应用，当前共 55 个 migrations。
- Server 最终 86 文件/690 项、Judge 15 文件/45 项、Web 25 文件/93 项及所有新增领域定向测试通过；Shared/Server/Judge/Web 生产构建、Prisma、模板、UI、API、架构、文档和路由门禁通过。
- 修复 `/api/health` 因后置认证 Router 返回 401 的既有回归，liveness/readiness 现在在所有业务 Router 前公开注册且只返回最小状态。
- API 已由 3303 蓝绿切换到 3302；Web BUILD_ID `KnmV0By0XFpxTqNGEq30B` 经 canary 和正式端口双账号聊天写入/SSE/已读/回复探针后提升，公网健康、构建清单和 Revision readiness 已验证。

### Blog / 知识发布独立领域

- 新增账号级 Blog 草稿与不可变发布版本；每个版本固化发布时可见范围、组织范围、正文哈希、Series/Tags 和引用快照，历史 PRIVATE/ORGANIZATION 版本不会因后续 PUBLIC 发布而泄露。
- 结构化引用支持题目、固定 TestSet Revision、固定题解版本、最终比赛榜单快照和已应用 RatingChange；发布逐项执行可见性与归属校验，相关题目/比赛/题解/用户支持反向索引。V1 明确拒绝直接引用 Submission/JudgeRun，等待后续脱敏快照模型。
- Markdown 渲染契约禁用原始 HTML、可执行代码、危险协议和外部图片，保留 LaTeX 与 fenced code；博客不能直接成为正式题解，只能将固定博客版本复制为独立题解投稿草稿。
- 个人端新增博客列表、新建/编辑/预览/发布、版本历史、引用编辑、Series 顺序和受控 Tags；题目详情新增 Related Blogs。该批次完成隔离数据库、Web 契约和生产发布验证。

### Revision 数据商品、购买授权与事故处置

- 新增固定绑定不可变 `ProblemTestSetRevision + TestSetQualitySnapshot` 的 DataProduct；等级和三类许可证价格由服务端质量规则生成，客户端金额字段会被拒绝。
- 个人、组织与比赛许可证分别绑定购买者、Organization 与 `Training(type=contest)`；组织数据只允许 active teacher/principal，比赛数据只允许 Team owner/admin 或组织管理者读取，普通学生和参赛成员返回 404。
- 购买使用 UUID 幂等键与 Carits 平衡账本，首版资金进入 `RESOURCE_SINK`；Entitlement 固定购买 Revision，升级只追加授权版本，并提供按 `includes` 裁剪、逐次复核权限的 manifest 与对象下载接口。
- Critical 质量事故会立即停售并通知既有买家，修复后追加免费 Revision；历史 Purchase 证书、Snapshot 与旧授权版本保持不变。个人与平台管理端新增紧凑数据市场工作台；该批次已完成生产发布。

### 题解历史可见性与审核并发收口

- `ProblemSolutionVersion` 固化发布时的 visibilityPolicy；读取历史版本按版本本身重新鉴权，后续 PUBLIC 发布不再泄露旧 MANAGER_ONLY 内容。
- 审核和采纳增加投稿级事务锁与 expected-status CAS，冲突审核只有一个能落库；重复发布继续按来源投稿 Revision 幂等返回同一版本。

### TestSet DQS 与题目 PQS 质量底座

- 新增 Revision 级异步 DQS：任务固定 Revision、Wrong Corpus、Evaluation/Holdout、Feature、程序、Checker 和规则输入，使用租约、fencing 与有界重试；快照及任务输入均由数据库不可变约束保护。
- DQS 分离六维评分、Confidence 与 Maturity；正确性 Critical Gate 固定产生 `CRITICAL` 和空总分，Evaluation/Holdout 分别计算，完整证据仅题目管理者可读。
- DQS 在计分前通过 Judge 对去重后的物理测试点重放 Validator、OI Classifier，并以固定 STD 对完整 Revision 执行 Checker 自检；沙箱故障不会误发证书，正式输入或答案语义不一致直接进入 Critical Gate。
- 新增内容版本级 PQS 自动评估和平台专家追加审查；自动证据不可覆盖，专家分仅 platform_admin/super_admin 可写且同一版本只能提交一次。
- 新增版本化 Reference Solution Profile：只能引用本题固定 Revision 的本地终态提交，OI Subtask Quality 按预期总分/单 Subtask 区间验证得分梯度；Feature、Profile、程序和 Critical Incident 变化会使旧证书显示 STALE 并重新排队。
- 题目评测资产工作台新增“质量评估”，展示当前/历史 DQS、任务状态、Critical/NOT_READY、Confidence/Maturity、Reference Solution Profile 和 PQS 机器/专家结果。该批次已完成 Judge 语义验证、统一回归和生产发布。

### OI/IOI/ACM 比赛 Rating 独立领域

- 新增全局/组织 × OI/IOI/ACM 六类独立 RatingPool 与账户投影；比赛在开始或首交时冻结版本化规则，参赛资格和组织归属随首次提交原子固化。
- OI 使用最终提交、IOI 使用最好提交、ACM 使用解题数和罚时生成不可变最终榜单；Carits Multi-player Elo V1 使用并列感知的 pairwise Elo 和零和平衡取整。
- 结算生成不可变 Standing、Batch 和 Change；赛后重测会把比赛置为 HELD，完成后生成新榜单并从受影响 RatingPool 起点完整重放，旧 Batch/Change 只标记 superseded。
- 比赛编辑器增加 Rating 范围、权重和最低人数；排名页展示结算状态、最终榜单和组织/全局批次，个人/组织排名工作台可切换 OI、IOI、ACM Rating。
- 新增独立平台比赛工作台，让 `GLOBAL/BOTH` 成为可创建的真实产品路径；所有新组织、团队和平台比赛均显式创建默认 `NONE` 配置，团队 ACM 首版禁止误启个人 Rating。
- 平台 `BOTH` 比赛的多组织参赛者必须在首提前显式选择组织，首交后固化快照；同池到期比赛由后台按确定顺序结算，Serializable 冲突有界重试，榜单排名在完整结果集上计算后再分页。
- Rating 与平台比赛隔离 PostgreSQL 集成测试 19/19、Web Rating 契约 3/3、Server/Web 生产构建、全量组合回归和生产发布均已通过。

### 独立 Assignment 作业域收口

- 新作业使用独立 `Assignment`、固定 Revision 题目、名单快照、进度、订正/反馈、调分和版本成绩快照，不再用比赛排名模型承载作业。
- 题单“创建作业草稿”和已结束活动“创建补题作业”已改为创建 `DRAFT Assignment`，题目固定当前不可变 TestSet Revision，再由教师在作业工作台完成名单和策略确认后发布。
- 旧题单 `publish-homework` 和团队活动 `type=homework` 写入返回 `410 LEGACY_HOMEWORK_API_RETIRED`；旧数据继续可读并通过超管 check/apply 幂等迁移，不删历史记录或重评历史提交。
- 产品列表、教师草稿工作台和学生作业页使用同一 Assignment API；E2E 固定数据也改为独立作业，不再用旧 homework 活动验证新流程。

## 2026-09-08

### 贡献、Carits 与 Evaluation Credits 闭环

- 收口奖励重放证据：Candidate 的晋升事件改用跨规则版本稳定事实键，并校验正式 Revision；Reward Delivery 始终读取事件冻结的金额和规则，避免规则升级后重复贡献或按新价格补发。贡献、Hack、钱包和平台审计界面补齐组织归因、全生命周期、债务/余额阻断、免费与已购额度及最近兑换，不再把等待、拒绝或技术 Hack 成功误显示为已正式奖励。
- Candidate/Hack 被 Selector 正式晋升时在同一 Revision 事务写入版本化 `ContributionEvent`；普通 Candidate 记 100 贡献值/20 C，Hack 记 150 贡献值/30 C，紧急发布等待超管审核。
- 新增持久 `ContributionRewardDelivery` Worker，使用租约、fencing、UTC 用户/平台日上限和延迟重试；撤销已发奖励只新增不可变冲正交易，不回退 TestSet Revision。
- Carits 写入收口为排序加锁的平衡账本服务；数据库阻止 posted 交易追加分录，强制至少两条分录、总和为零和交易/账户聚合唯一。
- 个人可按服务端固定的 5K/20K/50K 套餐以 `1 C = 500 Credits` 兑换长期 Evaluation Credits；任务按免费日额度、已购钱包、平台预算预占，结算优先免费并释放未用已购额度。
- 贡献页展示 L0–L4、晋升事件和奖励状态；钱包页展示可用/负债 Carits、免费/已购 Credits 与购买弹窗；平台贡献审计对 platform_admin 只读、对 super_admin 开放处理。
- 贡献者可明确选择个人或当时有效组织归因，生成任务、Hack Attempt 和 Candidate 固定快照；首版组织匹配奖励仍为 0。
- 强一致审查后将数据生成/Candidate 评估任务与额度预占、取消及终态结算收进同一事务，并增加 30 秒 Reservation 对账器，幂等修复终态遗留、超过 10 分钟的孤儿预占和历史 `reserving` 记录。
- Evaluation Ledger 统一记录预占扣减与未用额度退回，当前预占统计只包含 `reserved` Reservation；管理者当日账户可安全升级到 100,000 上限。
- Carits 交易增加 `requestFingerprint`，相同幂等键只有在业务引用和聚合分录完全一致时才能重放，差异请求返回 409；购买 UI 在明确成功前稳定复用同一幂等键。
- 奖励 Worker 的终态写入同时校验 fencing token，日上限按 `posted + reversed` 毛发放量计算；连续失败 5 次后由超级管理员通过审计接口显式重试。
- 生产迁移前备份 `/data/backups/oi-manager/releases/20260909_000220/oi_manager_20260909_000220.dump`（SHA-256 `4651fb811d440d7b8e6b17add546f731db5e9b692bd28ba7f8d27c903282e4b7`）已恢复演练；干净库与生产升级结构哈希同为 `bd4a48be676df87d65aa5a061210eff57afc73905137da21ea94922aa33968d7`，48/48 migrations 已应用。economy-loop check/apply 确认异常账户、孤儿额度流水、不平衡交易和旧活跃预占均为 0，创建两个系统账户后关闭维护 API。
- Server 全量 78 文件/649 项、经济定向 37/37、Web 71/71、Judge 42/42、模板 8/8、四端构建与文档/API/架构/UI/路由门禁通过；后台调度器退出竞态由 `74e760f` 修复。API 已由 3303 提升至 3302，奖励 Worker 正式启用，Judge 完成重新注册；Web BUILD_ID `i2NpDFGhvzuTCOti5d250` 经候选与正式双账号消息闭环探针后提升。线上只读验收确认套餐、额度、钱包与贡献审计正常，且普通账户、交易、奖励投递、购买、付费钱包和 Reservation 均为 0，没有补发历史奖励。

### Training Engine 可视化顺序编排

- 新增组织与个人团队 DRAFT 训练的独立设计路由，创建后直接进入“阶段时间线 → 题目链 → 可用题目池”三栏工作台；运行工作台不再承担结构编辑。
- 阶段和阶段内题目均可拖动、上下移、复制和删除；题目可跨阶段移动或批量加入多个阶段。顺序链直接展示 AC/分数/时间/次数/教练放行及 ANY/ALL，OI 投影使用固定 Revision 中的真实 Subtask 多选。
- 题目池按组织题库、Carits 和其他题库分区，执行服务端搜索和分页；加入时固定当前正式 TestSet Revision，只有管理员显式点击才会更新到最新版本。
- 设计流程补齐基本信息、学员与分组、提示配置和发布检查；阶段可填写说明，单题可覆盖目标分与时限，聚焦阶段可配置策略切换间隔、最长连续作答和超时强制切换。
- 结构保存改为训练级 advisory lock + `statusRevision` CAS + 稳定 ID 差异更新，重排不再删除分配或 Hint；删除带 Hint 的分配必须显式确认。模板只创建阶段骨架，不再静默复制题目。
- Server/Web 构建、Training Engine 12/12、Web 69/69、UI 契约与 Chromium 双尺寸编排 E2E 2/2 通过；提交 `753eba6`、`c7adf0d` 已推送，API 已切换至 3303，Web BUILD_ID `k_PCi8emq6NI2vNOMnQ-q` 经候选与正式消息探针提升。

### 独立 Training Engine 教练流程收口

- 新增独立 `TrainingSession` 聚合，不再把教练训练伪装成比赛；Stage、固定 TestSet Revision、学员进度、命令、Overlay、草稿、提示、分数轨迹、策略决策与可补偿事件分别持久化。
- 教练可按全员、训练分组、团队或单个学员执行聚焦、锁题、禁交、消息、提示和个人放行；Focus 替换与结束会恢复每名学员原阶段/题目，服务端只向学员返回适用于本人的 Overlay 和事件。
- 后端统一执行顺序/分数/时间/提交次数/教练放行、FOCUS_ONLY、软硬暂停、目标分、OI Subtask 投影和 ACM 强制换题；训练提交与 JudgeRun 固化实际 Stage 投影，不依赖前端隐藏按钮。
- 心跳只累计 RUNNING、可见且编辑器聚焦的有效时间，分别记录会话、学员、题目和连续做题时间；完成/跳过状态不会被后续心跳覆盖。OI 达到目标分即可完成，HYBRID 推进必须同时满足时长和完成比例。
- 迟到加入支持 `CURRENT_STAGE/FROM_BEGINNING/TEACHER_ASSIGN`；显式名单不能经手工加入绕过，`FROM_BEGINNING` 学员完成落后阶段后只推进到不超过全班当前阶段的位置。
- 学生端增加自动草稿、提示、策略检查和按可见性裁剪的同学进度；教练端增加阶段规则、目标分、解锁条件、分组目标、暂停/推进/聚焦/提示/消息和个人干预入口。
- 生产迁移前备份 `oi_manager_20260908_124041.dump`（SHA-256 `19677368…2113cc`）并完成恢复演练；受保护迁移 API 将 384 条旧训练中的 378 条幂等迁移，6 条异常记录保持旧模型并列入报告。Server 全量、Training Engine 11/11、Judge 42/42、Web 69/69、双视口训练 E2E 8/8、四端构建和全部门禁通过。API 已由 3303 提升至 3302，Web BUILD_ID `VlK5d6fINiscMWP5LhkfH` 经候选与正式消息探针提升；线上训练读取、迁移 API 关闭状态和 P1345 模板回归均正常。

### OI Candidate、Wrong Corpus 与 11 选 10 Selector 收口

- OI 正式测试图增加不可绕过的结构上限：每题最多 15 个 Subtask，每个 Subtask 在全部 Official Group 与 Hack Gate 中去重后最多 10 个测试点；Test Graph、数据生成发布和 Revision 发布三层同时校验。管理员无错误语料时最多 Bootstrap 三个 Official Core，额外写入必须填写审计原因。
- Wrong Corpus 按 Current JudgeRun 的最终结果构建稳定错误程序样本，以 Verdict、分数、Subtask 和逐点行为聚类并固定 80/20 Evaluation/Holdout；每个 Subtask 独立显示 CLOSED、LIMITED、OPEN，只有达到 5 个错误程序和 3 个行为簇时才能自动选择。
- 新增持久 Candidate Evaluation 队列和 Judge 协议，依次执行 L1、L2 与 Hidden Holdout，保存 Kill Vector、语义/Feature 指纹、真实执行数和 CPU；任务使用全局单车道、租约、fencing token、三次基础设施重试，以及每轮唯一的用户/平台预算流水。未完成 Holdout 时 fail closed，不允许自动晋升。
- 技术有效 Hack 不再直接创建正式测试版本，而是进入共享 Candidate Pool。Selector 按错误簇覆盖、语义多样性、Feature、Hack 证据和成本计算集合价值；Subtask 满 10 点时执行 11 选 10，保护至少三个 Official Core、手工保护点、新点 7 天和有效 Hack 14 天，并要求替换增益达到 `max(50, 当前质量的 5%)`。
- 入选只创建下一不可变 Revision，退出成员写入追加式 `TestcaseMembershipRetirement` 审计而不删除旧数据。自动发布每题每小时最多三次；管理员紧急发布必须填写原因，且不能绕过结构、保护、Official Core 或 CAS。
- Candidate 管理页增加逐 Subtask readiness、真实 Selector dry-run、紧急发布标准 Dialog、永久保护测试点和成员替换历史。普通贡献者仍只获得安全的粗粒度状态，不返回 Corpus 源码、Kill Vector、Holdout 或内部权重。
- 最终回归中发现并修复两个状态机边界：LIMITED Corpus 仅保留观察结果，不会误建 `not_selected` Selection Run 或将有效 Hack 记为冗余；再次提交已进入正式 Revision 的 Hack 数据会持久化 `REDUNDANT` Candidate 与 Hack 终态，而不是在 Admission Gateway 提前中断审计链。
- 生产迁移前备份 `/data/backups/oi-manager/manual-release-20260908/oi_manager_20260908_021924.dump` 已验证（SHA-256 `e14e4578d8068b7a264a01fd68388a3e932d5b084ef711611677dce285dc0e09`）；46/46 migrations 已应用。Server 75 文件/606 项、最终并发 6/6、Judge 42/42、Web 69/69 和生产构建通过；API 已提升到 3303，Web BUILD_ID `BC8fg3mXA_gDllqfnwdve` 经候选/正式消息闭环探针后提升。

## 2026-09-07

### 评测程序模板与完整示例显性化

- 共享 Registry 的 8 个模板升级为 v2 完整教学包：STD 提供可运行的数组求和与期望输出，三类 Validator 提供合法、边界、越界、少 Token 和多 Token Fixture，两种 Classifier 提供单项、重叠和完整 JSON 示例，两种 Generator 同时提供源码、Parameter Schema、random/max Profile 与固定 Context。
- 评测资产首页新增常驻模板区，支持按四类职责查看完整示例、复制源码、下载完整包和一键载入；新增向导不再静默填入模板，必须明确选择模板或空白开始，Generator 配置与源码一起载入。
- Classifier 预览和编辑持续展示当前 Test Graph 的 ID、分值与依赖，Fixture 引用未知 Subtask 时立即阻断协议预检；模板仍只创建草稿，不能跳过 Judge 编译、Fixture 预检和人工激活。
- 模板目录响应收口为摘要，详情接口返回完整包；新增 API 契约、Web 模板契约和双视口浏览器流程，真实协议 smoke 扩展为执行全部非 DSL 内置模板。
- 新增线上 P1345 只读模板探针，使用短时会话验证桌面和手机界面，并保证探针前后活动 STD/Validator 身份不变。
- 已有模板草稿继续保留原 `templateVersion`，读取当前模板详情只用于展示和明确恢复，不会把 v1 草稿静默冒充或覆盖为 v2。
- 验收结果：模板静态检查 8/8、API 5/5、Web 69/69、真实 go-judge 非 DSL 模板 7/7、隔离 Chromium 双视口含登录准备 8/8，Shared/Server/Judge/Web 生产构建和全部 UI/API/架构/文档门禁通过。API 已由 3303 提升至 3302，Web BUILD_ID `4mA3AetlUgd8pw8CvNZOy` 经候选与正式消息探针提升；线上 P1345 在 1440×900 和 390×844 均显示 Classifier 完整示例、`当前题目 Subtask：1（100 分）` 及未知 ID 2、3 阻断，原活动 STD/Validator 未改变。

### 评测程序生命周期与协议链最终收口

- STD、Validator、Classifier、Generator 改为不可变版本和 `draft → compiled → verified → active → retired` 生命周期；创建源码不再同步激活，编译与 Fixture 预检使用带租约和 fencing token 的持久 Judge 队列。
- 新增统一五步管理向导、服务端草稿、结构化 Fixture、Generator Profile/Parameter Schema、验证报告和显式激活；Validator DSL materialize 与激活拆分，旧路由仅保留兼容语义。
- 正式数据生成只接受并在领取时复核当前 active 程序；普通 Generator 贡献强制完整 `oj.generator/v1` Manifest，Seed 由服务端生成并固化，旧 args 协议仅供历史管理员任务读取。
- 修复 Validator 负 Fixture 的非零退出被沙箱映射为 Runtime Error 后误判失败，以及基础设施重试耗尽误把程序标为编译失败的问题；C++ Classifier 支持系统 `testlib.h`。
- 增加 OI `Validator → Classifier → STD → Hack Gate → 100→0` 正向链、未知 Subtask fail-closed、资源释放与基础设施重试测试，并新增可重复运行的生产闭环探针；探针只创建不可见草稿题，不接触真实用户题目或输出认证信息。
- 生产发布前备份 `oi_manager_20260907_135823.dump`（SHA-256 `0053738c…e0c99`）已校验；两条增量迁移应用后为 45/45，历史程序协议 check/apply 为 0 条待处理、0 条歧义。Linux Judge 38/38、隔离 Server 定向 9/9、Web 68/68、模板 8/8、三端构建和真实 go-judge 协议 smoke 通过。
- 首轮线上探针发现 Candidate 管理 API 将 `affectedSubtaskIds` 暴露为 JSON 字符串；已统一修复为 `number[]` 并增加详情/池接口回归 7/7。复跑草稿题 #1043 完整完成 Validator、STD、Classifier、Generator 的异步编译、Fixture 预检和激活，正式生成数据发布 R1→R2，Generator Candidate 经分类命中 Subtask `[1]` 并安全停在 `awaiting_corpus`。提交 `75a5f6b`、`cfb71d8`、`05cc6f5` 已推送；API 活动 slot 为 3303，Web BUILD_ID `g9OnA4VVceF_lEBLM0QrE` 已提升。

## 2026-09-06

### 评测程序协议、模板与 Python 执行链

- 新增共享 Judge Program Protocol Registry，统一四类程序职责、语言能力、机器 Schema、帮助文本和 7 个版本化编辑器模板；C++ Generator 使用平台注入 `oj_generator.hpp`。
- ProgramVersion 记录协议、模板、运行元数据和预检报告，改为编译、Fixture 验证、人工激活、退役四段式生命周期；新建不再自动成为活动版本，创建/验证/激活分别审计。
- 数据生成与 Hack 共用 Judge Program Runner；Python3 Validator/Classifier 全链路可用，Classifier 输出执行严格 JSON/ID 校验。新 Generator 统一 `oj.generator/v1`，旧 `legacy-args-v1` 仅兼容历史。
- 管理端改为职责卡、推荐模板、协议说明、源码编辑、预检和激活工作流；普通贡献端明确无需提交 STD/Validator/Classifier，并为两种 Generator 自动填充模板。
- 增加超管 check/reportHash/apply 协议迁移、模板编译 CI 门禁和协议/Runner 定向测试。三端生产构建、7 个模板编译和 Judge 15/15 定向测试通过。

### 平台内置聊天表情包

- 新增不可变 `ChatStickerPack/ChatSticker` 和带 `reportHash` 的暂存导入；ZIP 素材经过路径、体积、格式、尺寸、帧数及时长检查，并统一重编码为 WebP 与静态 poster 后进入内容寻址 Blob。
- 私信发送兼容 `text/sticker` 判别类型，表情点击即发并复用现有幂等、序号、限流、未读与 SSE；会话摘要和旧客户端使用安全降级文本，退役只禁止新发。
- 消息页新增统一 Popover 表情选择器、账号隔离最近使用、减少动态效果、加载失败回退；表情消息无复制操作但可举报，举报证据保存不可变表情身份。
- 隔离 Chat API 20/20、Chromium/紧凑视口/Firefox 11/11、Web 66/66、干净库 122 表/43 迁移、三端构建和 UI/API/架构/文档门禁通过；跨平台测试素材改由 Sharp 生成，避免固定 PNG 在 Linux 严格解码器中失败。
- 提交 `bd66ec0`、`a72367a`、`4a01006`、`536027e` 已推送。生产迁移前备份 `oi_manager_20260906_172435.dump`（SHA-256 `53bdb5be…c9b13da`）已校验；API 已提升至 3303，Web BUILD_ID `hqzO1qRwh2oQdWom08XiR` 经候选和正式消息探针后提升。
- 使用授权目录素材发布 `小狐狸日常` v1：“你好、谢谢、好的、收到、OK”5 个静态表情均规范化为 512×512 WebP。线上 10 个内容/poster 资源读取及专用双账号真实表情发送、接收、已读和双方清理均通过，普通用户端表情入口已自动开放。

### 私信消息气泡与操作收口

- 修复对方头像落在消息 footer 高度的问题，消息分组头像现在与首个浅色气泡顶部对齐；对方气泡增加卡片背景、边框和轻阴影，自己的主色气泡缩减内边距及最大宽度。
- 消息较少时内容靠近输入区，空状态继续居中；输入框从单行约 58px 开始，按内容自动增长并限制在 140px。
- 常驻“举报”文字改为 `⋯` 消息菜单，桌面 hover/focus 显示、移动端直接可用；菜单向上展开，包含复制与举报。复制在非安全 HTTP 环境提供选区 fallback，Menu 选择操作后统一关闭。
- 浏览器测试新增头像/气泡顶部对齐、气泡背景对比、底部距离、菜单可见性、复制反馈和输入高度断言。Chromium、紧凑视口与 Firefox 发布回归 11/11，Web 65/65；提交 `b20da3b` 已推送，Web BUILD_ID `d8rPI4GL7PPkELpvrrR-i` 已通过候选及正式生产探针并提升。

### 私信头像与聊天视觉优化

- 新增统一 `UserAvatar` 组件，集中处理资源 URL、Unicode 首字符、图片加载失败、尺寸和可访问语义，并替换 AppShell、管理身份单元格及聊天内的重复头像实现。
- 最近会话、聊天头部、搜索、联系人、联系申请和黑名单增加头像；会话列表展示降噪时间与摘要，选中态改为浅色背景和左侧指示线。
- 消息区使用弱背景与紧凑无边框空状态，时间改为今天/昨天/本年/跨年规则；连续三分钟内的对方消息分组并只显示一个小头像，自己消息不重复显示头像。
- 继续保持首版纯文本边界，没有加入不可用的附件按钮。Web 65/65、生产构建、UI 门禁和聊天发布回归 11/11 通过；提交 `cbc909d` 已推送，Web BUILD_ID `dPUk9Ykw9jXrMCwuyiA8F` 已通过候选与正式消息探针并提升。

### 私信动作级测试与生产闭环探针

- 新增三个隔离 E2E 账号和双浏览器真实动作测试，覆盖用户发现、联系申请、SSE 实时接受、会话创建、发送、未读、回复、已读、历史恢复、窄屏和 Firefox。
- 浏览器测试主动移除 `crypto.randomUUID`，确保 HTTP 环境走兼容 UUID；模拟服务端已提交但响应丢失时，草稿保留且重试复用原幂等键，避免重复消息。
- 新增消息事务、SSE 新事件、双向并发序号和失败无半写入集成测试；四项关键竞态固定重复 10 轮。
- 修复普通全局 `user` 无法进入账号和个人页面的权限壳遗漏。
- 新增两个无组织、团队或发现能力的生产探针账号；Web 候选和正式提升均真实执行发送、SSE 接收、已读和回复，失败会阻断提升或恢复上一版本，探针日志不输出正文和凭据。
- 验证结果：Server 588/588、Chat 19/19、Web 64/64、Chromium 桌面 8/8、紧凑视口 7/7、Firefox 8/8；提交 `4037aea` 已推送，Web BUILD_ID `QdHV_MBCtFlhP4XDwex_m` 已通过候选和正式两轮消息探针并提升。

## 2026-09-05

### HTTP 环境私信发送修复

- 修复线上 HTTP 页面缺少 `crypto.randomUUID()` 时，私信发送在浏览器端抛错且请求未到达 API 的问题；所有浏览器侧幂等键统一改用带 Web Crypto 降级路径的 `createClientUUID()`。
- 私信发送流程增加异常兜底和 `finally` 状态恢复，客户端异常会明确提示，不再表现为点击后无响应。
- 提交 `476a66f` 已推送并提升 Web BUILD_ID `v_dHMnaNbaYLtspzJb-VK`；Web 63/63、生产构建及全部静态门禁通过。

### 私信正确性、实时性与生命周期整改

- 修复超过 100 条消息时首次打开返回最旧消息的问题；消息支持最新页、beforeSeq 历史和 afterSeq 实时补偿，会话支持 active/archived 稳定游标分页。
- 认证外壳使用单例 ChatProvider，每标签页仅一条 SSE；首次连接从当前事件尾部开始，重连保存 cursor，过期时统一 resync，事件按 100ms 合并并局部刷新。
- 修复快速切换会话错窗、草稿串联系人、IME Enter 误发、未读不同步和历史阅读被强制滚动；补齐归档、恢复、单方清空、移除联系人和拉黑交互，界面统一采用“联系人”。
- 发送幂等检查前置于限流，事务内重查账号状态；RealtimeHub 隔离后台失败并将兜底扫描降至 30 秒。维护任务改用持久游标，终态举报满一年后释放证据原文和消息引用。
- 最终并发审计统一了事件、会话成员和联系人关系的锁顺序；已读/清空/归档与发送串行，接受联系申请与拉黑使用同一用户对锁，避免矛盾关系。消息、联系申请和举报的硬限流改为事务内账号锁计数，不能被并发请求穿透；瞬态数据库冲突执行有界幂等重试。
- 举报终态处理支持安全重试且不重复写审计；不存在记录明确返回 404。当前 Server 全量回归 584/584、聊天 15/15（关键竞态重复 5 轮）、Web 61/61，三端构建和全部门禁通过。
- 最终整改提交 `ea87788` 已推送并完成蓝绿发布；当前 API slot 为 3302，Web BUILD_ID 为 `5E91W4lE0MwI1SKTCKElt`，Judge/Worker/Executor 已重启，线上登录态会话、未读和 SSE ready/heartbeat 探针正常。

### 好友前置的一对一私信

- 新增好友申请、好友、账号隐私和方向性拉黑；共享组织/团队可模糊搜索，跨关系完整用户名搜索默认关闭。
- 新增账号级一对一会话、幂等文本消息、事务未读、归档/单方清空，以及 PostgreSQL 持久事件与 SSE 断线补偿。
- 新增用户消息中心、页头独立私信未读入口和平台举报工作台；举报证据有限快照，管理员每次查看均写平台审计。
- 增加每小时好友过期、事件回收、未读修复和双方清空消息延迟清理；Nginx 与 API drain 已适配 SSE 长连接。
- SSE 浏览器客户端改为可恢复的流式请求，同时支持 Cookie 和旧 Bearer 会话，重连携带 `Last-Event-ID`，账号级连接不会发送组织作用域请求头。
- 生产数据库迁移、API 蓝绿和 Web canary/promote 已完成；当前 API slot 为 3302，Web BUILD_ID 为 `WjaW8nMU1yJrXhTenAtpR`。Web 58/58、Chat/Notification 定向 10/10、三端构建及全部静态门禁通过，线上认证接口与公网 SSE `ready` 探针正常。

### 学校历史数据隔离与目录治理

- 学校新增 `pending/verified/hidden/legacy` 目录状态；公开目录只返回 verified，legacy 同时从本人组织、工作区、组织上下文、申请和邀请中隔离。
- 新增带报告哈希的历史学校 check/apply 迁移，按稳定 ID 隔离测试/临时学校并完整保留成员、团队、活动、题单和提交引用；legacy 不再占用正式学校名称。
- 超管学校管理增加目录状态分页、搜索、关联摘要、隐藏/核验/隔离和恢复操作；所有变更保存原因、并发版本和平台审计。
- 生产迁移已隔离 4,901 所历史测试学校并幂等复跑；18,865 个成员关系、942 个团队、552 个活动和 780 个题单引用保持不变。定向 Server 11/11、三端构建与全部静态门禁通过，API 已提升至 3303，Web BUILD_ID 为 `qfGQBna1fp-VWGNOvhZXc`。

### 学校创建申请、平台审计与名称防重

- 新增独立的学校创建申请与超管审核流程；申请批准和超管直接创建共用同一原子创建服务，不修改申请人的全局角色。
- 新增平台级审计、账号通知、单 pending、频率/冷却限制、学校规范化名称唯一约束和并发审批冲突处理。
- 个人组织页增加创建申请持久状态，超管学校页增加创建申请标签和审核弹窗，学校的加入策略改由独立“加入设置”管理。
- 生产备份检测到历史测试 School 存在标准化重名，回填按设计 fail closed，不自动删除/合并；新申请和新建学校仍会检查这些未回填历史名称。

## 2026-09-04

### 组织申请、独立邀请与账号通知上下文

- 新增学校加入策略、主动申请、独立邀请、组织审计和幂等迁移模型；现有学校默认仅邀请，负责人可开启审核申请或关闭加入。
- 普通教师只能邀请和审批学生，批准后学生固定归属该教师；教师申请仅负责人可处理。active/disabled/archived Membership 分别执行阻止、禁止自助恢复和原位恢复。
- 通知改为账号级与具体组织级上下文聚合，学校邀请在个人空间可见；未读通知与待审核业务数分别计算。
- 新增“我的组织”、学校管理申请/邀请标签、WorkspaceSwitcher 加入入口和完整消息中心，所有表单复用统一 FormDialog。
- Prisma、Server/Web/Judge 生产构建、Web 57/57、API 鉴权审计、路由及 UI 门禁通过。生产备份克隆成功应用新增迁移，组织加入与旧邀请迁移 5/5 通过；验证同时修复 clean bootstrap 缺少组织 partial unique index、数据生成关系外键及 Candidate 枚举顺序与升级库不一致的问题。全新安装与生产备份升级均得到 107 张表，规范结构签名一致（SHA-256 `ab451b69…5a6e5d00`）。
- 发布探针发现并修复组织 Router 的无路径认证中间件误拦 `/api/readiness`；新增公开后继路由回归后，提交 `591fc36` 已推送 `main`。迁移前 31 MiB 备份 `oi_manager_20260904_231337.dump` 已校验，生产迁移与通知 check/apply 完成：0 条旧 Membership 邀请、43 条通知解析到组织、43 条不可可靠归属通知安全退役、复查遗留 0。API 3303→3302，Web BUILD_ID `O-16nqPRAhL2BZapkVbku` 已提升，组织目录/本人组织/通知接口均为 200，Judge 1012 重连认证成功。

## 2026-09-03

### Carits 平台题库与其他题库恢复分区

- 个人题库和教师的平台题库恢复“Carits 平台题库 / 其他题库”两级来源标签；默认进入 Carits，其他题库再按洛谷、Codeforces 等主来源筛选，列表和分页不再混合。
- 服务端 `GET /api/problems` 增加 `sourceGroup=carits|external` 数据库级过滤；缺少参数保持旧混合查询兼容，非法分组和冲突平台返回明确 400。来源分组只依据 `Problem.platform`，外部绑定不会移动 Carits 本地题。
- 校内题库和平台管理员题库管理保持不变；搜索关键词在来源标签间保留，平台筛选与页码在切换时清除。

## 2026-09-01

### 比赛评测记录筛选布局修复

- 比赛、训练和作业内的评测记录筛选区从全宽控件逐项占行改为带持续标签的响应式 Grid；管理员桌面端按“题目、用户名、评测结果、语言、重置”单行排列，参与者按权限自动省略用户名或隐藏题目来源。
- `960px` 以下降为两列，`560px` 以下降为单列等宽；重置操作在手机端占满可用宽度，筛选区和数据表之间不再出现大面积无效空白。
- 新增比赛管理员桌面单行和参与者手机单列、无页面横向溢出的浏览器回归断言；Web 单测、类型检查、UI 组件门禁和生产构建通过。

### 提交详情测试点折叠与来源信息优化

- ACM/OI 详细测试点改为默认折叠的键盘可用 Disclosure，总 Verdict、OI 总分和 ACM 首个失败点保持可见；展开后继续使用弹窗外层单纵向滚动。
- 来源统一显示“平台 · 原始题号”，活动优先使用固定来源快照；赛中隐藏原题身份时字段从响应省略。详情界面删除远端记录展示，后端远程 ID 与归档抓取能力保持不变。
- Server 权限/详情 21/21、OI 原题隐藏 1/1、Web 57/57、隔离 Chromium 10/10 通过。提交 `ba6ee1a` 已推送 `main`，API 3303→3302，Web BUILD_ID `4rLL5mW5zC7ZWDwN5JxWr` 已提升；生产 #3677 来源和 20 个测试点只读验证正常。

### 评测记录与提交详情强一致性重构

- 全局提交详情和比赛/训练详情改为同一个 application service：活动成员、开始时间、本人/管理员、题目来源隐藏、代码与远端 ID 权限只计算一次，route 不再维护第二套 DTO。
- 修复全局 `/api/submissions/:id` 可绕过 OI 赛中脱敏的问题。非管理员从任一端点访问均只得到“已提交”，真实 Verdict、分数、资源指标、测试点、Subtask、错误和远端 ID置空。
- 弹窗与独立详情页改为共用 Hook、类型、状态机和内容组件；修复 Codeforces 归档代码重抓路径。403/404 不再显示误导性的重试，临时错误使用局部重试并保留请求编号。
- 详情摘要、结果、文件 IO、代码权限和空状态统一；代码内容使用弹窗最外层纵向滚动，仅保留超长行横向滚动。列表含 Queuing/Judging 时自动刷新，详情终态会同步回列表。
- 新增 OI 双端点脱敏、永久错误无重试和单纵向滚动条回归；个人工作区 teacher/school_principal 本人详情权限修复随本批 API 一并发布。
- Server 提交权限 21/21、OI 原题隐藏定向 1/1、Web 57/57、隔离 Chromium 10/10 通过。提交 `4e4b19d` 已推送 `main`，API 3302→3303 蓝绿提升，Web BUILD_ID `VxV3DoXrP-Ole9yMHoVa5` 已提升至公网 3000；生产 #3824 只读验证、readiness 与服务监控正常。

### 评测记录列表弹窗与个人提交详情权限

- 评测记录列表恢复整行打开详情弹窗，保留题目、用户链接和 `/submissions/[id]` 独立深链；弹窗与独立详情对 401/403/404 等永久错误停止轮询，对网络、超时、限流和 5xx 临时错误继续定时重试。
- 修复个人工作区教师和校园负责人查看本人提交仍落入校园成员校验的问题。个人区现在对普通账号统一仅允许本人提交，查看他人返回 404；校园学生、校园教师/负责人和全局管理员原有边界保持不变。
- 新增 teacher/school_principal 个人列表与详情权限回归、轮询策略单测，以及个人提交列表实际点击弹窗 E2E。Server 69 文件 550/550、Web 13 文件 55/55、Judge 10 文件 30/30、隔离 Playwright 7/7 通过；Server/Web/Judge 构建、导航与 UI 契约、运行时及安全审计通过。
- 发布前 `pnpm db:install-paths:verify` 暴露与本改动无关的现存安装路径差异：空库与正式备份升级库在 4 个外键和 `TestcaseCandidateStatus` 枚举顺序上不一致。本批未修改 Prisma 或迁移；列表弹窗的 Web 部分已经随下述前端构建上线，个人教师/校园负责人详情权限的 Server 部分仍未提升到活动 API。

### 评测记录筛选布局与键盘焦点修复

- 修复统一表单控件 `width: 100%` 与旧 Flex 工具栏冲突导致的平台、结果和语言选择器逐项占整行、题号孤立、操作按钮错位的问题；评测记录改为有可见标签的响应式筛选 Grid。
- 个人记录页只描述并筛选本人可用的“平台、题号、评测结果、语言”，教师/管理员视图按权限增加用户名；空选项统一为“全部结果”和“全部语言”，表单 Enter 与筛选按钮走同一 URL 查询逻辑。
- 可点击表格行新增 Token 化 `focus-visible` 边界，覆盖浏览器默认黑色 `tr` outline，同时保留键盘定位反馈；表格补充隐藏 caption。
- Web 57/57、类型检查、生产构建、UI 组件门禁和 64 路由静态审计通过；服务器隔离 Chromium 覆盖管理员、校园学生、详情弹窗、1600px 桌面与 600px 窄屏共 10/10。提交 `09204f5` 已推送 `main`，Web BUILD_ID `Y6VnrxGmIxELCjtl3BKge` 已通过 canary/health 并提升到公网 3000；服务监控、外部健康和最近 Web 错误日志正常，API 与数据库未变更。

## 2026-08-31

### 提交级文件 IO Adapter 与旧 FileIO 安全迁移

- 题库、比赛/训练提交和 Hack 证明程序新增独立输入/输出文件选择；文件名固化在 Submission，并在每个 JudgeRun 创建时复制，重测继续沿用原执行意图。文件名参与幂等指纹，路径、保留名、输入输出同名及不支持题型统一返回 422。
- Judge 将旧单一 `{prefix}.in/.out` 分支重构为四组合 IO Adapter。每个测试点和本地 fallback 使用独立运行目录；文件输出缺失按空输出进入 Checker并记录点级诊断，stdout、stderr 与文件输出分别按 UTF-8 字节数限制，基础设施读取失败与用户 Verdict 分开处理。
- STD、Validator、Generator、Classifier 和 Checker固定使用标准 IO；Hack baseline/candidate 共用证明程序 IO。Wrong Corpus 执行指纹加入输入/输出文件名，防止同源码不同执行方式错误去重。
- 新增超级管理员 `check/apply` 迁移接口，按提交固定 Revision 的旧 `filename` 幂等回填 Submission/JudgeRun；旧 Revision 保持不可变，历史结果、成绩和排行榜不重测。评测设置不再写入源码题 FileIO 前缀，旧题仅向提交框提供可修改建议。
- Linux 隔离回归为 Server 68 文件 547/547、Judge 29/29、Web 45/45；新增迁移与 IO 定向 32/32 通过。真实上线四组合首轮发现 WebSocket Judge Client 丢弃新增 IO 字段，补充协议映射回归后 Judge 30/30，文件输入/输出三种模式重测均 Accepted。
- 生产迁移检查为 2518 条可解析、183 条 FileIO、0 条异常；apply 迁移 2518 条并二次检查保持 0 待处理，迁移前后原 2586 条 Submission 的 Verdict/分数分布不变。缺失命名输出真实返回 WA 且点级 `outputFileMissing=true`，非法路径返回 422。提交 `2f85f61` 已推送 `main`，API 蓝绿提升到 3302，Judge 重启，Web BUILD_ID `2lhep8Ied7CIZOrw7KVGm` 已提升到公网 3000；361 端点匿名审计和生产监控通过。

### 贡献数据就绪状态与任务进度

- 新增统一贡献 readiness，STD、Validator 只有编译通过且激活后才能接收 Candidate；OI 缺 Classifier 时允许完成技术验证，但安全停留在等待分类，Wrong Corpus/渐进评估器未就绪时不会用占位价值晋升。
- Candidate POST 立即返回贡献任务 ID；新增本人/题目管理者任务查询，按 Generator、Validator、STD、去重、分类、价值评估和 Candidate Pool 展示安全阶段，普通用户不获得其他贡献者、Kill Vector、Holdout 或隐藏 Feature。
- Validator DSL 激活会同步物化不可变 Validator 程序版本；普通贡献统一使用激活资产，OI 数据生成可运行 Classifier 并记录 Subtask，Hack 仅在固定到当前程序版本时开放。
- 题目页增加贡献条件卡、明确阻断与警告、管理员配置入口、直接数据/Generator 流程说明、禁用原因和任务时间线；缺少硬前置时不再展示可填写但无法提交的编辑区。

## 2026-08-30

### 有界 Candidate Pool 与评估资源边界

- 数据贡献、Generator、管理员导入与技术有效 Hack 统一写入 `TestcaseCandidate`；Candidate 具有来源、目标角色、基础 Revision、程序版本、阶段、价值、语义指纹、生命周期和晋升指针。Hack 不再绕过候选记录直接写测试数据，正式晋升仍复用不可变 Revision、题目锁和 CAS。
- 新增用户/平台双层 Evaluation Credits，预占、真实结算和失败释放均使用幂等流水；普通用户与题目管理者分别受日额度约束，平台总池提供额外硬上限。当前 2 核生产拓扑的 Candidate 数据生成全局并发固定为 1，Judge 调度采用提交/Hack/Candidate `8:1:1` 权重。
- 新增全局 SHA-256 `BlobObject/BlobReference` 双写兼容层。Candidate 原始输入和答案去重保存，引用释放后等待 30 天才可 GC；GC 与写入使用同一 advisory lock，仍有 Candidate、Revision 或其他业务引用的对象不会删除。
- 新增版本化 Validator DSL、Feature 定义和 Subtask Rule。DSL 由可信模板生成 C++17/testlib Validator，支持标量、数组、矩阵、边集及常用数组/图断言；真实沙箱编译回归发现并修复 `readLong` 重载歧义。DeepSeek 默认返回 DSL，C++ Validator 保留为显式 fallback，AI 结果仍需人工保存和激活。
- 新增私有 Wrong Behavior Corpus 的安全回填骨架、固定 80/20 Evaluation/Holdout 分层、Candidate Pool/Selector 预览与策略页面。当前行为聚类仍处于 bootstrap/观察能力：历史本地错误提交只生成不暴露源码的代表簇；非 Hack Candidate 在完整分级评测器上线前不会自动晋升。技术有效 Hack 可按自动策略与每题每小时 3 次上限晋升，既有活动固定 Revision 和历史成绩不变。
- 题目页对所有可提交用户提供“贡献数据”；即使未启用 Hack，也可提交直接数据或 `oj.generator/v1` 的 C++17/Python3 Generator。Generator 使用 JSON stdin，并以相同 Seed 连续执行两次校验确定性；服务端限制每用户同时一个贡献任务、每题一个数据生成任务和单点 16 MiB。
- 平台 AI 管理页增加 Candidate Credits、HOT 数据、全局 Blob/孤儿对象和用户消耗视图。生产扩展迁移 `20260830_bounded_candidate_pipeline` 与默认策略迁移 `20260830_candidate_selector_auto_default` 已在可恢复备份后应用。
- Server 全量 529/529 与最终边界定向 10/10、Judge 20/20、Web 45/45、三端生产构建及 UI/API/架构/文档门禁通过。提交 `9c95028` 已推送并蓝绿提升到 API 3302；Judge 完成重连注册，前端 BUILD_ID `U5-dMerIgwkJMw9v0A8Xb` 已提升到公网 3000。

### GitHub 异机公网探针（等待 Actions 账单恢复）

- 新增私有仓库 GitHub Actions 异机探针，每五分钟从 GitHub Runner 检查 Nginx API、Nginx 登录页和公开 `3000` 登录页；失败时只创建一个固定标题 Issue，持续故障不刷屏，恢复后自动评论并关闭，且不依赖仓库 Secret。
- 工作流语法、调度、权限、探针和 Issue 状态机静态门禁已加入安全基线。真实手动 Run `33290187717` 在分配 Runner 前被 GitHub 拒绝，官方注解为账号近期付款失败或消费上限不足；为避免无效计划任务堆积，工作流已设为 `disabled_manually`，待所有者修复 Billing 后再启用并完成实际故障/恢复验收。

### 持久化运维调度

- 将五分钟服务监控、每日数据库/资产备份、每周数据库/资产恢复验证和安全基线从用户 Cron 迁移到六个 `Persistent=true` systemd timers；主机停机错过的日历任务会在恢复后补跑，最近执行结果、下次时间和日志统一由 systemd/journald 查询。
- 新增受限的 `oi-manager-operations@.service` 与任务白名单分发器，固定以 `ecs-user`、`NoNewPrivileges`、资源上限和只读仓库运行，仅允许写 `.run` 与私有备份根。安装器先启动一次监控并确认成功，再移除重复 Cron，失败时保留旧调度作为回滚路径。
- 生产监控新增 Timer 启用、活动状态、触发服务和最近结果检查；运行时审计与安全基线覆盖全部必需 Timer。故障注入验证缺失 Timer 会 fail closed，当前生产六个 Timer 均已启用且监控健康。
- 运维任务仅 `Wants/After` Docker 而不 `Requires` Docker，确保 Docker 故障时监控本身仍能启动、取证和告警；事故与日志采集先使用 `ecs-user` 已有的 `adm/systemd-journal/docker` 权限直接读取，再在交互式回退场景尝试 sudo，与 `NoNewPrivileges` 沙箱兼容。
- 生产以真实 systemd 沙箱逐项运行六类任务：监控、安全基线、31MiB 数据库备份、2920 文件资产快照、90 表数据库恢复和约 1.53GB 资产恢复全部 `Result=success`；Timer 随后自动触发的监控同样成功，不以手工脚本结果代替调度验收。

### 评测资产、数据生成与 DeepSeek Validator

- 新增不可变 `ProblemJudgeProgram` / `ProblemJudgeProgramVersion`，统一管理 C++17 STD、Validator、OI Classifier 以及 C++17/Python3 Generator。源码上传和编辑共用沙箱编译检查，拒绝二进制、NUL、超限源码和跨题目版本引用；Hack 配置可引用程序版本并保留旧源码双读兼容。
- 新增独立持久化数据生成队列。参数清单和直接输入逐点经过 Generator、Validator、STD、Checker 自检，保存阶段、耗时、参数、种子、预览和内容哈希；任务领取使用租约与 fencing token，题目锁阻止并发创建，延迟结果和重复回传不能覆盖新 owner。
- 候选测试点由管理员显式发布：ACM 按顺序加入，OI 只能分配到 Official Group，Hack Gate 保持只读。发布复用题目 advisory lock、内容寻址对象、TestSet Revision CAS 和单向 Judge 投影；重复输入或旧 Revision 返回明确 409，固定活动和历史提交保持不变。
- 题目评测设置新增“评测资产与生成”工作台，包含评测程序、`.in/.out/.ans/ZIP` 数据导入、参数/直接输入生成、候选预览与 OI Group 分配、正式 Revision 记录。平台管理员增加 DeepSeek Token 总池页面。
- DeepSeek Validator 仅接受官方 Markdown 题面，使用不可信内容分隔提示返回结构化约束、EOF 规则、假设和 C++17 `validator.cpp`，再以系统 `testlib.h` 沙箱编译。结果必须人工审阅保存，最多两轮关联修复，不会自动启用或发布数据。
- 题面翻译、格式化和 Validator 生成统一进入平台 Token 池：调用前预占、供应商返回后按真实 prompt/completion/total Token 结算，网络失败释放，缓存命中不消费，settle/release 只允许一个终态。额度调整使用幂等键和不可变流水。
- 数据库迁移前完成 31 MiB 可恢复备份并成功应用 `20260829_judge_assets_ai_validator`。Server 全量 61 文件 520/520、最新 Token/Validator/Revision/Hack 定向 19/19、Web 12 文件 45/45、Judge 8 文件 20/20、三端类型检查、UI/路由/文档/架构门禁通过。

## 2026-08-29

### 全链路监控、事故证据与长期安全基线

- API 新增原子运行快照，记录端点 2xx/3xx/4xx/5xx、P50/P95/P99、外部调用、缓存、RSS/Heap、事件循环以及审计/安全事件；活动蓝绿 slot 各自持有快照，退出和未捕获异常前强制刷新。
- Judge 新增连接/认证/心跳、在途任务、提交/Hack 时延、结果计数、编译缓存和进程资源快照；业务状态快照统一检查 JudgeRun、Attempt、Rejudge、Hack、Candidate、OJ Fetch 陈旧记录及 Revision 投影差异。
- Web 捕获浏览器 error、unhandled rejection 和脚本/样式/图片加载失败，以匿名、限流、严格字段白名单端点上报；凭据和 URL 敏感参数脱敏，原始堆栈不写日志。
- 监控新增快照新鲜度、端点 5xx/P99、事件循环、内存和 Judge 心跳阈值。第一次失败状态转换会先生成受保护事故证据包，再发送告警；证据包包含服务/主机/日志/快照/配置哈希而不包含密钥或数据库内容。告警入口只接受绝对路径可执行文件，不再执行任意 shell 片段。
- 完成第二轮反向审计：API/Judge 改为 5 分钟/1 分钟滚动窗口，端点维度限定 512 条并对溢出 fail-closed；增加外部依赖失败、浏览器/安全/服务端异常、Judge 基础设施错误、队列积压、数据库连接/长事务/锁等待、所有 systemd 单元、重启增量、磁盘/inode 和公网端口暴露监控。
- 自动备份默认保留 14 天，备份/监控/事故/日志目录与文件收紧为 `0700/0600`；每周真实恢复最新备份到隔离临时数据库，原子保存备份哈希、表/迁移/用户计数，失败状态立即进入监控且不会被旧成功掩盖。
- 新增周安全基线及 90 天私有报告：实际执行运行时安全契约、存量 OJ 密文解密、端口暴露、资源限制、TLS 工具和生产依赖审计，监控校验报告状态、新鲜度、文件存在和 SHA-256。
- 部署后反向审计发现 API、Worker、Executor 的 `NODE_ENV` 仍为 development；现已统一固定为 production，并由滚动快照和 systemd 进程环境双重监控，防止部署模板回退。`APP_ENV=development` 仅作为当前 HTTP 兼容标记保留，待域名/TLS 到位后与 Secure Cookie、严格 Origin 同步切换。
- 第三轮恢复审计补齐此前未备份的 716MB 测试数据与 46MB 上传资产：每日生成 14 天增量硬链接快照、逐文件 SHA-256 清单并固定关联数据库 dump 与创建清单；缺少清单、字节哈希不符或身份不一致时拒绝生成和恢复。每周完整复制到隔离目录恢复并逐文件验签。数据库 dump 同时新增创建时行数/哈希清单，恢复需精确匹配用户、题目、提交、文件和 TestSet Revision 计数；事故证据自动保留 90 天并包含资产恢复状态。
- 监控状态改为由稳定检查码驱动：同一故障的动态详情、年龄或端口错误文本变化不会重复生成事故包和告警，只有失败集合变化或真正恢复才产生新通知；隔离验证覆盖详情变化仍只发送一次 failed/recovered。
- 新增生产资产恢复命令：必须显式提供快照、配对数据库 SHA-256、确认目标与 `--apply`；执行前完整验证并创建回滚快照，停写后只替换精确的 `testdata/uploads` 根，逐文件/链接验签，失败或 readiness 异常自动回滚。隔离验证覆盖数据库哈希错配与目标确认失败的 fail-closed 行为。
- 部署探针发现 body-parser 的畸形 JSON 被全局错误边界误记为 500；现统一返回 400 且不记录原始请求体，避免无效流量污染服务端 5xx 告警。
- 新增统一策略文档，固定 SEV 等级、告警响应、RTO/RPO、证据和日志保留、发布/周/月/季度安全周期以及外部资源边界。Server 60 文件 518/518、Web 12 文件 45/45、Judge 7 文件 18/18、三端生产构建、UI/架构/文档门禁、生产依赖零已知漏洞及自动验证通过。

### HTTPS 前置 CSRF 严格模式

- 生产环境中，携带 Session Cookie 的写请求现在默认必须提供可信 `Origin`；缺失来源返回 `CSRF_ORIGIN_REQUIRED`，不再只依赖 SameSite Cookie。
- 新增 `CSRF_REQUIRE_ORIGIN` 显式开关，当前 HTTP 部署继续使用兼容模式，生产模板和 TLS 手册固定为严格模式。
- 运行时安全审计新增 Cookie/CSRF 联合配置、通配来源和 HTTPS 来源校验；Server 58 文件 513/513、生产构建、安全审计与文档门禁通过。

### 离站日志归档远端确认

- 日志归档不再执行任意 shell 命令片段；上传和远端校验均要求配置为绝对路径可执行文件。
- 上传成功后必须由独立校验器读取远端对象并核对大小与 SHA-256，之后才创建 `.uploaded` 标记；校验失败保留本地归档且不会被保留期清理。
- 可观测性验证新增成功读回及故意校验失败两条路径。真实异机/对象存储目标仍属于外部依赖，本批不伪造生产送达。

### JudgeRun Switch read

- 新增唯一 `judge-read-projection` 边界。存在 CurrentJudgeRun 的本地提交，其队列状态、终态结果、分数、测试点、Subtask、错误和资源指标全部从 Run 读取；只有远程归档与无 Run 历史记录回退 Submission 兼容列。
- 全局/活动/题目提交列表与详情、结果筛选、题目状态、个人概览、OI/ICPC 排名、平台/校园解题排名、管理统计和重测预览统一到同一语义；OI SQL 聚合显式投影 CurrentJudgeRun。
- 新增故意把 Submission 兼容列写成 WA/0、Run 写成 AC/100 的回归，列表、详情、筛选和排名仍返回 AC/100。Server 57 文件 509/509、Web 36/36、Judge 17/17、三端生产构建和文档/架构门禁通过。
- 提交 `c554aa8` 已推送 `main` 并完成 3302→3303 API 蓝绿提升；Judge 自动重连，生产 2518/2518 投影对账零差异。

### 架构边界与运行文档收口

- 60 个 HTTP adapter 的 Prisma、transaction、filesystem 和 Judge Runtime 直接调用全部归零，Strangler 过渡结束，零基线门禁阻止回退。
- 环境、远端拓扑、项目概览、存储和剩余工作文档统一到 systemd Web、稳定 Router、蓝绿 API、Scheduler/Executor、Judge、Docker 以及不可变 BlobStore 的当前事实。
- 文档门禁新增 PM2 正式拓扑、tsx watch 公网 API、“正式配置仅为模板”和固定页面数量等过时表述检查。
- 新增账号级 UI capability 矩阵，统一全局管理员工作区、个人/校园工作区、全量评测记录、组织管理和平台密钥入口判断；动态资源权限继续由后端响应决定。登录、身份选择、RoleLayout、Shell、工作区切换器和提交列表已迁移，UI 门禁拒绝重新拼接全局管理员复合角色判断。
- Capability 批次提交 `8776b5e` 已推送 `main`，preview 构建 `pLLd_bBuL87zHDakelxvi` 已提升到公网 `3000`。Web、Router、API 3303、Worker、Executor、Judge 与 health/readiness 均正常；Codex 内置浏览器确认登录页可访问且页面控制台无 warning/error。
- 新增架构收口逐项完成审计，把原评审的产品边界、Judge 生命周期、状态机、Candidate、Strangler、BlobStore、Scheduler/Executor、SLO、API 契约和 capability UI 分别映射到当前实现与验证证据；外部生产 P0 和观察期事项继续保持未完成，不以本地模拟替代。
- 重新检查 ECS 元数据和可用浏览器会话：实例/地域元数据正常，但 RAM Role 端点仍为 404；阿里云控制台在内置浏览器和 Edge 中都要求登录。已保留 Edge 登录页供所有者接管，未读取浏览器秘密或改动云端配置。
- 删除失效的 PM2 `start:production` 和旧 ecosystem manifest，生产日志文档改为 journald；自动架构检查新增 PM2 生产入口防回退规则，使仓库可执行入口与 systemd + API Router 蓝绿拓扑保持一致。Server 57 文件 509/509、文档与架构门禁通过；该批不改变运行进程，无需重启服务。
- 新增受保护的 TLS 配置生成与隔离验收工具，校验证书 SAN、30 天剩余有效期、私钥匹配和真实 Nginx 语法；Web middleware 增加默认关闭、可分阶段启用的 nonce `strict-dynamic` CSP，并提供响应头/HTML nonce 一致性检查。Web 44/44、普通与 report-only 生产构建、隔离 Nginx/CSP 验收通过。提交 `bba8e6f` 已推送 `main`，默认关闭 CSP 的公网构建 `EilfIqQM_IwOJFYUKtfzk` 已完成 canary/promote，服务与 health/readiness 正常；未取得域名和证书前不修改 HTTP 公网入口。

## 2026-08-28

### Judge 分段延迟与 SLO

- `JudgeAttempt` 新增 Queue、Dispatch、Compile、Run、Persist 和 Total 六段毫秒指标；Server/Judge 协议携带分发时刻与 Judge 侧 phase metrics，最终化事务计算队列、持久化和总耗时。
- 新增 `pnpm judge:slo` 报告与 `judge:slo:check` 门禁。默认按最近 24 小时、至少 50 个样本检查六项 P95、基础设施错误率和卡住 Attempt；旧历史记录保持空值。
- SLO 运维契约记录于 `docs/operations/JUDGE_SLO.md`。

### Scheduler/Executor 与架构边界门禁

- 单例后台 Worker 收口为 Scheduler leader，只运行 Cron 和 OJ 账号自动验证；新增 `oi-manager-executor@N` 执行可并行任务。旧远程提交轮询以逐记录 PostgreSQL session advisory lease 保证多个 Executor 不重复处理，进程崩溃时连接关闭即可释放租约。
- systemd 安装、API 提升、数据库恢复、日志归档和运行时资源审计同步纳入 Executor unit。
- 新增自动生成架构事实清单，覆盖 Prisma model/enum、legacy/module HTTP adapter、systemd unit 和环境变量名；`docs:check` 会拒绝过期清单。
- 新增 route boundary baseline：HTTP adapter 中 Prisma、事务、文件系统和 Judge Runtime 依赖只能递减，新 adapter 默认零容忍，避免 `routes/ + modules/` 过渡债继续增长。

### Testcase Candidate 与 BlobStore 边界

- 新增独立 `TestcaseCandidate`，把“程序确实被候选数据卡掉”的技术事实与“候选数据成为题库正式版本”的发布事实分开；候选固定内容哈希、内容对象、基线 Revision、Subtask 分类及晋升结果。
- Hack 重复输入、并发 Revision 冲突和持久化错误分别落为 `REDUNDANT`、`STALE`、`FAILED`；成功时 Candidate、Hack Attempt 和新 Revision 在同一事务终结。
- TestSet Revision 的内容寻址写入和物化改为统一 `BlobStore` port。本地实现保留硬链接/复制优化，S3 与阿里云 OSS 以注入 adapter 形式建立供应商隔离边界，本批不迁移线上对象。
- 新增 Blob key 穿越防护、不可变 put/materialize 测试和 Candidate 并发断言。

### JudgeRun/JudgeAttempt 写路径切换

- Consumer 现在只领取 `Submission.currentJudgeRunId -> JudgeRun.currentAttemptId` 指向的 QUEUED Attempt；领取同时推进 Run/Attempt 状态并双写旧 Submission 投影。Judge 协议回传 Run、Attempt 和 fencing token，100 路重复或延迟回传只能有一次通过 CAS 进入 FINALIZING。
- 正常结果在一个事务中终结 Attempt、Run 和 Submission 投影；断连、沙箱传输故障、租约超时和 API 重启把当前 Attempt 终结为 `INFRA_ERROR` 并创建下一 Attempt，永不重开旧终态。
- 单条重测创建下一 `runNumber`；比赛范围和全局重测创建持久化 `RejudgeBatch` 并为每条可重测提交创建新 Run。归档记录和正在执行的提交继续跳过。
- 新增部署窗口对账迁移；空库/最新正式备份迁移链为 82 表、31/34 条迁移、20186 用户且结构签名一致。fenced 生命周期、重试、Batch 和 100 路重复回传通过，Server 46 文件 463/463、Judge 6 文件 17/17 通过。Submission 读取兼容投影仍保留，Switch read 和旧字段删除不在本批执行。

### JudgeRun/JudgeAttempt 领域模型第一阶段

- 新增 `JudgeRun`、`JudgeAttempt` 和 `RejudgeBatch`，把逻辑评测、物理执行尝试和范围重测从 Submission 用户意图中分离；新增 Run/Attempt/Batch Prisma 枚举与拒绝非法迁移的 domain state machine。
- 新普通题提交和活动提交改为在一个事务中创建 Submission、Run、Attempt 及 current 指针；远程归档明确不创建本地 Judge 生命周期。旧 `Submission.result/score/judgeId` 等字段保留为兼容投影，本批不切换 Consumer 或删除旧字段。
- 新迁移为现有本地提交回填确定性 legacy Run/Attempt；全新空库与最新正式备份恢复库分别为 30/33 条迁移、82 张表，规范结构 SHA-256 一致，恢复库保持 20186 用户。
- Prisma 校验、Server 构建、Judge Domain 6/6 和 Server 全量 46 文件 460/460 通过。架构总览、产品定义与开发路由契约同步为当前蓝绿生产拓扑和双领域模型。

### 受控 ECS 整机重启演练

- 重启前生成并恢复验证 `oi_manager_20260828_015754.dump`，确认 79 张表、32 条迁移、20186 个用户；备份 SHA-256 为 `fd0d1b94b1f3cac543e7cb17836fab81d4c12789d061133f38b6931c618b676b`。
- 受控重启于 01:58:43 发起，主机 01:59:09 进入新 boot，PostgreSQL/go-judge 01:59:25 就绪，Judge 01:59:30 注册，稳定 API 和 Web 01:59:31 同时健康，RTO 为 48 秒。
- 所有 Docker 和 systemd 服务均自动恢复；重启后 `runtime:audit` 零失败、服务监控 healthy、公网 Web BUILD_ID `_mJoRf679N5624kf24W8l` 验证通过，未执行人工补启动。

### 主机重启启动链预检

- PostgreSQL 容器补齐 `unless-stopped`，与 go-judge 一样在 Docker 恢复后自动启动；实际生产容器已无中断更新 restart policy。
- API、后台 Worker 和 Judge 的 systemd unit 显式要求 Docker；API/Worker 启动前等待数据库 health，Judge 再等待 go-judge 和稳定 API readiness，默认最多等待 120 秒。
- `runtime:audit` 新增两个基础容器自启动策略以及 systemd `Requires/ExecStartPre` 契约检查；事故记录补充 CloudMonitor 指标发送正常但进程/HTTP/脚本探测为空，以及 8 月 19 日异常 boot 边界复核证据。

### 正式备份隔离恢复核心闭环

- 新增 `backup:verify:core`，在专用 PostgreSQL 容器、15435 端口、`e2e` Schema、隔离存储和独立 go-judge 中恢复最新正式备份；生产 Schema 只读，写入验收永远不能落到正式数据库或正式测试数据目录。
- 恢复后执行当前 Prisma migration/status，再检查正式数据的用户、题目、活动、提交、Revision、活动固定版本和 Revision 哈希关系；随后通过真实 API/Judge 验证四类身份、管理员工作区、AC/WA、Hack 自动晋升、历史版本不变、草稿活动手动升级及活动开始后冻结。
- 2026-08-28 实际演练恢复 79 张表、32 条迁移、20186 个用户，恢复耗时 11618ms，核心 E2E 2/2 通过；精确命名且带所有权标签的 PostgreSQL/go-judge 容器在成功和失败路径均自动清理。

### Judge/数据库故障恢复一致性

- go-judge HTTP 传输失败不再返回用户 Compilation Error、Runtime Error 或最终 Hack System Error；普通评测以及 Hack 的 Generator/Validator/Classifier/STD/Checker/双评测基础设施错误都标记为可重试，Judge 主动断开连接，由 Server 立即条件式重排。
- Submission/Hack 的 Consumer 所有权延迟到数据库持久化成功后释放；短时数据库错误使用有界指数退避，超限后通过 WebSocket 断连恢复，条件更新不能覆盖已完成终态。
- 新增独立 PostgreSQL、TCP 故障代理、go-judge HTTP 故障代理和 E2E：沙箱 reset、数据库连接中断 3 秒后两条提交均最终 Accepted/100，无卡住或误判。
- 蓝绿 E2E 增加 Worker SIGTERM/替代进程接管；API 切换、回滚、100 路 finalization、Judge 1012 和 Worker 单例联合复验通过。

### 外部告警和异机日志接入基础

- Monitor 的 failed/recovered 状态仅在外部通知命令成功后写入；通知失败时保留旧状态并在下一轮重试，避免“本地显示已恢复但外部从未收到”的静默丢警。
- 新增 HTTPS webhook/邮件告警适配器；Webhook URL 只能从 mode-600/400 文件读取，不进入 Git、进程参数或日志，HTTP 仅允许隔离测试显式开启。
- 新增运维日志归档，收集 OI Manager systemd、PostgreSQL/go-judge Docker、Nginx、监控和备份记录，生成 manifest 与 SHA-256 后交给可信上传命令；没有外部上传配置时保留本地包并明确失败。
- 新增 failed/recovered 回环 HTTP、通知失败重试和独立归档接收目录验证。当前主机没有真实外部通知目标或对象存储权限，因此真实送达仍保持未完成。

## 2026-08-27

### 并发竞争与逐提交延迟收口

- Playwright 配置在加载测试模块前强制注入 `schema=e2e` 数据库和隔离存储目录；直接导入 Server 模块的 E2E 不再可能回退到正式 Schema 或正式文件路径。
- 比赛题目范围重测增加 20 路并发与普通提交竞争验证，并覆盖重测和 Judge 终态回传竞争、旧 Judge 结果拒绝及统计一致性。
- OI Test Graph 保存与 Hack 自动晋升增加同事务竞争验证；无论哪方赢得题目锁，都只生成一个下一 Revision，失败方安全 stale/requeue 且不留下半成品文件。
- Judge 压力工具增加逐提交 P50/P95/P99；100 条真实 go-judge 提交为 100/100 Accepted，P50/P95/P99 为 29990/50925/52932ms，RSS 增量和沙箱残留均为 0。
- `test:stress:judge` 只收集 Judge 负载测试；蓝绿 finalization 继续由独立命令执行，避免两个隔离栈的前置资产互相污染。

### Judge 结果所有权与双 API 蓝绿一致性

- Submission 终态写入改为以 `submissionId + judging + judgeId` 原子认领；重复、延迟或来自旧 Judge 的回传不能覆盖已经落库的结果，也不会重复触发成绩同步。
- Hack 回传先以 CAS 从 `judging` 进入 `finalizing`，同一 Hack 的 100 个重复回传只有一个拥有最终化权；Revision 发布和 Hack Attempt 的 `promoted` 状态在同一数据库事务中提交。
- `finalizing` 纳入单题和单用户活动任务唯一索引、排队排除、超时恢复和重启恢复；新增第 29 个迁移并同步空库 supplement。
- Router 补齐 HTTP、WebSocket、客户端 RST、上游断开和关闭阶段的 Socket 生命周期处理；客户端连接重置不再触发未处理的 `ECONNRESET` 终止进程。
- 新增独立双 API 演练：在 `e2e` schema、3410/3412/3413 和独立 go-judge 中验证 100 路双实例 finalization、50 次客户端 RST、Worker 单例锁、blue/green 切换与回滚、旧 API drain 和 Judge 1012 自动重连。
- Server 44 文件 452/452、Judge 4 文件 14/14、双 API E2E 1/1、根生产构建通过；空库和正式备份恢复路径分别为 29/32 条迁移、79 张表，规范结构哈希一致。
- 提交 `8697c80` 已推送 `main`；生产迁移前新备份 `oi_manager_20260827_230448.dump`（14 MiB）校验通过，第 29 个迁移已应用，API 从 3302 原子提升到 3303。新 Router 受控重启以 `Succeeded` 退出且不再出现 `ECONNRESET`，Judge 自动重新认证注册，318 端点匿名审计和公网/本机健康检查通过。

### 全新空库安装与历史迁移兼容

- 在不修改任何历史 migration 或校验和的前提下，新增仅空库可用的原子 bootstrap：根据当前 Prisma Schema 建库，将每个历史 SQL 文件的原始 SHA-256 写入标准迁移表，并在同一事务内通过 advisory lock 二次确认目标仍为空。
- 将旧 Seed 从已删除的 Teacher/Student 和学校负责人字段迁移到当前 OrganizationMembership、校园 Profile、TeamMember、ContestResult 与 Milestone 关系；平台管理员不再获得虚假的校园身份。
- 新增空库建库/Seed/非空拒绝演练，以及“空库安装”和“正式备份恢复后 migrate deploy”双路径 Schema 规范签名逐字节比较。
- 实际验收为空库 79 张表/28 个唯一 migration/32 个种子用户，恢复库 79 张表/31 条历史 migration 记录/20186 个用户；按目录语义比较得到相同 `public` Schema SHA-256 `bc604325…06e6`。生产标准 migrate deploy 无待办，bootstrap 对正式非空库在 DDL 前拒绝。

### 运行时密钥审计与可回滚轮换

- 新增不输出原文的运行时安全审计，检查 Server/Judge 环境文件权限与归属、JWT/Judge/账号密钥长度和独立性、Judge Token 一致性、CORS 通配符及 Cookie Secure 状态。
- 新增默认只读检查、显式 `--apply` 的事务轮换工具：先解密并预验证全部 OJ 账号，再用 CAS 重新加密，生成 mode-600 环境备份并将旧项目环境链接迁移为当前仓库内文件；异常时恢复环境路径并回滚数据库事务。
- 新增从最新正式备份恢复独立数据库的轮换演练，真实应用新 JWT/AES 密钥并用新密钥再次解密全部账号，测试数据库与临时环境通过 trap 清理。
- 使用新建并验证的 14MiB 正式备份完成生产轮换：2 个 OJ 账号事务重加密，旧项目 `.env` 链接替换为当前仓库 mode-600 文件，JWT/账号密钥升级为独立 64 字符值，CORS 固定为单一明确来源。轮换后安全审计零 violation、Judge 认证正常、新会话公网回归 4/4；HTTP 阶段按规则不启用 Secure Cookie。

### Judge 容器与 systemd 资源边界

- go-judge 增加 1.5 CPU、1536 MiB 内存、256 PID、65536 NOFILE、只读根、`no-new-privileges`、512 MiB 临时盘及 20 MiB × 5 Docker 日志轮转；PostgreSQL 日志同步设置本地轮转但数据库卷保持不变。
- Router、API 蓝绿实例、Worker、Judge 和 Web 增加任务数、文件描述符、停止超时与重启频率限制；新增无密钥运行时审计，配置漂移会返回非零。
- systemd 安装脚本重复执行时不再强行将活动 API 指针重置为 3302，而是从当前 slot 通过正常蓝绿流程切换，使 unit 变更可重复、安全部署。
- Compose 包装脚本固定历史生产 project 名 `oi-manager`，避免 checkout 目录名称变化时创建第二套空网络/卷；go-judge 的 512 MiB tmpfs 覆盖 Go 实际创建随机临时目录的 `/tmp`，而不是错误地只挂载固定子目录。
- 新增仅允许回环地址的 go-judge 生产冒烟，实际执行受限命令并断言临时 file inventory 前后相同；资源审计在宿主内核不支持 swap accounting 时明确告警，但仍强制 1536 MiB 内存硬上限。

### Judge 长稳与 Revision/Hack 并发一致性

- 新增独立 `e2e` Schema、API 端口、go-judge 容器和测试数据目录的真实 Judge 压力入口；每次执行验证全部提交终态、Accepted/100、无卡住记录、沙箱文件归零及 API readiness，并将报告同时写入固定 latest 文件和带轮次/数量的归档文件。
- 30 轮共 3000 条真实评测全部 Accepted，历时 1747.722 秒、平均 1.72 条/秒，结束时 API/Judge RSS 没有增长，沙箱文件数为 0；带只读根、`no-new-privileges`、CPU/内存/PID/NOFILE/临时盘限制的 10 条复验通过。
- 修复多个新提交同时首次访问未迁移题目时，初始 TestSet Revision 的 CAS 竞争失败者错误收到瞬时 409：赢家发布后，其他调用者现在读取并复用正式 Revision。新增 100 路首次创建、100 路同基线发布、Hack 并发晋升与重复输入、500 路系统程序缓存租约回归。

### 公网动态验收与收口总表

- 新增只读公网比赛动态套件，使用同一负责人会话依次验证 1158 IOI 与 1157 ACM 的排行榜题目格、用户题目提交列表和现有提交详情弹窗；确认 #3678 显示 OI 分数/Subtask/测试点得分，#3677 使用 ACM Verdict/测试点结构且不显示分值。
- 套件同时验证两层弹窗只关闭最上层、根页面滚动锁定、无横向溢出、5xx、控制台 error 或 page error；公网比赛流程 1/1、管理员与负责人工作区 3/3 通过。
- 新增当前唯一未完成事项执行总表，明确隔离并发/长稳压测、Judge 与容器边界、外部告警和异机日志、干净安装迁移链、蓝绿/恢复演练以及需要维护窗口或云平台权限的项目，并区分不能伪造的历史外部 OJ 数据。

### 20260815 ACM / IOI Revision 恢复与耗时基准

- 通过只允许超级管理员调用的安全恢复接口，将 1158 的 median、balloon、string 从迁移期旧 MIN Revision 固定恢复到数据对象完全相同的 SUM 后继版本；活动快照与 67 条既有提交指针在同一 Serializable 事务中更新，subset 继续固定其原 SUM Revision。
- 1157 ACM 与 1158 IOI 各 89 条提交完成全量重测，按用户名、题目顺序和源码 SHA-256 得到 89 组同源代码，Accepted/100 语义不一致为 0；`oi20260815_07` 的 median 两边均为 Accepted/100。
- 新增可复现的三轮基准与报告生成脚本。三轮整场耗时为 776.358s、773.414s、782.947s，共 267 个配对观测且无结果不一致；逐用户逐题、测试点 wall/CPU 与排队完成时间见 `docs/operations/ACM_IOI_TIMING_2026-08-27.md` 及配套原始 JSON。

### 运维监控与 SSH 基线

- 生产优化构建不再默认探测已退役的 HMR 端口 3001；开发环境仍可通过 `MONITOR_HMR_URL` 显式启用。健康成功路径、API 端口故障注入和生产状态恢复均已验证。
- 新增可回滚的 SSH 加固配置与安装脚本：安装前验证当前 sudo 用户的有效公钥和权限，禁用密码及键盘交互认证，root 仅允许公钥，并在 reload 前后校验 `sshd` 配置。

### 冻结活动测试版本恢复

- 新增仅超级管理员可调用的活动 Revision 恢复接口，使用当前版本 CAS、题库最新版校验、直接 `admin_edit` 或历史迁移 `initial` 后继限制、测试数据布局与非计分配置等价校验，拒绝排队/评测中的活动提交；历史迁移生成的 Official Group 内部键标准化不视为数据变化，但任一 Testcase 或输入输出对象变化仍会拒绝。
- 恢复操作在 Serializable 事务中同步更新活动题快照和既有提交 Revision 指针，并要求记录恢复原因；用于修复 20260815 IOI 活动在 Revision 体系上线前固定到旧 `MIN` 投影的问题，不开放为日常比赛管理能力。

### 权限所有权矩阵

- 新增活动、团队与题库的资源所有权语义矩阵，覆盖负责人、活动创建者、普通教师、学生、跨组织用户、
  超级管理员和平台管理员，明确“可查看”不等于“可管理”。
- 新增线上角色工作区冒烟：超级管理员、平台管理员严格单工作区，平台管理员评测记录保持全局范围，
  学校负责人可进入当前组织工作区。

### UI Token 收口

- 将加载状态、管理员标签页与状态徽标、用户头像、提交详情和常用表单操作迁移到统一组件与 CSS Module；继续收口平台绑定、OJ 账号、活动表单、题面矩阵、题目详情、评测设置和复杂导入后，静态内联样式遗留从 171 处降至 0，硬编码视觉值保持 0，UI 遗留白名单现已全部清空。

- 业务 TSX 与 CSS Module 的硬编码颜色、阴影从 155 处降为 0；竞赛状态、奖牌、热力图、代码区和
  半透明表层统一进入全局语义 Token，删除比赛列表/详情内重复声明的局部色板。
- 前端 Canary 日志由公共 `/tmp` 固定文件改为项目 `.run` 目录，避免 `fs.protected_regular` 在部署身份
  变化后拒绝重定向；修复前的提升失败未切换 3000，原 Web 始终保持可用。
- preview promote/rollback 在已安装 Web systemd unit 时改由 systemd 停启正式进程，切换后强制校验
  `.next-current/BUILD_ID`；旧 PID 文件仅保留给非 systemd 开发环境。

- 将 Cron、旧远程提交轮询和 OJ 账号自动验证从蓝绿 API 实例拆为独立
  `oi-manager-worker.service`。Worker 使用 PostgreSQL session advisory lock 保证集群单例，调度器提供
  幂等停止，轮询防止上一次尚未完成时重入；API promote 在切换完成后只重启这一份 Worker。
- 通过受权限保护的题目 API 恢复 1005–1014 已存在于服务器的 `.in/.ans` 与权威 `config.json`，
  并为 1015–1019 的既有演示数据补齐 Judge Config；活动固定覆盖由 110/301 提升至 293/301，
  提交固定覆盖由 642/2582 提升至 2361/2582。剩余 8 个活动题全部是无任何本地数据的历史外部 OJ
  引用，明确保留 `LOCAL_JUDGE_NOT_CONFIGURED`，不生成虚假测试版本。
- 修复历史上存在多个相同 Judge 投影哈希时，迁移器误选最旧 Revision 并在每次复跑继续发布等价版本；
  现在按 revision number 倒序选择最新等价版本，并增加连续两次迁移不增长的回归测试。
- TestSet Revision 兼容历史 JSON/YAML 中的数字测试点引用（如 `cases: [1, 2]`），确定性解析为
  `1.in/1.ans`、`2.in/2.ans`，并同时兼容旧 `scoring` 聚合字段；缺文件名的非数字结构仍 fail-closed。
- 修复 go-judge 自定义 Checker 的输出捕获：沙箱命令现在把进程 stdout/stderr 显式重定向为
  `copyOut` 文件，Testlib 的 `ok Accepted` 不再因消息为空而被误判为 Wrong Answer。
- 用户程序输出上限由硬编码 64KB 改为题目/测试点可配置的 `outputLimit` / `output_limit`，默认
  64MB；保留 Output Limit Exceeded 判定，同时允许 `subset` 等合法输出大量索引的题目通过。
- Judge 4 个测试文件 13/13 与生产构建通过；使用 F 盘官方 `subset.cpp` 的线上题库 Practice
  提交 `3820`（ACM Testlib）与 `3821`（IOI Lemon）均为 20/20、Accepted、100，median 提交
  `3822` 同样为 20/20、Accepted、100；这些记录不进入比赛排名。

## 2026-08-26

- 修复 TestSet Revision 迁移审计把独立 `ProblemChecker` 误当作普通 `TestdataFile` 的问题；
  Checker/Interactor/Manager 现在按独立评测资产校验可读文件，输入输出仍要求完整测试数据元数据。
  新增回归测试覆盖 Checker 仅存在于专用元数据表时仍可创建不可变 Revision。
- 通过受权限保护的线上 API 补登记 `20260815 median ACM` 的 40 个既有输入输出文件，并补登记
  `subset ACM/IOI` 的 `checker.cpp`；ACM 保留 `testlib` 版本，IOI 保留 F 盘权威 Lemon 版本，
  未上传 `checker.exe` 或题目私有 `testlib.h`。
- 完成不可变 TestSet Revision 的首次线上迁移与蓝绿部署收口：生产数据库迁移
  `20260826_testset_revision_consistency` 已应用，24 道可安全还原的题目生成 43 个正式 Revision，
  104 个活动题和 570 条可证明历史配置的提交已固定版本；重复执行迁移后 Revision 数量保持不变。
- 迁移检查继续拒绝 13 道缺少测试点或评测资产的旧题，不猜测补全数据；未能可靠还原的记录保持
  `legacy unpinned`。迁移前备份 `/data/backups/oi-manager/automatic/oi_manager_20260826_202206.dump`
  已通过校验。
- 修复 systemd 蓝绿实例端口被旧 `.env` 覆盖、Judge/Web 错误依赖旧单实例 Server、活动 slot
  未持久化到开机启动的问题；稳定 Router、活动 API slot、Judge 和 Web 均由 systemd 管理，连续
  `3302 → 3303 → 3302` 切换期间 readiness 保持正常，Judge 以 1012 自动重连。
- 兼容旧 OI 配置中的字符串 Subtask ID（如 `all`），按原顺序确定性映射为稳定数字 ID并同步依赖；
  Server 全量 40 文件 435/435 通过，公网 Web 构建为 `QNCp6PgwE1fmxSgivAPoQ`。
- 新增不可变 `ProblemTestSetRevision`、内容寻址测试对象和 Revision 级 ACM/OI 关系；测试数据及文件型 Checker、Interactor、Manager 固化到独立 Revision 目录，历史版本不受后续替换影响。
- 比赛、训练和作业题目固定 `testSetRevisionId`，提交记录保存实际 Revision 与投影哈希；活动开始或已有提交后返回 `409 TEST_SET_REVISION_FROZEN`。旧 Hack 同步 API 退役，题库 Hack 自动晋升下一正式 Revision 且不修改任何活动。
- Test Graph 保存、Hack 晋升、模式转换和正式发布统一使用 PostgreSQL advisory transaction lock 与 latest Revision CAS；普通配置不能隐式切换 ACM/OI，显式模式迁移保留旧版本并关闭 Hack。
- Judge 系统程序增加引用计数、30 分钟 TTL、64 项 LRU 编译缓存；Generator 和被 Hack 程序仍按任务释放。内容对象孤儿由每日 GC 在题目锁内清理。
- 增加 3002 稳定 API Router、3302/3303 蓝绿 Server、readiness、Judge drain 与 1012 重连流程；后续 API 发布不再直接替换 3002 单实例。
- 数据工作台增加正式 Revision 历史只读查看；Server 全量 40 文件 433/433、Web 36/36、Judge 11/11、定向 Revision/CAS/模式迁移/GC、Test Graph、Hack 与 Judge 协议 14/14，以及 Server/Web/Judge 生产构建通过。
- 将 OI Test Graph 从可编辑 JSON textarea 重构为 Subtask、Official Group、Testcase 池三栏工作台；支持依赖、分值、`min/max/sum`、批量分配、排序、文件上传/配对和只读 Hack Gate。
- OI 评测设置只保留“数据与分组”入口，旧 Subtask/测试数据入口不再可达；Hack 配置页只维护 STD、Validator 和 Classifier。
- 新增题目管理员单题显式迁移和测试点注册 API；整图校验返回字段路径，revision 冲突返回 `409 TEST_GRAPH_STALE`，被使用文件返回 `409 TESTDATA_IN_USE`，同名替换同步 Testcase 哈希。
- 验证：Server 39 文件 430/430、Web 36/36、Judge 9/9、Server/Judge/Web 生产构建、UI 门禁、Chromium `1280×720`/`1440×900` 工作台 E2E 全部通过。
- 提交 `7002e8d` 已推送远程 `main`；公网构建 `yWNYBecXwn49NS0LJhzwS` 已完成 3200 canary、3000 promote 和 3000/3002 健康检查。

## 2026-08-25

- 启动全站 UI 统一基础批次：新增统一表单控件、Combobox、Menu/Popover、Section、DataTable 与
  Form/Confirm/Detail Dialog；Modal 使用五档尺寸、busy 关闭保护、说明语义和手机全屏降级。
- 新增按文件计数的递减遗留基线，`ui:state-check` 现在阻止新增原生控件、自定义弹窗、静态内联样式、
  任意 Modal 宽度和硬编码视觉值；设计系统、前端架构和 UI 路由矩阵同步为 2026-08-25 基线。
- 完成弹窗统一批次：业务组件全部迁移到 Form/Confirm/Detail Dialog，21 处任意宽度改为五档标准尺寸；
  提交详情与排行榜提交列表统一使用整页单滚动模型，确认弹窗和密码重置通过公共兼容层收口。静态门禁
  新增 `directModal` 规则，业务层直接导入或渲染底层 Modal 的允许值固定为 0。
- 完成核心业务 UI 迁移：题目、评测设置、题单、训练、提交和团队使用统一 Button 与表单控件；复杂排行榜、
  测试图和 Subtask 矩阵保留专用交互外壳。525 处纯静态内联样式进入 CSS Modules，动态尺寸和状态变量继续
  使用受控内联样式；遗留计数降为内联样式 1042、原生按钮 92、原生表单 157。
- 完成管理页面 UI 迁移：超级管理员、平台管理员、学校、用户、OJ 账号、平台绑定和导入页面统一使用公共
  Button 与表单控件，并将 486 处静态内联视觉值迁入 CSS Modules。遗留计数进一步降为内联样式 556、
  原生按钮 32、原生表单 65；文件上传和选择类输入留待统一语义原语收口。
- 完成全站 UI 收口：业务层原生按钮、表单和表格标签均降为 0；复杂排名、测试图和矩阵通过
  `TablePrimitives` 保留原生 DOM 语义，文件、单选和复选输入通过公共 `Input` 且不套用文本框尺寸。
  自定义 Dialog、直接 Modal 和任意弹窗宽度继续保持 0。静态内联样式从初始 1567 降至 174，剩余项
  仅登记动态尺寸、坐标和状态；硬编码视觉计数从 218 降至 160，新增代码继续受逐文件递减门禁保护。
- 最终生产构建、Web 36/36、文档与 63 路由导航审计通过；通知 region、身份 menu 和工作区切换选择器
  同步新的可访问语义后，Chromium/Firefox 聚焦 UI 冒烟 44/44 通过。
- 题目级 Hack 扩展到 `judgeConfig.mode: oi` 的 OI / IOI 题：新增 C++17 Classifier，严格解析
  `{"subtasks":[...]}`，按证明程序总分下降判断有效性，并在命中的 Subtask 系统 Hack Gate 中只保存一份
  候选测试数据。历史提交、成绩和排行榜不会自动重测。
- 新增规范化 Testcase / Subtask / Test Group 多对多测试图、无环依赖校验、YAML 执行投影和超级管理员
  `check/apply` 迁移 API。旧配置保持双读；异常题只进入报告并禁止启用 OI Hack。
- 普通训练、作业和未开始活动自动同步有效 Hack；已经开始或结束的比赛冻结原快照，比赛管理员可在题目
  操作区预览 revision 差异并手动同步。题目管理页显示并可编辑关系测试图，系统 Hack Gate 只读；旧评测配置保存只更新非图配置并重新生成 YAML 投影，避免关系图与执行快照分叉，Hack 历史显示前后
  分数、降分和命中 Subtask。
- 安全增量迁移前已生成并校验 5.2MB 备份
  `/data/backups/oi-manager/automatic/oi_manager_20260825_133857.dump`；Prisma 迁移
  `20260825_oi_hack_test_graph` 已应用。Judge 9/9、训练权限 43/43 及 Server/Judge/Web 生产构建通过。
- Hack 历史把“查看程序”入口移动到程序语言之后，题目管理者无需横向滚动到表格末端即可读取候选输入/生成器和被 Hack 程序；完整源码仍只通过单条详情接口按题目管理权或记录归属返回。
- Hack 程序详情入口修复随提交 97ee230 推送并部署为公网构建 zqmtCul8BqfkMjyMkx8fU；Web 34/34、生产构建、文档门禁、3000/3002 健康检查通过，线上 API 验证管理员可读完整源码、其他用户读取他人记录返回 404。

## 2026-08-24

- 比赛排行榜统一排除 `submitMethod=archive`；远程归档不再可能给 ICPC 增加已解数或抬高 OI/IOI 分数。
- Judge 收到普通提交/Hack 结果时先解除连接任务所有权，避免结果已送达后立即断线又把任务恢复为排队；
  普通提交持久化失败时安全回队。
- 比赛重测先固化目标记录再更新，修复并发统计把本次刚重置的提交同时计入“将跳过”的错误摘要。
- 新增三赛制完整破坏性 E2E，覆盖 ICPC 两次提交与罚时、IOI 实时部分分、OI 赛中脱敏/管理员可见/
  赛后公开，以及 ACM/OI 详情模式和三种真实排行榜页面。
- 远程提交归档：Codeforces 同步参数在访问远端前校验；远端 HTTP/API 失败返回稳定 502，不再伪装为
  “同步成功但零记录”；单次同步限制为最近 1000 条，并新增幂等、归档隔离与前端流程回归。
- 归档修复提交 `1dcf362` 已按 preview build/canary/promote 部署为 `BWcB26mt5NrhD5un0to-E`；
  统一监控和 3000/3002 两套匿名 303/303 端点矩阵通过。
- 修复活动题面矩阵的官方共享行标题：行本来按语言/格式横跨多道题，但过去借用第一道题标题，视觉上
  像把该题题面错误铺给其他题；现在使用“官方中文/Official English/官方题面”等通用标签。
- 新增活动题面快照真实闭环 E2E：管理员为三题选择官方题面，普通学生选择和编辑均为 403，参与者可读取
  当前快照；活动内编辑生成 revision 2，旧 snapshot 再写返回 `409 CONTENT_SNAPSHOT_STALE`，活动上下文
  创建个人题面的退役接口保持 404。真实页面同时断言官方行不包含 A 题标题。
- 活动题面流程定向单元 7/7，与核心、Judge、Hack、重测联合 19/19，根生产构建通过；E2E 清单现为
  20 个文件、266 条可收集用例。
- 活动题面矩阵修复提交 `6ac52dd` 已推送并部署为公网构建 `ZUNj-cof6YGn9gkUrGKDN`；3200 候选、
  3000 提升、3002 API、统一监控和 3000/3002 两套匿名 303/303 矩阵均通过。

- 新增比赛范围重测的确定性破坏性 E2E：按指定题目重置 3 条本地终态提交，验证普通参赛者无权操作、
  重复请求跳过 3 条排队记录、Codeforces 远程归档不进入重测、其他题目历史结果保持 Accepted。
- 修复终态提交没有测试点明细时整个评测结果区被隐藏的问题；独立详情页现在仍显示最终 Verdict，
  仅在确有测试点时渲染明细表。核心流程中的发布作业和补题作业请求改用显式校园上下文，并迁移
  已退役的学生作业列表接口到当前组织活动接口。
- 核心流程、Judge、Hack 与重测联合 18/18；Server 37 文件 420/420、Web 9 文件 34/34、Judge
  2 文件 6/6 和根生产构建均通过。E2E 清单现为 19 个文件、265 条可收集用例。
- 重测隔离与详情修复提交 `3d06912` 已推送并部署为公网构建 `Y1Nc3hNxHVKLRi2vil5hP`；3200 候选、
  3000 提升、3002 API、统一监控及 3000/3002 两套匿名 303/303 矩阵均通过。

- 修复 Judge E2E 的隐藏顺序依赖：全新 `e2e` schema 下原用例因题目没有显式 `judgeConfig/TestdataFile` 而返回 409，过去通过依赖前序残留。隔离种子现在在独立 `test-results/testdata` 写入确定性 ACM 配置和 `1.in/1.out`，校园提交同时补齐 `organizationId`；全新环境 Judge 8/8、Judge + Hack 联合 9/9 通过。
- 新增题目级 Hack 破坏性 E2E：真实调用 go-judge 编译 STD/Validator，通过独立 WebSocket Hack 队列模拟 `Accepted → Wrong Answer`，验证 `hack_<id>.in/.out` 入库、Hack 点顺序、普通提交数量不变和历史结果不重置。E2E 清单现为 18 个文件、264 条可收集用例。
- 隔离 Judge/Hack 流程提交 `da24952` 已推送并部署为公网构建 `yl9YyYjjo3cSTnOQUGMvB`；3200 候选、3000 提升、3002 API、统一监控和 3000 匿名 303/303 矩阵均通过。

- 新增六角色认证 API 健壮性矩阵：超级管理员、平台管理员、校长、教师、校园学生和个人学生分别请求文档登记的 303 个端点，共 1818 次请求。首轮定位并修复无效团队、未绑定外部账号、缺失导入批次、非法提交 ID 和不存在的拉题任务被局部 `catch` 错误转换为 500 的问题；修复后六种身份均无 5xx。
- 已知客户端错误现在统一返回 400/403/404/409；外部团队导入和 OJ 拉题删除不再把预期 4xx 先记录为 `console.error`，避免监控误报。Server 类型构建、定向回归 7/7、全量 37 文件 420/420 和认证矩阵 12/12（含六身份初始化）通过。
- 认证健壮性修复提交 `a2bb119` 已推送并按 preview build/canary/promote 部署为公网构建 `OP9c7Uk_sz75WSE7etrIz`；3200 候选、3000 提升、3002 API、服务监控及 3000/3002 两套匿名 303/303 矩阵均通过。

- 新增可复用的自动备份恢复验证脚本与 `pnpm backup:verify`。最新 5.2MB 归档已成功恢复到隔离临时库，核对 67 张表、29 条 Prisma 迁移和 20186 个用户记录；临时数据库及容器归档随后自动清理，正式库未修改。

- 修复 `pnpm restart` 的长故障窗：pnpm 特殊 restart 生命周期的自动 stop 现在延后，由重启脚本先完成 PostgreSQL/go-judge 准备，再进入应用切换；停止逻辑不再把已退出的 zombie 父进程当作存活服务。100ms 采样确认 Judge 构建期间 API 持续可用，实际单实例切换窗口约 16 秒。

- 完成生产依赖安全升级：Next.js 14.2.35 升级到 15.5.21，并同步升级 Express、express-rate-limit、Undici、UUID、WebSocket、js-yaml、Superagent 及安全传递依赖；`pnpm audit --prod` 从 51 项漏洞降为 0。项目未使用 `next/image`，明确忽略仍带 libvips 公告的可选 Sharp。
- 安全升级提交 `2998473` 已部署为公网构建 `UhlTIrV7m4XFpXwf8DMsa`。3200 金丝雀、3000 提升、Server/Judge 重启、两套 303/303 匿名矩阵和统一服务监控均通过；公网登录响应已出现 nosniff、DENY frame、严格 referrer 与权限策略头，且不再暴露 `X-Powered-By`。
- 适配 Next 15 异步 `searchParams`、`headers()` 和 `cookies()`，按官方建议不再跟踪每次构建都会按 distDir 改写的 `next-env.d.ts`；新增 Web 基础安全头并关闭 `X-Powered-By`。
- 修复全局限流在认证之前执行、导致所有校园用户共享出口 IP 配额的问题：Limiter 现在验证 Bearer/HttpOnly Session JWT 后按 userId 分桶，无效或匿名凭据仍按 IP；定向回归 3/3 通过。
- 移除退役学校题单套件的 14 项整文件跳过，改为 GET/POST/DELETE 明确 410 且不写库契约。升级后 Server 36 文件 417/417、Web 34/34、Judge 6/6、Next 15 隔离 E2E 13/13 通过，生产根构建和静态门禁通过。

- 新增默认仅允许 loopback 只读端点、请求数上限 5000、并发上限 100 的受控压测脚本与 `pnpm load:smoke`。在线完成 2300 次请求：API 直连 1000/1000、3000 同源代理 1000/1000、登录页面 300/300 均无失败，压测后 PostgreSQL/Judge 资源稳定且统一监控 healthy。
- 压测期间发现 metrics 的“长度大于 10 即视为 ID”规则会把 `platform-bindings` 等静态路由误归一化。改为只识别 UUID、CUID、纯数字和项目明确的历史资源 ID 前缀，并新增静态路由与组织 ID 回归测试。
- Web 完整测试 9 文件 34/34、Judge 完整测试 2 文件 6/6 通过。

- 修复请求日志与端点指标在 Express 嵌套路由完成后读取被改写 `req.path` 的问题。请求入口现在固化原始 method/path，`request_end`、慢请求日志和 metrics 不再坍缩为 `/` 或路由内部相对路径；新增嵌套路由回归测试。
- 请求指标修复提交 `7bf856f` 已部署为公网构建 `2KH5mSH54QjEaNDtL9hy8`；在线嵌套路由日志保留完整 `/api/platform-bindings/platforms`，3002 直连与 3000 同源代理的匿名接口矩阵均为 303/303，统一服务监控 healthy。
- 完成迁移后的第三轮 Server 全量基线：34 个测试文件全部通过，423 项通过、14 项跳过、0 项失败，用时 502.38 秒。此前第二轮识别的 33 项旧模型契约失败已全部迁移或重写为当前组织模型契约。

- 完成第二轮 Server 基线剩余 5 个失败文件迁移：题库/题单使用 `organizationId` 与组织 library key，
  未授权题单按跨作用域规则返回 404；基础列表改用组织成员、平台组织和当前排名路由；用户一致性改查
  OrganizationMembership/Profile；团队列表改用 organization/mine。五套定向测试 85/85 通过。

- 迁移事务、功能入口与比赛来源可见性测试：学校/学生事务改测平台组织创建、组织学生创建、负责人转移、
  跨组织回滚、账号状态和校园团队 owner；旧 `/api/schools` 明确断言 410。删除已移除的
  `plannedFeatureResponse` 与 `shouldHideTrainingProblemIdentity` 契约，改测当前钱包权限和
  `shouldHideTrainingProblemSource`。三套定向测试 14/14 通过，消除全量基线中的 11 个失败。

- 迁移已退役的学校比赛测试契约：删除不存在的 `/api/schools/:schoolId/contests`、`isSchoolMember`、
  `isSchoolContestAdmin` 和 `Training.schoolId` 断言，改测当前组织活动接口、`organizationId` 所有权、
  active 成员、团队可见比赛、严格管理员工作区、创建权限及 OI 赛中脱敏。当前比赛套件 17/17，
  文件/组织权限关联回归 19/19 通过。
- 测试数据库清理由逐表 66 次 `TRUNCATE ... CASCADE` 改为一次多表 `TRUNCATE ... RESTART IDENTITY
  CASCADE`，保持每例隔离和平台夹具重建不变；单例固定清理耗时由约 4.6 秒降至约 1.0 秒。

- 新增统一服务监测与幂等 cron 安装器，覆盖 3000/3001/3002、go-judge 5050、PostgreSQL、当前
  Next.js BUILD_ID、根盘/数据盘占用和自动备份新鲜度；失败返回非零，状态变化写入状态文件，并预留
  `MONITOR_ALERT_COMMAND` 外部告警钩子。
- 监测提交 `1292dca` 已实装：在线全依赖巡检返回 healthy，故障注入将 go-judge 指向关闭端口时
  正确返回非零并记录明确原因；当前用户 cron 每 5 分钟运行，健康重复日志保持静默。

- 修复数据库自动备份链路仍指向已废弃 `/home/ecs-user/oi-manager` 的问题。新版脚本默认写入
  `/data/backups/oi-manager/automatic`，启用 `pipefail`、单实例锁、数据库就绪检查、同容器版本
  `pg_restore -l` 校验、临时文件原子提升和仅限自动备份目录的 7 天保留策略；新增幂等 cron 安装脚本。
- 自动备份提交 `a36ccb8` 已推送并在服务器实装：首份验证归档
  `/data/backups/oi-manager/automatic/oi_manager_20260824_122120.dump` 为 5.2MB，失败容器用例返回 1
  且无临时残留；旧每小时失效 cron 已替换为每日 03:00 的当前仓库绝对路径任务。

- 收紧通用文件 API 的存储与权限边界：物理路径改用 `path.relative` 判断是否真正位于
  `STORAGE_ROOT` 内，硬删除也复用同一安全解析；团队/比赛文件只允许当前工作区对应作用域、
  当前校园且状态为 `active` 的成员访问，管理操作还要求 owner/admin。全局管理员不再绕过普通
  用户和团队文件所有权，已软删除的公开文件元数据统一隐藏。
- 上传除扩展名、客户端 MIME 和大小外新增内容签名检查，覆盖 JPEG/PNG/GIF/WebP、PDF、
  ZIP/RAR/7z 与文本二进制伪装。新增 6 项回归，覆盖相邻目录前缀穿越、伪造 PNG、跨校园团队、
  失效成员、管理员越权和软删除元数据；Server 类型、303 端点认证静态门禁和运行时匿名矩阵通过。
- 文件存储安全提交 `f6ddc95` 已部署为公网构建 `gRRkDA9MqSWR-StqiXCOf`；3000/3002 健康检查
  与两套 303/303 匿名接口矩阵通过，Server/Judge 重启正常。

- 修复校园提交只记录 `workspaceScope=campus`、未记录具体组织导致的多校园串读风险。`Submission` 新增
  `organizationId`；题库提交和活动提交在创建时固化请求/活动组织，列表、题目记录与详情按当前组织过滤。
  通用重评和远程代码重新抓取同时收紧为提交本人且组织匹配，比赛管理员继续使用活动范围重测。
- 迁移前备份 `/data/backups/oi-manager/oi_manager_pre_submission_org_20260824_1120.dump` 已通过
  `pg_restore -l`。生产 2576 条历史校园提交按活动、校内题或唯一成员关系全部回填，空组织数为 0；
  数据库迁移 26/26，跨校园/破坏性接口/训练隔离测试 16/16、Server 类型和匿名矩阵 303/303 通过。
- 提交组织隔离修复 `39b857b` 已部署为公网构建 `_3YRjoz8eLKRo8vT_gr0s`；3200 候选、3000 提升、
  Server/Judge 重启和健康检查通过，3002 直连与 3000 同源代理匿名矩阵均为 303/303。
- 新增 303 个 HTTP 端点的认证边界门禁：静态解析直接 `authenticate`、受保护路由挂载、路径级认证
  和认证中间件数组别名；当前识别 296 个必须认证端点与 7 个显式公开端点。公开文件、健康检查、
  平台绑定元数据及登录/注册/退出均在机器可读清单中记录公开理由；未登记匿名端点会使文档门禁失败。
- 新增运行时匿名矩阵，实际向全部 303 个端点发送无会话请求。首轮发现空 JSON 登录请求触发 Prisma
  参数错误并返回 500；登录入口现先校验字段类型、空值及长度，空/缺失/错误类型和超长凭据统一返回 400。
  6 项输入回归通过，重启 Server 后匿名矩阵 303/303 通过（296 个 401、7 个公开非 5xx）。
- 认证门禁与登录校验提交 `9eda8c5` 已部署为公网构建 `ywaWmTvM6CM5X2HamOmSM`；3002 直连与
  3000 同源代理各自完成 303/303 匿名矩阵，3200 候选、3000 提升和健康检查均通过。
- 迁移已退役的 Server 权限单元测试：删除不存在的 `canAccessSchool/canManageSchool` 旧契约，测试夹具在保留
  历史 User ID 别名的同时返回真实组织学生/教师档案 ID。新权限套件覆盖本人、同组织、跨组织、负责人、
  班主任、团队公开/私有、owner/admin/member、个人/校园上下文和全局管理员前置条件，定向测试 13/13 通过。
- 权限测试迁移提交 `59f4597` 已推送；主干预览构建 `cLM4IQTMUJofnTy88pd_F` 通过 3200 候选与
  3000 提升健康检查，Server/Judge 已重启，数据库与带 Python3 的 Judge 容器保持健康。
- 提交详情共享结果组件修复 `be83577` 已推送并部署为公网预览构建 `YFyBItVMM7t35S7z9XQE-`。
  学生 Edge 已在线复验 IOI #3682 的 40/100、`sum` Subtask、20 个测试点及 checker message；
  ACM #3681 正确显示首个失败点与 Fast-Fail 跳过项且无得分列，#3677 显示 20 个 Accepted 测试点。
  IOI/ACM 排行榜均完成“本人题目格 → 提交列表 → 现有详情弹窗”两级流程验证：他人题目格不可点击，
  Enter 可打开本人记录，嵌套弹窗只有最外层单一滚动容器，Escape 按详情、列表的层级逐次关闭。
- 学生 Edge 在线打开 IOI 40 分提交 #3682 时，详情弹窗只显示摘要和源码，虽然后端已返回 20 个测试点、
  1 个 `sum` Subtask 及 checker message。新增共享 `SubmissionJudgeResult`，提交独立页和活动弹窗统一显示：
  OI/IOI 总分、Subtask、测试点得分/耗时/内存/message；ACM Verdict、首个失败点且不显示点分。
- 修复活动提交详情仍读取旧 `problemIdentityHidden` 字段的问题，同时兼容当前 `problemSourceHidden`；
  隐藏原题身份时标题改为“#ID | 用户 的比赛提交”，不再显示错误的“全部平台-C”，远程 ID 继续隐藏。
  新增结果行、失败点和内存格式单元测试，Web 单元测试 34/34、类型与导航静态检查通过。

- Edge 复现普通教师查看赛中隐藏原题身份的 IOI 比赛时，题目列表和题面元信息显示“题目标题缺失/未命名题目”。
  该场景继续隐藏原题标题、平台和题号，但改用稳定的“题目 A/B/…”活动标签，题面、题解和附件采用同一规则。
- 修复活动题面和题目笔记把毫秒制 `timeLimit` 错标为秒的问题，`2000` 现在显示为 `2000ms`；新增题目标签单元测试。
- 迁移一条过时的超级管理员首页断言：当前严格管理员工作区首页为 `/admin`，不再使用历史 `/admin/schools`。
  Web 单元测试 29/29、类型检查、UI 状态契约和 63 页面/86 发现导航静态审计通过。
- 修复提交 `f2acba5` 已推送并部署为预览构建 `AehXHfPqGZHMu5vpiCKWx`。真实 Edge 在线确认
  1158 比赛列表显示“题目 A/B/C/D”，题面显示“题目 A”和 `2000ms`，无缺失占位、错误秒单位或横向溢出。
- 普通教师 Edge 逐项点击 1158 的评测记录、题解、附件和排名后，修复“所有题目附件数组均为空但页面不显示空状态”；
  附件页现在明确显示“暂无附件”，纯状态单元测试覆盖空集合、全空数组和任意非空数组。
- 比赛评测记录筛选改为复用全局唯一 `JUDGE_RESULT_OPTIONS` 与 `LANGUAGE_OPTIONS`，补齐 PE、OLE、
  远程不可用、Judge 失败、未知错误、提交失败和完整语言集合；全局状态集合保留旧 `pending` 兼容。
  Web 单元测试增至 31/31，类型检查和 UI 状态契约通过。
- 修复提交 `933cb26` 已推送并部署为预览构建 `yAOIk_SAEjxP3QmmqzxiF`；真实 Edge 确认附件页显示
  “暂无附件”，评测筛选完整显示 16 个结果选项（含 OLE/PE/Queuing/Judging）且页面无横向溢出。

- 收紧题目级 ACM Hack 的题型边界：仅传统源码批处理题 `default` 与历史兼容名称
  `standard` 可以启用；客观题 `objective` 不再出现在可启用状态，题目详情接口也不会对
  已残留的无效配置暴露 Hack 入口。
- Judge 增加独立 Vitest 配置，只收集 `src/tests` 下的 TypeScript 测试，避免生产构建目录
  `dist` 中的 CommonJS 测试副本被二次收集而导致伪失败。验证包括 Server Hack 4/4、Judge
  6/6 以及 Server/Judge/Web TypeScript 检查。
- 修复提交 `851ca0e` 已推送并部署为预览构建 `rKIqHKJvX7wNvf2ibf5gW`；3000 候选与
  提升后健康检查、Server/Judge 重启、Python3 沙箱镜像和 25/25 数据库迁移状态均通过。

- 普通教师 Edge 权限审计覆盖校园全部一级模块及团队、比赛、题目、提交动态详情；修复非比赛管理员直接进入
  题面选择时永久加载并重复弹出 403 的问题，现在一次提示后返回明确的活动详情路径。
- 题面选择组件为组织比赛/作业、组织团队活动、个人比赛和个人团队训练分别接收稳定返回路径；非权限错误
  不再白屏，而是显示可恢复错误页和“返回活动”操作。
- 非比赛管理员题面选择权限回归连同六种身份初始化定向复跑 7/7 通过；Web 类型、导航、UI 状态和文档门禁通过。

- 全平台 Edge 审计完成超级管理员和平台管理员全部静态/动态页面、串区重定向，以及校园学生主要模块首轮复核；
  修复学生概览“评测记录”链接被模块白名单错误拦截的问题，学生现在可进入校园上下文中的本人提交列表。
- E2E 内部链接巡检把学生评测记录纳入根页面，并新增权限断言：学生页面不显示用户名筛选，服务端详情仍只允许本人。
- 修正审计基线中的 E2E 文件数量：当前实际可执行规格为 16 个，不再把历史/辅助文件误记为 42 个。
- 修复 E2E 页面审计监听器泄漏：每次健康断言后解绑 console/pageerror/response 监听器；连续链接点击时仅忽略
  Next.js 明确声明“回退完整浏览器导航”的 RSC 推测预取取消，最终目标页、API 失败和其他控制台错误仍保持阻断。
- 真实 Edge 补充完成学生校园主要页面和个人工作区静态页面巡检；个人区当前无数据的动态详情仍保留为明确待办。
- 隔离 E2E 合并复跑登录权限与全角色内部链接两组共 20/20 通过，覆盖本批学生评测记录入口及审计器生命周期修复。
- 在线复验修正学生评测记录中的虚假题目链接：校园学生无权直接进入校内题库时，题号不再跳向会被重定向的
  `/org/:id/problems/:id`；提交详情行点击和外部 OJ 链接不受影响。
- 功能提交 `44d4cb0`、`fb66a7a` 已推送并部署为预览构建 `dy1igmvi3TtWEAwIDKzlN`；Edge 在线确认
  学生校园评测记录有 8 条数据、无校内题库虚假链接，整行可进入本人提交 #3684 详情，页面无错误或横向溢出。

- 收口题目级 ACM Hack 边界：STD 成功退出但未生成答案时按标准程序阶段系统错误处理；Hack
  列表只返回摘要，候选输入、生成器和被 Hack 源码改为点击详情后按权限单独加载；记录新增
  `failureStage`，管理者可直接区分输入、生成器、Validator、STD、两次评测、配置过期和入库失败。
- 管理者重新执行系统错误 Hack 前会检查同用户同题的活动任务，并把数据库并发唯一约束冲突稳定转换为
  `409 HACK_ALREADY_ACTIVE`，不再出现极端并发下的 500。
- Hack 测试数据提升现在覆盖暂存写入、两次重命名和数据库事务的统一失败清理；任一阶段失败都不会留下
  单独的 `.in`、`.out` 或 `.pending` 文件。
- 修复提交 `f1337b4` 与原子提升提交 `af11921` 已推送 `main`；迁移 25/25，预览构建
  `8fxNjMc1nbC96bWmMLqlt` 已提升到公网，Server/Judge 已重启。迁移前备份
  `/data/backups/oi-manager/oi_manager_pre_hack_refinement_20260824_070650.dump` 已通过 PostgreSQL 16
  `pg_restore -l` 校验。
- 验证：Judge 4/4、Server 4/4 定向测试，Prisma 校验，Server/Judge/Web 生产构建，导航审计、UI 状态门禁、
  文档门禁和在线 Edge 的“评测设置 → Hack”配置入口均通过。

- 平台安全审计发现 PostgreSQL `5432` 与高权限 go-judge `5050` 被 Docker 发布到所有网卡；
  Compose 端口现仅绑定 `127.0.0.1`，数据库和沙箱不再可从公网直接访问。
- Server API `3002` 原先也监听所有网卡并可从公网直连；现默认通过 `API_HOST=127.0.0.1`
  仅服务同机 Web 反向代理与 Judge，容器部署需要外部监听时必须显式配置。
- 恢复 Playwright 路由 fixture 缺失的归属、解析和紧凑视口导出，251 条 E2E 用例重新可收集；
  管理员工作区测试同步为“超级管理员/平台管理员无个人区”的当前规则。
- 将 E2E 身份与资源种子从已删除的 `User.schoolId`、旧 Teacher/Student/Admin 表迁移到
  Organization、Membership 和校园身份 Profile；隔离库重置重新可执行。
- 修复组织 catch-all 路由下题单详情把 `segments` 误读为 `params.id`，导致列表可见但详情恒为空；
  组织路由现在显式传入题单 ID。
- 统一组织工作区侧栏使用绝对 `/org/:organizationId/*` 链接；学生直接访问管理、题库等未授权模块时
  自动返回校园概览，不再停留在受限 URL。
- 账号中心改用绝对个人导航，消除从校园页面进入账号资料后对 `/account/teams`、`/account/campus`
  等不存在 RSC 路由的 404 预取。
- 题目详情仅在拥有编辑权限时请求和展示 AI 工具，普通查看者不再触发 `/ai/usage` 404。
- E2E 全面迁移到统一组织路由和组织上下文；Chromium 56 条冒烟全部通过，当前登录、管理员、
  校园负责人、学生、个人区、题单和提交详情视觉基线已重新审阅并固化。
- 修复嵌套提交弹窗的双滚动条和单次 Escape 同时关闭两层弹窗；页面模式现在锁定根滚动容器，
  且仅最上层 Modal 处理键盘事件。
- 迁移题单测试 helper：`ProblemList.schoolId` 改为当前 `scope + organizationId`；为已退役的
  `/api/schools/*` 增加明确 410 契约，避免旧行为测试污染全量回归结果。

## 2026-08-23

- 新增题目级 ACM Hack：题目管理者配置并编译检查 C++17 STD/Validator，拥有题目提交权限的
  用户可提交直接数据、C++17/Python3 生成器和被 Hack 程序；Hack 使用独立记录与队列，不
  污染普通提交、排名和重测。
- 有效性按两次完整评测的最终 Verdict 变化判定。候选点在第二次评测中优先执行，通过后生成
  `hack_<attemptId>.in/.out`，同步题目和所有 ACM 活动快照；已完成提交和 OI/IOI 快照不变。
- 增加同用户同题与同题评测中的数据库并发约束、配置 revision/hash 过期保护、重复输入检测、
  题目级原子落库和失败清理；普通用户只查看自己的记录，题目管理者可查看全部并重试系统错误。
- go-judge 镜像加入 Python 3.11；修复无输入程序缺少空 `stdin` 文件导致生成器 RE 的问题。
- 在线浏览器验收发现并修复历史 `problemType=standard` 传统题被 Hack 配置页错误禁用的问题；
  `standard/default/objective` 现统一按源码型批处理题处理。
- 被 Hack 程序语言与 Judge 实际注册能力取交集，当前支持 C/C++ 与 Python3；Hack 历史增加
  本人/题目管理员可见的候选输入或生成器及被 Hack 源码详情。
- 验证：Prisma Schema 校验、24/24 迁移、Server/Judge/Web 生产构建、Server 2/2 和 Judge
  3/3 定向测试通过；真实 go-judge 以直接输入和 Python3 生成器两次验证 `Accepted → Wrong Answer`。
- 迁移前完整备份 `/data/backups/oi-manager/oi_manager_pre_problem_hack_20260823_2355.dump`
  已通过 PostgreSQL 16 `pg_restore -l` 校验。
- 功能提交 `44ad7c4`、兼容修复 `f3a56fc` 与详情收口 `a36c1f8` 已推送并部署；预览构建
  `ubx1GgM3v7m0hPeZKng7g` 通过 3200 候选和 3000 提升健康检查，Server/Judge 已重启。
  负责人真实浏览器验收确认历史 `standard` 传统题的 Hack 配置可启用，页面无 warning/error。

## 2026-08-22

- 收紧活动题面/题解边界：比赛、训练和作业页面移除“基于当前题面创建个人版本”和“我的题面/题解”，
  活动上下文的个人内容写入接口同步删除；活动中只允许选择既有题面和题解。
- 活动管理员可编辑当前选中的 Markdown 正文或替换 PDF。保存会创建新的活动快照 revision，
  不修改题库原版、用户版本或其他活动；陈旧快照写入返回 `CONTENT_SNAPSHOT_STALE`。
- 题面与题解入口分别改为“题面选择”和“题解选择”；管理员编辑共用活动快照编辑弹窗，
  普通参与者仅能切换已提供题面并按既有开放规则查看题解。
- 验证：活动内容定向测试 7/7、Server/Web 生产构建通过；覆盖管理员/参与者权限、旧创建
  接口封锁、Markdown revision、陈旧写入、来源隔离、PDF 替换及旧文件保留。
- 功能提交 `19b6b6f` 已推送，Server/Judge 已重启；预览构建 `fMB8H8E8lL7Q0M2T54lJj`
  通过 3200 候选与 3000 提升健康检查。
- 精简普通题目页的多题面工作区：右侧正文区不再重复显示题面版本名称、作者、可见性、语言、
  格式、来源说明或“基于此题面创建”入口，官方和公开题面直接从正文开始；个人题面仅在需要
  编辑时显示紧凑操作栏。版本身份和创建入口统一保留在左侧版本栏。
- 修复提交 `79dc21b` 已推送并部署为预览构建 `nc35unrXTK3QzFiwysxxv`；3200 候选与
  3000 提升健康检查通过。
- 修复多题面接口上线后返回 404：数据库迁移和 Web 预览已更新，但 3002 Server 仍是功能
  发布前启动的旧进程，未注册 `statement-versions` 路由。重启开发服务组后，未登录请求由
  404 恢复为预期的 401；使用负责人有效会话请求指定题目返回 200 和官方题面列表。
- 验证：3000/3002 健康检查通过，Server/Judge 均于本次修复重新启动；指定接口使用实际
  组织上下文和会话复测返回 200。

## 2026-08-21

- 将个人题面重构为 VJudge 式多版本：每位用户每题可创建多份独立命名的 Markdown/PDF
  题面，支持私有/全平台公开、从官方/公开/自有/空白题面独立派生和软删除；题目页采用
  左侧官方/我的/公开版本列表与右侧内容工作区。
- 活动题面改为独立矩阵管理，可为每题选择多份不可变快照并指定唯一默认题面；参与者可切换
  管理员选中的版本，选择只保存在浏览器本地。题解仍沿用原有单选快照和开放规则。
- 新增多题面权限、标准化同名、派生独立、跨题目作用域和活动快照不可变测试，定向测试 4/4
  通过；Server 与 Web 生产构建通过。
- 功能提交 `3edf4f8` 已推送；迁移前备份通过 `pg_restore -l` 校验，23/23 数据库迁移完成，
  301 道历史活动题均生成多题面选择集合 revision 1。预览构建 `SUjSF5JVPnpXvR3BO0msz`
  已通过 3200 候选和 3000 提升健康检查。

- 调整活动内容版本管理入口：从比赛/训练基础编辑表格移除题面与题解下拉框，改为在“题面”页
  针对当前题目打开独立“管理活动内容版本”弹窗；弹窗显示当前 revision、候选版本和预览，
  保存仍追加不可变快照。新活动继续由服务端自动选择默认官方版本。
- 修复提交 `c7cb7cf` 已推送并部署为预览构建 `eT3lfFreazJiKcuMbPe39`；3200 候选与 3000
  提升健康检查通过，负责人浏览器验收确认基础编辑弹窗不再包含版本选择器，新入口与 revision
  信息正常且控制台无错误。

- 新增用户专属题面/题解：每人每题可分别维护一个 Markdown 或 PDF 当前版本，revision
  随编辑递增，默认私有，并可授权给多个校园或全平台活动使用。
- 比赛、训练和作业的每道题可独立选择题面与题解来源；活动使用不可变 revision 快照，
  赛中更换只追加新版本。个人 PDF 会复制为活动专属文件，作者后续修改、删除或撤销共享
  不影响既有活动；题面不向参与者展示作者，题解开放后展示贡献者。
- 题库详情和活动题面均增加“我的版本”编辑入口；活动编辑器加载官方、自有及已授权版本，
  新活动添加题目时立即创建题面/题解 revision 1，补题作业复制当前快照。
- 验证：Prisma Schema 校验、根生产构建、用户内容定向测试 4/4、补题作业 17/17、训练兼容
  37/37 和文档检查通过；定向测试覆盖唯一当前版本、私有隔离、校园共享边界与活动快照不可变。
- 已推送功能提交 `541e088` 和迁移索引修正 `12959b4`；迁移前备份已校验，数据库 22/22
  迁移完成，301 个历史活动题的题面/题解 revision 1 全量生成。公网预览构建
  `IBHgEy3S4X96BkKWkX3jS` 已通过 3200 候选与 3000 提升健康检查；学生个人版本弹窗和负责人
  活动内容选择器完成真实浏览器验收，控制台无错误。

- 将题目来源与评测后端分离：所有本站代码提交统一进入本地 Judge，外部来源身份继续保存在
  `oj/problemId`；旧 `robot/myAccount` 请求兼容为 `local`，缺少本地评测配置或测试数据时返回 409。
- Codeforces/洛谷远程提交继续通过平台绑定同步归档；`archive` 记录只展示，不进入比赛计分、
  最佳成绩、Judge 或重测。比赛评测优先使用题目配置快照。
- 管理员全量重测新增 `/api/admin/data/rejudge-all-local`，旧 Carits 路径保留为兼容别名；两者
  均跳过排队中、评测中和远程归档记录。
- 题目与比赛提交界面移除机器人/个人远程提交入口，外部来源题开放本地评测设置和比赛提交；
  新增外部来源本地提交回归测试 8 项。
- 验证：根生产构建、外部本地提交 8/8、训练兼容 37/37、Server Judge 协议 2/2、Judge
  客户端 2/2 和文档检查通过；已推送 `5c86d22`，部署预览构建 `2ArRJLSYPVzgHd2aY5_P0`，
  3000/3002/5050 健康且 Judge 已注册。
- 修复个人归档题目统计接口被 `/:id` 动态路由遮蔽的问题；`GET /api/archived-problems/stats/summary` 现在正常返回统计数据，并新增回归测试。
- 修复 OI 赛中题目身份泄露：overview、题目列表、题目状态和题面接口在隐藏阶段不再返回原题标题、别名、内部题目 ID 或平台字段；管理员与比赛结束后的展示保持不变。
- 修复 `pnpm restart` 的生命周期行为：补齐根 `start` 脚本并让重启后的 `start` 阶段幂等，避免服务已健康启动却因缺少 `start/server.js` 返回失败。
- 加固外部 OJ 下载的 SSRF 防护：URL 校验会解析 DNS 并拒绝解析到回环、内网、链路本地或元数据地址的主机，覆盖数字 IPv4 别名和重定向目标；安全测试 3/3 通过。
- Fixed training route scope prefiltering for global administrators: super admins and platform admins can inspect campus/team contests without an active organization context, while regular users remain scope-isolated. Migrated compatibility fixtures; `training-compatibility.test.ts` now passes 37/37.
- Hardened OJ fetch configuration and batch jobs: platform names must be allowlisted, cookie configuration is capped at 64 KiB, and batches are capped at 200 string problem IDs.

- 修复比赛提交状态一致性：训练提交详情不再因缺失 `cases` 把 OLE/CE/RE 等终态误报 404；列表返回稳定的 `TrainingProblem.id`，并保留评测错误信息。
- 修复 OI/IOI 排行榜按 `cases` 筛选导致的漏记；修复 ACM 排行榜对 Queuing/Judging 的失败次数误计；统一补充 `judging` 标准结果。
- 补充旧校园 JWT 的 `schoolId → School.organizationId` 兼容解析并继续校验活动成员关系；迁移测试夹具到当前组织模型。
- 验证：Server 构建通过；提交详情、OI 无 cases 排名、ACM 进行中状态定向测试通过；历史全量套件仍有旧契约项未迁移。已推送 `cf00977` 并部署预览构建 `zQiyJOVrDFBVDsAmPOtaH`，3000/3002 健康检查通过。
- 修复平台题库管理权限：平台/超级管理员在无组织上下文的平台工作区可管理平台草稿、评测配置和 Checker，学校题仍保持组织隔离；通用文件上传增加运行时白名单，Checker 路径与绝对路径泄露风险已收紧。已推送 `d70290c` 并部署预览构建 `mr1BJwJo7HV2aQdSMWmLA`，3000/3002 健康检查通过。
- 收紧外部 OJ 附件/图片下载：阻止私网、回环和链路本地地址，重定向逐跳校验，仅可信 OJ 域名携带 Cookie，并限制远程响应体大小；安全单测 4/4 通过。
- Server 已构建并重启到 `113f884`；3002 服务健康。`pnpm restart` 尾部仍返回已知的缺少 `start/server.js` 警告，但服务实际启动成功。
- 收紧学校组织生命周期 API：平台管理员不再拥有学校列表、创建/编辑学校和负责人管理权限；新增授权回归测试通过。
- Server 已重启到 `7b9f1fa`，3002/3000 健康检查通过；重启脚本尾部的已知 `start/server.js` 非零提示仍存在。

## 2026-08-19

### Administrator full submission visibility

- 修复超级管理员和平台管理员评测记录页的全量展示：列表接口返回 `scope=all` 元数据，管理员页面明确显示全平台记录范围、总数和当前分页范围，并支持切换每页 20/50/100 条。
- 验证管理员接口能返回隐藏提交和全量总数；普通用户继续遵守原有工作区和权限过滤。

### Host reboot recovery and systemd service ownership

- Confirmed the post-reboot outage was caused by the obsolete `pm2-root.service` pointing at a missing `/nix/store` executable; PostgreSQL and go-judge were healthy.
- Added tracked systemd units for API, judge client, and published web preview with restart policies, memory ceilings, and journald evidence.
- Added a no-build installer and recovery runbook; the current artifact state was restored without changing the database.
- Fixed Node 24 workspace subpath resolution by mapping shared package exports to `.js`; the API now starts with the existing development-preview environment because the old env file does not contain production-only `CORS_ORIGINS` and `ACCOUNT_ENCRYPT_KEY`.

## 2026-08-18

### 认证工作区兼容与校园 ID 契约

- 登录、会话读取和工作区切换统一使用 `workspaceMode: "work" | "personal"`；登录接口继续接收旧 `mode`，旧 JWT 缺失工作区字段时按 `work` 处理。
- 新增 `POST /api/auth/switch-workspace`，会刷新 HttpOnly 会话 Cookie；首次进入个人工作区时按需创建 `PersonalProfile`。
- 修复认证响应把 `Organization.id` 错当作 `schoolId` 的问题。`schoolId` 现在只返回对应的 `School.id`，组织上下文继续由 `organizationId` 表示。
- 本轮复跑认证接口测试 `36/36` 通过。旧 `teams.test.ts` 仍有 14 项失败，原因是测试仍直接依赖已迁移的学校/成员模型和旧权限契约，尚未迁移；该问题不由本次认证变更引入。

## 2026-08-15

### Carits币与贡献 V1

- 新增个人、校园和平台管理端的 Carits币、贡献入口。当前均明确显示“暂未开放”，不会展示
  余额、流水、贡献值、排行榜或写入操作。
- 新增 Carits 账户、交易、不可变分录与贡献事件、组织归因、贡献项目的数据基础模型和迁移；
  不创建任何账户、初始余额、交易、分录或贡献事件。
- 组织上下文由 URL 对应的有效成员关系解析，服务端请求上下文包含成员关系 ID；工作区读取
  不再根据旧 `schoolId` 自动补写成员关系。
- 个人和组织只读接口统一返回 `featureStatus: "planned"` 与中文说明。未来公开贡献榜仅允许
  返回用户名、头像、贡献值和名次。


## 2026-08-13

### 比赛题号赛后显示

- “题号显示”设为“赛后显示”时，比赛进行中普通参赛者的 API 不再返回平台、平台题号、原题库 ID、别名、题目排序号、原题标题或原题链接；覆盖比赛概览、题目列表、题目状态、题面详情、评测记录和提交详情。
- 题目列表、题面切换、题解、附件和评测记录同步改为中性“比赛题目”展示；附件名称也会在赛中改为中性名称，避免文件名反向泄露题目身份。
- 比赛管理者始终可查看完整资料；比赛结束后普通参赛者自动恢复正常展示。OI 赛中原有的结果、分数、性能和远程提交 ID 隐藏规则保持不变。

### 赛时演示 V3

- 新增 V3 演示脚本与受保护的 V3 演示接口。脚本只通过受鉴权 HTTP API 创建资源；受保护接口只接受预定义的 V3 资源与时间线，不提供通用数据写入能力。
- V3 会创建 OI、IOI、ICPC 三场同时进行中的 20 小时比赛，每场 8 题、8 名演示学生；开始时间在过去 6 小时，结束时间在未来 14 小时。
- 三场比赛均使用复杂时间线：包含错误后通过、部分分后满分、仅错误、通过后错误、未提交和不同参赛者的分散提交，便于验证三种赛制的赛时可见性与排名表现。

### 统一登录与多校园身份

- 登录页改为唯一的“用户名 + 密码”入口，不再要求学生、教师或管理员预先选择登录端；登录成功后进入“选择身份”，从平台管理、各校园身份和个人中进入。
- 新增组织成员档案：学生档案和教师档案绑定成员关系，同一账号可在多个校园分别拥有独立姓名、年级/入学信息、主教练、Rating、联系方式和状态。
- 校园上下文由组织 URL 和有效成员关系共同决定。后端、组织页面和侧栏导航均使用当前校园成员身份，不再用全局账号角色推断校园身份。
- 保留旧学校字段、学生和教师表作为兼容数据源；已通过迁移建立组织档案和成员关系。后续业务资源会分批迁移到组织上下文，避免一次性改写历史比赛、提交与团队数据。
- 旧校园账号首次读取身份列表时会自动补齐可进入的校园关系；例如历史演示账号现在可同时显示“第一中学 / 学生”和“个人”。

### API 演示比赛数据与状态控制

- 新增比赛管理员 API：`POST /api/trainings/:id/start` 可立即开始未开始比赛，
  `POST /api/trainings/:id/finish` 可提前结束已开始比赛；提前结束比赛会公开该比赛原本
  隐藏的提交记录。两者均校验管理员身份和合法状态转换。
- 新增 `scripts/create-api-demo-contests.mjs`。脚本只调用受鉴权 HTTP API，不导入 Prisma、
  不连接数据库、不执行 SQL；它会幂等创建演示团队、5 名学生、5 道本地题、题解、样例说明附件、
  测试数据，以及 OI、IOI、ICPC 各三场（进行中、已结束、未开始）比赛。
- 已通过该脚本在公网预览环境写入演示资源：9 场比赛均有 5 题；进行中和已结束的六场分别
  有 25 至 35 条真实提交与 5 名参赛者，未开始比赛保持零提交。ICPC 包含错误尝试、首 A 和
  正常通过，三种排名接口均返回有效榜单。
- 演示提交会为各场可参与比赛分散写入错误代码和正确代码，保证 OI、IOI、ICPC 的评测记录
  均可展示 AC 与 WA；ICPC 的错误尝试还会用于展示负次数和罚时。

### OI、IOI、ICPC 排名矩阵

- 三种赛制使用分档自适应列宽：三题榜单适度放宽，四至八题逐级收紧，更多题目使用紧凑列宽并在内容区内滚动；搜索栏与成绩矩阵统一左对齐，避免榜单视觉重心漂在页面中央。
- 排名与参赛者列在成绩矩阵横向滚动时保持固定；窄屏只在榜单内部滚动，不再引起整个页面横向溢出。
- OI 使用克制的分数文字颜色突出最终总分，IOI 使用浅色进度背景表达部分分，ICPC 保留“提交次数/通过分钟”、失败负次数、首 A 深绿和普通通过浅绿。
- 参赛者列固定展示头像、姓名和用户名，长内容自动省略并可悬停查看完整信息；当前用户和行悬停不会覆盖成绩语义颜色。
- 新增浏览器回归测试，覆盖三种赛制、精确列宽、少题居中、首 A、失败提交、缺失分钟防御、移动端内部滚动和固定列。

## 2026-08-12

### ICPC 首 A 标识

- ICPC 排名接口按每道题的有效通过时间计算首 A，同一毫秒内按提交 ID 稳定判定，并排除不计入排名的团队管理者、校级比赛创建者和学校负责人提交。
- 排名接口新增独立的通过分钟字段，排名矩阵使用“提交次数/通过分钟”展示成绩，不再用拥挤的“+ 首 A”标签。
- 首 A 使用深绿色白字，普通通过使用浅绿色，尝试但未通过使用浅红色，未提交保持空白；姓名与用户名合并为紧凑的参赛者列。
- 新增接口和浏览器回归测试，覆盖先错误后通过、只错误未通过、未提交、首 A 唯一性、固定题目列宽以及窄屏内部滚动。

### 路由巡检与 Codex 执行手册

- 修复学校比赛详情的包屑、加载态、错误态和删除后返回地址，避免生成不存在的 `/teacher/school/contests` 或 `/student/school/contests` 父路径。
- 修复个人比赛详情误把比赛 ID 当作团队 ID 的包屑跳转问题，统一返回 `/personal/contests`。
- 新增 `pnpm routes:audit` 静态跳转巡检和 `internal-link-audit.spec.ts` 实际点击巡检；四种固定 E2E 身份分别验证负责人、教师、校园学生和个人学生的可见内部链接与详情页返回链路。
- 重写 Codex 接手指南，明确服务器工作树、禁止直接操作数据库、E2E schema 隔离、路由/按钮真实点击门禁、部署步骤和文档交付要求。
- 已实际验证：Web 单测与构建、`pnpm docs:check`、`pnpm routes:audit`、四种身份的 Chromium 内部链接巡检、GitHub `main` 推送，以及 `3000` 健康检查。

## 2026-08-11

### 校园主页

- 校园工作区新增固定的“校园”入口，教师、学校负责人和学生都可进入，不涉及工作区切换。
- 学校主页收敛为学校资料页，只展示学校身份、简介、公告、学校状态和联系人；负责人可编辑，其他本校用户只读且联系电话、邮箱脱敏。
- 教师、学生、团队、比赛、题单和排名继续使用侧栏原有入口，不再在校园页内重复提供标签和运营统计。
- 学制作为负责人编辑学校信息时的基础配置，支持六三三、五四三、六三、五四与自定义；年级计算同步读取统一配置。

### 排名体验

- 校园排行榜统一为 Rating 与做题量两个指标，支持姓名或用户名搜索、年级筛选、已毕业学生开关和服务端分页。
- 个人排行榜只展示公开用户名资料，并支持用户名搜索；校园资料不会进入个人排行榜返回数据。
- 比赛与训练榜单增加参赛者搜索和更轻的当前用户提示，不改变 OI 封榜、作业排名权限或原有计分规则。

### 文档中文化规范

- 当前生效文档中的说明性文字统一使用中文；命令、路径、环境变量、协议、代码标识符和第三方产品名称保留原写法。
- 将 Codex 项目接手指南、评测机提交可见性说明和文档首页中的英文说明改为中文。

### 团队模块 UI 重设计完成

- 以紧凑管理工作区风格完成团队详情概览、公告、创建/编辑和转移所有权弹窗。
- 团队概览在教师、学生和个人工作区中统一组织头像、身份、所有者/范围/成员信息和权限操作。
- 个人团队继续优先显示用户名所有者，不在团队头部暴露学校和其他私密身份字段。
- 已验证：`pnpm --filter web build`、文档检查、预览构建和部署健康检查。

## 2026-08-10

### 团队成员管理界面更新

- 将团队详情标签、成员管理布局、加入申请审核行和邀请弹窗整理为更紧凑的管理界面。
- 邀请与待处理邀请弹窗改为更宽的结构化布局，明确搜索、选择、状态和底部操作。

### 作业排名可见性

- 作业详情对非管理者隐藏排名标签，初始加载标签骨架也保持一致。
- 直接访问作业排名 API 时，非管理者会收到 `403`。

### 比赛列表排序

- 团队、学校、学生汇总、个人汇总和卡片式比赛列表现在按状态排序：进行中、未开始、已结束。
- 相同状态按既有标题中的数字级别、开始时间和创建时间/ID 兜底排序；在专用级别字段出现前保持旧数据稳定。

### 比赛远程提交 ID 隐私

- 训练和比赛的提交列表/详情 API 对每种赛制和状态都向非管理参与者隐藏 `ojRemoteId`。
- `SubmissionDetailModal` 遵守后端 `hideRemoteId` 标志，参与者不会看到远程提交 ID 或误导性的“等待分配”状态。
- 已验证：Server 构建、Web 构建、文档检查和 Git 差异检查。

## 2026-08-07

### Codex 项目接手指南

- 新增 `docs/guide/CODEX_ONBOARDING.md`，记录 SSH 访问、远端工作树、运行端口、测试/部署/推送流程、文档门禁、安全边界和近期高风险模块，供新 Codex 会话使用。
- 已从文档首页链接该指南，后续代理可从正式文档入口找到它。
- 此项为仅文档更新，推送前已运行 `pnpm docs:check` 与 Git 差异检查。

## 2026-08-02

### 统一左侧导航

- 所有岗位、校园和个人工作区改用默认隐藏的左侧抽屉导航，顶部只保留菜单、品牌和工作区切换。
- 导航不会因路由、刷新、工作区切换、悬停或窗口变化主动显示；展开状态按账号和工作区分别记忆。
- 账号身份卡移至展开侧栏左下角，菜单向上弹出，集中提供资料、安全、平台绑定和退出入口。
- 预览提升脚本可复用已通过候选健康检查的受管进程，避免重复启动候选导致无意义的提升失败。

### 登录入口

- 根地址 `/` 改为服务端直接跳转 `/login`，移除旧的介绍/开始页面，用户首次进入即看到实际登录表单。
- 预览提升脚本改为有限次数的健康轮询，并在失败回滚后验证旧版本恢复，避免端口切换时把 Next 启动竞态误报为构建故障。

### 校内题库与学校隔离

- 将题库拆分为 `platform` 和 `school`；学校题使用 `school:<schoolId>` 独立命名空间，
  不同学校可以分别导入和维护同一道外部 OJ 题。
- 新增题目 `libraryScope`、`libraryKey`、`schoolId`、`sourceProblemId`、
  `publishedAt` 及与 `User`/`School` 的关系；删除改为归档，旧 `visibility`
  仅保留兼容。
- 建立集中式题目访问策略，覆盖 CRUD、题解、附件、PDF、测试数据、
  Judge 配置、AI、笔记、提交、题单和训练选题；跨校资源统一返回 `404`。
- 学校题图片、PDF、附件和测试数据迁入私有存储。学生通过训练上下文专用
  文件接口读取已授权内容，不能凭文件 ID 绕过教学活动。
- 教师页面新增独立的“校内题库 / 平台题库”标签，支持草稿、发布、创建人
  筛选、平台题复制和归档；学生校园工作区不提供题库入口。
- 校内题库列表保留整行快捷进入，并增加明确的“查看/编辑”操作；负责人和作者无需猜测整行可点击即可进入管理流程。
- 新增确定性数据迁移、历史学校题文件迁移脚本和双学校权限回归测试。
- E2E 固定数据显式区分平台/学校命名空间，并新增教师、负责人、学生和平台管理员的题库页面权限冒烟。

### 远端部署与浏览器验收

- 将校内题库版本 `5142630` 部署至开发服务器 `47.99.222.76`；迁移前生成 PostgreSQL
  完整备份 `/data/backups/oi-manager/oi_manager_pre_school_library_20260802_145336.dump`，
  并使用 PostgreSQL 16 工具验证备份目录可读。
- 先在生产备份恢复出的临时数据库执行归属预检和完整迁移，再升级远端开发数据库；迁移
  状态为 8/8，42 道现有题确定性拆分为 27 道平台题和 15 道学校题。
- Server、Judge 和优化 Web 构建通过；候选版本先在 `3200` 验证登录页与 API 健康检查，再提升至公网
  `3000`，切换后两项检查均返回 `200`。
- Server Vitest 472/472、Web Vitest 23/23 和校内题库远端隔离 E2E 14/14 通过；文档检查
  登记 109 条页面路由、51 个 Prisma 模型和 258 个 HTTP 端点。
- 本机浏览器通过 SSH 隧道访问远端部署，实测根地址直接进入登录页、教师与负责人校内题库、
  学生无题库入口、平台管理员跨域阻断和列表显式查看/编辑操作，浏览器控制台无错误。
- 本机 VPN/系统代理访问公网 IP 的登录请求曾返回 `502`，而服务器本机经 `3000` 和直连 `3002` 的登录均返回
  `200`；该现象记录为本机代理链路问题，不作为应用服务失败处理。
- 历史迁移 `20260429_rename_to_id_v2` 仍不能在全新空库直接重放；生产备份恢复库和现有远端
  数据库均已验证本次升级成功。该干净安装问题作为独立历史迁移修复事项保留，不改写已执行迁移。

## 2026-08-01

### 全角色个人工作区

- 将学生专属个人模式升级为 `super_admin`、`platform_admin`、`school_principal`、`teacher`
  和 `student` 共用的个人工作区；岗位 `role` 在切换时保持不变。
- 新增 `workspaceMode=work|personal`、`resourceScope=campus|personal`、
  `POST /api/auth/switch-workspace` 和按需创建的 `PersonalProfile`。
- 个人团队改为 `schoolId=null` 和通用 `user` 成员关系；团队邀请、申请、所有权转移、题单、
  训练、提交和排名查询均按服务端会话作用域隔离。
- 新增 16 个 `/personal/*` 页面和 3 个 `/account/*` 页面；个人 Shell 固定使用用户名，隐藏
  实名、学校、职称和后台岗位，旧学生个人 URL 提供兼容重定向。
- E2E fixture 为六类账号创建个人身份、个人团队、题单、比赛和提交；新增五角色切换、七个
  个人导航页、切换失败回滚和教师个人资源隔离测试。
- 顶栏模式控件增加明确的“工作区切换”标签、扩大点击区域和选中态；教师/负责人使用
  “校园 / 个人”，平台管理员/超管使用“管理 / 个人”，避免入口被误认为普通状态标签。
- 修复 `AppShell` 在退出登录时因条件返回跳过 `useMemo` 而触发的 React Hook 顺序错误，
  保证教师与管理员切换账号后不会进入路由错误边界。
- 团队训练继续使用 `teamId` 表示归属并保持 `schoolId=null`；`scope` 只负责校园/个人
  隔离，不改变既有团队训练与学校比赛的数据约定。
- 提交详情区分作用域和岗位权限：跨工作区或个人空间越权返回 `404`，同一校园工作区内
  无权查看他人提交返回 `403`。

### 前端页面与交互重构

- 统一角色 Shell：学生顶部导航，教师和管理员侧栏；移除首页重复 Shell。
- 新增页面、工具栏、Tab、分段控件、表格、表单、状态、空状态、分页和 Modal 基础组件。
- 重做登录与四类首页，首页改为近期任务、团队、邀请和平台状态概览。
- 重构团队、作业、比赛、题库、题单、排名、训练和提交高频流程。
- 搜索、筛选、分页和详情 Tab 进入 URL，刷新与浏览器历史可恢复。
- 新增 90 路由 UX 矩阵，并在两个桌面视口执行完整页面健康检查。
- 人物资料页进入统一角色 Shell，学生与教师资料合并为同一可访问组件；导入错误态和
  题目详情补齐语义标题。
- 全路由轻量健康检查与核心路由 Critical Axe 扫描分层，避免 90 页重复执行高成本扫描。

### 校园与个人模式隔离

- 团队增加校园/个人作用域，列表、详情、成员关系和操作接口按当前学生模式隔离。
- 跨作用域资源详情统一返回 `404`；在错误工作区调用专属能力返回 `403` 和
  `WORKSPACE_MODE_REQUIRED`，不向另一工作区泄露资源是否存在。
- 个人模式排名使用用户名，不显示学校姓名或学校归属信息。
- 增加同时拥有校园团队和个人团队的固定 E2E 数据，并覆盖模式切换后的团队、排名、
  缓存和权限隔离。

### Prisma Client 启动一致性

- 修复远端数据库已有 `Team.scope`、但运行中的 Prisma Client 尚未重新生成而导致的
  `Unknown argument scope` 和团队接口 `500`。
- 根目录 `dev`、`dev:dirty`、`build` 以及 Server `prebuild` 现在都会在启动或构建前
  生成 Prisma Client。

### 验证结果

- Server Vitest 完整主跑 460/464；4 项失败经契约修复及延迟隔离后，提交/训练 46/46、
  回归 11/11 聚焦复跑通过。远程测试库经 SSH 隧道访问，学校列表用例耗时约 58 秒，确认
  原 30 秒失败来自测试传输延迟。
- 全角色工作区 Chromium 18/18、旧学生模式隔离 11/11、Firefox 核心工作区冒烟 21/21。
- 109 条页面路由在 Chromium `1440×900` 全部通过；紧凑桌面 `1280×720` 为 115/115。
- 当前分支根构建、Server/Web TypeScript 检查、Web 23/23、Judge 2/2、UI 状态守卫和
  文档检查通过。
- Codex 内置浏览器完成教师校园/个人往返、个人首页、团队和排名验收；`1440×900` 与
  `1280×720` 均无横向溢出，个人页面只显示用户名，控制台无 warning/error。
- 线上接口隔离矩阵：24/24 断言通过；临时验证数据已清理。
- 文档检查覆盖 35 份活动文档、109 个页面、51 个 Prisma 模型和 253 个端点。

### 文档完成门禁

- 增加根目录 `AGENTS.md`，要求每个仓库任务同步变更记录、当前状态和对应活动文档。
- 在开发工作流中明确记录归属、完成检查项和 `pnpm docs:check` 门禁。

### 前端 UX 审查

- 从学生排名、团队、作业、训练详情、登录和各角色首页检查信息层级、页面结构和交互语义。
- 确认主要问题来自重复页面容器、内联样式扩散、基础组件覆盖不足以及首页缺少任务导向，
  不是单一配色问题。
- 在设计系统中记录角色目标、全局外壳、核心页面整改顺序、组件治理和桌面端验收标准。
- 本次只形成重构依据，没有切换线上 UI 或修改业务代码。

## 2026-07-30

### 文档体系重构

- 按指南、架构、开发、运维、参考和归档重新组织 `docs/`。
- 以当前源码重建 90 个页面、50 个 Prisma 模型和完整 HTTP API 目录。
- 修正开发/正式环境边界、PostgreSQL 测试隔离、Judge 鉴权和角色权限说明。
- 增加 `pnpm docs:check` 与独立文档 CI。

### UI E2E

- 建立隔离的 Playwright 测试体系，使用 `e2e` schema、`3100/3102` 和独立存储目录。
- 覆盖全部页面路由、核心角色流程、权限、安全边界、文件和模拟 Judge。
- Pull Request 运行 Chromium/Firefox 冒烟；`main` 和定时任务运行 Chromium 全量。

### 安全与运行链路

- OJ Cookie 配置限制为超级管理员，并改为脱敏响应。
- 维护迁移接口增加超级管理员权限和默认关闭开关。
- Judge WebSocket 增加强制 Token、双向心跳刷新和任务原子领取。
- 修复登录构建、角色别名、API 错误解析和开发构建缓存冲突。
 OI 双赛制，兼容旧子任务配置，并为 ACM 失败后的未执行测试点返回 Skipped。/ OI 双赛制，兼容旧子任务配置，并为 ACM 失败后的未执行测试点返回 `Skipped`。
## 2026-08-18
- 评测设置支持 ACM / OI 双赛制：ACM 题目按测试点串行评测，首个失败后返回 Skipped，最终分数为 0 或 100；OI 题目保留子任务、依赖和部分分语义。
- 服务端保存评测配置时归一化并持久化 mode，未指定模式的历史配置按是否存在子任务兼容推断。
- Judge、Web、Server 构建及文档检查通过；部署状态以本次提交后的健康检查为准。

- 2026-08-18: Added Lemon SPJ checker support, secure checker file storage APIs, and subset contest configuration.
