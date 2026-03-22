# 变更日志

## 2026-03-23

### 文档一致性修复

**目标**：检查并修复过时的项目文档，确保文档与代码一致。

**修复内容**：

1. **DATABASE_MODELS.md**：
   - 添加缺失的 `Admin` 模型文档
   - 删除不存在的 `StudentTeam`、`TeamAdmin` 模型描述
   - 添加 `TeamMember` 模型文档（实际使用的团队成员表）
   - 修正 `Team` 模型（移除不存在的 `ownerId` 字段）
   - 修正 `Contest` 模型（移除不存在的 `createdBy` 字段）
   - 更新 ER 图

2. **COMPONENTS.md**：
   - 添加缺失的 17 个组件文档
   - 添加 `team/` 目录组件（10个）
   - 添加 `profile/` 目录组件（2个）
   - 添加 `ui/` 目录组件（Empty, ConfirmModal）
   - 添加根目录组件（Providers, Loading, ContestDetail）
   - 移除 UserManagement "未使用"的错误标注

3. **API_REFERENCE.md**：
   - 移除不存在的子文档引用（auth.md, users.md 等）
   - 添加"文档待完善"警告
   - 补充缺失的 API：
     - 认证接口（/me, /profile, /avatar, /password）
     - 用户管理接口（/:id/logs, /platform-admin）
     - 学校管理接口（principal-logs 等）
     - 团队管理接口（约 25 个端点）
     - 比赛管理接口（题目、资源、成绩导入）
     - 任务进度接口（3 个端点）
     - 里程碑接口（5 个端点）
     - 统计接口（3 个端点）

4. **README.md**：
   - 移除不存在的文档引用
   - 添加文档状态表
   - 更新快速导航

**涉及文件**：
- `docs/database/DATABASE_MODELS.md`
- `docs/components/COMPONENTS.md`
- `docs/api/API_REFERENCE.md`
- `docs/README.md`

---

### CLAUDE.md 文档路径修正

**问题**：CLAUDE.md 中引用的文档路径与实际文件位置不一致，部分引用的文档不存在。

**修复内容**：
1. 修正文档路径：
   - `@docs/DATABASE_MODELS.md` → `@docs/database/DATABASE_MODELS.md`
   - `@docs/API_REFERENCE.md` → `@docs/api/API_REFERENCE.md`
   - `@docs/COMPONENTS.md` → `@docs/components/COMPONENTS.md`
2. 移除不存在的文档引用：
   - `@docs/ENVIRONMENT.md`
   - `@docs/DATA_FLOW.md`
   - `@docs/DECISIONS.md`
3. 调整同步更新文档的指引，使用实际存在的文档

**涉及文件**：
- `CLAUDE.md`

---

### 头像上传功能修复

**问题**：`ProfileEditor.tsx` 调用了 `apiClient.postFile()` 方法，但 `apiClient` 类未定义该方法，导致头像上传静默失败。

**修复**：在 `apiClient` 类中添加 `postFile` 方法，复用现有 FormData 处理逻辑。

**涉及文件**：
- `apps/web/src/lib/apiClient.ts`

---

### 后端安全与并发止损重构（第三轮）

**目标**：针对团队模块进行权限边界检查和写操作原子性修复。

**修复的权限边界问题**：
1. `/api/teams?view=mine` 移除未使用的 `teacherId`/`studentId` query 参数，明确只信任 JWT 身份

**修复的并发风险**：
1. **创建团队**：count 检查移入事务，防止并发创建超限
2. **团队转移**：所有检查和更新在一个事务中完成，防止并发转移导致双所有者
3. **批准申请**：使用 `updateMany` 条件更新 + `upsert` 保证幂等性，防止双击重复审批
4. **邀请成员**：添加 P2002 唯一约束异常处理，友好的错误提示

**关键改动**：
- 导入 `PrismaClientKnownRequestError` 用于捕获唯一约束冲突
- 创建团队：count 检查从事务外移入事务内
- 团队转移：重构为单一事务，包含所有权限验证和更新
- 批准申请：使用 `updateMany({ where: { status: 'pending' } })` 实现幂等
- 邀请成员：catch P2002 返回 409 Conflict

**涉及文件**：
- `apps/server/src/routes/teams.ts`

**风险评估**：
| 风险项 | 修复前 | 修复后 |
|--------|--------|--------|
| view=mine 越权 | 低（代码已正确） | 无 |
| 创建团队超限 | 高 | 低 |
| 团队转移竞态 | 高 | 低 |
| 批准申请重复 | 中 | 低 |
| 异常信息泄露 | 中 | 低 |

---

### 遗留直连 API 调用迁移（第二批 - 完成）

**目标**：将所有页面和组件中的硬编码 `http://localhost:3001` 迁移到 `apiClient`。

**修改范围**：

1. **教师端页面**（3个文件）：
   - `app/teacher/contests/page.tsx` - 比赛管理
   - `app/teacher/classes/page.tsx` - 班级管理（已废弃，重定向到团队）
   - `app/teacher/task-lists/page.tsx` - 题单管理（5处硬编码）

2. **教师端学校组件**（5个文件）：
   - `app/teacher/school/components/HomeTab.tsx` - 4处
   - `app/teacher/school/components/TeachersTab.tsx` - 6处
   - `app/teacher/school/components/StudentsTab.tsx` - 多处
   - `app/teacher/school/components/RankingsTab.tsx` - 1处
   - `app/teacher/school/components/EditSchoolModal.tsx` - 1处
   - `app/teacher/school/page.tsx` - 2处

3. **学生端页面**（5个文件）：
   - `app/student/school/page.tsx` - 学校信息
   - `app/student/rating/page.tsx` - Rating 历史
   - `app/student/scores/page.tsx` - 成绩记录
   - `app/student/task-lists/page.tsx` - 题单进度（5处）
   - `app/student/team/browse/page.tsx` - 浏览团队（2处）

4. **公共组件**（3个文件）：
   - `components/profile/ProfileEditor.tsx` - 个人信息编辑（2处）
   - `components/profile/PasswordEditor.tsx` - 密码修改（1处）
   - `components/business/UserManagement.tsx` - 用户管理组件（3处）

5. **个人主页**（2个文件）：
   - `app/profile/student/[id]/page.tsx` - 学生个人主页
   - `app/profile/teacher/[id]/page.tsx` - 教师个人主页

6. **超管端页面**（6个文件）：
   - `app/admin/schools/[id]/page.tsx` - 学校详情（3处）
   - `app/admin/schools/[id]/edit/page.tsx` - 编辑学校（5处）
   - `app/admin/schools/new/page.tsx` - 创建学校（1处）
   - `app/admin/users/page.tsx` - 账号管理（3处）
   - `app/admin/users/[id]/page.tsx` - 用户详情（1处）
   - `app/admin/users/new-platform-admin/page.tsx` - 创建平台管理员（1处）

7. **平台管理员页面**（2个文件）：
   - `app/platform-admin/users/page.tsx` - 账号管理（3处）
   - `app/platform-admin/page.tsx` - 控制台首页（1处）

**修改统计**：
- 共修改 **26 个文件**
- 替换 **约 50 处** 硬编码 URL
- 统一使用 `apiClient` 进行 API 调用

**验证结果**：
- 运行 `grep -r "http://localhost:3001" apps/web/src` 仅剩 2 个文件：
  - `config/env.ts` - 配置文件中的默认值（正确）
  - `lib/apiClient.ts` - 使用 ENV.API_URL（正确）

---

### 遗留直连 API 调用迁移（第一批）

