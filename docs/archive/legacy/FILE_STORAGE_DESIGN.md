---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/architecture/FILE_STORAGE.md
---

> 历史文档：本文件保留当时的设计、调查或实现记录，不代表当前系统行为。请以 `docs/architecture/FILE_STORAGE.md` 为准。

# 文件存储设计文档

> 创建时间: 2026-03-26
> 状态: 已实现

---

## 1. 概述

本文档描述 OI Manager V2 的文件存储系统设计，支持本地存储并预留 OSS 迁移能力。

### 1.1 设计目标

1. **清晰分类**：展示资源与判题资源彻底分离
2. **权限控制**：private 文件必须经权限接口访问
3. **可扩展性**：抽象 storage_type / disk / relative_path，便于迁移 OSS
4. **安全性**：防止路径穿越、文件类型校验、大小限制
5. **可维护性**：统一的上传/下载/删除流程

---

## 2. 目录结构

### 2.1 完整目录结构

```
uploads/
├── app/                           # 应用层文件
│   ├── public/                    # 公开访问（无需认证）
│   │   ├── avatars/               # 用户头像
│   │   │   ├── users/             # User 表头像
│   │   │   ├── teachers/          # Teacher 表头像
│   │   │   ├── students/          # Student 表头像
│   │   │   └── teams/             # Team 表头像
│   │   ├── problem-images/        # 题面图片
│   │   └── contest-assets/        # 比赛公开资源
│   │
│   ├── private/                   # 私有访问（需认证+权限）
│   │   ├── problem-pdfs/          # 题面/题解 PDF
│   │   ├── problem-attachments/   # 题目附件
│   │   ├── contest-attachments/   # 比赛私有资源
│   │   ├── team-attachments/      # 团队附件
│   │   └── exports/               # 导出文件
│   │
│   ├── temp/                      # 临时文件（定期清理）
│   │   ├── uploads/               # 上传缓存
│   │   ├── unzip/                 # 解压目录
│   │   └── convert/               # 格式转换临时文件
│   │
│   └── trash/                     # 回收站（延迟删除）
│       └── pending-delete/        # 待删除文件
│
├── judge/                         # 评测机专用（不可对外暴露）
│   ├── problems/                  # 题目测试数据
│   │   └── {problemCode}/         # 按题目编号组织
│   │       ├── testdata/          # 测试点
│   │       ├── spj/               # Special Judge
│   │       ├── checker/           # 检查器
│   │       └── interactor/        # 交互器
│   ├── submissions/               # 提交记录
│   ├── workdir/                   # 评测工作目录
│   └── cache/                     # 评测缓存
```

### 2.2 目录职责说明

| 目录 | 职责 | 访问权限 | 清理策略 |
|------|------|----------|----------|
| `public` | 公开展示资源 | 无需认证 | 无 |
| `private` | 私有展示资源 | 需认证+业务权限 | 无 |
| `temp` | 临时处理文件 | 仅后端 | 24小时自动清理 |
| `trash` | 待删除文件 | 仅后端 | 7天后彻底删除 |
| `judge` | 评测资源 | 仅评测机 | 随关联数据删除 |

---

## 3. 数据库模型

### 3.1 File 模型

```prisma
model File {
  id            String   @id @default(uuid())

  // 存储抽象层
  storageType   String   @default("local")    // local | oss | s3
  disk          String   @default("default")  // 存储盘标识（支持多盘）
  relativePath  String                         // 相对路径（不含文件名）
  fileName      String                         // 落盘文件名
  originalName  String                         // 用户原始文件名

  // 文件元数据
  mimeType      String                         // MIME 类型
  fileSize      Int                            // 文件大小（字节）
  md5Hash       String?                        // MD5 哈希（去重用）
  sha256Hash    String?                        // SHA256 哈希（安全校验）

  // 访问控制
  accessLevel   String   @default("private")  // public | private | protected
  isPublic      Boolean  @default(false)      // 是否公开访问

  // 业务归属（多态关联）
  ownerType     String                         // problem | contest | user | team | attachment
  ownerId       String                         // 业务对象 ID
  category      String                         // pdf | attachment | avatar | image | testdata

  // 生命周期
  status        String   @default("active")   // active | deleted | archived
  deletedAt     DateTime?
  expiresAt     DateTime?                      // 过期时间（临时文件）

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([storageType, disk])
  @@index([ownerType, ownerId])
  @@index([md5Hash])
  @@index([status, deletedAt])
  @@index([category])
}
```

### 3.2 字段说明

