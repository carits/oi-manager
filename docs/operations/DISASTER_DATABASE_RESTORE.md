---
status: current
audience: operations
last_verified: 2026-08-28
source_of_truth: scripts/restore-production-database.sh
---

# 生产数据库灾难恢复

只有备份归档通过校验和、归档清单及一次性候选数据库验证后，本操作手册才允许替换指定的生产数据库。
它与日常备份恢复验证严格分开。

## 安全约束

- 必须以 root 在 `/data/oi-manager-response-refactor` 执行。
- 归档文件解析后的路径必须位于 `/data/backups/oi-manager/` 目录下。
- 目标固定为 `oi-postgres` 容器中的 `oi_manager` 数据库。
- 必须提供预期 SHA-256，并再次明确指定完全相同的数据库名。
- 脚本会在替换前停止 API 写入和 Judge 消费者。
- 删除目标数据库前先创建并校验不可变的恢复前 dump。
- 数据库失败会自动从该 dump 回滚；回滚失败时继续停止应用写入，等待人工恢复。
- 不要为了证明工具可用而执行真实替换；隔离破坏性测试使用 `pnpm disaster:restore:verify`。

## 预检查

1. 记录事故/维护窗口以及已明确授权使用的备份。
2. 验证当前运行状态：

   ```bash
   cd /data/oi-manager-response-refactor
   pnpm runtime:audit
   pnpm monitor:once
   ```

3. 独立验证归档文件：

   ```bash
   sha256sum /data/backups/oi-manager/<archive>.dump
   docker exec -i oi-postgres pg_restore -l \
     </data/backups/oi-manager/<archive>.dump >/dev/null
   ```

4. 如果当前脚本版本尚未通过隔离验证，先运行：

   ```bash
   pnpm disaster:restore:verify
   ```

## 授权执行

只有负责人明确指定归档文件，并明确授权覆盖生产数据库后，才允许执行：

```bash
sudo pnpm disaster:restore -- \
  --backup /data/backups/oi-manager/<archive>.dump \
  --sha256 <64-lowercase-hex> \
  --confirm-database oi_manager \
  --apply
```

审计目录 `/data/backups/oi-manager/disaster-recovery/` 会保存恢复日志、恢复前 dump 和校验和。
这些文件必须与事故记录一起保留。

## 恢复后验证

```bash
pnpm runtime:audit
pnpm monitor:once
curl --fail http://127.0.0.1:3002/api/readiness
curl --fail http://127.0.0.1:3000/api/health
```

随后执行文档规定的只读公网冒烟检查。除非恢复授权范围明确包含，否则不要发起批量重测、Hack 晋升或其他写操作。
