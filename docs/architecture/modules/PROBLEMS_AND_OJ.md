---
status: current
audience: development, operations
last_verified: 2026-09-08
source_of_truth: problem modules, OJ routes, adapter registry
---

# 题目、题单与外部 OJ

## 题库作用域

`Problem` 按 `libraryScope` 分为两个完全独立的题库：

| 题库 | `libraryKey` | 可见范围 | 管理者 |
|------|--------------|------------|--------|
| 平台题库 | `platform` | 已发布题可供教学和个人工作区使用 | 平台管理员和超级管理员 |
| 校内题库 | `school:<schoolId>` | 仅本校教师和负责人 | 作者管理自己的题，负责人管理本校全部题 |

校内题默认为 `draft`。同校教师只能看到其他作者的 `published`
题目；学生不能浏览题库，但可在已授权的题单、作业或比赛中阅读题面。
跨校资源、学校题对平台管理员及超管均表现为 `404`，不泄露是否存在。

`libraryKey + platform + problemId` 是唯一命名空间，因此不同学校可以分别
导入同一道外部 OJ 题并独立修改。教师可将已发布的平台题复制为本校草稿；
题面、题解、Judge 配置、附件和测试数据一并复制，后续不与平台副本同步。

平台题库的用户浏览入口按主来源再次分为“Carits 平台题库”和“其他题库”。
`GET /api/problems?library=platform&sourceGroup=carits|external` 在数据库查询和分页前完成分组；
不传 `sourceGroup` 时保留全部来源的兼容查询。分组只依据 `Problem.platform`，不会因附加 OJ 绑定改变。
教师校内题库和平台管理员管理工作台不使用该浏览分区。

归档代替物理删除。教师转校后题目仍属于原学校，由原学校负责人继续管理。
`visibility` 仅保留旧请求兼容，不得用于判断学校边界。

## 题目内容

Carits 本地题和外部 OJ 题共用 `Problem`。题面、PDF、附件、测试数据和
个人笔记使用独立模型或存储记录。所有读写入口共用集中式题目访问策略，
包括 Judge 配置、AI、测试数据、文件下载、提交和教学活动选题。

## 题单

题单由 section 和 entry 组成，支持排序、分享、学校/团队挂载和发布为作业。

- 校园题单只能添加已发布的平台题和本校已发布题。
- 个人题单只能使用已发布平台题。
- 学生只通过已分配的教学上下文访问校内题，不获得原始题库访问权。
- 发布作业时固定题目和目标范围，不依赖前端当前列表。

## OJ 适配器

`apps/server/src/oj-adapters` 的适配器统一输出标题、Markdown、样例、限制、来源 URL
和附件信息。OJ 抓题任务只能创建或更新平台题，不能命中学校副本。

- Cookie 配置：仅超级管理员，响应脱敏。
- 全局抓题任务：超级管理员和平台管理员。
- 教师导入：先获取平台题，再复制到本校，不获得全局任务管理权。
- 外部附件和题面图片下载只允许 HTTP(S) 公网地址，阻断本机/内网目标和不安全重定向；仅可信 OJ 域名会携带平台 Cookie，并限制响应体大小。
- 平台/超级管理员在平台工作区可管理平台草稿、评测配置和 Checker；学校题仍由组织权限隔离。

## 平台绑定、账号池与 AI

用户平台绑定属于账号级数据。Codeforces/洛谷归档和提交同步归入个人作用域，
不会创建学校题。OJ 账号池只允许平台管理员和超级管理员管理。

AI 翻译、格式整理和 Validator 助手只对题目管理者开放，并在调用和再次写入前
校验作用域权限。所有 DeepSeek 调用统一经过 AI Gateway：调用前从平台 Token 池预占，
调用后按供应商返回的 `prompt_tokens`、`completion_tokens` 和 `total_tokens` 结算；网络失败
释放预占，编译失败仍结算已经发生的 API 用量。普通管理者只能查看单次预估与实际用量，
平台管理员在 `/platform-admin/ai` 管理总池和不可变流水。数据模型由平台唯一的
`AiTokenPool`、追加式 `AiTokenLedgerEntry` 和逐次调用的 `AiGenerationRequest` 组成；
`AiUsageLog` 通过 request ID 关联真实输入、输出和总 Token 数。

Validator 助手只接受官方 Markdown 题面。题面以不可信分隔区传入模型，默认返回受 JSON
Schema 约束的 Validator DSL、Feature、Subtask Rule 建议和边界样例；服务端以可信模板生成
C++17/testlib Validator 并在 go-judge 编译。DSL 无法表达时保留 C++17 fallback。AI 结果不会
自动启用或发布；管理员审阅后才能保存、验证和激活不可变版本。

## 评测资产与数据生成