**目标**：将核心文件的硬编码 `http://localhost:3001` 迁移到统一配置。

**修改文件**：

1. `apps/web/src/components/AuthProvider.tsx`
   - `/api/auth/me` 改用 `ENV.API_URL`
   - `/api/auth/login` 改用 `ENV.API_URL`

2. `apps/web/src/hooks/data/useTeamDetail.ts`
   - `/api/teams/:id` 改用 `apiClient`
   - `/api/teams/:id/join-requests` 改用 `apiClient`

3. `apps/web/src/app/student/team/page.tsx`
   - `/api/teams/student/:id` 改用 `apiClient`
   - `/api/teams/invitations/:id/accept` 改用 `apiClient`
   - `/api/teams/invitations/:id/reject` 改用 `apiClient`
   - `/api/teams` (POST) 改用 `apiClient`

**sessionKey 机制验证**：
- ✅ AuthProvider.tsx - 正确计算并导出 sessionKey
- ✅ ProtectedRoute.tsx - 使用 sessionKey 作为 key 强制重新挂载
- ✅ useFetch.ts - 支持 sessionKey 依赖和 AbortController
- ✅ useList.ts - 正确传递 sessionKey
- ✅ useTeams.ts - 正确传递 sessionKey
- ✅ useStudents.ts - 正确传递 sessionKey
- ✅ useTeamDetail.ts - 支持 sessionKey 和请求取消
- ✅ teacher/teams/page.tsx - 传递 sessionKey 给 useTeams
- ✅ teacher/students/page.tsx - 传递 sessionKey 给 useStudents
- ✅ student/team/page.tsx - 传递 sessionKey 给 useTeams

---

### 文档体系"接管视角"增强

**目标**：建立完善的文档体系，使任何人都能快速理解并接手项目。

**新增文档**：
1. `docs/SYSTEM_MAP.md` - 系统全景图
   - 项目结构、角色与入口
   - 前端页面路由完整列表
   - 后端 API 路由完整列表
   - 数据库模型关系
   - 前端组件架构
   - 快速定位指南

2. `docs/RUNBOOK.md` - 本地开发运维手册
   - 环境要求和首次启动
   - 测试账号列表
   - 常用命令速查
   - 数据库操作指南
   - 环境变量配置
   - 常见问题排查

3. `docs/AUTH_AND_PERMISSION.md` - 认证与权限系统
   - 角色体系详解
   - 认证流程（JWT）
   - 权限控制机制
   - 各角色权限详解
   - 数据隔离机制
   - 权限检查速查表

4. `docs/MODULE_INDEX.md` - 业务模块索引
   - 模块总览与状态
   - 各模块功能说明
   - 前后端代码位置
   - API 列表
   - 模块依赖关系
   - 新增模块开发指南

5. `docs/KNOWN_ISSUES.md` - 已知问题与技术债务
   - 架构层面问题
   - 功能层面问题
   - 安全层面问题
   - 性能层面问题
   - 代码质量问题
   - 优先级说明

6. `docs/HANDOVER.md` - 项目交接指南
   - 30 分钟快速上手
   - 核心概念速记
   - 关键文件定位
   - 常见任务示例
   - 开发规范
   - 项目状态

**更新文档**：
- `docs/README.md` - 更新文档目录结构
- `docs/PROJECT_OVERVIEW.md` - 添加相关文档链接

---

### 统一配置层建立

**目标**：移除业务代码中的硬编码地址，建立统一配置层。

**新增文件**：
1. `apps/web/src/config/env.ts` - 编译时环境配置
2. `apps/web/src/config/runtime.ts` - 运行时配置
3. `apps/web/src/lib/assets.ts` - 资源 URL 辅助函数

**修改内容**：
- 所有 Next.js API Routes（24个）改用 `ENV.API_URL`
- 所有资源 URL（9个组件）改用 `getAssetUrl()`
- 配置文件（5个）改用 `ENV.API_URL`

**遗留问题**：
- 部分页面仍直接使用 `fetch('http://localhost:3001/api/...')`
- 需后续迁移到 `apiClient` 统一调用

---

## 2026-03-22

### 账号切换后的私有数据隔离重构（sessionKey 机制）

**问题描述**：之前虽然修复了团队列表显示错误账号数据的问题，但根本原因在于**前端数据获取没有与登录身份强绑定**。切换账号后，页面可能显示上一个账号的数据，或者旧请求可能覆盖新数据。

**解决方案**：引入 `sessionKey` 机制，基于当前登录身份生成唯一标识符，用于：
- 标识私有数据的归属
- 触发数据重新获取
- 清理旧数据
- 取消旧请求

**sessionKey 生成逻辑**：
```typescript
const sessionKey = `${role}:${userId}:${teacherId || studentId || adminId}`
// 例如: "teacher:xxx-xxx:e914dff8..." 或 "student:xxx-xxx:e2976392..."
```

**修改内容**：

1. **AuthProvider.tsx** - 新增 sessionKey 计算，导出给组件使用
2. **useFetch.ts** - 支持 sessionKey 依赖，添加 AbortController 请求取消机制
3. **useList.ts** - 传递 sessionKey 到 useFetch
4. **useTeams.ts** - 接收并传递 sessionKey
5. **useStudents.ts** - 接收并传递 sessionKey
6. **useTeamDetail.ts** - 支持 sessionKey 和请求取消
7. **teacher/teams/page.tsx** - 使用 sessionKey 调用 useTeams
8. **student/team/page.tsx** - 使用 sessionKey 调用 useTeams
9. **teacher/students/page.tsx** - 使用 sessionKey 调用 useStudents
10. **TeamDetailPage.tsx** - 使用 sessionKey 调用 useTeamDetail
11. **teams.ts (后端)** - 禁止 query 参数覆盖 JWT token 中的身份
12. **ProtectedRoute.tsx** - 使用 sessionKey 作为 key，强制组件重新挂载

**核心改动**：
- `useFetch` 在 sessionKey 变化时清空数据并取消旧请求
- `ProtectedRoute` 使用 `key={sessionKey}` 确保账号切换时组件完全重新挂载
- 后端只信任 JWT token 中的身份，忽略 query 参数

**涉及文件**：
- `apps/web/src/components/AuthProvider.tsx`
- `apps/web/src/components/ProtectedRoute.tsx`
- `apps/web/src/components/team/TeamDetailPage.tsx`
- `apps/web/src/hooks/data/useFetch.ts`
- `apps/web/src/hooks/data/useList.ts`
- `apps/web/src/hooks/data/useTeams.ts`
- `apps/web/src/hooks/data/useStudents.ts`
- `apps/web/src/hooks/data/useTeamDetail.ts`
- `apps/web/src/app/teacher/teams/page.tsx`
- `apps/web/src/app/teacher/students/page.tsx`
- `apps/web/src/app/student/team/page.tsx`
- `apps/server/src/routes/teams.ts`

---

### 严重 Bug 修复：团队列表显示错误账号数据

**问题描述**：用户切换账号后，团队列表有时显示其他账号的团队数据，刷新几次才会正确显示，然后又变回去。

**根本原因**：
1. `clearAuth()` 函数漏删 `studentId`，导致退出登录时学生的 ID 没有被清除
2. 后端 `/api/teams` 只从 query 参数获取 studentId，完全忽略了 JWT token 中的 studentId
3. 学生端团队页面使用 localStorage 获取 studentId，而不是使用 AuthProvider 中的用户状态
4. `useTeams` 把 `null` 转换成 `undefined`，导致 `useList` 发起了无参数请求
5. `useFetch` 和 `useList` hooks 在参数未准备好时仍然会发起请求

