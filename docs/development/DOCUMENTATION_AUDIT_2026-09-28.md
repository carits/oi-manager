---
status: current
audience: development, operations
last_verified: 2026-09-28
source_of_truth: docs tree, docs:check, current Prisma schema and remote runtime branch audit
---

# 开发文档审计记录

本次审计针对当前 `docs/` 下的开发、架构、参考和运维文档，重点检查两类问题：

1. 是否仍把已经退役的 TestSet Revision、远端代码归档或 Contest→Training 兼容关系写成当前事实。
2. 面向开发者和维护者的说明是否仍使用整段英文，导致与项目中文文档风格不一致。

## 已修正

- `architecture/DATA_MODEL.md`：模型数与当前 Prisma Schema 对齐为 199；Contest/ContestProblem 明确为比赛唯一事实源；Submission 不再描述远端代码归档结果。
- `architecture/RATING_DOMAIN.md`：改为 Contest-only 事实源，并补充历史 Training 比赛行不再读取、新路径不再创建投影。
- `architecture/FILE_STORAGE.md`、`development/TESTING.md`：当前安全约束和数据库隔离说明已翻译为中文。
- `development/DESIGN_SYSTEM.md`：将过时的“学生模式”改为账号工作区和当前组织上下文语义。
- `operations/DEPLOYMENT.md`、`operations/RUNBOOK.md`：明确每题只有 Stable/Evolving 当前槽，Revision 迁移步骤仅为一次性历史迁移，不是日常发布流程；监控和备份操作说明已改为中文。
- `operations/EXTERNAL_DEPENDENCIES_2026-08-28.md`、`operations/SYSTEMD_DEPLOYMENT.md`、`reference/DATABASE_SCHEMA.md`：当前外部依赖、systemd 和 Training Engine 表说明已翻译为中文。
- `development/FULL_PROJECT_USABILITY_HARDENING_AUDIT.md`：标记为 `reference`，并注明这是保留英文证据的历史静态审计快照，不代表当前发布状态。

## 保留为历史内容的文档

`docs/CHANGELOG.md`、`docs/archive/` 以及带日期的恢复/性能/一致性审计报告保留当时的原始英文术语和事实，以便追溯，不能当作当前架构说明。它们已通过历史/参考标记或顶部警告与当前文档区分。

## 当前仍可见的英文

命令、路径、环境变量、协议名、数据库表名、枚举值、第三方产品名和代码标识（如 `Stable`、`Evolving`、`Reader`、`Writer`、`SSE`、`systemd`、`PostgreSQL`）保留原写法，避免复制时失真。少量原始审计证据仍保留英文正文，但已明确标记为 `reference`，不属于当前开发入口。

## 当前事实基线

- TestSet：每题只有 `Stable` 和可选 `Evolving`，不存在历史 Revision、`revisionId` 或 `latest` 指针。
- Contest：`Contest`/`ContestProblem` 是身份、参与者、提交、排名和 Rating 的规范事实源；Training 不再作为比赛业务事实。
- Training：现有 Stage/运行控制文档继续以当前代码为准；若未来完成 Stage 分组模型迁移，必须同步更新本审计记录和数据库参考。
- 运行分支：公网运行目录以 `docs/operations/REMOTE_ENVIRONMENT_MAP.md` 的远端 systemd/Git HEAD 审计为准，不以本地工作树推断。

提交文档变更前运行：

```bash
pnpm docs:check
```