| 字段 | 用途 | 迁移 OSS 时 |
|------|------|-------------|
| `storageType` | 区分本地/OSS/S3 | 改为 `oss` |
| `disk` | 支持多存储盘 | OSS bucket 名称 |
| `relativePath` | 相对路径，不含盘信息 | OSS object key 前缀 |
| `fileName` | 落盘文件名 | OSS object 名称 |
| `originalName` | 下载时使用原名 | 不变 |
| `accessLevel` | 权限控制 | 不变 |
| `ownerType/ownerId` | 业务关联 | 不变 |

---

## 4. 文件分类

### 4.1 分类定义

| 类别 | 说明 | 存储位置 | 访问方式 |
|------|------|----------|----------|
| `avatar` | 用户头像 | public/avatars/ | 静态访问 |
| `image` | 题面图片 | public/problem-images/ | 静态访问 |
| `pdf` | 题面/题解 PDF | private/problem-pdfs/ | 权限 API |
| `attachment` | 题目附件 | private/problem-attachments/ | 权限 API |
| `testdata` | 测试数据 | judge/problems/ | 仅评测机 |

### 4.2 业务归属类型

| ownerType | 说明 |
|-----------|------|
| `problem` | 题目相关文件 |
| `contest` | 比赛相关文件 |
| `user` | 用户个人文件 |
| `team` | 团队相关文件 |
| `attachment` | 通用附件 |

---

## 5. API 接口

### 5.1 上传文件

```
POST /api/files/upload
Content-Type: multipart/form-data

参数：
- file: 文件
- category: 文件类别 (pdf | attachment | avatar | image | testdata)
- ownerType: 业务归属类型 (problem | contest | user | team)
- ownerId: 业务对象 ID
- isPublic: 是否公开（可选，默认 false）

响应：
{
  "success": true,
  "data": {
    "id": "uuid",
    "fileName": "1711423456789-123456789.jpg",
    "originalName": "avatar.jpg",
    "fileUrl": "/api/files/uuid/download",
    "fileSize": 12345,
    "mimeType": "image/jpeg"
  }
}
```

### 5.2 下载文件（私有）

```
GET /api/files/:id/download
Authorization: Bearer <token>

响应：文件内容（Content-Disposition: attachment）
```

### 5.3 访问公开文件

```
GET /api/files/:id/public

响应：文件内容（Cache-Control: public, max-age=31536000）
```

### 5.4 获取文件信息

```
GET /api/files/:id
Authorization: Bearer <token>

响应：
{
  "success": true,
  "data": {
    "id": "uuid",
    "originalName": "avatar.jpg",
    "fileSize": 12345,
    "mimeType": "image/jpeg",
    "category": "avatar",
    "isPublic": true,
    "url": "/api/files/uuid/public"
  }
}
```

### 5.5 删除文件

```
DELETE /api/files/:id
Authorization: Bearer <token>

响应：
{
  "success": true,
  "message": "删除成功"
}
```

### 5.6 按业务对象获取文件列表

```
GET /api/files/by-owner/:ownerType/:ownerId
Authorization: Bearer <token>

参数：
- category: 文件类别（可选）

响应：
{
  "success": true,
  "data": [
    { "id": "uuid", "originalName": "file1.pdf", ... },
    { "id": "uuid", "originalName": "file2.pdf", ... }
  ]
}
```

---

## 6. 权限控制

### 6.1 访问检查流程

```
1. 检查文件是否存在
2. 检查文件状态（active）
3. 如果是公开文件，允许访问
4. 如果是私有文件：
   a. 验证用户登录
   b. 根据 ownerType 检查业务权限：
      - problem: 题目可见性 + 用户角色
      - contest: 比赛参与权限
      - team: 团队成员权限
      - user: 仅本人或管理员
```

### 6.2 权限检查实现

```typescript
async checkAccess(userId: string, userRole: string, fileId: string): Promise<boolean> {
  const file = await prisma.file.findUnique({ where: { id: fileId } })
  if (!file) return false

  // 公开文件允许访问
  if (file.isPublic) return true

  // 管理员允许访问
  if (userRole === 'super_admin' || userRole === 'platform_admin') return true

  // 根据业务类型检查权限
  switch (file.ownerType) {
    case 'user':
      return file.ownerId === userId
    case 'problem':
      // 检查题目可见性和所有权
      // ...
    case 'team':
      // 检查团队成员关系
      // ...
    default:
      return false
  }
}
```

---

## 7. 安全措施

### 7.1 路径穿越防护

```typescript
private getPhysicalPath(relativePath: string, fileName: string): string {
  const fullPath = path.resolve(STORAGE_ROOT, relativePath, fileName)
  const normalizedRoot = path.resolve(STORAGE_ROOT)

  if (!fullPath.startsWith(normalizedRoot)) {
    throw new Error('Invalid file path: potential path traversal attack')
  }

  return fullPath
}
```

### 7.2 文件类型校验