**修复内容**：
1. `auth.ts` - 在 `clearAuth()` 中添加 `localStorage.removeItem(STUDENT_ID_KEY)`
2. `teams.ts` (后端) - 优先使用 JWT token 中的 studentId/teacherId，而不是只依赖 query 参数
3. `student/team/page.tsx` - 使用 `useAuth()` 获取用户信息，而不是直接从 localStorage 读取
4. `teacher/teams/page.tsx` - 同上修复
5. `useFetch.ts` - 支持 `url` 为 `null`，当 `url` 是 `null` 时不发起请求
6. `useList.ts` - 当 `filters` 是 `null`/`undefined`/空对象时，返回 `null` URL
7. `useTeams.ts` - 修复 `filters ?? undefined` 改为直接传 `filters`

**涉及文件**：
- `apps/web/src/lib/auth.ts`
- `apps/server/src/routes/teams.ts`
- `apps/web/src/app/student/team/page.tsx`
- `apps/web/src/app/teacher/teams/page.tsx`
- `apps/web/src/hooks/data/useFetch.ts`
- `apps/web/src/hooks/data/useList.ts`
- `apps/web/src/hooks/data/useTeams.ts`

---

### 个人卡片功能（页面导航版）

**需求**：点击成员头像或姓名，跳转到个人主页查看用户信息

**功能**：
- 页面展示：头像、姓名、用户名、角色（教师/学生）、学校、个人简介
- 入口：团队成员列表、学校学生列表、学校教师列表
- 可见范围：所有登录用户可见
- 导航方式：独立页面（/profile/student/[id] 或 /profile/teacher/[id]）

**改动内容**：

1. **后端 API**（保持不变）：
   - `GET /api/users/:userId/profile?userType=teacher|student` 获取用户公开信息

2. **前端页面**（新实现）：
   - `/profile/student/[id]/page.tsx` - 学生个人主页
   - `/profile/teacher/[id]/page.tsx` - 教师个人主页

3. **代码清理**：
   - 删除 `ProfileCard.tsx` 弹窗组件
   - 删除 `ProfileCardProvider.tsx` 上下文
   - 删除 `profile/index.ts`
   - 移除 `AppShell.tsx` 中的 Provider 包裹

4. **入口更新**：
   - `TeamMemberList.tsx` - 使用 Next.js Link 导航
   - `StudentsTab.tsx` - 使用 router.push 导航
   - `TeachersTab.tsx` - 使用 router.push 导航

**涉及文件**：
- `apps/web/src/app/profile/student/[id]/page.tsx` - 新建
- `apps/web/src/app/profile/teacher/[id]/page.tsx` - 新建
- `apps/web/src/components/profile/` - 删除整个目录
- `apps/web/src/components/AppShell.tsx` - 移除 Provider
- `apps/web/src/components/team/TeamMemberList.tsx` - 使用 Link 导航
- `apps/web/src/components/team/TeamDetailPage.tsx` - 移除 useProfileCard
- `apps/web/src/app/teacher/school/components/StudentsTab.tsx` - 使用 router.push
- `apps/web/src/app/teacher/school/components/TeachersTab.tsx` - 使用 router.push

---

### 个人信息编辑功能

**新增功能**：右上角头像下拉菜单，包含个人信息和账号安全入口

**改动内容**：

1. **后端 API**：
   - 新增 `PUT /api/auth/password` 修改密码接口
   - 验证当前密码、新密码格式校验
   - 上传头像时同步更新 User、Teacher/Student 表（保证团队模块头像一致）

2. **AppShell 头像下拉菜单**：
   - 右上角显示用户头像（无头像则显示用户名首字母）
   - 点击头像显示下拉菜单：个人信息、账号安全、退出登录
   - 根据用户角色跳转到对应页面

3. **公共组件**：
   - `ProfileEditor.tsx` - 个人信息编辑组件（头像、姓名、手机号、邮箱、简介）
   - `PasswordEditor.tsx` - 密码修改组件（当前密码、新密码、确认密码）
   - 支持密码显示/隐藏切换
   - 上传头像后自动刷新全局用户状态（头像在右上角、团队模块同步更新）

4. **AuthProvider 增强**：
   - 新增 `refreshUser()` 方法，用于刷新用户信息
   - 头像修改后自动同步到右上角和团队模块

4. **页面文件**：
   - 学生端：`/student/profile`、`/student/security`
   - 教师端：`/teacher/profile`、`/teacher/security`
   - 管理端：`/admin/profile`、`/admin/security`

**涉及文件**：
- `apps/server/src/routes/auth.ts` - 添加修改密码 API
- `apps/server/src/routes/teams.ts` - getMemberDetails 优先使用 User.avatar
- `apps/web/src/components/AppShell.tsx` - 头像下拉菜单
- `apps/web/src/components/profile/ProfileEditor.tsx` - 新建
- `apps/web/src/components/profile/PasswordEditor.tsx` - 新建
- `apps/web/src/components/profile/index.ts` - 新建
- `apps/web/src/components/team/TeamMemberList.tsx` - 修复所有者头像显示
- `apps/web/src/app/student/profile/page.tsx` - 重构
- `apps/web/src/app/student/security/page.tsx` - 新建
- `apps/web/src/app/teacher/profile/page.tsx` - 新建
- `apps/web/src/app/teacher/security/page.tsx` - 新建
- `apps/web/src/app/admin/profile/page.tsx` - 新建
- `apps/web/src/app/admin/security/page.tsx` - 新建

### 头像同步 Bug 修复

**问题**：团队模块中成员头像与个人信息页面头像不一致

**修复内容**：
1. **后端修复**：`getMemberDetails` 函数优先使用 `User.avatar` 而非 `Teacher.avatar`/`Student.avatar`
2. **前端修复**：`TeamMemberList.tsx` 所有者头像从 `undefined` 改为 `team.owner.avatar`

---

### 团队头像上传功能

**需求**：团队头像上传功能（仅所有者可用）

**改动内容**：

1. **后端修改**：
   - `POST /api/teams/:id/avatar` 权限从 `isAdmin` 改为只有 `isOwner` 可以上传

2. **前端修改**：
   - `TeamHeader` 组件添加头像上传按钮（📷图标）
   - 仅所有者可见上传按钮
   - 上传成功后通过 `onAvatarUpdate` 回调更新显示

**涉及文件**：
- `apps/server/src/routes/teams.ts` - 修改权限检查
- `apps/web/src/components/team/TeamHeader.tsx` - 添加头像上传功能
- `apps/web/src/components/team/TeamDetailPage.tsx` - 添加头像状态管理

---

### 学校模块 Bug 修复

**修复内容**：

1. **TeachersTab - 移除状态列**
   - 删除教师列表的"状态"列（正常/禁用）
   - 移除未使用的 Badge 组件导入

2. **RankingsTab - 添加分页**
   - 添加客户端分页功能
   - 每页默认 20 条，支持切换 10/20/50/100
   - 翻页时保持正确的排名序号

3. **TeamsTab - 添加分页**
   - 添加分页状态，传入 useTeams hook
   - 每页默认 20 条，支持切换

4. **年级分布缺失问题**
   - 根因：学生年级为"未设置"或"未入学"时，未归类到"其他"
   - 修复：后端 API 将"未设置"和"未入学"也转换为"其他"

**涉及文件**：
- `apps/web/src/app/teacher/school/components/TeachersTab.tsx`
- `apps/web/src/app/teacher/school/components/RankingsTab.tsx`
- `apps/web/src/app/teacher/school/components/TeamsTab.tsx`
- `apps/server/src/routes/schools.ts`

