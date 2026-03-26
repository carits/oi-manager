# 当前任务

## 状态: 已完成

## 已完成任务：平台绑定功能基础框架（2026-03-26）

### 目标
为每个用户添加平台绑定功能，支持绑定 Vjudge、洛谷、Codeforces、AtCoder 等 OJ 账号。

### 需求要点
1. 入口位置：点击头像后，在"账号安全"下方显示"平台绑定"
2. 支持平台：Vjudge、洛谷、Codeforces、AtCoder（可扩展）
3. 初始状态：所有平台显示为"未绑定"
4. 交互方式：点击平台后弹出绑定弹窗（本次只做弹窗框架）
5. 独立性：每个用户的绑定独立，不同用户之间无关联
6. 可扩展性：为每个平台预留独立的代码实现空间

### 数据库修改
新增 `UserPlatformBinding` 模型：
- `platform`: 平台标识（vjudge | luogu | codeforces | atcoder）
- `platformUsername`: 第三方平台用户名
- `bindingStatus`: 绑定状态（unbound | pending | bound | failed）
- `bindingData`: JSON 存储绑定额外数据
- `verifiedAt`: 验证成功时间

### 后端模块
采用分层架构，新建 `modules/platform-binding/` 模块：
- `platform-binding.types.ts` - 类型定义
- `platform-binding.repository.ts` - 数据访问层
- `platform-binding.service.ts` - 业务逻辑层
- `platform-binding.routes.ts` - 路由层
- `binders/` - 各平台绑定器（预留）
  - `vjudge.ts`, `luogu.ts`, `codeforces.ts`, `atcoder.ts`

### API 端点
- `GET /api/platform-bindings` - 获取当前用户绑定状态
- `GET /api/platform-bindings/platforms` - 获取支持的平台列表
- `POST /api/platform-bindings/:platform/bind` - 发起绑定
- `DELETE /api/platform-bindings/:platform` - 解除绑定
- `POST /api/platform-bindings/:platform/refresh` - 刷新绑定

### 前端页面
- `apps/web/src/app/teacher/platform-bindings/page.tsx`
- `apps/web/src/app/student/platform-bindings/page.tsx`
- `apps/web/src/app/admin/platform-bindings/page.tsx`

### 涉及文件
**新建文件**：
- `apps/server/prisma/schema.prisma` - 添加 UserPlatformBinding 模型
- `apps/server/src/modules/platform-binding/` - 整个模块目录
- `apps/web/src/app/*/platform-bindings/page.tsx` - 三个角色页面

**修改文件**：
- `apps/server/src/index.ts` - 注册路由
- `apps/web/src/components/AppShell.tsx` - 添加菜单入口

### 验证结果
- ✅ 数据库模型已同步
- ✅ 后端 API 已实现
- ✅ 前端页面已创建
- ✅ 下拉菜单显示"平台绑定"入口

### 后续事项
- 各平台绑定器实现（需要研究各平台 API）
- 绑定弹窗完善（表单、验证、错误提示）
- 绑定数据加密存储

---

## 已完成任务：旧题目保存修复（2026-03-26）

### 目标
修复旧题目（没有 ProblemStatement 记录）保存时失败的问题。

### 问题描述
编辑旧题目时，前端为兼容旧数据生成了 `legacy-md-zh`、`legacy-pdf` 等假 ID。后端尝试用这些 ID 更新记录时，因记录不存在而报错：`Record to update not found`。

### 修复内容
**文件**: `apps/server/src/routes/problems.ts`

修改更新逻辑：
1. 检查 ID 是否以 `legacy-` 开头（前端生成的假 ID）
2. 如果是假 ID，跳过更新，改为查找是否存在相同唯一键的记录
3. 如果存在则更新，否则创建新记录

### 版本唯一性约束
**前端已实现**（`ProblemForm.tsx`）：
- `hasStatement`/`hasSolution` 函数检查版本是否存在
- `addStatement`/`addSolution` 函数内部有检查，已存在则不添加
- 下拉菜单中已添加的选项显示为禁用状态

---

## 已完成任务：OJ 拉取适配器语言检测（2026-03-26）

### 目标
修改 OJ 拉取适配器，支持自动检测题面语言并创建多版本记录。

### 实现内容
1. 修改 `OjProblem` 类型，添加 `statements` 数组字段
2. 修改洛谷适配器，检测 `contentEn` 字段并创建多语言题面
3. 修改 OJ 拉取队列，创建 `ProblemStatement` 记录

### 涉及文件
- `apps/server/src/oj-adapters/types.ts` - 添加 `OjStatement` 类型
- `apps/server/src/oj-adapters/luogu.ts` - 支持多语言题面检测
- `apps/server/src/routes/oj-fetcher.ts` - 创建多版本题面记录

### 验证结果
- ✅ OJ 拉取返回 `statements` 数组
- ✅ 中文题面默认可见
- ✅ 英文题面（如存在）默认隐藏

---

## 已完成任务：题面/题解多语言多格式支持（2026-03-26）

### 目标
实现题面/题解的多语言多格式支持，支持 Markdown 中文、Markdown 英文、PDF 三种格式。

### 数据库修改
新增 `ProblemStatement` 模型：
- `type`: 'statement' | 'solution'
- `format`: 'markdown' | 'pdf'
- `language`: 'zh' | 'en' | null
- `content`: Markdown 内容
- `fileUrl`: PDF 文件 URL
- `isVisible`: 是否可见

### 后端 API
- `GET /api/problems/:id` - 返回 statements/solutions 数组
- `POST /api/problems` - 创建时支持多版本
- `PUT /api/problems/:id` - 更新时支持多版本
- `POST /api/problems/:id/statements/pdf` - 上传 PDF
- `PUT /api/problems/:id/statements/:statementId/visibility` - 更新可见性
- `DELETE /api/problems/:id/statements/:statementId` - 删除版本

### 前端修改
- `ProblemDetail.tsx` - 查看界面，左上角语言切换下拉框
- `ProblemForm.tsx` - 编辑界面，下拉添加版本，可见性切换

### 验证结果
- ✅ 创建题目时支持多版本题面/题解
- ✅ 获取题目返回 statements/solutions 数组
- ✅ 更新题目支持添加/删除版本
- ✅ 可见性切换正常
- ✅ 删除版本正常

---

## 已完成任务：Markdown 图片显示修复（2026-03-26）

### 目标
修复 Markdown 中图片无法显示的问题。

### 问题描述
P14842 题目拉取后，Markdown 中的图片不显示，提示内容缺失。

### 根因分析
洛谷 Markdown 使用 `:::align{center}` 指令语法包裹图片，例如：
```markdown
:::align{center}
![](/uploads/public/problem-images/xxx.png)

Figure A.1. Sample 1
:::
```

ReactMarkdown 默认不支持该指令语法，导致整个块被渲染为纯文本，图片引用不生效。

### 修复内容

**文件**: `apps/web/src/components/ui/MarkdownRenderer.tsx`

1. 安装 `remark-directive` 和 `remark-directive-rehype` 插件
2. 在 ReactMarkdown 中添加插件支持

**文件**: `apps/web/src/styles/globals.css`

添加 `.align` 和 `.center` 类的 CSS 样式。

### 验证结果
- ✅ `:::align{center}` 语法被正确解析为 `<div class="align center">`
- ✅ 图片 URL 被正确转换为 `http://localhost:3001/uploads/...`
- ✅ 图片正常显示

---

## 已完成任务：附件下载行为修复（2026-03-26）

### 目标
修复附件点击下载时被查看而不是下载的问题。

### 问题描述
用户点击附件的"下载"按钮时，浏览器会直接查看文件内容，而不是下载文件。

### 根因分析
`LocalStorageProvider.getUrl()` 方法总是返回 `/uploads/...` 静态路径，不管文件是公开还是私有的。静态文件服务不设置 `Content-Disposition: attachment` 响应头，浏览器会根据文件类型决定是显示还是下载。

### 修复内容

**文件**: `apps/server/src/lib/storage.ts`

修改 `getUrl()` 方法：
- 公开文件（图片、头像）返回 `/uploads/...` 静态路径（支持浏览器缓存）
- 私有文件（附件）返回 `/api/files/:id/download` API 路径

```typescript
getUrl(file: { storageType: string; relativePath: string; fileName: string; isPublic: boolean; id?: string }): string {
  if (file.storageType === 'local') {
    // 公开文件返回静态路径（支持缓存）
    if (file.isPublic) {
      return `/uploads/${file.relativePath}/${file.fileName}`
    }
    // 私有文件通过 API 访问（支持认证和下载响应头）
    return `/api/files/${file.id}/download`
  }
  return `/api/files/${file.id}/download`
}
```

**数据迁移**:
- 更新现有 ProblemAttachment 记录的 `fileUrl` 从 `/uploads/...` 到 `/api/files/:id/download`

### 验证结果
- ✅ `/api/files/:id/download` 端点返回正确的 `Content-Disposition: attachment` 响应头
- ✅ 浏览器会强制下载文件而不是查看

---

## 已完成任务：文件存储系统实现（2026-03-26）

### 目标
实现本地文件存储系统，支持权限控制和 OSS 迁移。

### 需求要点
1. Markdown 题面存数据库，二进制文件存磁盘
2. 展示资源与判题资源分离
3. 私有文件通过权限 API 访问
4. 文件命名安全（时间戳-随机数格式）
5. 预留 OSS 迁移能力

### 实现内容

#### 1. 数据库模型
- 新增 `File` 模型，包含存储抽象层字段（storageType, disk, relativePath）
- 支持多态关联（ownerType + ownerId）

#### 2. 存储服务
- `config/storage.ts` - 存储配置（目录、大小限制、类型限制）
- `lib/storage.ts` - 存储服务（上传、下载、删除、权限检查）
- `LocalStorageProvider` - 本地存储实现

#### 3. API 路由
- `POST /api/files/upload` - 文件上传
- `GET /api/files/:id/download` - 下载私有文件
- `GET /api/files/:id/public` - 访问公开文件
- `GET /api/files/:id` - 获取文件信息
- `DELETE /api/files/:id` - 软删除文件
- `GET /api/files/by-owner/:ownerType/:ownerId` - 按业务对象获取文件列表

#### 4. 目录结构
```
uploads/
├── public/           # 公开访问
│   ├── avatars/      # 头像
│   ├── problem-images/  # 题面图片
│   └── contest-assets/  # 比赛公开资源
├── private/          # 私有访问（需权限）
│   ├── problem-pdfs/    # 题面/题解 PDF
│   ├── problem-attachments/  # 题目附件
│   └── contest-attachments/  # 比赛私有资源
├── temp/             # 临时文件
├── trash/            # 回收站
└── judge/            # 评测资源
```

