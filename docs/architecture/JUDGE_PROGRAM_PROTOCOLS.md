---
status: current
audience: development, operations
last_verified: 2026-09-06
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

## Generator Context

新 Generator 只允许 `oj.generator/v1`。Context 固定包含 `protocol`、十进制字符串 `seed`、
`caseId`、`profile` 和标量 `params`。stdout 只能包含测试输入，stderr 仅用于限长日志；同一 Context
执行两次的 SHA-256 必须一致。C++ 模板使用平台注入的 `oj_generator.hpp`，用户无需解析 JSON。

历史 `legacy-args-v1` 只允许读取和执行旧版本，不在新建界面提供。迁移维护接口先生成 reportHash，
歧义版本 fail closed，再幂等回填协议元数据。

## 生命周期

源码在浏览器中是草稿。保存后先创建不可变 `compiled` 版本；协议样例验证成功后转为 `verified`；
只有管理员明确激活后才成为 `active`，旧活动版本转为 `retired`。Validator 激活前必须同时验证正、
负样例；Generator 必须通过非空和双运行确定性检查；Classifier 必须通过严格 Schema、题目 Subtask
ID 和可选期望分类检查。创建、验证、激活分别记录审计事件。

数据生成、普通贡献和 Hack 都通过统一 Judge Program Runner 执行 Python/C++ Validator、Classifier、
Generator 与 STD。普通贡献者只提交直接输入或 Generator；STD、Validator、Classifier 永远使用题目
管理员已激活的版本。

## 安全与兼容

- 源码限 256 KiB、拒绝 NUL 和二进制内容；Python 只提供固定解释器和标准库，无网络。
- stdout、stderr、CPU、内存、进程和生成数据大小均由 go-judge 限制。
- 老版本、历史 Candidate、Hack 和 TestSet Revision 不被原地改写。
- ProgramVersion 保存协议、模板、源码哈希、运行元数据、预检报告和激活时间，便于复现与审计。
