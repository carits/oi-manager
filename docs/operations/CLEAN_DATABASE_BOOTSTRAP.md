---
status: current
audience: operations, development
last_verified: 2026-09-13
source_of_truth: apps/server/scripts/bootstrap-clean-database.ts, scripts/verify-clean-database-bootstrap.sh, Prisma schema and migration directory
---

# 全新空库 Bootstrap

历史 migration 必须保持原文件和校验和，现有数据库继续使用：

```bash
pnpm --filter server exec prisma migrate deploy
```

早期 `20260429_rename_to_id_v2` 不能在全新空库顺序重放，因此全新安装使用当前 Schema 原子建库，再应用
`prisma/bootstrap/supplement.sql` 中 Prisma 无法表达的 Check、部分唯一索引、函数和触发器，最后把
仓库内每个历史 migration 按原始文件 SHA-256 登记为已执行。Bootstrap 不修改历史 migration，也不用于
升级、修复或覆盖已有数据库。

补充结构同时包含 Contest Rating 规范身份触发器：兼容旧二进制先写 `TrainingRatingConfig`、后创建 Contest 的
滚动发布顺序，并拒绝配置、榜单快照或 Rating Batch 指向与 `runtimeTrainingId` 不一致的 Contest。空库 bootstrap
与备份升级路径必须生成同一组触发器、外键和索引，不能只在增量 migration 路径具备该保护。

## 安全规则

- 默认 `db:bootstrap:check` 只检查，不写入。
- 只允许没有业务表、Enum 和 migration 记录的数据库；非空目标 fail-closed。
- 应用 Schema、标准 `_prisma_migrations` 表和全部 checksum 记录在同一个 PostgreSQL 事务中完成。
- 事务内再次获取 advisory lock 并复查空库，避免并发调用绕过第一次检查。
- 建库后立即运行 `prisma migrate deploy` 与 `prisma migrate status`；任一失败均视为安装失败。
- `--seed` 仅用于新环境初始化或隔离验收，不应在已有数据环境运行。

## 新环境操作

先创建独立空数据库并设置正确的 `DATABASE_URL`，然后：

```bash
pnpm db:bootstrap:check
pnpm db:bootstrap
```

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