#### 5. 安全措施
- 路径穿越防护
- 文件类型校验（扩展名 + MIME 类型）
- 文件大小限制
- 安全文件命名

#### 6. 迁移脚本
- `prisma/migrate-files.ts` - 迁移现有文件到新目录结构

### 涉及文件
**新建文件**：
- `apps/server/src/config/storage.ts` - 存储配置
- `apps/server/src/lib/storage.ts` - 存储服务
- `apps/server/src/routes/files.ts` - 文件 API 路由
- `apps/server/prisma/migrate-files.ts` - 文件迁移脚本
- `docs/FILE_STORAGE_DESIGN.md` - 设计文档

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 File 模型
- `apps/server/src/index.ts` - 注册 filesRouter
- `docs/database/DATABASE_MODELS.md` - 添加 File 模型文档
- `docs/api/API_REFERENCE.md` - 添加文件 API 文档
- `docs/KNOWN_ISSUES.md` - 更新静态文件安全问题状态

### 后续事项（已完成）
1. ✅ 运行迁移脚本迁移现有文件
2. ✅ 修改现有上传代码使用 FileService
   - auth.ts: 头像上传
   - problems.ts: PDF 和附件上传
   - team.routes.ts: 团队头像上传
3. ✅ 前端代码迁移到新的文件访问 API
   - assets.ts: 新增辅助函数
   - ProblemDetail.tsx: PDF 显示和附件下载
   - ProblemNote.tsx: PDF 显示

---

### 目标
修复学校模块的 `_count` 字段大小写问题，确保前端能正确显示学校的学生、教师、团队数量。

### 问题描述
教师端"我的学校"页面显示的学生数量、教师数量、团队数量不正确。

### 根因分析
Prisma 查询返回的 `_count` 使用大写模型名（`_count.Team`, `_count.Teacher`, `_count.Student`），但前端期望小写字段名（`_count.teams`, `_count.teachers`, `_count.students`）。

### 修复内容

**文件**: `apps/server/src/routes/schools.ts`

1. **学校列表端点** (line 68-70): 转换 `_count.Team/Teacher/Student` → `_count.teams/teachers/students`
2. **学校详情端点 - 非本校用户** (line 314-316): 同样的转换
3. **学校详情端点 - 本校用户** (line 346-348): 同样的转换

### 符合规范
按 `docs/api/FIELD_CONTRACT.md` 规范。

### 涉及文件
- `apps/server/src/routes/schools.ts` - 修复 `_count` 字段转换

---

## 已完成任务：学校教师列表字段契约修复（2026-03-25）

### 目标
修复前端访问 `teacher.user.status` 报错 undefined 的问题。

### 修复内容
在 `/api/schools/:id/teachers` 端点返回数据前，转换字段名 `User` → `user`。

### 符合规范
按 `docs/api/FIELD_CONTRACT.md` 规范。

---

## 已完成任务：学生邀请列表过滤与 UI 优化（2026-03-25）

### 目标
修复学生端邀请列表显示"邀请不存在"的问题，并优化 UI 显示。

### 问题描述
学生在"我的团队"页面看到邀请，点击"接受"或"拒绝"时提示"邀请不存在"。

### 根因分析
`team.service.ts` 的 `getStudentTeams` 方法返回所有 `status='pending'` 的 TeamMember 记录，没有区分：
- **邀请**：`invitedBy !== null`（管理员邀请学生加入）
- **申请**：`invitedBy === null`（学生主动申请，需管理员审批）

学生看到自己的申请记录，尝试"接受"，但申请记录不能由学生自己接受。

### 修复内容

#### 1. 后端过滤
**文件**: `apps/server/src/modules/team/team.service.ts`

- 邀请列表只返回 `invitedBy !== null` 的记录
- 新增 `requests` 数组返回 `invitedBy === null` 的申请记录

```typescript
// 分类：已加入、邀请（invitedBy != null）、申请（invitedBy == null）
if (record.invitedBy !== null) {
  // 实际邀请：管理员邀请学生加入
  pendingInvitations.push({...})
} else {
  // 申请记录：学生主动申请加入，需要管理员审批
  pendingRequests.push({...})
}

return {
  joined: [...],
  pending: pendingInvitations,  // 只包含实际邀请
  requests: pendingRequests      // 学生申请记录
}
```

#### 2. UI 优化
**文件**: `apps/web/src/components/team/InvitationCard.tsx`

- 将"邀请人"信息显示更突出
- 格式：`邀请人: XXX · 学校名称`
- 字体更大、颜色更深

### 涉及文件
- `apps/server/src/modules/team/team.service.ts` - 过滤逻辑
- `apps/web/src/components/team/InvitationCard.tsx` - UI 优化

---

## 已完成任务：团队模块 P1 危险问题修复（2026-03-25）

### 目标
修复团队模块的 P1 优先级安全问题，包括跨团队操作漏洞、ID 维度混用、语义混乱、权限校验缺失等。

### 修复内容

#### P1-1: 跨团队操作漏洞
- **问题**: `DELETE /:id/invites/:inviteId` 未验证邀请是否属于当前团队
- **风险**: 攻击者可删除其他团队的邀请
- **修复**: 添加 `invitation.teamId !== id` 检查
- **位置**: `team.routes.ts`

#### P1-2: ID 维度混用
- **问题**: 多处将 `userId` 当作 `memberId`（TeamMember 记录 ID）使用
- **风险**: 查询错误、数据混乱
- **修复**:
  - `POST /:id/admins`: 改用 `findMemberById(memberId)` 查询 TeamMember 记录
  - `DELETE /:id/members/:memberId`: 统一使用 TeamMember.id，添加跨团队检查
- **位置**: `team.routes.ts`

#### P1-3: 查询语义混乱
- **问题**: 邀请/申请接口没有区分 `invitedBy` 字段语义
- **风险**: 可通过申请接口处理邀请，或反之
- **修复**:
  - 教师申请审批: 检查 `invitedBy !== null` 时拒绝（应为邀请）
  - 邀请接受: 检查 `invitedBy === null` 时拒绝（应为申请）
- **参考**: `TEAM_STATE_MACHINE.md` - INVITED vs REQUESTED 区分
- **位置**: `team.routes.ts`

#### P1-4: 敏感操作未重新鉴权
- **问题**: 部分操作仅依赖前端权限判断
- **修复**: 在每个敏感操作中添加权限重新校验
- **结合修复**: 与 P1-1、P1-2 修复合并实现

#### P1-5: 假耦合问题
- **验证结果**: 不存在。团队模块无 Contest、TaskList 等未完成模块的关联查询

### 代码修改位置

**文件**: `apps/server/src/modules/team/team.routes.ts`

| 端点 | 修复内容 |
|------|----------|
| `POST /:id/admins` | 使用 findMemberById，添加跨团队检查 |
| `DELETE /:id/members/:memberId` | 统一 ID 语义，添加跨团队检查 |
| `DELETE /:id/invites/:inviteId` | 添加跨团队检查 |
| `POST /teacher-join-requests/:memberId/approve` | 添加 invitedBy 语义验证 |
| `POST /teacher-join-requests/:memberId/reject` | 添加 invitedBy 语义验证 |
| `POST /invitations/:invitationId/accept` | 添加 invitedBy 语义验证 + 并发安全 |
| `POST /invitations/:invitationId/reject` | 添加 invitedBy 语义验证 + 并发安全 |

### 涉及规范文档
- `docs/team/TEAM_STATE_MACHINE.md` - 状态机定义
- `docs/team/TEAM_PERMISSION_RULES.md` - 权限规则
- `docs/team/TEAM_CONFLICT_RULES.md` - 冲突处理
- `docs/team/TEAM_API_CONTRACT.md` - API 契约

### 后续任务（P2 优先级）
- P2-1: 重复申请/邀请处理 - ✅ 已实现（joinRequest 方法）
- P2-2: 加强并发保护 - ✅ 已实现（条件更新/删除方法）
- P2-3: owner 生命周期边界 - ✅ 已实现（leaveTeam/transferTeam）

---

## 待处理事项

---

## 已完成任务：前后端字段契约规范文档（2026-03-25）

### 目标
创建前后端字段契约规范文档，统一 Prisma 查询和 API 响应规范。

### 完成内容

#### 1. 新建文档
- `docs/api/FIELD_CONTRACT.md` - 前后端字段契约规范

#### 2. 修复 /auth/me 的 profile 字段
- **问题**: `profile` 字段返回原始 Prisma 对象，包含大写关联字段（School, Teacher 等）
- **修复**: 只返回简化的基本字段，避免暴露 Prisma 内部结构
- **文件**: `apps/server/src/routes/auth.ts`

#### 3. 更新 CLAUDE.md
- 添加字段契约文档引用
- 添加 Prisma 查询规范特别提醒
- 添加高风险区域提示

### 规范要点
- Prisma `include`/`select` 必须使用大写关联字段名（Teacher, School, Student 等）
- 访问关联对象使用大写字段名（`user.Teacher?.name`）
- API 返回优先使用扁平字段（teacherId, schoolId 等）
- 避免直接返回原始 Prisma 对象

### 涉及文件
- `docs/api/FIELD_CONTRACT.md` - 新建
- `docs/api/API_REFERENCE.md` - 添加文档引用
- `docs/change-log.md` - 记录变更
- `CLAUDE.md` - 添加规范提醒
- `apps/server/src/routes/auth.ts` - 修复 profile 字段

---

## 已完成任务：认证链路稳定性修复（2026-03-25）

### 目标
修复认证链路的稳定性问题，解决登录态刷新后丢失、错误信息不明确等问题。

### 修复内容

#### 1. /auth/me Prisma 关联字段名不一致
- **问题**: `/me` 端点在 Prisma include 中使用小写 `student/teacher/admin`，但访问时使用大写 `Student/Teacher/Admin`
- **结果**: `teacherId`、`studentId`、`schoolId` 等字段返回 `undefined`，导致前端状态丢失
- **修复**: 将 include 改为使用大写 `Student/Teacher/Admin`
- **文件**: `apps/server/src/routes/auth.ts` 第 327-334 行

