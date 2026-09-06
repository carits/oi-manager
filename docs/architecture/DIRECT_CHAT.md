---
status: current
audience: development, operations
last_verified: 2026-09-06
source_of_truth: apps/server/src/modules/chat, apps/web/src/app/account/messages, apps/server/prisma/schema.prisma
---

# 联系人与一对一私信

私信是账号级能力，不携带 `X-OI-Organization-ID`。产品界面使用“联系人”，数据库为兼容继续使用 Friendship 命名。只有有效联系人可以创建会话和发送消息；移除联系人保留历史并禁发，拉黑同时解除关系并关闭待处理申请。

## 用户发现与隐私

- 共享有效组织或团队的账号支持用户名模糊搜索；legacy 学校不构成共享关系。
- 无共享关系时只接受完整用户名，并要求目标主动开启 `allowExactUsernameDiscovery`；默认关闭。
- 响应只返回账号用户名、头像和粗粒度发现来源，不向陌生用户返回组织档案真实姓名。

## 一致性与实时链路

- 会话按有序用户对唯一；消息使用会话内递增 `seq` 和发送者级 `clientMessageId` 幂等。
- 联系申请创建/处理、移除联系人、拉黑和解除拉黑对同一有序用户对使用数据库事务 advisory lock；接受申请与拉黑并发时，拉黑完成后不得遗留 active 联系关系。
- 无游标消息读取返回当前用户可见的最新页，`beforeSeq` 加载历史，`afterSeq` 补偿实时增量；V2 返回游标元数据，旧数组响应在蓝绿兼容期保留。
- 会话使用 `lastActivityAt + id` opaque cursor 分页，active 与 archived 列表分离。
- 发送事务先锁定发送者消息额度，再锁定会话和双方成员；同时写消息、摘要、接收方未读投影和 `ChatUserEvent`。事件和成员写入始终按用户 ID 排序，瞬态死锁/序列化冲突只对完整幂等事务做最多三次重试。
- 消息、联系申请和举报的硬限流在数据库事务内按操作者串行计数，多实例和并发请求不能穿透上限。
- `lastReadSeq` 是事实，`unreadCount` 是可修复投影；已读、清空和归档先锁定会话，与新消息按同一顺序串行。Worker 每小时执行一致性修复。
- 每个浏览器标签页由 `ChatProvider` 维护一条 SSE；页头和消息页订阅 Provider，不重复连接。Cursor 保存于用户级 sessionStorage，事件在 100ms 窗口合并并按类型局部刷新。
- SSE 通过独立 PostgreSQL LISTEN 连接接收 `pg_notify`，同时每 30 秒扫描持久事件表补偿通知丢失；首次连接从当前事件尾部开始，只有真实重连才补发，过期 cursor 要求 REST resync。事件保留 7 天。
- RealtimeHub 对定时器、用户和单 stream 失败逐级隔离，不允许后台 Promise rejection 终止 API。
- API 退出先发送 `service_restart` 并关闭 SSE，再执行 Judge 和 HTTP drain。

## 举报和保留

- 用户只能举报对方向自己会话发送的消息；证据保存举报点前后各十条的不可变快照。
- 超级管理员和平台管理员可审核。读取证据必须提交原因并写 `PlatformAuditLog`，不能浏览未举报会话。
- 单方清空推进自己的 `clearedThroughSeq`。双方均清空且超过 30 天后，未被举报引用的消息由 Worker 清理。
- Pending 举报持续保全证据；终态举报满一年后将证据最小化为哈希摘要并释放原消息引用，使其重新服从双方清空后的 GC 规则。
- 未读修复、消息 GC 和证据释放使用持久 keyset cursor，正确记录也推进扫描位置，不会被前 500 条长期阻塞。

## 平台表情包

- 消息类型为 `text | sticker`。表情是独立消息，服务端根据已发布 `stickerId` 生成 `[表情：名称]` 降级文本；客户端不能提交资源 URL、Blob ID或标签。
- `ChatStickerPack` 按 key/version 不可变，`ChatSticker` 引用内容寻址的动画 WebP 与静态 poster。退役只阻止新发送，历史消息和举报证据继续可读。
- 超管通过 ZIP + `manifest.json` 分两阶段导入和发布。导入检查路径、加密、文件数量、解压体积、真实图片格式、尺寸、帧数和时长，解码后统一重编码以清除元数据。
- 表情发送复用文字消息的会话锁、幂等键、限流、序号、未读和 SSE 事务；会话摘要固定为 `[表情]`。
- 举报证据固化消息类型、表情 ID、包版本、标签和资源哈希。表情 Blob 由不可变表情引用保护，暂存导入 24 小时过期后释放。

## 产品边界

- 后端维护已读位置以保证未读一致性，但不向联系人展示对方已读回执。
- UI 提供归档、恢复、单方清空、移除联系人和拉黑；`mutedUntil` 仍是预留字段，不宣称支持静音。
- 当前支持纯文本和平台内置表情包；用户表情上传、Unicode Emoji 选择器、附件、引用、撤回、编辑、在线状态和聊天处罚不属于本轮能力。

## API

账号端统一使用 `/api/chat`；举报审核使用 `/api/platform/chat-reports`。消息和会话分页新客户端携带 `pagination=v2`，部署兼容期内旧调用仍返回数组。

## 验证与发布门禁

- Server 集成测试必须真实创建联系人、会话和消息，并核对消息、摘要、未读和双方持久事件的同事务结果；关键已读、发送和拉黑竞态重复十轮。
- 隔离 Playwright 使用独立 `chat_sender/chat_receiver/chat_outsider`，两个 BrowserContext 完成申请、接受、发送、SSE 接收、已读和回复，不复用 teacher1/teacher2。
- Chromium 核心闭环进入每次 PR；Firefox、紧凑视口、响应丢失和幂等重试进入发布前测试。
- 生产 Web 提升前后均使用两个无组织关系的专用探针账号执行消息闭环；候选失败阻止提升，提升后失败自动恢复上一构建。探针双方清空本轮历史，凭据只保存在权限为 0600 的 `.run/chat-probe.env`。
