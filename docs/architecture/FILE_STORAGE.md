---
status: current
audience: development, operations
last_verified: 2026-07-30
source_of_truth: apps/server/src/config/storage.ts, apps/server/src/routes/files.ts
---

# 文件存储

## 根目录

`STORAGE_ROOT` 决定所有运行时文件位置；未设置时默认为 Server 的 `uploads` 目录。
E2E 强制使用 `test-results/storage`，不得写入开发上传目录。

```text
STORAGE_ROOT/
├── public/
│   ├── avatars/
│   ├── problem-images/
│   └── contest-assets/
├── private/
│   ├── problem-pdfs/
│   ├── problem-attachments/
│   ├── contest-attachments/
│   ├── team-attachments/
│   └── exports/
├── temp/
├── trash/pending-delete/
└── judge/
    ├── problems/
    ├── submissions/
    ├── workdir/
    └── cache/
```

## 访问

- 公开文件可通过 `/uploads/public` 或兼容路径 `/public` 访问。
- 私有和受保护文件必须通过 `/api/files/:id/download`，由后端检查身份和业务归属。
- 文件元数据保存在 `File`，题目附件和题面还有对应业务模型。
- 删除采用业务记录更新和回收站策略，不允许把用户提供的路径直接拼进文件系统。

## 限制

| 类别 | 最大大小 | 常用格式 |
|------|---------:|----------|
| 头像 | 2 MB | JPEG、PNG、GIF、WebP |
| 图片 | 10 MB | JPEG、PNG、GIF、WebP |
| PDF | 20 MB | PDF |
| 附件 | 50 MB | PDF、ZIP、文本和源码 |
| 测试数据 | 100 MB | ZIP、IN、OUT、ANS |
| 源码 | 64 KB | C/C++、Python、Java、Pascal |

上传同时检查扩展名、MIME、大小和业务权限。文件名由服务端生成，下载时对解析后的
绝对路径做根目录边界检查，防止路径穿越。

## 生命周期

- 临时文件默认保留 24 小时。
- 回收站默认保留 7 天。
- 后台清理可用 `DISABLE_BACKGROUND_JOBS=true` 在 E2E 中关闭。
- 数据盘迁移必须保证 `STORAGE_ROOT`、测试数据路径和 PM2 工作目录同步更新。