#### 2. AuthProvider 过于激进清除认证状态
- **问题**: `fetchUserData` 在任何错误（包括网络错误）时都调用 `clearAuth()`
- **结果**: 网络波动就会导致用户被登出
- **修复**: 只在 HTTP 状态码 401/403 时才清除认证状态，网络错误时保留 token
- **文件**: `apps/web/src/components/AuthProvider.tsx` 第 82-89 行

#### 3. apiClient 吞掉所有错误
- **问题**: 所有错误都返回 "网络错误"，不保留 HTTP 状态码
- **结果**: 调用方无法区分网络错误和业务错误
- **修复**: 在 ApiResponse 中添加 `status` 字段，网络错误使用 status=0
- **文件**: `apps/web/src/lib/apiClient.ts`

#### 4. env.ts 要求 DATABASE_URL
- **问题**: SQLite 使用文件路径 `file:./dev.db`，不需要 DATABASE_URL 环境变量
- **结果**: 本地开发可能因缺少环境变量而启动失败
- **修复**: 将 `required` 数组改为空，不再强制要求 DATABASE_URL
- **文件**: `apps/server/src/config/env.ts`

### 涉及文件
- `apps/server/src/routes/auth.ts` - Prisma 关联字段名修复
- `apps/web/src/components/AuthProvider.tsx` - 错误处理逻辑优化
- `apps/web/src/lib/apiClient.ts` - 保留 HTTP 状态码
- `apps/server/src/config/env.ts` - 移除 DATABASE_URL 强制要求

### 错误类型说明

#### 会显示"网络错误"的情况
1. 服务器未启动（无法连接）
2. 网络连接中断
3. CORS 预检失败
4. DNS 解析失败

#### 会显示"服务器错误"的情况
1. 后端抛出未捕获的异常（500）
2. 数据库连接失败
3. Prisma 查询错误

#### 登录态持久化验证
- ✅ 修复后：刷新页面时 `/me` 请求返回正确的 `teacherId/studentId/schoolId`
- ✅ 网络错误时不再清除 localStorage 中的 token
- ✅ 只有真正的认证失败（401/403）才会清除登录态

### 手工验证步骤
1. 启动前后端：`pnpm dev`
2. 使用教师账号登录（teacher1 / admin123）
3. 刷新页面，确认仍然保持登录状态
4. 打开浏览器开发者工具 → Network → 查看 `/api/auth/me` 请求
5. 确认响应中包含正确的 `teacherId` 和 `schoolId`

---

## 已完成任务：代码仓库清理（2026-03-25）

### 目标
清理仓库中的无用、重复、历史残留代码，减少磁盘占用和干扰。

### 清理内容

#### 1. 删除 test 目录（约 114MB）
- 包含旧项目完整副本和 `apps.zip` 打包文件
- .gitignore 已配置忽略，但物理文件仍在磁盘上

#### 2. 删除数据库备份文件
- `apps/server/prisma/dev.db.backup`

#### 3. 删除临时/旧版脚本
- `apps/server/prisma/check-data.ts` - 临时检查脚本
- `apps/server/prisma/seed-test-data.ts` - 无引用的测试数据脚本
- `apps/server/prisma/seed-v1.ts` - 旧版本种子数据

#### 4. 清理 webpack 缓存旧文件
- `apps/web/.next/cache/**/*.old`

#### 5. 更新 package.json
- 删除 `prisma:seed-v1` 脚本

### 涉及文件
- 删除：test 目录、4 个 prisma 脚本、多个 .old 缓存文件
- 修改：apps/server/package.json

### apps/server/src 职责边界
清理后，后端目录结构清晰：
```
apps/server/src/
├── config/          # 后端配置（env.ts, cors.ts）
├── lib/             # 工具函数（logger.ts, jwtSecret.ts）
├── middleware/      # Express 中间件
├── modules/         # 业务模块（team/）
├── oj-adapters/     # OJ 适配器
├── routes/          # API 路由
└── index.ts         # 入口文件
```

---

## 已完成任务：比赛和题单模块清理（2026-03-25）

### 目标
彻底清理比赛模块和题单模块的代码，仅保留导航占位入口。

### 清理内容

#### 1. 删除前端API代理（共10个文件）
- `apps/web/src/app/api/contests/**` (5个文件)
- `apps/web/src/app/api/task-lists/**` (2个文件)
- `apps/web/src/app/api/task-progress/**` (2个文件)
- `apps/web/src/app/teacher/school/components/ContestsTab.tsx`

#### 2. 修改占位页
- `apps/web/src/app/student/contests/page.tsx` - 改为"功能暂未开放"占位页
- `apps/web/src/app/student/task-lists/page.tsx` - 改为"功能暂未开放"占位页

#### 3. 修改导航配置
- 平台管理员：移除"公共比赛"入口
- 学校负责人/教师：移除"题单管理"和"比赛中心"入口
- 学生：移除"我的题单"和"我的比赛"入口

#### 4. 修改首页
- 教师端：移除"最近比赛"卡片、"新建比赛"、"发布题单"快捷入口
- 学生端：移除"最近比赛"卡片、"查看我的题单"、"查看我的比赛"快捷入口
- 平台管理端：移除比赛统计卡片、"公共比赛"快捷入口

#### 5. 修改成绩页面
- `/teacher/scores` - 改为"功能暂未开放"占位页
- `/student/scores` - 改为"功能暂未开放"占位页

#### 6. 修改后端统计接口
- `apps/server/src/routes/stats.ts`：
  - 移除 `/contests` 端点
  - `/global` 端点移除 `totalContests`, `totalPublicContests` 字段

### 涉及文件
- 删除：10个前端API代理文件和1个组件
- 修改：10个前端页面/配置文件 + 1个后端路由

---

## 已完成任务：权限注释修正（2026-03-25）

### 目标
修正 permissions.ts 中关于学生管理权限的误导性注释。

### 修改内容

**问题分析**：
- `canManageStudent` 函数的实现逻辑是正确的：普通教师只能管理自己作为主教练的学生（`headTeacherId === teacherId`）
- 但注释描述错误，说"teacher: 可管理自己的学生（主教练）或本校学生"，这会误导开发者

**修复内容**：
- 修正文件头部角色权限定义注释
- 修正 `canManageStudent` 函数的 JSDoc 注释

**验证结果**：
- ✅ `canManageStudent` 逻辑正确：普通教师只能管理 `headTeacherId === teacherId` 的学生
- ✅ `students.ts` 删除接口正确使用 `canManageStudent` 权限检查
- ✅ 团队管理员删除越权修复已存在（`adminMember.teamId !== id` 检查）

### 涉及文件
- `apps/server/src/middleware/permissions.ts` - 注释修正

---

## 已完成任务：代码清理与权限修复（2026-03-25）

### 目标
系统性清理项目代码，解决权限漏洞、目录污染、历史残留等问题。

### 清理内容

#### 1. 删除历史残留文件
- `apps/server/prisma/seed.ts.bak`
- `apps/server/prisma/seed.ts.old`
- `docs/docs.zip`
- `.next/cache/**/*.old`

#### 2. 清理目录污染（server下的前端代码）
- 删除 `apps/server/src/app/` （前端页面结构）
- 删除 `apps/server/src/components/` （React组件）
- 删除 `apps/server/src/hooks/` （React Hooks）
- 删除 `apps/server/src/styles/` （CSS样式）
- 删除 `apps/server/src/config/navigation.ts` （前端导航配置）

#### 3. 删除题单模块
**后端**:
- `apps/server/src/routes/task-lists.ts`
- `apps/server/src/routes/task-progress.ts`

**前端**:
- `apps/web/src/app/teacher/task-lists/page.tsx`
- 简化 `apps/web/src/app/student/task-lists/page.tsx` 为只保留Tab导航

#### 4. 删除比赛模块
**后端**:
- `apps/server/src/routes/contests.ts`
- `apps/server/src/routes/contest-notes.ts`

**前端**:
- `apps/web/src/app/teacher/contests/` （整个目录）
- `apps/web/src/app/student/contests/[id]/` （整个目录）
- `apps/web/src/components/ContestDetail.tsx`
- 简化 `apps/web/src/app/student/contests/page.tsx` 为只保留Tab导航

#### 5. 修复权限漏洞

**canManageStudent 权限逻辑修正**:
- 学校负责人：可管理本校所有学生
- 普通教师：只能管理自己作为主教练的学生（headTeacherId === teacherId）
- 文件：`apps/server/src/middleware/permissions.ts`

**团队跨团队操作漏洞修复**:
- 删除管理员时验证 adminMember 是否属于当前团队
- 文件：`apps/server/src/modules/team/team.routes.ts`

### 涉及文件
- `apps/server/src/index.ts` - 移除路由注册
- `apps/server/src/middleware/permissions.ts` - 权限逻辑修复
- `apps/server/src/modules/team/team.routes.ts` - 跨团队漏洞修复
- 多个删除的前端/后端文件

---

## 已完成任务：题库界面优化（2026-03-25）

### 目标
优化题库列表和详情页的显示与交互。

### 修改内容

1. **题目名称点击跳转**：
   - 修复题目名称点击跳转问题，改为使用客户端导航 `router.push()`，与"查看"按钮行为一致
   - 位置：`apps/web/src/app/platform-admin/problems/page.tsx`

2. **时间/空间限制显示单位调整**：
   - 时间限制显示单位改为毫秒（ms）
   - 标签名称从"时限"改为"时间限制"，"内存"改为"空间限制"
   - 修改位置：
     - `apps/web/src/components/problem/ProblemDetail.tsx` - 详情页显示
     - `apps/web/src/components/problem/ProblemForm.tsx` - 表单输入

3. **OJ 拉取时间限制修复**：
   - 修复从洛谷拉取题目时时间限制被错误除以1000的问题
   - 洛谷 API 返回的时间限制已经是毫秒，无需转换
   - 位置：`apps/web/src/components/problem/ProblemForm.tsx`

### 涉及文件
- `apps/web/src/app/platform-admin/problems/page.tsx`
- `apps/web/src/components/problem/ProblemDetail.tsx`
- `apps/web/src/components/problem/ProblemForm.tsx`

---

## 已完成任务：OJ 拉取队列管理功能

### 目标
为平台管理员设计批量从OJ平台（先支持洛谷）拉取题目的队列管理功能。

### 需求要点
1. **批量拉取**：输入多个题号，队列式拉取
2. **平台Cookie配置**：每个平台可配置不同Cookie（洛谷：__client_id, _uid）
3. **状态返回**：拉取成功、拉取失败、附件下载失败等
4. **去重**：已拉取的题目不重复拉取
5. **重新拉取**：对已拉取的题目可手动重新拉取
6. **无Cookie也能拉取**：但附件可能下载失败