题目评测设置中的“评测资产与生成”是 STD、Validator、Classifier、Generator 和候选测试点
的统一入口。`ProblemJudgeProgram` 表示逻辑程序，`ProblemJudgeProgramVersion` 保存每次
上传或编辑产生的不可变源码版本、哈希、编译状态、作者和来源：

- 协议、语言能力、机器 Schema、帮助文本和编辑器模板由共享 Protocol Registry 唯一维护；详细约定见[评测程序协议](../JUDGE_PROGRAM_PROTOCOLS.md)。
- STD 使用 C++17；Validator、Classifier 支持 C++17 与 Python3，Validator 另支持 DSL 的可信 C++ 投影。
- Generator 可创建多个，C++17/Python3 新版本统一使用 `oj.generator/v1`；旧 `legacy-args-v1` 只读兼容。
- 只接受有大小上限的文本源码；二进制和可执行文件被拒绝。
- ProgramVersion 依次经过 `compiled → verified → active → retired`，编译成功不能直接成为活动版本。
- Hack 配置可以引用程序版本，同时保留旧源码字段双读兼容。

数据生成不是普通 Submission。`ProblemDataGenerationJob` 通过 Judge WebSocket 持久队列领取，
租约和 fencing token 阻止延迟结果覆盖；每一参数行保存为 `ProblemDataGenerationCase`，
独立经历 Generator、Validator、STD 与
Checker 自检。成功输入、答案、参数、种子、程序版本、耗时和内容哈希进入候选池，失败点
保留阶段与错误，不影响同批其他点。

所有可提交用户都可以贡献直接输入或 `oj.generator/v1` Generator。贡献任务先预占用户与平台
双层 Evaluation Credits，并受单用户、单题、全局并发、数据体积和 Candidate HOT 池硬上限。
Generator 从 JSON stdin 读取服务器选择的十进制 Seed/Profile/参数；C++ 由平台注入 helper，同一 Context 连续两次输出哈希不一致时拒绝。

贡献页面和写接口共用 `resolveContributionReadiness`：只有已激活的 STD、Validator 才能接收任务，
Validator DSL 激活时物化为不可变程序版本。Classifier 对 ACM 不需要；OI 普通贡献缺少 Classifier
时仍可完成 Validator、STD 与去重，但 Candidate 保持 `ADMITTED/awaiting_classifier`。Wrong Corpus
或渐进评估器尚未就绪时分别保持 `awaiting_corpus`、`awaiting_evaluator`，不得用占位价值发布。
页面立即展示贡献任务 ID，Generator 产生的 Candidate 作为逐点子结果返回；普通用户看不到其他贡献者、
Kill Vector、Holdout 或隐藏 Feature。

Candidate 通过技术验证后进入有界池。OI 每题最多 15 个 Subtask，每个 Subtask 在全部 Official
Group 与系统 Hack Gate 中合计最多 10 个唯一测试点；前三个管理员正式点作为最小 Official Core。
各 Subtask 独立按错误程序和行为簇数量进入 `CLOSED / LIMITED / OPEN`：无错误程序时只允许管理员
Bootstrap，至少 1 个错误程序后允许观察评估，达到 5 个错误程序且至少 3 个行为簇后才允许自动选择。

Wrong Behavior Corpus 使用本站稳定可复现的本地错误/部分分源码与人工错误程序，按当前判定行为
聚类并固定为 80% Evaluation 与 20% Hidden Holdout。Candidate 评估由独立持久任务依次执行
L1（24 个代表簇）、L2（最多 96 个）和 Holdout（最多 256 个），任务具有租约、fencing token、
执行/CPU 硬预算和幂等预算流水。未覆盖 Holdout 的任务不会自动晋升。普通贡献者只获得粗粒度结论；
题目管理者可查看每个 Subtask 的 readiness、dry-run 决策和成员替换审计，但不能绕过硬结构约束。

技术有效 Hack 只会产生带 14 天保护期的 Candidate，不再从 Judge 回调直接改正式数据。Selector
以错误簇覆盖、语义多样性、Feature、Hack 证据和运行成本计算集合价值；满 10 点时执行 11 选 10，
遵守手工保护、7/14 天新点保护、至少 3 个 Official Core 和同语义簇最多 2 点，并要求替换增益达到
`max(50, 当前质量的 5%)`。入选后只创建下一不可变 TestSet Revision，旧成员只记录 retirement
审计而不删除 Blob。题目级每小时最多自动发布 3 个 Revision；紧急发布需要原因和平台审计，仍须
通过结构、保护和 Revision CAS。固定旧 Revision 的活动、历史提交和排名永远不受影响。

外部平台研究和旧实现方案保存在[研究归档](../../archive/research/)和
[计划归档](../../archive/plans/)。