```typescript
// 扩展名校验
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  pdf: ['.pdf'],
  attachment: ['.pdf', '.zip', '.rar', '.7z', '.txt', '.cpp', '.c', '.py', '.java', '.pas', '.in', '.out', '.ans', '.md'],
  testdata: ['.zip', '.in', '.out', '.ans']
}

// MIME 类型校验
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  pdf: ['application/pdf'],
  attachment: [
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'text/plain',
    'text/x-c++src',
    'text/x-csrc',
    'text/x-python',
    'text/x-java-source',
    'text/x-pascal'
  ]
}
```

### 7.3 文件大小限制

```typescript
const SIZE_LIMITS: Record<string, number> = {
  avatar: 2 * 1024 * 1024,        // 2MB
  pdf: 20 * 1024 * 1024,          // 20MB
  attachment: 50 * 1024 * 1024,   // 50MB
  testdata: 100 * 1024 * 1024,    // 100MB
  image: 10 * 1024 * 1024         // 10MB
}
```

### 7.4 文件命名规范

```typescript
// 格式：{timestamp}-{random}{ext}
private generateSafeFileName(originalName: string): string {
  const timestamp = Date.now()
  const random = Math.round(Math.random() * 1e9)
  const ext = path.extname(originalName).toLowerCase()
  return `${timestamp}-${random}${ext}`
}
```

---

## 8. OSS 迁移方案

### 8.1 迁移策略

```
阶段 1：本地存储（当前）
- storageType = 'local'
- disk = 'default'
- 文件存本地磁盘

阶段 2：混合存储
- storageType = 'local' | 'oss'
- 新文件可选择存 OSS
- 旧文件保持本地

阶段 3：全量 OSS
- storageType = 'oss'
- disk = 'bucket-name'
- 本地文件逐步迁移
```

### 8.2 业务层接口抽象

```typescript
interface StorageProvider {
  upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult>
  download(relativePath: string, fileName: string): Promise<Buffer>
  delete(relativePath: string, fileName: string): Promise<void>
  exists(relativePath: string, fileName: string): boolean
  getUrl(file: { storageType, relativePath, fileName, isPublic }): string
  move(oldPath: string, oldName: string, newPath: string, newName: string): Promise<void>
}

class LocalStorageProvider implements StorageProvider { ... }
// class OSSStorageProvider implements StorageProvider { ... }  // 未来实现
```

### 8.3 迁移时业务层改动

1. **数据库抽象层**：File 表已包含 storageType、disk、relativePath
2. **接口抽象**：StorageProvider 统一接口
3. **URL 生成**：getUrl() 方法根据 storageType 返回不同 URL
4. **权限逻辑不变**：访问控制基于 File 表记录

---

## 9. 文件迁移

### 9.1 迁移脚本

位置：`apps/server/prisma/migrate-files.ts`

使用方法：
```bash
cd apps/server
npx tsx prisma/migrate-files.ts
```

### 9.2 迁移内容

| 类型 | 旧位置 | 新位置 | 数据库更新 |
|------|--------|--------|------------|
| 用户头像 | uploads/avatars/ | uploads/public/avatars/users/ | User.avatar |
| 教师头像 | uploads/avatars/ | uploads/public/avatars/teachers/ | Teacher.avatar |
| 学生头像 | uploads/avatars/ | uploads/public/avatars/students/ | Student.avatar |
| 团队头像 | uploads/teams/ | uploads/public/avatars/teams/ | Team.avatar |
| 题面 PDF | uploads/problems/ | uploads/private/problem-pdfs/ | Problem.statementPdfUrl |
| 题解 PDF | uploads/problems/ | uploads/private/problem-pdfs/ | Problem.solutionPdfUrl |
| 题目附件 | uploads/problems/ | uploads/private/problem-attachments/ | ProblemAttachment.fileUrl |

---

## 10. 相关文件

### 10.1 代码文件

| 文件 | 说明 |
|------|------|
| `apps/server/prisma/schema.prisma` | File 模型定义 |
| `apps/server/src/config/storage.ts` | 存储配置（目录、大小限制、类型限制） |
| `apps/server/src/lib/storage.ts` | 存储服务（上传、下载、删除、权限检查） |
| `apps/server/src/routes/files.ts` | 文件 API 路由 |
| `apps/server/prisma/migrate-files.ts` | 文件迁移脚本 |

### 10.2 文档文件

| 文件 | 说明 |
|------|------|
| `docs/database/DATABASE_MODELS.md` | 数据库模型文档 |
| `docs/api/API_REFERENCE.md` | API 接口文档 |

---

## 11. 更新日志

### 2026-03-26
- 创建 File 数据库模型
- 创建存储配置和服务模块
- 创建文件 API 路由
- 创建目录结构
- 创建文件迁移脚本
- 创建本文档