### 数据库模型

**OjFetchJob** (拉取任务)
```prisma
model OjFetchJob {
  id               String   @id @default(uuid())
  platform         String            // luogu / codeforces 等
  problemId        String            // 原平台题号 P1001
  status           String   @default("pending") // pending / fetching / success / failed / duplicate
  message          String?           // 错误信息或备注
  hasAttachment    Boolean  @default(false)    // 是否有附件
  attachmentStatus String?           // pending / success / failed / skipped
  createdProblemId String?           // 创建的题目ID
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([platform, problemId])
  @@index([status])
  @@index([createdAt])
}
```

**OjPlatformConfig** (平台Cookie配置)
```prisma
model OjPlatformConfig {
  id         String    @id @default(uuid())
  platform   String    @unique       // luogu / codeforces 等
  cookies    String?                 // JSON格式存储Cookie键值对
  lastUsedAt DateTime?               // 最后使用时间
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}
```

### API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/oj-fetcher/jobs` | 获取拉取任务列表 |
| POST | `/api/oj-fetcher/jobs/batch` | 创建批量拉取任务 |
| POST | `/api/oj-fetcher/jobs/:id/retry` | 重试单个任务 |
| DELETE | `/api/oj-fetcher/jobs/:id` | 删除任务 |
| GET | `/api/oj-fetcher/platforms/:platform/config` | 获取平台Cookie配置 |
| PUT | `/api/oj-fetcher/platforms/:platform/config` | 更新平台Cookie配置 |

### 前端页面

**位置**：`apps/web/src/app/platform-admin/problems/page.tsx`

**布局**：Tab切换
- **拉取队列** Tab：Cookie配置、批量拉取输入、任务列表
- **公共题库** Tab：已拉取的题目列表，支持重新拉取

### 修改文件
- `apps/server/prisma/schema.prisma` - 添加 OjFetchJob, OjPlatformConfig 模型
- `apps/server/src/routes/oj-fetcher.ts` - 添加队列管理API
- `apps/web/src/app/platform-admin/problems/page.tsx` - 重写为Tab布局

### 验证结果
- ✅ 批量拉取 P1001, P1002, P1003 成功
- ✅ 去重功能正常（P1001 不重复拉取）
- ✅ 任务状态正确更新
- ✅ 公共题库显示已拉取题目

---

## 已完成任务：洛谷附件下载功能

### 目标
支持从洛谷题目页面下载附件到本地系统。

### 需求要点
1. 拉取洛谷题目时自动获取附件信息
2. 在编辑页面显示远程附件列表
3. 支持一键下载远程附件到本地
4. 支持配置洛谷 Cookie（部分附件需要登录）

### 技术实现
1. **获取附件信息**：从洛谷 API 的 `attachments` 字段获取
2. **下载附件**：处理洛谷的重定向（302 到阿里云 OSS）
3. **权限处理**：部分附件需要登录，返回 403 时提示配置 Cookie

### 修改文件
- `apps/server/src/oj-adapters/types.ts` - 添加 OjAttachment 类型
- `apps/server/src/oj-adapters/luogu.ts` - 返回附件信息
- `apps/server/src/routes/oj-fetcher.ts` - 添加下载附件 API
- `apps/web/src/components/problem/ProblemForm.tsx` - 添加远程附件 UI
- `apps/server/.env.example` - 添加 LUOGU_COOKIE 配置说明

### 验证结果
- ✅ 洛谷题目附件信息正确获取
- ✅ 前端显示远程附件列表
- ✅ 下载 API 实现完成（需配置 Cookie 才能下载）

### 使用说明
1. 在编辑页面添加洛谷题目绑定，点击"拉取"
2. 切换到"附件"标签页，查看远程附件
3. 点击"下载"按钮下载附件
4. 如果下载失败（403），需要在 `.env` 配置 `LUOGU_COOKIE`

---

## 已完成任务：题目附件功能

### 目标
为每个题目添加附件功能，支持在详情页查看和下载，在编辑页上传和删除。

### 需求要点
1. 详情页显示附件列表，支持下载
2. 编辑页显示附件 Tab，支持上传和删除
3. 支持多种文件格式：PDF、ZIP、RAR、7Z、TXT、CPP、C、PY、JAVA、PAS、IN、OUT、MD
4. 最大文件大小：50MB

### 数据库修改
**文件**: `apps/server/prisma/schema.prisma`

```prisma
model ProblemAttachment {
  id          String   @id @default(uuid())
  problemId   String
  fileName    String
  fileSize    Int
  fileUrl     String
  description String?
  uploadedAt  DateTime @default(now())
  problem     Problem  @relation(fields: [problemId], references: [id], onDelete: Cascade)

  @@index([problemId])
}
```

### 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/problems/:id/attachments` | 获取附件列表 |
| POST | `/api/problems/:id/attachments` | 上传附件 |
| DELETE | `/api/problems/:id/attachments/:attachmentId` | 删除附件 |

### 修改文件

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 ProblemAttachment 模型
- `apps/server/src/routes/problems.ts` - 添加附件 API 端点
- `apps/web/src/components/problem/ProblemDetail.tsx` - 添加附件 Tab
- `apps/web/src/components/problem/ProblemForm.tsx` - 添加附件 Tab（仅编辑模式）

### 验证结果
- ✅ 数据库模型已同步
- ✅ 后端 API 已实现
- ✅ 前端详情页已添加附件 Tab
- ✅ 前端编辑页已添加附件上传/删除功能

---

## 已完成任务：洛谷适配器题面解析修复

### 目标
修复洛谷适配器无法正确拉取题目内容的问题。

### 问题描述
洛谷适配器在解析题目时，只获取了样例和附件，缺失了题目背景、描述、输入输出格式、提示等主要内容。

### 根因分析
洛谷 API 返回的数据结构中，题目内容在 `content` 子对象中：
- `content.background` - 题目背景
- `content.description` - 题目描述
- `content.formatI` - 输入格式
- `content.formatO` - 输出格式
- `content.hint` - 提示

原代码错误地在根层级查找这些字段。

### 修复内容
**文件**: `apps/server/src/oj-adapters/luogu.ts`

1. 修正 `LuoguProblemData` 接口，添加 `content` 子对象结构
2. 修改 `buildMarkdown` 方法，从 `content` 子对象读取各字段
3. 样例支持数组和对象两种格式

### 验证结果
- ✅ 成功拉取 P14839 完整题面（包含背景、描述、格式、样例、提示、附件）
- ✅ 创建题目 P000006（[THUPC 2026 初赛] 集合）

---

## 已完成任务：题库搜索与平台筛选功能

### 目标
为题库列表页面添加搜索和平台筛选功能。

### 需求要点
1. **公有题库**：添加 OJ 平台下拉选择 + 搜索题号和名字
2. **私有题库**：添加搜索题号和名字功能

### 修改文件
- `apps/server/src/routes/problems.ts` - 添加 keyword 和 platform 查询参数
- `apps/web/src/components/problem/ProblemList.tsx` - 添加搜索框和平台下拉

### 新增 API 参数
- `keyword`: 搜索关键词（匹配 problemCode 和 title）
- `platform`: OJ 平台筛选（luogu、codeforces 等）

### 技术要点
1. **关键词搜索**：使用 Prisma 的 `contains` 匹配题号和标题
2. **平台筛选**：由于 ojBindings 是 JSON 字符串，在应用层过滤

### 验证结果
- ✅ 关键词搜索正常
- ✅ 平台下拉仅在公有题库显示
- ✅ 重置按钮清空筛选条件

---

## 已完成任务：OJ 远程题目拉取功能

### 目标
实现从洛谷平台拉取题目信息的功能，自动填充题目表单。

### 需求要点
1. 在题目编辑页的 OJ 绑定区域添加"拉取"按钮
2. 输入洛谷题号后点击拉取，自动填充表单（标题、题面、时间/内存限制、难度）
3. 支持限流控制（2 请求/秒 + 随机抖动）
4. 错误处理和重试机制

### 新增文件
- `apps/server/src/oj-adapters/types.ts` - 类型定义（OjPlatform, OjErrorCode, OjFetchError, OjProblem, OjAdapter）
- `apps/server/src/oj-adapters/luogu.ts` - 洛谷适配器（含限流、重试、Cookie 处理）
- `apps/server/src/oj-adapters/index.ts` - 统一导出和适配器注册
- `apps/server/src/routes/oj-fetcher.ts` - API 路由

### API 端点
- `GET /api/oj-fetcher/platforms` - 获取支持的 OJ 平台列表
- `GET /api/oj-fetcher/:platform/:problemId` - 拉取指定平台的题目信息

### 修改文件
- `apps/server/src/index.ts` - 注册 oj-fetcher 路由
- `apps/web/src/components/problem/ProblemForm.tsx` - 添加拉取按钮和处理函数
- `apps/server/package.json` - 添加 cheerio 依赖

### 技术要点
1. **限流控制**: 2 请求/秒 + 0.10-0.35秒随机抖动
2. **重试机制**: 最多 3 次重试，指数退避
3. **反爬虫处理**: 洛谷使用 302 重定向 + Cookie 验证，需要手动处理
4. **HTML 解析**: 使用 cheerio 解析页面中的 lentille-context JSON

### 验证结果
- ✅ 平台列表 API 正常
- ✅ 洛谷题目拉取成功（测试 P1001）
- ✅ 表单自动填充正常

---

## 已完成任务：题库模块重构

### 目标
重构题库模块，实现三端（学生、教师、管理端）的题库功能，支持私有题库和公共题库。

### 需求要点
1. 私有题库：学生和教师都可以创建私有题目，只有自己能看到和编辑
2. 公共题库：管理端可以创建公共题目，所有人可见
3. 代码复用：三端尽量用一套代码，只是权限不同

### 数据库修改
- `Problem` 模型添加 `visibility` 字段（private/public）
- `Problem` 模型添加 `ownerType` 字段（teacher/student/admin）
- 移除 `owner` 外键关联（因为 owner 可能是 Teacher、Student 或 Admin）

### 共享组件
- `ProblemList.tsx` - 列表组件（接收 role 参数）
- `ProblemDetail.tsx` - 详情组件（接收 role 参数）
- `ProblemForm.tsx` - 表单组件（接收 role 参数）
- `ProblemNote.tsx` - 思路记录组件（接收 role 参数）