---

### 团队模块彻底统一 - 移除教师/学生端功能区分

**核心原则**：
- 只有一个角色：**TeamMember**
- 所有功能差异只基于**权限(permission)**控制
- 前端页面层不允许出现 userType 条件判断

**改动内容**：

1. **TeamDetailPage.tsx 修改**：
   - 移除 `showApplyButton` 中的 `userType === 'student'` 条件
   - 移除获取邀请数量时的 `userType === 'teacher'` 条件
   - 移除所有"仅教师端"/"仅学生端"注释

2. **最终效果**：
   - 非成员访问公有团队 → 两端都显示"申请加入"按钮
   - 管理员 → 两端都能看到邀请列表、申请列表
   - 所有者 → 两端都能管理团队

**涉及文件**：
- `apps/web/src/components/team/TeamDetailPage.tsx`

---

### 团队模块代码统一化

**核心改动**：教师端和学生端团队详情页合并为同一套代码

**改动内容**：

1. **创建 TeamDetailPage 公共组件**：
   - 文件：`components/team/TeamDetailPage.tsx`
   - 接受 `userType` 参数区分教师端和学生端
   - 功能差异通过权限控制，不由 userType 控制

2. **简化页面文件**：
   - 教师端：`app/teacher/teams/[id]/page.tsx` 从 ~487 行简化为 ~17 行
   - 学生端：`app/student/team/[id]/page.tsx` 从 ~276 行简化为 ~17 行
   - 两者都使用 TeamDetailPage 组件

3. **申请加入按钮位置调整**：
   - 从列表页移到详情页内部
   - 在 TeamHeader 中显示，仅非成员 + 公有团队时可见
   - 移除 TeamCard 和 TeamListPage 中的申请按钮相关代码

4. **类型更新**：
   - TeamDetail 接口添加 `requestStatus` 字段
   - TeamHeader 接口添加 `onApplyJoin`、`applyStatus`、`applying` 字段

**涉及文件**：
- `apps/web/src/components/team/TeamDetailPage.tsx` - 新建
- `apps/web/src/components/team/TeamHeader.tsx` - 添加申请按钮
- `apps/web/src/components/team/TeamCard.tsx` - 移除申请按钮
- `apps/web/src/components/team/TeamListPage.tsx` - 移除申请相关 props
- `apps/web/src/components/team/index.ts` - 导出新组件
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 简化为组件调用
- `apps/web/src/app/student/team/[id]/page.tsx` - 简化为组件调用
- `apps/web/src/app/student/team/page.tsx` - 移除申请相关代码
- `apps/web/src/hooks/data/useTeamDetail.ts` - 添加 requestStatus 字段

---

### 团队模块界面测试与修复

**测试结果**：发现并修复以下问题

**问题1：删除团队功能**
- 状态：✅ 已移除
- 说明：功能不需要，移除 TeamHeader 和教师端详情页中的删除按钮和相关代码

**问题2：管理员可以操作其他管理员**
- 状态：✅ 已修复
- 原因：`canRemove = permission.canRemove` 对管理员也是 true
- 修复：添加判断 `(permission.isOwner || member.role === 'member')`
- 结果：所有者可以操作管理员，管理员只能操作普通成员

**问题3：学生端编辑按钮无效**
- 状态：✅ 已修复
- 原因：`handleEditTeam` 是空函数，没有弹窗
- 修复：添加 TeamEditModal 弹窗和相关状态

**问题4：学生端成员 Tab 重复标题**
- 状态：✅ 已修复
- 原因：页面和 TeamMemberList 组件都有"团队成员"标题
- 修复：移除页面中多余的 h2 标题

**问题5：全部团队Tab缺少申请加入按钮**
- 状态：✅ 已修复
- 原因：TeamListPage 没有传递申请相关的 props
- 修复：
  - TeamListPage 添加 `onApplyJoin` 和 `applyStatusMap` props
  - 在全部团队Tab下传递 `showApplyButton`、`applyStatus`、`onApply` 给 TeamCard
  - 学生端团队列表页传递申请相关 props

**问题6：成员列表用角色标签区分不够清晰**
- 状态：✅ 已修复
- 原因：用户要求用分组标题区分所有者/管理员/成员
- 修复：TeamMemberList 重构为三个分组显示，移除角色标签

**涉及文件**：
- `apps/web/src/components/team/TeamListPage.tsx` - 添加申请按钮支持
- `apps/web/src/components/team/TeamMemberList.tsx` - 分组显示成员
- `apps/web/src/app/student/team/page.tsx` - 传递申请相关 props

---

## 2026-03-21 (续)

### 团队模块界面修复

**核心改动**：
1. 移除删除团队功能
2. 修复管理员权限问题：管理员不能操作其他管理员

**改动内容**：

1. **移除删除团队功能**：
   - `TeamHeader`：移除 `onDeleteTeam` 和 `canDelete` 属性
   - 教师端详情页：移除 `handleDeleteTeam` 函数和相关代码

2. **修复管理员权限问题**：
   - `TeamMemberList`：修改 `canRemove` 和 `canSetAdmin` 的逻辑
   - 管理员现在只能操作普通成员，不能操作其他管理员
   - 所有者仍然可以操作所有成员

3. **移除公告 Tab**：
   - 公告已在 TeamHeader 中显示，不需要单独的 Tab
   - 默认 Tab 改为"成员"

**涉及文件**：
- `apps/web/src/components/team/TeamHeader.tsx` - 移除删除团队支持
- `apps/web/src/components/team/TeamMemberList.tsx` - 修复管理员权限
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 移除删除功能、移除公告Tab
- `apps/web/src/app/student/team/[id]/page.tsx` - 移除公告Tab

---

### 教师端团队详情页重构 - 使用公共组件

**核心改动**：教师端团队详情页从 ~1800 行重构为 ~380 行，复用公共组件

**改动内容**：

1. **扩展公共组件**：
   - `TeamHeader`：添加 `onDeleteTeam` 和 `canDelete` 属性，支持删除团队
   - `TeamMemberList`：添加邀请成员、邀请列表、申请管理等功能

2. **抽取管理弹窗组件**（放在 `components/team/` 目录）：
   - `TeamInviteModal.tsx` - 邀请成员弹窗
   - `TeamInviteListModal.tsx` - 邀请列表弹窗
   - `TeamTransferModal.tsx` - 转移所有者弹窗
   - `TeamEditModal.tsx` - 编辑团队弹窗

3. **重构教师端详情页**：
   - 使用 `TeamHeader` 组件替代头部自定义实现
   - 使用 `TeamMemberList` 组件替代成员管理自定义实现
   - 引用抽取的弹窗组件
   - 保留 Tab 导航和内容区域

**涉及文件**：
- `apps/web/src/components/team/TeamHeader.tsx` - 扩展删除团队支持
- `apps/web/src/components/team/TeamMemberList.tsx` - 扩展邀请和申请管理
- `apps/web/src/components/team/TeamInviteModal.tsx` - 新建
- `apps/web/src/components/team/TeamInviteListModal.tsx` - 新建
- `apps/web/src/components/team/TeamTransferModal.tsx` - 新建
- `apps/web/src/components/team/TeamEditModal.tsx` - 新建
- `apps/web/src/components/team/index.ts` - 导出新组件
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 重构使用公共组件

---

### 团队模块前端统一化 - 类型标签位置调整和用户名显示

**核心改动**：
1. 类型标签（教师/学生）移至名字旁边显示
2. 名字后面用括号显示用户名

**改动内容**：

