---
status: current
audience: development, operations
last_verified: 2026-08-31
source_of_truth: storage config, BlobStore implementations, TestSet Revision services and file HTTP adapters
---

## 2026-08-24 security contract

- Only `STORAGE_ROOT/public` is mounted as static content. Private files are served by authenticated APIs.
- Read, move, delete and hard-delete paths use `path.relative` containment checks. String-prefix checks are forbidden
  because a sibling directory such as `storage-evil` shares the `storage` prefix.
- Team and contest files require an active team membership in the current workspace scope. Campus resources must also
  match `JwtPayload.organizationId`; management operations require the `owner` or `admin` team role.
- Global administrators do not bypass ownership for arbitrary user/team files. Problem access continues through the
  centralized problem permission policy.
- Upload validation checks size, extension-to-MIME pairing and actual content. Images, PDF and archives require their expected
  magic signature; text/source/testdata files reject NUL and excessive control bytes.
- Soft-deleted files are excluded from metadata and download access even when the former record was public.

# 文件存储

## 根目录

`STORAGE_ROOT` 决定所有运行时文件位置；未设置时默认为 Server 的 `uploads` 目录。
E2E 强制使用 `test-results/storage`，不得写入开发上传目录。

```text
STORAGE_ROOT/
├── public/
│   ├── avatars/
│   └── contest-assets/
├── private/
│   ├── problem-images/
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

- 头像等真正公开文件可通过 `/uploads/public` 或兼容路径 `/public` 访问。
- 题目图片、PDF、附件和测试数据全部为私有文件，不生成可匿名访问的 `/public` URL。
- 教师通过 `/api/files/:id/download` 按题库作用域鉴权。学生必须使用
  `/api/contests/:id/problems/:problemId/files/:fileId` 或
  `/api/problem-lists/:id/entries/:entryId/files/:fileId` 教学上下文通道，同时校验教学资源、题目条目和文件引用。
- 直接访问跨校文件、未授权学校题文件或私有静态路径统一返回 `404`。
- 文件元数据保存在 `File`，题目附件和题面还有对应业务模型。
- 用户个人 PDF 以私有 `ownerType=user` 文件保存；活动选用 PDF 时复制为
  `ownerType=training_content` 的快照文件。参与者只能通过活动内容接口读取当前快照，
  不能凭原始用户文件 ID 绕过共享与活动权限。
- 删除采用业务记录更新和回收站策略，不允许把用户提供的路径直接拼进文件系统。

## 不可变评测资产

TestSet Revision、Checker、Validator、Classifier 与 Hack 晋升数据不直接依赖普通附件路径。
领域服务只依赖 `BlobStore` port，当前提供：

- `LocalBlobStore`：生产主机当前实现。
- `S3BlobStore`：S3 兼容对象存储适配器。
- `AliyunOssBlobStore`：阿里云 OSS 适配器。

对象以 SHA-256 内容寻址，键形如 `objects/<sha256>`；Revision 保存不可变 manifest、投影哈希和
对象引用，不覆盖旧对象。多个 Revision 可以复用同一对象。数据库事务失败或发布竞争失败时不会产生
可见半成品 Revision，超过保留时间且无引用的孤儿对象由 GC 清理。

Candidate、程序源码、Kill vector 和 Feature fingerprint 使用全局 `BlobObject + BlobReference` 引用层，物理键为 `global/objects/<sha256>`。Blob 本身不携带访问权限，读取权限始终来自 owner 业务记录。Candidate 被拒绝、判重或过期时先删除引用；Blob 至少再等待 30 天，并在同一内容锁内重新确认零引用后删除。迁移期间题目级 `TestdataObject` 与全局 Blob 双写，正式 Revision 仍由原不可变对象关系保证可复现。

从 Local 切换到 OSS/S3 只替换 BlobStore 配置和物化策略，不允许业务服务自行拼接云厂商路径。
当前尚未获得真实对象存储凭据，所以异机留存验收仍由运维未完成事项跟踪。

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
- 数据盘迁移必须保证 `STORAGE_ROOT`、内容寻址对象、Revision manifest/链接目录和 systemd
  `WorkingDirectory` 同步更新；迁移后必须运行对象哈希、Revision 投影与 Judge 读取验证。
- 历史学校题文件使用 `pnpm --filter server migrate:school-problem-files`
  迁入私有目录；必须先执行 `--dry-run`并备份数据库和存储根目录。
- 删除或替换个人 PDF 会软删除原文件；已经复制到活动快照的文件继续保留。删除活动时，
  其 `training_content` 快照文件进入现有软删除流程。