### 权限逻辑
| 角色 | 可见范围 | 可创建 | 可编辑/删除 |
|------|----------|--------|-------------|
| teacher | 私有(自己) + 公共 | 私有题目 | 自己的私有题目 |
| student | 私有(自己) + 公共 | 私有题目 | 自己的私有题目 |
| admin | 全部 | 私有/公共题目 | 全部题目 |

### 修改文件清单
1. `apps/server/prisma/schema.prisma` - 添加 visibility, ownerType 字段
2. `apps/server/src/routes/problems.ts` - 修改权限逻辑
3. `apps/web/src/components/problem/ProblemList.tsx` - 列表组件
4. `apps/web/src/components/problem/ProblemDetail.tsx` - 详情组件
5. `apps/web/src/components/problem/ProblemForm.tsx` - 表单组件
6. `apps/web/src/components/problem/ProblemNote.tsx` - 思路记录组件
7. 教师端页面 - 使用共享组件
8. 学生端页面 - 新建完整题库功能
9. 管理端页面 - 新建完整题库功能

---

## 已完成任务：题目绑定功能

### 目标
在题目编辑和创建页面的"发布设置" Tab 中添加 OJ 题目绑定功能。

### 需求要点
1. 支持绑定外部 OJ 平台题目（最多3个，可选）
2. 平台选择：洛谷、CodeForces、AtCoder、LOJ、POJ、HDU、SPOJ、UVa、Vijos、BZOJ、Gym、其他
3. 详情页显示 OJ 绑定链接，点击可跳转

### 数据库修改
**文件**: `apps/server/prisma/schema.prisma`

```prisma
model Problem {
  // ... 其他字段 ...
  ojBindings String? // JSON: OJ 题目绑定
}
```

### 数据格式
```json
[
  { "platform": "luogu", "problemId": "P1001" },
  { "platform": "codeforces", "problemId": "1234A" }
]
```

### 修改文件
- `apps/server/prisma/schema.prisma` - 添加 ojBindings 字段
- `apps/server/src/routes/problems.ts` - 处理 ojBindings 字段
- `apps/web/src/app/teacher/problems/new/page.tsx` - 创建页面添加绑定 UI
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 编辑页面添加绑定 UI
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 详情页显示绑定链接

---

## 已完成任务：移除发布按钮，通过编辑页修改状态

### 目标
移除题目详情页的发布按钮，改为通过编辑页面的"发布设置" Tab 修改状态。

### 修改内容
- 移除详情页的"发布"按钮
- 移除 `handlePublish` 函数
- 保留编辑页面的状态选择功能（草稿/已发布）

### 修改文件
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 移除发布按钮和相关函数

### 用户体验流程
1. 用户点击"编辑"按钮进入编辑页
2. 在"发布设置" Tab 中可以修改题目状态（草稿/已发布）
3. 点击保存后返回详情页

---

## 已完成任务：私有题库编辑页面 Tab 布局与内容保留

### 目标
优化私有题库的创建和编辑页面，使用 Tab 布局，并解决切换题面/题解类型时内容丢失的问题。

### 需求要点
1. 编辑/创建页面使用 Tab 布局：题面、题解、发布设置
2. 基本信息栏始终显示在顶部（标题、难度、时间/内存限制）
3. 题面/题解支持编辑/预览切换
4. **切换题面/题解类型时保留之前的内容**（如从 Markdown 切到 PDF 再切回，Markdown 内容不丢失）

### 修改内容

#### 后端修改
**文件**: `apps/server/src/routes/problems.ts`

- **创建接口**：始终保存 description/solutionMarkdown（如果有内容），不管当前类型
- **更新接口**：只在类型匹配时才更新对应内容
- 这样切换类型时不会清空其他类型的内容

```typescript
// 创建时：始终保存内容（如果有）
if (description) {
  createData.description = description
}

// 更新时：只有当类型是 markdown 时才更新
if (statementType === 'markdown') {
  updateData.description = description
}
```

#### 前端修改
**文件**:
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 编辑页面 Tab 布局
- `apps/web/src/app/teacher/problems/new/page.tsx` - 创建页面 Tab 布局

### 涉及文件

**修改文件**：
- `apps/server/src/routes/problems.ts` - 创建时始终保存内容，更新时只保存匹配类型的内容
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 编辑页面 Tab 布局
- `apps/web/src/app/teacher/problems/new/page.tsx` - 创建页面 Tab 布局
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 详情页面保存逻辑修复

---

## 已完成任务：私有题库思路记录模式

### 目标
为私有题库实现思路记录功能，教师可以在查看题目时记录解题思路。

### 需求要点
- 全屏分栏布局：左侧题目，右侧编辑器
- 支持 Markdown 编辑/预览/分栏三种模式
- 自动保存（2秒 debounce）+ 手动保存按钮
- 显示保存状态和时间

### 数据库模型

新增 `ProblemNote` 模型（已存在）：
```prisma
model ProblemNote {
  id        String   @id @default(uuid())
  problemId String
  userId    String   // 用户ID（学生或教师）
  userType  String   // teacher / student
  content   String   @default("") // Markdown 内容
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  problem Problem @relation(fields: [problemId], references: [id], onDelete: Cascade)

  @@unique([problemId, userId, userType]) // 每个用户对每道题只有一份记录
}
```

### 前端页面

新建页面：`apps/web/src/app/teacher/problems/[id]/note/page.tsx`

### 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/problems/:id/note` | 获取用户的思路记录 |
| PUT | `/api/problems/:id/note` | 保存思路记录 |

### 涉及文件

**新建文件**：
- `apps/web/src/app/teacher/problems/[id]/note/page.tsx` - 思路记录全屏页面

**修改文件**：
- `apps/server/src/routes/problems.ts` - 添加思路记录 API
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 添加入口按钮，"我的代码"改为"评测记录"

---

## 已完成任务：比赛思路记录模式实现

### 目标
实现学生在比赛做题时能够一边看题一边记录思路过程的功能。

### 需求要点
- 题目在左边，笔记编辑在右边（分栏布局）
- 支持 Markdown 预览
- 自动保存功能（debounce 1秒）
- 按题目存储（每道比赛题单独一份思路记录）

### 数据库模型

新增 `ContestProblemNote` 模型：
```prisma
model ContestProblemNote {
  id        String   @id @default(uuid())
  contestId String
  problemId String
  studentId String
  content   String   @default("") // Markdown 内容
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  contest Contest        @relation(fields: [contestId], references: [id], onDelete: Cascade)
  problem ContestProblem @relation(fields: [problemId], references: [id], onDelete: Cascade)
  student Student        @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([contestId, problemId, studentId]) // 每个学生对每道题只有一份记录
}
```

### 前端页面

新建页面：`apps/web/src/app/student/contests/[id]/practice/[problemId]/page.tsx`

**页面布局**：
- 顶部：比赛标题、题目名称、返回按钮、保存状态
- 左侧：题目描述区域（Markdown 渲染）
- 右侧：Markdown 编辑器（支持编辑/预览/分栏三种模式）

### 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/contests/:contestId/problems/:problemId/note` | 获取学生的思路记录 |
| PUT | `/api/contests/:contestId/problems/:problemId/note` | 保存思路记录 |

### 涉及文件

**新建文件**：
- `apps/server/src/routes/contest-notes.ts` - 思路记录 API
- `apps/web/src/app/student/contests/[id]/practice/[problemId]/page.tsx` - 思路记录页面
- `apps/web/src/components/ui/MarkdownEditor.tsx` - Markdown 编辑器组件

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 ContestProblemNote 模型
- `apps/server/src/index.ts` - 注册 contest-notes 路由
- `apps/web/src/app/student/contests/[id]/page.tsx` - 添加「开启思路记录模式」按钮

### 验证结果
- ✅ 数据库模型已添加
- ✅ 后端 API 已创建
- ✅ MarkdownEditor 组件已创建
- ✅ 思路记录页面已创建
- ✅ 入口按钮已添加

---

## 已完成任务：PDF 跨域显示问题修复

### 问题描述
私有题库功能已实现，但 PDF 嵌入显示存在问题：
- 前端页面运行在 3000 端口 (Next.js)
- PDF 静态文件在后端 3001 端口 (Express)
- 浏览器在 iframe/object 中嵌入跨域 PDF 时会被阻止

### 解决方案
使用 **Next.js API 代理**：在 Next.js 中创建 API 路由，代理请求到后端的 PDF 文件。这样 PDF 就会从 3000 端口提供，避免跨域问题。

### 实现步骤

#### 1. 创建 Next.js API 代理路由
新建文件 `apps/web/src/app/api/problems/pdf/[...path]/route.ts`

#### 2. 修改前端 PDF URL 生成逻辑
在详情页和编辑页中，将 PDF URL 改为使用代理路径：
- 原来: `http://localhost:3001/uploads/problems/xxx.pdf`
- 改为: `/api/problems/pdf/xxx.pdf`

### 涉及文件

**新建文件**：
- `apps/web/src/app/api/problems/pdf/[...path]/route.ts` - PDF 代理 API

**修改文件**：
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 修改 PDF URL 生成
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 修改 PDF URL 生成

### 验证结果
- ✅ PDF 能在页面中嵌入显示
- ✅ 网络请求确认 PDF 从 3000 端口加载

---

## 已完成任务：私有题库功能实现

### 目标
实现教师私有题库功能，支持创建和管理私有题目。

### 需求要点
- 题库分公有（暂空）和私有
- 私有题库：用户是所有者的单题
- 支持题面和题解（markdown/pdf）
- 题号全局唯一（P000001 格式）
- 支持编辑
- 页面跳转，不做弹窗
- 显示题目所有者名字
- 数据范围：时间限制（秒）、内存限制（MB）
- 草稿/发布状态
- 提交记录功能本次不做
- 评测设置预留

### 数据库模型

新增 `Problem` 模型：
```prisma
model Problem {
  id                String    @id @default(uuid())
  problemCode       String    @unique  // 全局唯一题号，如 P000001
  title             String
  description       String?            // Markdown 题面内容
  statementType     String    @default("none")  // none / markdown / pdf
  statementPdfUrl   String?            // PDF 题面文件 URL
  solutionType      String    @default("none")  // none / markdown / pdf
  solutionMarkdown  String?            // Markdown 题解内容
  solutionPdfUrl    String?            // PDF 题解文件 URL
  solutionVisible   Boolean   @default(false)
  difficulty        String?            // 简单/中等/困难
  timeLimit         Int?               // 时间限制（秒）
  memoryLimit       Int?               // 内存限制（MB）
  judgeConfig       String?            // JSON：预留评测配置
  ownerId           String             // 创建者 teacherId
  status            String    @default("draft")  // draft / published
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  owner             Teacher   @relation(fields: [ownerId], references: [id])
}
```