1. **类型定义更新**：
   - `TeamMember` 接口添加 `username` 字段
   - `TeamAdmin` 接口添加 `username` 字段
   - `TeamDetail.owner` 添加 `username` 字段
   - `JoinRequest.student` 添加 `username` 字段
   - 移除 `rating`、`title`、`enrollmentYear` 等独有属性

2. **后端 API 更新**：
   - `getMemberDetails` 函数返回 `username` 字段
   - `available-members` API 返回 `username` 字段

3. **前端显示格式**：
   - 所有者显示：`张三 (zhangsan) [教师]`
   - 管理员显示：`李四 (lisi) [学生]`
   - 成员显示：`王五 (wangwu) [学生]`
   - 邀请列表显示：`赵六 (zhaoliu) [教师]`
   - 申请列表显示：`钱七 (qianqi) [学生]`

**涉及文件**：
- `apps/web/src/hooks/data/useTeamDetail.ts` - 类型定义更新
- `apps/web/src/components/team/TeamMemberList.tsx` - 显示格式更新
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 页面显示更新
- `apps/server/src/routes/teams.ts` - API 返回 username

---

### 团队模块前端统一化 - 移除教师/学生独有属性显示

**核心原则**：除成员列表名字旁的标签外，不允许显示任何教师/学生独有的属性

**教师与学生数据结构**：
- 教师独有：title（职称）、email、phone、bio
- 学生独有：rating、enrollmentYear、targetContest 等
- 公有：id、name、avatar、joinedAt

**改动内容**：

1. **移除所有 rating 显示**（学生独有）：
   - TeamMemberList 组件移除 rating 显示
   - 成员列表移除 rating 显示
   - 管理员列表移除 rating 显示
   - 申请列表移除 rating 显示
   - 邀请弹窗移除 rating 显示
   - 邀请列表移除 rating 显示

2. **移除所有 title 显示**（教师独有）：
   - 所有者信息移除 title 显示
   - 管理员列表移除 title 显示
   - 成员列表移除 title 显示
   - 邀请弹窗移除 title 显示
   - 邀请列表移除 title 显示

3. **成员信息只显示公有属性**：
   - 名字
   - 头像
   - 加入时间（如果有）
   - 类型标签（教师/学生）

**涉及文件**：
- `apps/web/src/components/team/TeamMemberList.tsx`
- `apps/web/src/app/teacher/teams/[id]/page.tsx`

---

### 团队模块前端统一化 - 彻底移除教师/学生区分

**核心原则**：除成员列表名字旁的标签外，任何地方都不得区分学生与教师，只能以 TeamMember 进行处理

**改动内容**：

1. **状态变量统一**：
   - `availableStudents` + `availableTeachers` → `availableMembers`
   - `selectedStudents` + `selectedTeachers` → `selectedMembers`（存储 `{id, memberType}` 对象）
   - `transferType` + `selectedTransferTarget` → `selectedTransferTarget`（存储 `{id, memberType}` 对象）

2. **头像颜色统一**：
   - 所有成员头像背景色统一为主题色 `var(--primary)`
   - 不再根据教师/学生使用不同颜色

3. **Rating 显示统一**：
   - 所有成员（教师和学生）都显示 Rating（如果有的话）
   - 不再只对学生显示 Rating

4. **邀请成员弹窗统一**：
   - 将分开的"教师"和"学生"选择区域合并为统一的成员列表
   - 成员名字旁用标签区分类型（教师/学生）
   - API 调用使用统一的 `members: Array<{id, type}>` 格式

5. **成员列表显示统一**：
   - 教师端详情页：将"教师成员"和"学生成员"两个区域合并为统一的"成员"列表
   - TeamMemberList 组件：将教师和学生合并为统一列表显示
   - 移除学生名字可点击跳转的区分（统一显示纯文本）

6. **邀请列表弹窗统一**：
   - 头像颜色统一
   - 显示格式统一（都显示 Rating 和职称，如果有的话）

**涉及文件**：
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 大规模重构，统一状态和显示
- `apps/web/src/components/team/TeamMemberList.tsx` - Rating 显示统一

---

### 团队模块类型定义修复

**改动**：修复 `@/types/team` 模块删除后的类型导入问题

**修复内容**：
1. 删除 `apps/web/src/types/team.ts` 文件（该文件导致类型定义重复）
2. 将类型定义整合到各自的 hook 文件中：
   - `useTeamPermission.ts` 定义并导出 `TeamPermission`、`UserType`、`MemberRole`、`TeamForPermission`
   - `useTeamDetail.ts` 定义并导出 `TeamDetail`、`TeamMember`、`TeamAdmin`
3. 更新导入路径：
   - `TeamMemberList.tsx` 从 `@/hooks/useTeamPermission` 和 `@/hooks/data/useTeamDetail` 导入类型
   - `student/team/[id]/page.tsx` 本地定义 `TeamTabType` 类型
   - `components/team/index.ts` 更新类型重新导出路径
4. 修复类型兼容性问题：
   - `TeamForPermission.owner.type` 改为 `string` 以兼容 `TeamDetail` 的类型定义
   - `useTeams` 的 `filters` 参数正确处理 `null` 值

**涉及文件**：
- `apps/web/src/types/team.ts` - 删除
- `apps/web/src/hooks/useTeamPermission.ts` - 类型定义内置化
- `apps/web/src/hooks/data/useTeams.ts` - 修复 null 参数处理
- `apps/web/src/components/team/TeamMemberList.tsx` - 更新导入
- `apps/web/src/components/team/index.ts` - 更新导出
- `apps/web/src/app/student/team/[id]/page.tsx` - 本地定义类型

**注意**：教师端团队详情页保持独立实现，作为标准版本。学生端使用公共组件。

---

### 团队模块代码重构 - 统一数据模型和权限逻辑

**核心改动**：清理数据库旧表，创建公共组件和 hook，统一团队权限判断逻辑

**1. 数据库旧表清理**：
- 删除 `StudentTeam`、`TeacherTeam`、`TeamAdmin` 模型（后端已完全使用 TeamMember）
- 删除 Team 模型中的 `ownerId`、`ownerType`、旧关联字段
- 所有者信息现在通过 TeamMember 表 `role='owner'` 查询

**2. 新增公共 hook**：
- `useTeamPermission` - 统一权限判断逻辑，支持教师端和学生端
  - 返回 `isOwner`、`isAdmin`、`isMember`、`role` 等权限标识
  - 返回 `canEdit`、`canInvite`、`canRemove`、`canTransfer`、`canDissolve` 操作权限
- `useTeamDetail` - 统一团队详情数据获取
  - 自动获取团队信息
  - 支持获取加入申请列表

**3. 新增公共组件**：
- `TeamHeader` - 团队头部信息展示（头像、名称、描述、公告）
- `TeamMemberList` - 成员列表展示（区分教师成员和学生成员）

**涉及文件**：
- `apps/server/prisma/schema.prisma` - 删除旧表
- `apps/web/src/hooks/useTeamPermission.ts` - 新建权限 hook
- `apps/web/src/hooks/data/useTeamDetail.ts` - 新建数据获取 hook
- `apps/web/src/components/team/TeamHeader.tsx` - 新建头部组件
- `apps/web/src/components/team/TeamMemberList.tsx` - 新建成员列表组件
- `apps/web/src/components/team/index.ts` - 更新导出

---

### 统一学生端和教师端团队列表界面

