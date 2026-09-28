---
status: reference
audience: development, operations
last_verified: 2026-08-28
source_of_truth: scripts/verify-restored-core-flows.sh, playwright.restore.config.ts, e2e/stress/restored-backup-core.spec.ts
---

# 正式备份隔离恢复核心演练（2026-08-28）

> 历史演练证据：本报告验证的是当时的 TestSet Revision Schema。当前恢复验收必须改用
> Stable/Evolving 槽、Reader/Writer 屏障与无 revisionId 基线；不得直接复用本文的数据模型断言。

## 目标与边界

本演练验证最新正式备份不但能被 PostgreSQL 读取，而且能支持当前代码的登录、权限、提交、真实 Judge、Hack 和 TestSet Revision 闭环。

演练不停止或修改正式服务：

- PostgreSQL 使用一次性容器和 `127.0.0.1:15435`。
- 备份恢复到容器内 `public` Schema，仅执行迁移和只读完整性检查。
- 所有业务写入使用同一隔离实例的专用 `e2e` Schema。
- API 使用 3612，go-judge 使用 15054，存储和测试数据使用 `test-results`。
- 容器名称固定且必须带 `oi-manager.restore-audit=true` 标签；脚本不会删除名称相同但不属于本演练的容器。
- 成功、失败和中断路径均通过 trap 停止容器；不会覆盖正式数据库或测试数据。

这与“覆盖正式库的灾难恢复演练”不同。后者仍然需要维护窗口和明确授权。

## 执行命令

```bash
pnpm backup:verify:core
```

也可以把明确的备份文件作为第一个参数传给脚本：

```bash
bash scripts/verify-restored-core-flows.sh /data/backups/oi-manager/automatic/oi_manager_YYYYMMDD_HHMMSS.dump
```

## 本次证据

```text
backup: /data/backups/oi-manager/automatic/oi_manager_20260827_230448.dump
sha256: 7142d45c57d8600242f242651882c30c7fb403178c5a46c6db7f32c1121754de
restore duration: 11618 ms
tables: 79
migrations after migrate deploy: 32
users: 20186
core E2E: 2/2 passed (21.1 s)
```

本次备份比当前代码少最后一条迁移。`prisma migrate deploy` 正确应用 `20260827_hack_finalizing_claim`，随后 `migrate status` 返回数据库已是最新状态。

恢复数据的只读断言包括：

- 用户、题目、活动和提交均非空。
- TestSet Revision 和固定 Revision 的活动题均存在。
- 每个题目的 latest Revision 仍属于该题。
- Judge Config、Judge Config Hash 和 Graph Hash 均存在且格式正确。

隔离写入断言包括：

- 超级管理员、平台管理员、学校负责人和学生均可登录，管理员仅返回一个管理员工作区。
- 正确 A+B 程序由真实 go-judge 判为 `accepted/100`，错误程序判为统一状态 `wa/0`。
- 提交保存实际使用的 `testSetRevisionId`。
- 有效 Hack 由真实 Judge 得到 `Accepted → Wrong Answer`，`canonicalStatus=promoted` 并生成下一正式 Revision。
- Hack 前已完成提交继续固定旧 Revision，不被重测或改写。
- Hack 前创建的两个活动题继续固定旧 Revision。
- 未开始且无提交的活动可以显式更新到题库最新版。
- 活动开始后更新返回 `409 TEST_SET_REVISION_FROZEN`，固定版本保持不变。
- Hack 后新 Practice 提交使用新 Revision；正确代码仍 AC，目标错误代码变为 WA。
- 演练结束没有 `queuing/judging/finalizing` 残留。

运行证据保存在 `test-results/restore-audit/`，其中 `manifest.json` 记录备份摘要、恢复耗时和结构数量。该目录是运行产物，不提交 Git。

## 仍未完成

- 受控 ECS 整机重启需要维护窗口。
- 覆盖正式数据库的灾难恢复需要明确授权和停写窗口。
- 阿里云 2026-08-19 实例事件/ActionTrail 需要云平台权限。

