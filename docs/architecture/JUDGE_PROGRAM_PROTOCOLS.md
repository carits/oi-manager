---
status: current
audience: development, operations
last_verified: 2026-09-07
source_of_truth: packages/shared/src/judge-program-protocol.ts, apps/judge/src/judge-program-runner.ts, ProblemJudgeProgramVersion
---

# 评测程序协议与模板

评测程序的能力矩阵、机器 Schema、帮助文本和编辑器模板统一定义在
`packages/shared/src/judge-program-protocol.ts`。Web、Server、Judge 和测试不得再自行维护语言或协议列表。

## 程序职责

| 类型 | 协议 | 输入 | 输出/结果 | 当前语言 |
| --- | --- | --- | --- | --- |
| STD | `oj.standard/v1` | 原始题目输入 | 标准答案 | C++17 |
| Generator | `oj.generator/v1` | JSON Context | 一份原始题目输入 | C++17、Python3 |
| Validator | `oj.validator/v1` | 原始题目输入 | exit 0 合法，非 0 拒绝 | C++17、Python3、DSL 投影 |
| Classifier | `oj.classifier/v1` | 已通过 Validator 的输入 | 严格 JSON `{"subtasks":[...]}` | C++17、Python3 |

Classifier 必须返回数据满足的全部 Subtask。输出不允许额外字段、空集合、重复 ID、非整数或未知 ID。

## 模板与完整示例包

内置模板不是一段静默填入编辑器的默认字符串，而是共享 Registry 中的版本化教学包。每个模板必须同时包含：

- 完整源码或 Validator DSL、协议标识和协议说明。
- 可执行 Fixture；STD 包含期望输出，Validator 同时包含合法和拒绝输入，Classifier 包含完整 Subtask 集合。
- 教学要点和使用前必须修改项。
- Generator 的 Parameter Schema、有限 Profile 以及完整 `oj.generator/v1` Context Fixture。

当前 8 个 v2 模板覆盖 C++17 STD，DSL/C++17/Python3 Validator，C++17/Python3 Classifier 和
C++17/Python3 Generator。数组求和只是可运行的教学例子，不能根据模板身份跳过编译、协议预检或人工激活。
模板 ID 保持稳定，内容语义更新通过 `version` 递增；已经创建的 ProgramVersion 继续固化当时的
`templateId/templateVersion`，不会被新模板覆盖。

模板目录接口只返回说明、语言、协议、Fixture/Profile 数量等摘要，不传输源码、Fixture 或 Generator
配置；管理员明确查看详情时才读取完整示例包。评测资产首页常驻展示四类模板入口，新建向导必须先让
管理员选择模板或空白开始，禁止静默载入。载入 Generator 模板时，源码、Schema、Profile 和 Fixture
必须作为同一草稿一起初始化。

Classifier 编辑器持续展示当前 Test Graph 的真实 Subtask ID、分值和依赖。模板 Fixture 引用不存在的
ID 时前端立即阻断预检，服务端和 Judge 仍对严格 JSON、未知 ID 与 Fixture 期望进行最终校验。

## Generator Context

新 Generator 只允许 `oj.generator/v1`。Context 固定包含 `protocol`、十进制字符串 `seed`、
`caseId`、`profile` 和标量 `params`。stdout 只能包含测试输入，stderr 仅用于限长日志；同一 Context
执行两次的 SHA-256 必须一致。C++ 模板使用平台注入的 `oj_generator.hpp`，用户无需解析 JSON。

历史 `legacy-args-v1` 只允许读取和执行旧版本，不在新建界面提供。迁移维护接口先生成 reportHash，
歧义版本 fail closed，再幂等回填协议元数据。

## 生命周期

源码在浏览器中是草稿。保存后先创建不可变 `draft` 版本；Judge 异步编译成功后转为 `compiled`，协议样例验证成功后转为 `verified`；
只有管理员明确激活后才成为 `active`，旧活动版本转为 `retired`。Validator 激活前必须同时验证正、
负样例；Generator 必须通过非空和双运行确定性检查；Classifier 必须通过严格 Schema、题目 Subtask
ID 和可选期望分类检查。创建、验证、激活分别记录审计事件。

编译和预检任务通过持久化队列分发给 Judge，并保存租约、Judge ID 与 fencing token。过期租约、断线
和 API 重启可以重新排队；迟到或重复结果无法越过 fencing token。基础设施错误最多自动重试三次，
达到上限只终止本次验证任务，不会把源码版本误标为程序编译失败，管理员可以重新发起验证。

Validator DSL 的“物化”只生成不可变 C++ ProgramVersion，不等于激活。物化后的版本仍必须依次完成
Judge 编译、正负 Fixture 预检和管理员显式激活。兼容的旧 `/activate` 路由保持相同物化语义，新客户端
使用语义明确的 `/materialize` 路由。

数据生成、普通贡献和 Hack 都通过统一 Judge Program Runner 执行 Python/C++ Validator、Classifier、
Generator 与 STD。普通贡献者只提交直接输入或 Generator；STD、Validator、Classifier 永远使用题目
管理员已激活的版本。正式任务在创建和领取时都会复核 `compileStatus=passed`、`lifecycleStatus=active`、
逻辑程序仍 active 且 `currentVersionId` 一致，防止排队期间被退役的版本继续执行。

普通用户上传 Generator 必须提供完整 `oj.generator/v1` Manifest，包括语言、入口、参数 Schema 和有限
Profile；Seed 由服务端生成并和 Profile、参数、程序版本、基础 TestSet Revision 一起固化到任务。
Validator 通过后先按输入 SHA-256 去重，重复输入不再运行 STD。管理员历史任务可以读取
`legacy-args-v1`，新贡献接口不能创建旧协议任务。

## 安全与兼容

- 源码限 256 KiB、拒绝 NUL 和二进制内容；Python 只提供固定解释器和标准库，无网络。
- stdout、stderr、CPU、内存、进程和生成数据大小均由 go-judge 限制。
- 老版本、历史 Candidate、Hack 和 TestSet Revision 不被原地改写。
- ProgramVersion 保存协议、模板、源码哈希、运行元数据、预检报告和激活时间，便于复现与审计。
- `pnpm judge:templates:check` 校验 8 个模板的静态契约与本地编译；`pnpm judge:protocols:smoke`
  通过真实 go-judge Runner 执行全部非 DSL 模板 Fixture、Generator 双运行确定性及联调链。
- `node scripts/verify-live-judge-template-ui.mjs` 使用五分钟短时管理员会话只读检查线上 P1345 的
  桌面/手机模板入口、Classifier 完整示例与 Subtask 阻断，并在检查前后对比活动 STD/Validator 身份。
