---
status: current
audience: development, operations
last_verified: 2026-07-30
source_of_truth: Git history
---

# 变更记录

本文件记录 2026-07 起的重要行为变化。更早的详细记录保存在
[历史变更日志](archive/LEGACY_CHANGELOG.md)。

## 2026-07-30

### 文档体系重构

- 按指南、架构、开发、运维、参考和归档重新组织 `docs/`。
- 以当前源码重建 90 个页面、50 个 Prisma 模型和完整 HTTP API 目录。
- 修正开发/正式环境边界、PostgreSQL 测试隔离、Judge 鉴权和角色权限说明。
- 增加 `pnpm docs:check` 与独立文档 CI。

### UI E2E

- 建立隔离的 Playwright 测试体系，使用 `e2e` schema、`3100/3102` 和独立存储目录。
- 覆盖全部页面路由、核心角色流程、权限、安全边界、文件和模拟 Judge。
- Pull Request 运行 Chromium/Firefox 冒烟；`main` 和定时任务运行 Chromium 全量。

### 安全与运行链路

- OJ Cookie 配置限制为超级管理员，并改为脱敏响应。
- 维护迁移接口增加超级管理员权限和默认关闭开关。
- Judge WebSocket 增加强制 Token、双向心跳刷新和任务原子领取。
- 修复登录构建、角色别名、API 错误解析和开发构建缓存冲突。

