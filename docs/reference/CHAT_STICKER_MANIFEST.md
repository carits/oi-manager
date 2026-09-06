---
status: current
audience: development, operations
last_verified: 2026-09-06
source_of_truth: apps/server/src/modules/chat/application/chat-sticker.service.ts
---

# 聊天表情包导入清单

表情包使用 ZIP 上传，根目录必须包含 UTF-8 `manifest.json`。普通用户不能导入；超管上传后先获得检查报告和 `reportHash`，确认发布时必须回传该哈希。

```json
{
  "schemaVersion": 1,
  "pack": {
    "key": "carits-default",
    "name": "Carits 表情",
    "version": 1,
    "sortOrder": 0
  },
  "stickers": [
    {
      "key": "happy",
      "label": "开心",
      "file": "stickers/happy.webp",
      "order": 1
    }
  ]
}
```

- `pack.key`、表情 `key` 使用小写字母、数字、`_`、`-`，长度最多 64。
- 同一 `pack.key + version` 只能发布一次；发布新版本会自动退役相同 key 的旧活动版本。
- 源文件只接受扩展名与真实格式一致的 PNG、WebP、GIF。系统解码后统一保存 WebP，并为动画生成静态 poster。
- 图片不超过 512×512；动画不超过 120 帧、8 秒；规范化后的单文件不超过 2 MiB；每包最多 240 个表情。
- ZIP 最大 100 MiB，解压后最大 100 MiB，禁止绝对路径、`..`、重复路径、链接和加密条目。
- 发布后的资源不可覆盖或物理删除；退役只影响新发送，历史消息和举报证据继续可用。