**改动**：
1. 抽取 `TeamListPage` 公共组件，实现教师端和学生端代码完全复用
2. 后端 `/api/teams` API 支持 `studentId` 参数，学生端和教师端使用同一 API
3. 学生端使用 `useTeams` hook，支持分页功能
4. TeamCard 组件添加 `showApplyButton` 和 `applyStatus` 属性，支持申请按钮
5. 所有"创建者"改为"所有者"

**涉及文件**：
- `apps/web/src/components/team/TeamListPage.tsx` - 新建公共团队列表组件
- `apps/web/src/components/team/TeamCard.tsx` - 添加申请按钮支持
- `apps/web/src/hooks/data/useTeams.ts` - 添加 studentId 支持
- `apps/web/src/lib/auth.ts` - 添加 getStudentId/setStudentId 函数
- `apps/web/src/app/teacher/teams/page.tsx` - 使用 TeamListPage 组件
- `apps/web/src/app/student/team/page.tsx` - 使用 TeamListPage 组件 + useTeams hook
- `apps/server/src/routes/teams.ts` - API 支持 studentId 参数
- `apps/server/prisma/seed.ts` - 术语修改

---

### 成员列表显示优化

**改动**：
1. 成员列表不再区分教师成员和学生成员，统一显示为一个列表
2. 在成员名字后面用标签区分类型（教师/学生）
3. 所有成员使用统一的主题色头像
4. 移除成员 API 支持 `memberType` 查询参数

**涉及文件**：
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 合并教师和学生成员列表
- `apps/server/src/routes/teams.ts` - 移除成员 API 支持 memberType

**API 变更**：
- `DELETE /api/teams/:id/members/:memberId` 支持 `memberType` 查询参数
  - 如果提供 `memberType=student|teacher`，则 `memberId` 被视为用户ID
  - 如果不提供，则 `memberId` 被视为 TeamMember 记录ID（兼容旧逻辑）

---

### 教师申请加入团队功能

**新增功能**：
1. 教师可以主动申请加入公有团队
2. 团队管理员可以审批/拒绝教师的加入请求
3. 团队卡片移除"查看详情"按钮（用户反馈太难看）

**涉及文件**：
- `apps/server/src/routes/teams.ts` - 新增教师申请加入 API、审批/拒绝 API
- `apps/web/src/app/teacher/teams/[id]/page.tsx` - 添加申请加入按钮、待审批教师请求列表
- `apps/web/src/components/team/TeamCard.tsx` - 移除查看详情按钮

**API 变更**：
- `POST /api/teams/:id/teacher-join-request` - 教师申请加入团队
- `POST /api/teams/teacher-join-requests/:memberId/approve` - 批准教师加入
- `POST /api/teams/teacher-join-requests/:memberId/reject` - 拒绝教师加入
- `GET /api/teams/:id` - 返回数据新增 `pendingTeachers` 字段

---

### 团队卡片和列表显示优化

**修复问题**：
1. 团队卡片现在显示所有者名字，而不是创建者类型
2. "全部团队"列表不再显示用户已加入的团队
3. 移除管理员API支持通过用户ID和用户类型进行操作

**涉及文件**：
- `apps/web/src/components/team/TeamCard.tsx` - 添加 ownerName, isPublic 属性
- `apps/web/src/app/teacher/teams/page.tsx` - 传递 ownerName, isPublic；修复前端请求参数
- `apps/server/src/routes/teams.ts` - 全部团队API排除已加入的团队；移除管理员API支持用户ID

**API 变更**：
- `DELETE /api/teams/:id/admins/:adminId` 现在支持 `adminType` 查询参数
  - 如果提供 `adminType`，则 `adminId` 被视为用户ID
  - 如果不提供，则 `adminId` 被视为 TeamMember 记录ID（兼容旧逻辑）

---

## 2026-03-21

### 团队成员数据模型重构（TeamMember 统一模型）

**核心改动**：将分散在多个表（TeamAdmin, StudentTeam, TeacherTeam）的团队成员信息统一到新的 `TeamMember` 模型。

**新数据模型设计**：
```prisma
model TeamMember {
  id        String    @id @default(uuid())
  teamId    String
  userId    String    // 学生ID或教师ID
  userType  String    // 'teacher' | 'student'
  role      String    // 'owner' | 'admin' | 'member'
  status    String    @default("active")  // 'pending' | 'active'
  joinedAt  DateTime  @default(now())
  invitedBy String?   // 邀请人ID
  team      Team      @relation(...)

  @@unique([teamId, userId, userType])
}
```

**主要变更**：

1. **seed.ts 重写**：
   - 创建团队时同时创建所有者的 TeamMember 记录（role='owner'）
   - 使用 TeamMember 表替代 StudentTeam/TeacherTeam/TeamAdmin 表

2. **teams.ts API 完全重写**：
   - 所有成员查询使用 TeamMember 表
   - 新增辅助函数 `getUserName`, `getMemberDetails`, `getMemberRole`, `isTeamAdmin`
   - API 返回 `owner.type` 字段标识所有者类型
   - 成员列表按角色分组：owner, admins, teachers, students

3. **删除用户时的所有者转移逻辑**：
   - `students.ts`：删除学生时，如果其是团队所有者，按优先级转移：
     - 教师管理员 > 学生管理员 > 教师成员 > 学生成员
     - 无成员则解散团队
   - `teachers.ts`：新增删除教师 API，所有者转移优先级：
     - 学校负责人 > 教师管理员 > 学生管理员 > 教师成员 > 学生成员
     - 无成员则解散团队

4. **前端页面更新**：
   - `student/team/[id]/page.tsx`：兼容新 API 响应格式，使用 `owner.type` 判断所有者类型
   - `teacher/teams/[id]/page.tsx`：同上

