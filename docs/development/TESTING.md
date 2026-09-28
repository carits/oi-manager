---
status: current
audience: development
last_verified: 2026-08-24
source_of_truth: Vitest configs, apps/server/tests, package scripts
---

## Server 数据库隔离

Server 测试使用 PostgreSQL 的 `test` schema，并保持串行执行。每个测试结束后，测试框架执行一次多表
`TRUNCATE ... RESTART IDENTITY CASCADE`，然后重新创建平台 fixture。不要恢复逐表清理的旧循环：它会沿外键图遍历 66 次，
每个测试额外增加约 4.5 秒，即使是纯单元测试也会受影响。`TEST_DATABASE_URL` 绝不能指向生产 `public` schema。

# 单元与集成测试

## 数据库隔离

Server 测试使用 PostgreSQL：

```text
postgresql://oi:oi_password@localhost:5432/oi_manager?schema=test
```

`apps/server/tests/setup-env.ts` 必须在 Prisma 单例导入前设置 `DATABASE_URL`。测试不
使用 SQLite 或 `test.db`，因为事务、锁和 PostgreSQL SQL 行为需要与运行环境一致。

规则：

- 不在测试文件中覆盖为开发 `public` schema。
- 不直接创建未统一清理的 PrismaClient。
- fixture 使用唯一 ID，并按依赖顺序清理。
- 破坏性准备脚本必须拒绝无 schema、`public` 和非测试 URL。

## 测试分层

| 工作区 | 重点 | 2026-08-24 快照 |
|--------|------|----------------:|
| Server | 认证、权限、事务、团队、题单、训练、OJ、安全边界 | 426 |
| Web | 登录角色、API 响应解析等 | 34 |
| Judge | 心跳协议、评测与 Hack 判定 | 6 |
| 合计 | Vitest | 466 |

测试数会随代码变化；命令和覆盖行为比固定数字更重要。

## 命令

```bash
# 全部工作区
pnpm test

# 单独工作区
pnpm --filter server test
pnpm --filter web test
pnpm --filter @oi-manager/judge test

# 单个 Server 文件
pnpm --filter server exec vitest run tests/security-boundaries.test.ts
```

## 必测场景

- 匿名请求为 `401`，错误角色为 `403`，关闭的维护 API 为 `404`。
- 超管、平台管理员、负责人、教师、校园学生、个人学生权限差异。
- OJ 响应和日志不泄露 Cookie、账号密码或 Token。
- 多 Judge 不重复领取任务，ping/pong 会刷新活跃时间。
- 事务失败不留下部分学校、负责人、成员或状态数据。
- API 客户端正确处理 JSON、文本、空响应、HTTP 错误、超时和断网。
- Training Engine 必测 Stage 正常完成、提前结束、跳过、Scheduler/人工 CAS 竞争和禁止回滚；竞态至少重复 20 轮。
- Stage 分组覆盖沿用、手工重分、`immediate/next_stage`、共有题 Progress 复用和跨 Session/Stage ID 伪造。
- OI 30→60→100 目标及 Subtask 投影必须同时固定到 Submission/JudgeRun；暂停不累计 Stage 时间，延时不得改写计划时间。

全页面和业务闭环由[UI E2E](UI_E2E.md)覆盖。

## Training Engine V2 测试矩阵

测试必须覆盖全局唯一 RUNNING Stage、默认计划与分组覆盖、学员 immediate/next-stage 换组、Stage 转换 CAS、不可变 RuntimeSnapshot、暂停不累计时间、延时独立记录、Split/Merge 不产生新时间线、Training 每次提交动态取得 Evolving（缺失回退 Stable），以及旧分组运行表/接口不存在。