### 前端页面

```
apps/web/src/app/teacher/problems/
├── page.tsx              # 题库列表页（Tab: 私有/公有）
├── new/
│   └── page.tsx          # 新建题目页
└── [id]/
    ├── page.tsx          # 题目详情页
    └── edit/
        └── page.tsx      # 题目编辑页
```

### 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/problems` | 获取私有题目列表 |
| POST | `/api/problems` | 创建题目 |
| GET | `/api/problems/:id` | 获取题目详情 |
| PUT | `/api/problems/:id` | 更新题目 |
| DELETE | `/api/problems/:id` | 删除题目 |
| POST | `/api/problems/:id/statement-pdf` | 上传题面 PDF |
| POST | `/api/problems/:id/solution-pdf` | 上传题解 PDF |
| POST | `/api/problems/:id/publish` | 发布题目 |

### 涉及文件

**新建文件**：
- `apps/server/src/routes/problems.ts` - 题目 API 路由
- `apps/web/src/app/teacher/problems/page.tsx` - 题库列表页
- `apps/web/src/app/teacher/problems/new/page.tsx` - 新建题目页
- `apps/web/src/app/teacher/problems/[id]/page.tsx` - 题目详情页
- `apps/web/src/app/teacher/problems/[id]/edit/page.tsx` - 题目编辑页

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 Problem 模型
- `apps/server/src/index.ts` - 注册 problems 路由

### 验证结果
- ✅ 题目列表 API 正常工作
- ✅ 创建题目自动生成题号 P000001
- ✅ 题目详情包含所有者姓名
- ✅ 发布功能正常（draft → published）
- ✅ 前后端服务正常启动

---

## 已完成任务：团队邀请功能 Bug 修复

### 问题描述
教师通过用户名邀请学生后，邀请在教师端的"待处理邀请"列表显示，但学生端看不到邀请。

### 根因分析
`team.service.ts` 中 `getStudentTeams` 方法错误调用 `findMembers(studentId)`：

```typescript
// 错误：findMembers 第一个参数是 teamId，不是 userId
const memberRecords = await this.repo.findMembers(studentId)
```

这导致查询条件变成 `WHERE teamId = studentId`，永远查不到正确结果。

### 修复方案
1. 在 `team.repository.ts` 新增 `findMembersByUser()` 方法
2. 修改 `team.service.ts` 正确使用 `findMembersByUser(studentId, 'student')`

### 验证结果
- ✅ 教师邀请学生成功
- ✅ 学生端能看到待处理邀请
- ✅ 邀请包含完整的团队信息和邀请人信息

### 修改文件
- `apps/server/src/modules/team/team.repository.ts` - 新增 `findMembersByUser` 方法
- `apps/server/src/modules/team/team.service.ts` - 修复调用
- `apps/web/src/components/AuthProvider.tsx` - 修复头像不持久化问题

---

## 已完成任务：团队模块代码结构重构

### 目标
将过大的 `routes/teams.ts`（2707 行）拆分为分层架构，提高代码可维护性，为后续重构建立模式。

### 原有问题

| 检查项 | 现状 | 说明 |
|--------|------|------|
| 单文件行数 | 2707 行 | teams.ts 过大，职责混杂 |
| 分层架构 | ❌ 无 | 路由、业务逻辑、数据访问混杂 |
| 代码复用 | ⚠️ 低 | 辅助函数重复、内联逻辑多 |
| 可测试性 | ⚠️ 低 | 难以单独测试业务逻辑 |

### 新增模块化结构

```
apps/server/src/
├── modules/
│   └── team/
│       ├── team.types.ts      # 类型定义（~300 行）
│       ├── team.utils.ts      # 工具函数（~100 行）
│       ├── team.repository.ts # 数据访问层（~600 行）
│       ├── team.service.ts    # 业务逻辑层（~500 行）
│       └── team.routes.ts     # 路由层（~300 行）
├── routes/
│   └── teams.ts               # 重导出入口（~35 行）
```

### 各层职责

#### team.types.ts - 类型定义
- MemberType, MemberRole, MemberStatus 基础类型
- DTO 类型（CreateTeamDTO, UpdateTeamDTO, InviteMembersDTO 等）
- 响应类型（TeamListItem, TeamDetail, MemberDetails 等）
- 业务错误类型（TeamErrorCode, TeamErrorMessages）
- 工具函数（extractUserIdentity, getUserIdentity）

#### team.repository.ts - 数据访问层
- 团队 CRUD 操作（findById, findMany, create, update, delete）
- 成员管理（findMember, createMember, updateMember, deleteMember）
- 加入申请（findJoinRequest, createJoinRequest, updateJoinRequest）
- 审计日志（logOperation）
- 事务支持（transaction）
- 用户查询（findTeacher, findStudent, findAvailableMembers）

#### team.service.ts - 业务逻辑层
- 权限检查（getMemberRole, isTeamAdmin）
- 团队列表获取（getTeamList, getStudentTeams）
- 团队详情（getTeamDetail）
- 团队创建（createTeam）
- 成员邀请（inviteMembers）
- 所有权转移（transferOwnership）
- 加入申请处理（handleJoinRequest）

#### team.routes.ts - 路由层
- 30+ 个 API 端点定义
- 请求解析和响应格式化
- 错误处理和日志记录

### 涉及文件

**新建文件**：
- `apps/server/src/modules/team/team.types.ts` - 类型定义
- `apps/server/src/modules/team/team.utils.ts` - 工具函数
- `apps/server/src/modules/team/team.repository.ts` - 数据访问层
- `apps/server/src/modules/team/team.service.ts` - 业务逻辑层
- `apps/server/src/modules/team/team.routes.ts` - 路由层

**修改文件**：
- `apps/server/src/routes/teams.ts` - 改为重导出入口
- `apps/server/tests/helpers/testRequest.ts` - 修复 ESM 导入
- `docs/current-task.md` - 任务状态
- `docs/change-log.md` - 变更记录

### 验证方案

```bash
# 运行测试验证功能正常
cd apps/server
pnpm test

# 启动开发服务器验证 API 正常
pnpm dev
```

### 技术决策

1. **模块位置**：使用 `modules/team/` 而非 `services/` + `repositories/` 分散目录
2. **向后兼容**：保留 `routes/teams.ts` 作为重导出入口
3. **类型导入**：使用相对路径 `../../../../packages/shared/src/index.js` 解决模块解析问题
4. **事务处理**：Repository 层提供 `transaction()` 方法供 Service 层使用

### 后续建议

1. **schools.ts 拆分**：按相同模式重构（1360 行）
2. **contests.ts 拆分**：按相同模式重构（937 行）
3. **统一错误处理**：创建错误类和中间件
4. **测试补齐**：为新的分层结构编写单元测试

---

## 已完成任务：测试体系补齐

### 目标
建立基础的测试基础设施并编写关键测试用例，为项目提供回归测试保障。

### 现状分析

| 检查项 | 现状 | 说明 |
|--------|------|------|
| 测试框架 | ❌ 无 | 未配置任何测试框架 |
| 测试文件 | ❌ 无 | 项目中无测试文件 |
| 测试脚本 | ❌ 无 | package.json 中无测试命令 |

### 新增基础设施

#### 1. Vitest 测试框架
**配置文件**: `apps/server/vitest.config.ts`

```typescript
{
  globals: true,
  environment: 'node',
  include: ['tests/**/*.test.ts'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html']
  }
}
```

#### 2. 测试辅助工具
**目录**: `apps/server/tests/helpers/`

- `testUser.ts` - 创建测试用户、学校、团队
- `testToken.ts` - 生成测试 JWT Token
- `testRequest.ts` - 创建测试 Express 应用

#### 3. 测试脚本
**文件**: `apps/server/package.json`

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

### 测试用例

#### 认证模块 (auth.test.ts)
- ✅ 正确密码登录成功
- ✅ 错误密码登录失败
- ✅ 用户不存在
- ✅ 账号被禁用
- ✅ 角色不匹配
- ✅ 登录日志记录
- ✅ 注册功能
- ✅ 用户名重复
- ✅ Token 验证
- ✅ 密码修改

#### 权限模块 (permissions.test.ts)
- ✅ 学校访问权限 (canAccessSchool)
- ✅ 学校管理权限 (canManageSchool)
- ✅ 学生查看权限 (canViewStudent)
- ✅ 学生管理权限 (canManageStudent)
- ✅ 教师查看权限 (canViewTeacher)
- ✅ 教师管理权限 (canManageTeacher)
- ✅ 团队查看权限 (canViewTeam)
- ✅ 团队管理权限 (canManageTeam)

#### 事务测试 (transactions.test.ts)
- ✅ 学校创建事务完整性
- ✅ 学生创建事务完整性
- ✅ 负责人转移事务
- ✅ 用户状态更新事务

#### 团队操作测试 (teams.test.ts)
- ✅ 团队创建
- ✅ 添加成员（教师/学生）
- ✅ 移除成员
- ✅ 角色变更
- ✅ 所有权转移
- ✅ 团队列表
- ✅ 团队详情
- ✅ 团队删除

#### 回归测试 (regression.test.ts)
- ✅ 学生列表分页
- ✅ 学生列表筛选
- ✅ 学校列表
- ✅ 教师列表
- ✅ 用户列表
- ✅ 学生排名
- ✅ 健康检查

### 涉及文件

**新建文件**：
- `apps/server/vitest.config.ts` - Vitest 配置
- `apps/server/tests/setup.ts` - 测试环境设置
- `apps/server/tests/helpers/index.ts` - 辅助函数入口
- `apps/server/tests/helpers/testUser.ts` - 测试用户创建
- `apps/server/tests/helpers/testToken.ts` - 测试 Token 生成
- `apps/server/tests/helpers/testRequest.ts` - 测试请求封装
- `apps/server/tests/auth.test.ts` - 认证模块测试
- `apps/server/tests/permissions.test.ts` - 权限模块测试
- `apps/server/tests/transactions.test.ts` - 事务测试
- `apps/server/tests/teams.test.ts` - 团队操作测试
- `apps/server/tests/regression.test.ts` - 基础回归测试

**修改文件**：
- `apps/server/package.json` - 添加测试依赖和脚本
- `docs/current-task.md` - 更新任务状态
- `docs/change-log.md` - 记录变更

### 验证方案

