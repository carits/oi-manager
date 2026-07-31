---
status: current
audience: development, operations
last_verified: 2026-07-30
source_of_truth: package.json, docker-compose.yml, Prisma schema, Playwright configuration
---

# 当前状态

## 阶段

OI Manager 仍处于开发阶段。当前服务器运行 Next.js 开发服务和 `tsx watch` 后端，
没有切换到正式构建、正式密钥或生产进程。公网可访问不等于已经正式上线。

| 服务 | 开发端口 | E2E 端口 | 说明 |
|------|----------|----------|------|
| Web | `3000` | `3100` | Next.js App Router |
| Server/API | `3002` | `3102` | Express + Prisma |
| PostgreSQL | `5432` | 同实例 `e2e` schema | Docker Compose 基础设施 |
| go-judge | `5050` | `5050` | 评测沙箱 |

## 已实现能力

- 五类角色：超级管理员、平台管理员、学校负责人、教师、学生。
- 学校、用户、教师、学生、团队、邀请、申请和成员管理。
- 私有题库、题单、学校/团队题单、作业、比赛、训练、补题和排名。
- 校园学生与个人学生模式切换，个人模式可管理自己的题目、团队和题单。
- 外部 OJ 题目抓取、平台绑定、账号池、提交同步和 AI 翻译。
- Carits 本地提交、评测队列、Judge WebSocket、详情和重新评测。
- 隔离的 PostgreSQL 单元测试与 Playwright 全 UI 测试。

## 最近验证

以下数字是 2026-07-30 的验证快照，不作为永久常量：

- 根构建按 `shared → Prisma Client → server → web → judge` 顺序通过。
- Vitest：Server 444、Web 8、Judge 2，共 454 个测试。
- Chromium 全量 UI：122/122，通过三次连续运行。
- 紧凑桌面视口与 Firefox 冒烟：58/58。
- 页面清单：90 个 App Router 页面。
- Prisma Schema：50 个模型。

## 安全边界

- OJ Cookie 配置只允许 `super_admin` 读写，读取结果不返回 Cookie 原文。
- OJ 全局任务允许 `super_admin` 和 `platform_admin` 管理。
- 维护迁移接口只允许 `super_admin`，且 `ENABLE_MAINTENANCE_API` 默认关闭。
- Judge 必须使用与 Server 一致的 `JUDGE_TOKEN`；无令牌模式只允许显式本机测试。
- 正式环境必须设置严格 CORS、独立 JWT/Judge/加密密钥。

## 当前限制

- 当前服务器没有启用正式部署配置。
- 外部 OJ 受登录状态、反爬策略和页面结构变化影响，真实连通性不作为 PR 门禁。
- 前端 Token 仍保存在 `localStorage`，生产化前应重新评估会话存储方案。
- `apps/server/.env.example` 和 `apps/judge/.env.example` 仍包含旧端口/数据库示例；
  开发启动请使用 [开发环境启动](guide/DEVELOPMENT_SETUP.md) 中的配置。
- 历史设计和调研仅供追溯，参见 [归档索引](archive/README.md)。