**涉及文件**：
- `apps/server/prisma/seed.ts`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/routes/teams.ts`
- `apps/server/src/routes/students.ts`
- `apps/server/src/routes/teachers.ts`
- `apps/web/src/app/student/team/[id]/page.tsx`
- `apps/web/src/app/teacher/teams/[id]/page.tsx`

**注意事项**：
- 旧表（StudentTeam, TeacherTeam, TeamAdmin）临时保留，待数据迁移完成后删除
- Team.ownerId 和 Team.ownerType 临时保留，迁移完成后删除

---

## 2026-03-21

### 学生团队模块权限和显示修复
- **问题1**：学生团队详情页管理员检查不完整，可能误匹配教师管理员
- **问题2**：学生团队列表成员数统计只显示学生成员，不包含所有者、管理员、教师
- **问题3**：学生团队详情页成员 Tab 不显示教师成员
- **问题4**：学生作为所有者/管理员的团队不显示在"我的团队"列表中
- **修复内容**：
  - `student/team/[id]/page.tsx`：`isAdmin` 检查添加 `adminType === 'student'` 条件
  - `teams.ts`：学生团队列表 API 返回完整的 `_count`（members, teacherMembers, admins）
  - `student/team/page.tsx`：成员数计算改为 `1 + admins + teacherMembers + members`
  - `student/team/[id]/page.tsx`：添加教师成员列表显示（绿色头像）
  - `teams.ts`：`GET /api/teams/student/:studentId` API 修复
    - 查询学生作为所有者的团队
    - 查询学生作为管理员的团队
    - 查询学生作为成员的团队
    - 合并去重后返回完整列表
    - 同时返回待处理的成员邀请和管理员邀请
- **涉及文件**：
  - `apps/server/src/routes/teams.ts`
  - `apps/web/src/app/student/team/page.tsx`
  - `apps/web/src/app/student/team/[id]/page.tsx`

### 团队成员退出功能
- **需求**：团队每个成员都应有退出按钮，所有者只能在团队无人时退出（解散）
- **新增 API**：`POST /api/teams/:id/leave` - 退出团队
- **逻辑实现**：
  - 所有者退出：检查团队是否有其他成员（学生+教师+管理员），有则拒绝，无则删除团队
  - 非所有者退出：从 StudentTeam/TeacherTeam/TeamAdmin 表中移除记录
- **前端更新**：
  - 教师端团队详情页添加退出/解散按钮
  - 学生端团队详情页添加退出/解散按钮
  - 按钮文案根据角色动态显示（所有者显示"解散团队"，其他显示"退出团队"）
- **涉及文件**：
  - `apps/server/src/routes/teams.ts`
  - `apps/web/src/app/teacher/teams/[id]/page.tsx`
  - `apps/web/src/app/student/team/[id]/page.tsx`

### 教师端学生列表排序优化
- **需求**：主教练优先显示自己的学生，然后按年级由低到高显示
- **修改**：
  - 后端 `GET /api/students` API 排序逻辑优化
  - 排序规则：1. 主教练优先显示自己的学生 2. 按入学年份降序（年级低的在前）
- **涉及文件**：`apps/server/src/routes/students.ts`

### 安全修复：被禁用用户登录限制
- **问题**：被禁用的用户（status = 'disabled'）仍然可以正常登录系统
- **修复**：
  - 登录 API (`POST /api/auth/login`) 添加用户状态检查
  - 被禁用用户登录时返回 401 错误："该账号已被禁用，请联系管理员"
  - `/api/auth/me` API 添加状态检查，已登录用户被禁用后会被强制登出
  - 前端 `AuthProvider.tsx` 的 `login` 函数返回错误信息（而不仅是 boolean）
  - 登录页面显示后端返回的具体错误信息
- **涉及文件**：
  - `apps/server/src/routes/auth.ts`
  - `apps/web/src/components/AuthProvider.tsx`
  - `apps/web/src/app/login/page.tsx`

## 2026-03-20

### 团队成员模型统一
- **新增 TeacherTeam 模型**：支持教师作为普通成员加入团队
- **邀请成员 API 更新**：`POST /api/teams/:id/members` 支持 `teacherIds` 参数
- **团队详情 API 更新**：返回结果包含 `teachers` 字段（教师成员列表）
- **前端更新**：
  - 邀请弹窗移除"将被设为管理员"文案
  - 成员列表分别显示教师成员和学生成员

### 团队列表页面重构（之前完成）
- **Tab 切换**：默认显示"我的团队"Tab，第二个是"全部团队"Tab
- **我的团队**：包含我创建的团队 + 我是管理员的团队
- **创建团队弹窗**：添加团队描述、公有/私有选项
- **后端 API**：新增 `GET /api/teams/my-admin-teams` 获取我作为管理员的团队列表

### 团队详情页优化
- **编辑弹窗**：点击"编辑"按钮打开弹窗，可编辑名称、描述、公有/私有
- **移除学校链接**：学校名称只显示文本，不再可点击
- **修复返回导航**：使用 `router.back()` 返回上一页，从学校详情页进入时正确返回

### 邀请成员弹窗优化（之前完成）
- **UI 简化**：移除"邀请学生"和"邀请教师"的 Tab 切换
- **统一列表**：教师和学生显示在同一个列表中，分别用标签标识类型
- 教师邀请后自动设为管理员（保持原有逻辑）
- 学生邀请为普通成员

### 团队设置功能
- **公有/私有切换**：所有者可点击切换团队类型（公有/私有）
- **编辑团队**：所有者可编辑团队名称
- **删除团队**：所有者可删除团队（只有所有者有此权限）
- **团队列表权限修复**：非所有者在团队列表页不再显示编辑/删除按钮
- 新增后端 API：`PUT /api/teams/:id`（编辑团队）、`DELETE /api/teams/:id`（删除团队）

### 学生管理员功能（重要）
- **核心改动**：学生和教师在团队管理方面拥有完全一致的功能，唯一区别是团队数量限制
  - 学生最多创建5个团队
  - 教师最多创建50个团队
- **TeamAdmin 模型更新**：
  - 移除 `teacherId` 字段，改用 `adminId` 和 `adminType` 字段
  - `adminType` 支持 `'student'` 和 `'teacher'` 两种类型
  - 学生和教师都可以成为团队管理员
- **后端 API 更新**：
  - `GET /api/teams/:id` 返回管理员信息时包含 `adminType` 字段
  - `POST /api/teams/:id/admins` 接受 `memberId` 和 `memberType` 参数
  - `DELETE /api/teams/:id/admins/:adminId` 支持移除学生或教师管理员
  - `GET /api/teams/admin-invitations` 支持学生和教师查看自己的管理员邀请
  - `GET /api/teams/:id/pending-invites` 正确显示学生和教师管理员邀请
  - 所有团队管理操作（邀请成员、审批申请等）学生管理员也可执行
- **前端更新**：
  - 团队详情页管理员列表显示管理员类型标签（学生/教师）
  - 成员列表"设置为管理员"按钮现在可以正常工作
  - 转移所有权时使用管理员实际的类型（而非固定为教师）

### 团队管理功能完善（续）
- **转移所有者功能**：
  - 后端 `POST /api/teams/:id/transfer` API 添加团队数量限制检查
  - 转移给学生时检查学生团队数量上限（5个）
  - 转移给教师时检查教师团队数量上限（50个）
  - 前端添加转移所有者弹窗，支持选择学生或教师作为新所有者
- **成员列表优化**：
  - 把"学生"改为"成员"
  - 移除所有者旁边的"转移所有权"按钮
  - 在每个管理员和成员旁边添加独立的操作按钮（转移所有权、移除）
- **教师管理员邀请流程优化**：
  - 新增 `GET /api/teams/admin-invitations` API 获取教师的管理员邀请列表
  - 新增 `POST /api/teams/admin-invitations/:id/accept` 接受管理员邀请
  - 新增 `POST /api/teams/admin-invitations/:id/reject` 拒绝管理员邀请
  - 邀请教师为管理员时改为 `pending` 状态，等待教师确认
- **API 修复**：
  - 修复 `GET /api/teams/student/:studentId` 返回的所有者信息问题
  - 修复 `GET /api/teams/school/:schoolId` 返回的所有者信息问题
  - 根据 `ownerType` 正确获取所有者（教师或学生）信息

### 团队管理功能完善
- **邀请列表功能**：
  - 新增 `GET /api/teams/:id/pending-invites` API 获取待处理邀请列表
  - 新增 `DELETE /api/teams/:id/invites/:inviteId` API 取消学生邀请
  - 新增 `DELETE /api/teams/:id/admin-invites/:inviteId` API 取消管理员邀请
  - 教师端团队详情页添加"邀请列表"按钮，可查看和取消待处理邀请
- **邀请教师为管理员**：
  - 邀请成员弹窗支持 Tab 切换（邀请学生/邀请教师）
  - 可搜索并选择本校教师，将其设为团队管理员
- **代码优化**：
  - 清理未使用的状态变量
  - 优化邀请弹窗组件结构

### 团队管理功能重构（重要）
- **核心改动**：重构团队管理模块，支持完整的团队生命周期管理
- **新增数据模型**：
  - `Team.avatar`：团队头像
  - `Team.announcement`：团队公告（Markdown）
  - `Team.isPublic`：公有/私有类型
  - `TeamAdmin`：团队管理员模型
  - `TeamJoinRequest`：学生加入申请模型
  - `StudentTeam.status/invitedAt/joinedAt/invitedBy`：邀请状态机制
- **团队角色机制**：
  - 所有者（Owner）：团队创建者，可删除团队、切换公有/私有、添加/移除管理员
  - 管理员（Admin）：由所有者任命的教师，可编辑公告、邀请/移除成员、处理申请
  - 学生成员：只能查看，无管理权限
- **邀请与申请机制**：
  - 邀请：管理员邀请 → 学生确认/拒绝
  - 申请：学生申请加入公有团队 → 管理员审批
- **添加成员方式**：
  - 下拉框搜索选择本校学生
  - 输入逗号分割的用户名批量邀请
- **权限控制**：
  - 学校负责人/超管默认只能**查看**团队，不能操作（除非被任命为管理员）
  - 只有所有者和管理员可以进行团队管理操作
- **前端页面**：
  - 学生端团队列表页：已加入团队 + 待处理邀请 + 可申请团队
  - 学生端浏览团队页面：查看公有团队并申请加入
  - 学生端团队详情页：公告/成员/模拟赛/训练赛/题单 Tab
  - 教师端团队详情页：支持公告编辑、成员管理、申请审批
- **其他改动**：
  - 更新 AuthProvider 支持 studentId
  - 将 Team.leaderId 改为 Team.ownerId
  - 修复 GET /api/teams/:id 的 grade 字段问题

### 问题修复
- **修复教师端团队列表显示问题**：
  - 前端 `useTeams.ts` 使用 `owner` 替代 `leader` 字段
  - 前端 `teams/page.tsx` 列配置更新为 `owner.name` 和 `_count.members`
  - 后端 API 响应格式统一为 `{list: [...], total: ...}`
- **修复邀请成员功能**：
  - 邀请弹窗添加 Tab 切换（邀请学生/邀请教师）
  - 支持邀请教师作为管理员加入团队
  - 同时获取可邀请的学生和教师列表

### 团队功能增强
- **支持学生创建团队**：
  - Team 模型添加 `ownerType` 字段（"student" | "teacher"）
  - 学生可以作为团队所有者创建团队
  - 学生最多创建5个团队，教师最多创建50个团队
- **新增转移所有者 API**：
  - `POST /api/teams/:id/transfer` - 转移团队所有权
  - 支持转移给学生或教师
- **学生端添加创建团队按钮**：
  - 学生团队列表页添加"+ 创建团队"按钮
  - 创建团队弹窗支持输入名称和描述

## 2026-03-19

### 年级计算重构（重要）
- **核心改动**：重构年级计算模块，前后端统一使用 `packages/shared/src/utils/grade.ts`
- 新增 `calculateGrade` 统一接口，支持 `enrollmentStage`（入学阶段）+ `educationSystem`（学制）+ `schoolType`（学校类型）
- 支持预备役学生：入学前的学生根据入学阶段往前推算（小学入学往前推幼儿园、初中入学往前推小学等）
- 修复幼儿园年级计算逻辑：幼儿园固定 3 年，与学制无关（6-3-3 和 5-4-3 的幼儿园都是 3 年）
- 后端 stats 接口使用共享模块计算年级分布，解决前后端计算不一致问题
- 前端统一从 `@/lib/grade` 导入，内部引用共享模块，保持向后兼容
- **新增 `calculateStudentGrade` 函数**：统一的学生年级计算，自动从学生对象提取所需参数
- 后端 students API 和 student-rankings API 返回学生数据时包含学校的 `educationSystem` 和 `schoolType`
- 前端 Student 类型新增 `enrollmentStage` 和学校学制信息字段
- **修复学校类型过滤逻辑**：年级分布严格按学校类型显示，初中+高中类型不再显示小学年级
- **完善年级计算转换逻辑**：
  - 当学校不包含学生的入学阶段时，按学校最低学段重新计算年级
  - 例如：初中入学 + 学校只有高中 → 按高中入学计算
  - 例如：小学入学 + 学校只有初中 → 按初中入学计算

### 学生端学校页面重构
- **修复学生端学校页面无内容问题**：原页面使用了不存在的 `/api/schools/me` API
- 重构学生端学校页面，与教师端保持一致的 Tab 结构（主页、教师、学生、Rating 排名、团队）
- 后端登录 API 支持返回学生的 schoolId（JWT payload 和 /api/auth/me）
- 更新 JwtPayload 类型定义，新增 studentId 字段，schoolId 同时支持教师和学生

### 问题修复
- 修复教师端 TeachersTab.tsx 组件因后端 API 响应格式变更（从数组改为分页格式 `{list, total, page, pageSize}`）导致的 `teachers.filter is not a function` 错误
- 修复年级分布逻辑：根据学校类型（小学/初中/高中/9年一贯制/初高中连体/完全中学）限制年级显示范围
- 优化年级分布颜色为统一彩虹色谱配色（含幼儿园幼一/幼二/幼三）
- 修复年级计算不一致问题：统一使用 `calculateStudentGrade` 函数，确保全校年级计算逻辑一致
- 修复预备役年级显示问题：初中+高中类型的学校，预备役学生显示"未入学"而非小学年级
- **修复学生列表排序**：按入学年份排序，入学年份大的（低年级）在前
- **修复学校信息编辑后刷新问题**：学制或学校类型变更时自动刷新年级分布和排名数据
- **修复超管端学校编辑页面**：`teachers.map is not a function` 错误（API 返回格式变更后前端未同步更新 `data.data.list`）

## 2026-03-18

### 数据模型更新
- **重要变更**：学生表 schoolId 字段改为必填，确保所有学生必须关联学校
- 修复已存在的无学校学生数据（将"许波"分配到"第一中学"）
- 后端 API 增加学生创建时的学校必填验证
- 后端 API 增加学生更新时的学校必填验证（防止 schoolId 被清空）

### 文档更新
- 创建 `docs/README.md` - 文档导航
- 创建 `docs/PROJECT_OVERVIEW.md` - 项目概述
- 创建 `docs/database/DATABASE_MODELS.md` - 数据库模型文档
- 创建 `docs/api/API_REFERENCE.md` - API 接口文档
- 创建 `docs/components/COMPONENTS.md` - 前端组件文档
- 更新 `README.md` - 项目主文档
- 创建 `docs/context.md` - 项目上下文
- 创建 `docs/current-task.md` - 当前任务
- 创建 `docs/change-log.md` - 变更日志

### 功能新增
- 添加教师联系方式必填验证（邮箱或手机号至少一个）
- 为平台管理员账号管理页面添加分页功能
- 支持 Markdown 和 LaTeX 渲染（学校公告等）
- 优化年级分布显示（进度条、百分比）
- 支持 5-4-3 和 6-3-3 学制动态计算年级

### 问题修复
- 修复学校负责人教师管理页面操作按钮显示问题
- 修复 Rating 排名 Top 10 显示空数据问题
- 修复"不包含已毕业"筛选后显示不足 10 人问题
- 统一超管和平台管理员使用同一套账号管理代码
- 为超管端学校详情页学生列表添加分页功能
- 超管端学校详情页学生列表移除团队列
- 添加旧路由 /super_admin 重定向到 /admin/schools（解决 404 问题）
- 为教师端学校学生列表添加分页功能
- 实现超管端学校详情页教师列表功能并添加分页
- 修复 ProtectedRoute 组件不支持数组类型 requiredRole 的问题
- 修复超管端学校详情页默认显示学生列表改为显示首页
- 修复年级分布逻辑：只有已毕业的学生显示为"其他"，其余正常显示年级

### 代码优化
- 为所有现有教师添加随机邮箱
- 后端 API 验证联系方式必填
- 前端表单验证联系方式必填
- 年级分布根据学制动态计算