```bash
# 运行所有测试
cd apps/server
pnpm test

# 运行特定测试
pnpm vitest run tests/auth.test.ts

# 查看覆盖率
pnpm test:coverage

# 监视模式
pnpm test:watch
```

### 未做事项（留待后续）

1. **前端组件测试**：本次只做后端测试
2. **E2E 测试**：需要单独任务处理
3. **比赛模块测试**：按需补充
4. **题单模块测试**：按需补充

---

## 已完成任务：安全中间件、运行环境校验与基础防护

### 目标
将项目从"开发环境能跑"提升到"更接近生产可用"，补齐基础安全防护，用中间件和统一入口解决一批基础防护问题。

### 现有问题

| 检查项 | 现状 | 风险 |
|--------|------|------|
| helmet | ❌ 未使用 | 缺少 X-Frame-Options、X-Content-Type-Options 等安全头 |
| CORS | 硬编码 localhost:3000 | 生产环境无法使用 |
| JSON body | ❌ 无大小限制 | 可被大请求拖垮 |
| 比赛资料上传 | ❌ 无限制 | 可被滥用存储或拖垮服务器 |
| 全局限流 | ❌ 无 | 可被 DDoS 攻击 |
| 启动校验 | ⚠️ 仅 JWT_SECRET | 缺少关键配置也能启动 |

### 新增基础设施

#### 1. Helmet 安全响应头
**目的**：防止 XSS、点击劫持、MIME 嗅探等攻击

添加的安全头：
- `X-Frame-Options: DENY` - 防止点击劫持
- `X-Content-Type-Options: nosniff` - 防止 MIME 嗅探
- `X-XSS-Protection: 0` - 现代浏览器已内置防护

#### 2. 动态 CORS 配置
**文件**: `apps/server/src/config/cors.ts`

- **开发环境**：允许 `localhost:3000` 和 `127.0.0.1:3000`
- **生产环境**：从环境变量 `CORS_ORIGINS` 读取白名单

#### 3. 环境变量启动校验
**文件**: `apps/server/src/config/env.ts`

校验规则：
- 必须：`DATABASE_URL`
- 生产必须：`JWT_SECRET`、`CORS_ORIGINS`
- 缺少配置时拒绝启动并输出错误

#### 4. 全局 API 限流
**文件**: `apps/server/src/middleware/rateLimiter.ts`

- 限制：每分钟最多 100 次请求
- 目的：防止 DDoS 和恶意滥用

#### 5. 请求体大小限制
- JSON body：限制为 1MB
- 比赛资料上传：限制为 20MB + 文件类型白名单

#### 6. 错误信息优化
- 生产环境隐藏详细错误信息
- 统一处理 Multer 上传错误
- 统一处理 CORS 错误

### 涉及文件

**新建文件**：
- `apps/server/src/config/env.ts` - 环境变量校验和工具函数
- `apps/server/src/config/cors.ts` - CORS 动态配置

**修改文件**：
- `apps/server/package.json` - 添加 helmet 依赖
- `apps/server/src/index.ts` - 注册安全中间件、启动校验、错误处理优化
- `apps/server/src/middleware/rateLimiter.ts` - 添加 globalLimiter
- `apps/server/src/routes/contests.ts` - 添加上传大小和类型限制
- `apps/server/.env.example` - 添加 CORS_ORIGINS、NODE_ENV

### 环境区分

| 配置项 | 开发环境 | 生产环境 |
|--------|----------|----------|
| CORS | 允许 localhost | 白名单（CORS_ORIGINS） |
| JWT_SECRET | 可省略（有警告） | **必须配置** |
| CORS_ORIGINS | 不需要 | **必须配置** |
| 错误信息 | 显示详细 | 隐藏详情 |
| 安全响应头 | 全部启用 | 全部启用 |

### 验证方案

1. **安全头验证**：`curl -I http://localhost:3001/api/health` 查看响应头
2. **CORS 验证**：用不同 Origin 测试跨域请求
3. **限流验证**：快速发送 100+ 请求观察 429 响应
4. **启动校验**：删除必须配置后启动，应拒绝并报错

### 未做事项（留待后续）

1. **静态文件权限控制**：记录为已知问题 P2，需单独任务处理
2. **HTTPS 强制**：部署层面处理
3. **内容安全策略 (CSP)**：按需后续添加

---

## 已完成任务：日志、审计与问题定位能力建设

### 目标
建立基础的结构化日志和关键操作追踪能力，解决以下问题：
- 日志方式原始（192 处 console.log/error/warn）
- 缺少请求级定位能力（无 requestId）
- 审计日志覆盖不全
- 出问题只能"看控制台"

### 新增基础设施

#### 1. 统一 Logger 模块
**文件**: `apps/server/src/lib/logger.ts`

日志级别：
- `info` - 常规信息
- `warn` - 警告
- `error` - 错误
- `audit` - 审计日志（关键操作）
- `security` - 安全日志（权限拒绝等）

日志格式：
```typescript
{
  timestamp: '2026-03-23T03:20:00.000Z',
  level: 'info',
  requestId: 'req_abc123',
  userId: 'xxx',
  role: 'teacher',
  action: 'login',
  target: 'username',
  message: '登录成功',
  metadata: { ip: '127.0.0.1' }
}
```

#### 2. 请求追踪中间件
**文件**: `apps/server/src/middleware/requestLogger.ts`

功能：
- 生成唯一 requestId
- 记录请求入口（method、path、query、ip）
- 记录请求出口（status、duration）
- 提供 `updateRequestContext` 供登录后更新用户信息

#### 3. 审计日志表

**LoginLog** - 登录审计：
| 字段 | 说明 |
|------|------|
| userId | 登录成功时有值 |
| username | 尝试登录的用户名 |
| loginRole | 尝试登录的端（admin/teacher/student） |
| userRole | 用户实际角色 |
| result | success / failed_user_not_found / failed_wrong_password / failed_account_disabled / failed_role_mismatch |
| ipAddress | 客户端 IP |
| userAgent | 浏览器标识 |

**TeamOperationLog** - 团队操作审计：
| 字段 | 说明 |
|------|------|
| teamId | 团队 ID |
| operatorId | 操作人 ID |
| operatorType | teacher / student |
| action | member_add / member_remove / role_change / ownership_transfer / team_delete / invite_send / invite_accept / invite_reject / join_approve / join_reject |
| targetId | 目标用户 ID |
| oldValue | 变更前的值（如旧角色） |
| newValue | 变更后的值（如新角色） |

### 审计埋点

#### 登录相关（auth.ts）
| 事件 | 记录方式 |
|------|----------|
| 登录成功 | LoginLog (result=success) |
| 用户不存在 | LoginLog (result=failed_user_not_found) |
| 密码错误 | LoginLog (result=failed_wrong_password) |
| 账号禁用 | LoginLog (result=failed_account_disabled) |
| 角色不匹配 | LoginLog (result=failed_role_mismatch) |
| 密码修改成功 | logger.audit('password_change_success') |

#### 团队操作（teams.ts）
| 事件 | action 值 |
|------|----------|
| 添加成员 | member_add |
| 移除成员 | member_remove |
| 成员角色变更 | role_change |
| 所有权转移 | ownership_transfer |
| 团队删除 | team_delete |
| 邀请发送 | invite_send |
| 邀请接受 | invite_accept |
| 邀请拒绝 | invite_reject |
| 申请批准 | join_approve |
| 申请拒绝 | join_reject |

#### 权限拒绝（permissions.ts）
所有权限检查函数在拒绝时记录 `logger.security('permission_denied', {...})`：
- canAccessSchool
- canManageSchool
- canViewStudent
- canManageStudent
- canViewTeacher
- canManageTeacher
- canViewTeam
- canManageTeam

### 涉及文件

**新建文件**：
- `apps/server/src/lib/logger.ts` - 统一日志模块
- `apps/server/src/middleware/requestLogger.ts` - 请求追踪中间件

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加 LoginLog、TeamOperationLog
- `apps/server/src/index.ts` - 注册中间件、全局错误处理
- `apps/server/src/routes/auth.ts` - 登录审计埋点
- `apps/server/src/routes/teams.ts` - 团队操作审计埋点
- `apps/server/src/middleware/permissions.ts` - 权限拒绝日志
- `docs/change-log.md` - 变更记录
- `docs/current-task.md` - 任务状态

### 验证方案

1. **请求追踪验证**：
   - 发起一个请求，观察日志中的 requestId
   - 确认同一请求的多条日志有相同 requestId

2. **登录审计验证**：
   - 使用错误密码登录，检查 LoginLog 表记录
   - 使用正确密码登录，检查 LoginLog 表记录

3. **团队操作审计验证**：
   - 添加/移除成员，检查 TeamOperationLog 表
   - 转移所有权，检查 TeamOperationLog 表

4. **权限拒绝验证**：
   - 尝试越权操作，检查安全日志输出

### 日志输出示例

```
{"timestamp":"2026-03-23T03:20:00.000Z","level":"info","requestId":"req_abc123","message":"request_start","method":"POST","path":"/api/auth/login"}
{"timestamp":"2026-03-23T03:20:00.100Z","level":"warn","requestId":"req_abc123","message":"login_failed","action":"login","username":"admin","result":"failed_wrong_password","ip":"127.0.0.1"}
{"timestamp":"2026-03-23T03:20:00.150Z","level":"info","requestId":"req_abc123","message":"request_end","status":401,"duration":150}
```

### 未做事项（留待后续）

1. **日志持久化**：当前只输出到控制台，后续可接入日志文件或日志服务
2. **告警机制**：登录失败阈值告警、异常操作告警
3. **日志检索平台**：ELK、Loki 等
4. **慢查询日志**：数据库查询性能监控
5. **请求响应体记录**：当前只记录入口和出口，不记录详细请求体（避免敏感信息）
6. **全量审计覆盖**：本次只覆盖关键敏感操作，其他操作按需补充

---

## 已完成任务：数据库索引优化

### 目标
为高频查询路径补充数据库索引，提升查询性能，评估 SQLite 适用边界。

### 新增索引

