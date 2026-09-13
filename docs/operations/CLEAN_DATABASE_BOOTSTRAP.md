---
status: current
audience: operations, development
last_verified: 2026-09-13
source_of_truth: apps/server/prisma/baselines/current.json, apps/server/scripts/bootstrap-clean-database.ts, scripts/verify-database-baseline.mjs
---

# 全新空库 Bootstrap

历史 migration 必须保持原文件和校验和，现有数据库继续使用：

```bash
pnpm --filter server exec prisma migrate deploy
```

早期 `20260429_rename_to_id_v2` 不能在全新空库顺序重放。自 `20260913_v2_lf` 起，全新安装不再运行时从
“当前 Prisma Schema + 可变 supplement”临时合成最终结构，而是应用经过生产备份升级路径对账的不可变
Baseline Snapshot，再顺序执行该 Epoch 之后的新 migration。

当前 Epoch 位于：

```text
prisma/baselines/current.json
→ prisma/baselines/20260913_v2_lf/manifest.json
→ prisma/baselines/20260913_v2_lf/schema.sql
```

Manifest 固定 Snapshot 哈希、进入 Epoch 的 67 个历史 migration 名称与原始 SHA-256，以及创建时的生产
结构签名。Bootstrap 只把 Manifest 中的历史 migration 登记为已执行；新 migration 必须按名称排在 Epoch
末项之后，并由标准 `prisma migrate deploy` 真实执行。任何历史 SQL、Snapshot 或冻结 supplement 被改写，
`pnpm db:baseline:check` 都会失败。SQL、Prisma Schema 和 supplement 的哈希在计算前统一规范化为 LF，避免
Windows CRLF 与 Linux LF 使同一 Git 内容得到不同校验结果；Snapshot 本身也固定写为 LF。

`20260913_v2` 是首次跨平台校验发现换行不稳定后保留的未启用审计产物，从未用于数据库 DDL；系统没有
覆盖该目录，而是创建 `20260913_v2_lf` 并切换 `current.json`，继续遵守 Epoch 不可变规则。

Baseline Snapshot 已包含原 supplement 中 Prisma 无法表达的 Check、部分唯一索引、函数和触发器，包括
Contest Rating 规范身份触发器：兼容旧二进制先写 `TrainingRatingConfig`、后创建 Contest 的
滚动发布顺序，并拒绝配置、榜单快照或 Rating Batch 指向与 `runtimeTrainingId` 不一致的 Contest。空库 bootstrap
与备份升级路径必须生成同一组触发器、外键和索引，不能只在增量 migration 路径具备该保护。

2026-09-13 使用最新生产备份完成双路径验证：两边均生成 202 张表，完整 public schema（含约束、索引、函数与
触发器）SHA-256 为 `de803187b4a0c99e30f6c5679ced341af8b5ce42187d0e4f114319b1c6edbb87`，比较结果为
`schema_match=true`。

## 安全规则

- 默认 `db:bootstrap:check` 只检查，不写入。
- `db:baseline:check` 校验 Epoch 指针、Snapshot、历史 migration 和冻结 supplement；该检查已进入架构/文档门禁。
- 只允许没有业务表、Enum 和 migration 记录的数据库；非空目标 fail-closed。
- 应用 Snapshot、标准 `_prisma_migrations` 表和 Epoch checksum 记录在同一个 PostgreSQL 事务中完成。
- 事务内再次获取 advisory lock 并复查空库，避免并发调用绕过第一次检查。
- 建库后立即运行 `prisma migrate deploy` 与 `prisma migrate status`；任一失败均视为安装失败。
- `--seed` 仅用于新环境初始化或隔离验收，不应在已有数据环境运行。

## 新环境操作

先创建独立空数据库并设置正确的 `DATABASE_URL`，然后：

```bash
pnpm db:bootstrap:check
pnpm db:bootstrap
```

创建后续 Epoch 不是普通 migration 的替代品。只有在当前 Schema 已与最新生产备份升级路径完成完整结构签名
对账后，才能显式执行：

```bash
pnpm db:baseline:create -- \
  --epoch=YYYYMMDD_name \
  --production-signature=<public-schema-signature-sha256>
```

已有 Epoch 不允许覆盖；新 Epoch 必须作为独立目录评审和提交。

服务器上的完整隔离演练使用唯一临时数据库，执行建库、迁移状态、Seed 和非空拒绝检查，结束后自动删除：

```bash
pnpm db:bootstrap:verify
pnpm db:install-paths:verify
```

`db:install-paths:verify` 同时保留两个隔离库：一个从空库 bootstrap + seed，另一个从最新正式备份恢复并
执行正常 `migrate deploy/status`。两边对 `public` 目录生成与物理列顺序无关的规范签名，覆盖表、列类型/
默认值/非空、约束、索引、Enum、函数、触发器、序列、视图和 RLS；签名 SHA-256 和逐字节内容必须一致，
不一致时失败并输出最多 200 行结构差异。

不要对生产 `oi_manager` 运行 bootstrap。即使误运行，非空检查也必须在任何 DDL 前拒绝；该保护不能替代
操作前核对 `DATABASE_URL`、数据库备份和变更审批。
