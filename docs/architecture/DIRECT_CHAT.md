---
status: current
audience: development, operations
last_verified: 2026-09-05
source_of_truth: apps/server/src/modules/chat, apps/web/src/app/account/messages, apps/server/prisma/schema.prisma
---

# 好友与一对一私信

私信是账号级能力，不携带 `X-OI-Organization-ID`。只有有效好友可以创建会话和发送消息；删除好友保留历史并禁发，拉黑同时解除好友并关闭待处理申请。

## 用户发现与隐私

- 共享有效组织或团队的账号支持用户名模糊搜索；legacy 学校不构成共享关系。
- 无共享关系时只接受完整用户名，并要求目标主动开启 `allowExactUsernameDiscovery`；默认关闭。
- 响应只返回账号用户名、头像和粗粒度发现来源，不向陌生用户返回组织档案真实姓名。

## 一致性与实时链路

- 会话按有序用户对唯一；消息使用会话内递增 `seq` 和发送者级 `clientMessageId` 幂等。
- 发送事务锁定会话，同时写消息、摘要、接收方未读投影和 `ChatUserEvent`。
- `lastReadSeq` 是事实，`unreadCount` 是可修复投影；Worker 每小时执行一致性修复。
- SSE 通过独立 PostgreSQL LISTEN 连接接收 `pg_notify`，同时周期扫描持久事件表补偿通知丢失；事件保留 7 天。
- API 退出先发送 `service_restart` 并关闭 SSE，再执行 Judge 和 HTTP drain。

## 举报和保留

- 用户只能举报对方向自己会话发送的消息；证据保存举报点前后各十条的不可变快照。
- 超级管理员和平台管理员可审核。读取证据必须提交原因并写 `PlatformAuditLog`，不能浏览未举报会话。
- 单方清空推进自己的 `clearedThroughSeq`。双方均清空且超过 30 天后，未被举报引用的消息由 Worker 清理。

## API

账号端统一使用 `/api/chat`；举报审核使用 `/api/platform/chat-reports`。