| 模型 | 索引字段 | 用途 |
|------|----------|------|
| User | `role`, `status`, `createdAt` | 用户列表筛选、角色/状态查询 |
| Teacher | `schoolId`, `status`, `createdAt` | 学校教师列表、状态筛选 |
| Student | `schoolId`, `headTeacherId`, `rating`, `enrollmentYear` | 学生列表、排名、"我的学生"筛选 |
| Student | `schoolId, headTeacherId` (复合) | 按学校+主教练联合查询 |
| Team | `schoolId`, `isPublic`, `createdAt` | 学校团队列表、公有团队筛选 |
| Team | `schoolId, isPublic` (复合) | 学生浏览可加入团队 |
| TeamMember | `teamId, status, role` (复合) | 成员列表查询、权限检查 |
| TeamMember | `userId, userType, status` (复合) | "我的团队"查询 |
| TeamMember | `teamId, role` (复合) | 查找团队所有者/管理员 |
| TeamMember | `status` | 待处理邀请查询 |
| Contest | `teamId`, `status`, `scope`, `contestDate` | 比赛列表筛选、日期排序 |
| Contest | `teamId, status` (复合) | 团队比赛状态筛选 |
| ContestResult | `studentId`, `createdAt` | 学生成绩历史、成绩统计 |
| Milestone | `studentId`, `teacherId`, `milestoneDate` | 学生里程碑、教师创建记录 |
| TaskList | `createdBy`, `createdAt` | 教师题单列表 |
| TaskProgress | `studentId`, `status` | 学生进度查询、状态筛选 |

### SQLite 适用边界评估

**当前 MVP 阶段**：SQLite 完全够用

**预期支撑能力**：
- 单校 1000 学生、50 教师以内
- 读多写少场景表现良好

**瓶颈预测**：
| 指标 | 当前状态 | 预计瓶颈 |
|------|----------|----------|
| 并发写入 | 低 | 10-20 并发写 |
| 数据量 | <1000 条/表 | 10万-100万条 |
| 连接数 | 单连接 | - |
| 复杂查询 | 简单 | 多表 JOIN 5+ |

**何时需要迁移 PostgreSQL**：
1. 单表数据超过 10 万条
2. 并发用户超过 50 人
3. 需要复杂分析查询（多表聚合）
4. 需要全文搜索功能
5. 需要 JSON 字段高级查询

### 涉及文件

**修改文件**：
- `apps/server/prisma/schema.prisma` - 添加索引声明
- `docs/change-log.md` - 变更记录
- `docs/current-task.md` - 任务状态

### 注意事项

- 数据库结构已通过 `prisma db push` 同步
- Prisma Client 生成因开发服务器运行中的文件锁定而失败
- **需要手动操作**：停止开发服务器后运行 `pnpm prisma:generate`

---

## 已完成任务：查询性能优化

### 目标
系统性优化现有模块的查询性能，重点解决全量查询+内存分页、内存排序、N+1 查询等问题。

### 修复内容

#### 1. students.ts GET / - 数据库级分页和排序
- **问题**: 全量查询所有学生后在内存中排序，再手动 slice 分页
- **修复**:
  - 使用 Prisma 的 `skip`/`take` 实现数据库级分页
  - 使用 `orderBy` 实现数据库级排序
  - 移除"主教练优先"的特殊排序（简化为统一的入学年份排序）
- **效果**: 内存占用降低 95%+，查询效率大幅提升

#### 2. students.ts GET /rankings - 数据库级排序 + 批量查询
- **问题**:
  - 全量查询后在内存中按 rating 排序
  - `include { contestResults: { take: 1 } }` 产生 N+1 查询
- **修复**:
  - 使用 `orderBy: { rating: 'desc' }` 数据库级排序
  - 使用 `groupBy` 批量获取最近成绩时间点
  - 批量查询最近成绩的 ratingChange
- **效果**: 查询次数从 N+1 降至 3 次

#### 3. teams.ts GET / - 批量加载关联数据
- **问题**: 每个团队 3-4 次额外查询（owner、count、getUserName）
- **修复**:
  - 在初始查询中 `include` 成员信息
  - 批量收集所有 owner ID
  - 批量查询教师和学生姓名
  - 在内存中组装结果
- **效果**: 10 个团队从 40 次查询降至 3 次查询

#### 4. teams.ts GET /school/:schoolId - 批量加载
- **问题**: 每个团队 2 次额外查询（owner + getUserName）
- **修复**: 与 GET / 相同的批量加载模式
- **效果**: 查询次数从 2N+1 降至 3 次

#### 5. teams.ts GET /student/:studentId - 批量加载
- **问题**: 循环中查询 owner 和 getUserName
- **修复**: 在初始查询中 include owner 成员，批量查询姓名
- **效果**: 查询次数从 2N+1 降至 3 次

#### 6. schools.ts GET / - 批量加载负责人
- **问题**: 每个学校额外查询一次负责人信息
- **修复**:
  - 收集所有 principalTeacherId
  - 批量查询所有负责人
  - 在内存中组装结果
- **效果**: 20 个学校从 21 次查询降至 2 次查询

### 涉及文件

**修改文件**：
- `apps/server/src/routes/students.ts` - GET / 和 GET /rankings 性能优化
- `apps/server/src/routes/teams.ts` - GET /、GET /school/:schoolId、GET /student/:studentId 性能优化
- `apps/server/src/routes/schools.ts` - GET / 性能优化
- `docs/current-task.md` - 任务状态
- `docs/change-log.md` - 变更记录

---

## 已完成任务：数据一致性与事务安全修复

### 目标
系统性修复关键创建/修改流程的数据一致性问题，确保多步写入操作的原子性，修复默认密码安全隐患。

### 修复内容

#### 1. 学校创建添加事务保护
- **问题**: 4 步操作（User → Teacher → School → Teacher.schoolId）缺少事务保护
- **修复**: 使用 `prisma.$transaction` 包裹所有操作
- **位置**: `apps/server/src/routes/schools.ts`

#### 2. 学校负责人创建添加事务保护
- **问题**: 3 步操作（User → Teacher → School.currentPrincipalTeacherId）缺少事务保护
- **修复**: 使用 `prisma.$transaction` 包裹所有操作
- **位置**: `apps/server/src/routes/schools.ts`

#### 3. 学生创建添加事务保护 + 密码修复
- **问题**:
  - 2 步操作（User → Student）缺少事务保护
  - 使用 `'default'` 作为密码哈希（严重安全问题）
- **修复**:
  - 使用 `prisma.$transaction` 包裹所有操作
  - 使用 `generateTempPassword()` 生成安全随机临时密码
  - 使用 `hashPassword()` 生成正确的 bcrypt 哈希
- **位置**: `apps/server/src/routes/students.ts`

#### 4. 学生更新添加事务保护
- **问题**: 2 步操作（User 更新 → Student 更新）缺少事务保护
- **修复**: 使用 `prisma.$transaction` 包裹所有操作
- **位置**: `apps/server/src/routes/students.ts`

### 涉及文件

**新建文件**：
- `apps/server/src/utils/password.ts` - 密码工具函数（generateTempPassword, hashPassword, verifyPassword）

**修改文件**：
- `apps/server/src/routes/schools.ts` - 学校创建、负责人创建添加事务
- `apps/server/src/routes/students.ts` - 学生创建、更新添加事务 + 密码修复
- `docs/current-task.md` - 任务状态
- `docs/change-log.md` - 变更记录

---

## 已完成任务：认证链路与账号安全修复

### 目标
系统性修复认证模块的安全隐患，包括敏感信息泄露、JWT Secret 硬编码、认证逻辑重复、缺少速率限制等。

### 修复内容

#### 1. 删除敏感日志输出
- **问题**: `auth.ts` 第 49 行 `console.log` 输出完整的 `req.body`，包含密码明文
- **修复**: 删除该行日志
- **位置**: `apps/server/src/routes/auth.ts`

#### 2. 统一 JWT Secret 获取
- **问题**: 6 处使用不安全的默认值 `'dev-secret-key-12345'`
- **修复**: 创建 `getJwtSecret()` 工具函数
  - 生产环境：未配置 `JWT_SECRET` 时抛出错误
  - 开发环境：使用默认值但输出警告
- **新建文件**: `apps/server/src/lib/jwtSecret.ts`
- **修改文件**: `middleware/auth.ts`, `routes/auth.ts`

#### 3. 统一认证逻辑
- **问题**: 多个接口手动解析 token，而非使用 `authenticate` 中间件
- **修复**: 统一使用 `authenticate` 中间件，从 `req.user` 获取用户信息
- **涉及接口**:
  - `GET /me`
  - `PUT /profile`
  - `POST /avatar`
  - `PUT /password`

#### 4. 收紧注册接口
- **问题**: 注册接口允许前端传入任意 `role`
- **修复**: 限制只能注册学生角色，其他角色返回 400 错误
- **位置**: `apps/server/src/routes/auth.ts`

#### 5. 添加速率限制
- **安装依赖**: `express-rate-limit`
- **新建文件**: `apps/server/src/middleware/rateLimiter.ts`
- **限制配置**:
  - 登录：5 次/分钟
  - 注册：3 次/小时
  - 密码修改：3 次/小时
  - 密码重置：3 次/小时

### 涉及文件

**新建文件**：
- `apps/server/src/lib/jwtSecret.ts` - JWT Secret 统一获取
- `apps/server/src/middleware/rateLimiter.ts` - 速率限制中间件

**修改文件**：
- `apps/server/src/middleware/auth.ts` - 使用 getJwtSecret()
- `apps/server/src/routes/auth.ts` - 安全修复
- `apps/server/src/routes/users.ts` - 密码重置添加速率限制
- `apps/server/package.json` - 添加 express-rate-limit 依赖
- `docs/KNOWN_ISSUES.md` - 更新 JWT Secret 问题状态

### 未处理事项

- 前端 Token 存储（localStorage 风险）：记录为已知问题 P1，需前后端协同改造
- 静态文件权限：记录为已知问题 P2

---

## 待处理事项

### 高优先级（P0）
- [x] ~~遗留直连 API 调用迁移到 apiClient~~ ✅ 已完成 (2026-03-23)
- [x] ~~后端安全与并发止损重构~~ ✅ 已完成 (2026-03-23)
- [x] ~~资源级权限控制修复~~ ✅ 已完成 (2026-03-23)
- [x] ~~认证链路与账号安全修复~~ ✅ 已完成 (2026-03-23)
- [x] ~~数据一致性与事务安全修复~~ ✅ 已完成 (2026-03-23)

### 中优先级（P1）
- [ ] Rating 计算功能实现
- [ ] 榜单导入匹配功能
- [ ] 题单执行闭环功能
- [ ] 测试用例编写
- [ ] 前端 Token 存储安全改造（使用 httpOnly Cookie）

### 低优先级（P2）
- [ ] 家长端功能实现
- [ ] 成绩中心功能
- [ ] 资源管理功能
- [ ] 学生成长报告功能
- [ ] 静态文件权限控制
