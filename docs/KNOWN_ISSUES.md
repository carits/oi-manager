# 已知问题与技术债务 (Known Issues & Technical Debt)

> 最后更新: 2026-04-27

本文档记录 OI Manager V2 中的已知问题、技术债务和待优化项。

---

## 1. 架构层面

### 1.1 ~~遗留直连 API 调用~~ ✅ 已解决

**问题**: 部分文件仍直接使用 `fetch('http://localhost:3001/api/...')` 而非 `apiClient`

**状态**: ✅ 已于 2026-03-23 完成迁移

**解决方案**: 所有页面和组件已迁移到 `apiClient` 统一调用

**验证**: `grep -r "http://localhost:3001" apps/web/src` 仅剩配置文件中的默认值

### 1.2 packages/shared 未充分利用 [P2]

**问题**: 共享类型包 `packages/shared` 存在但未被前端充分利用

**影响**: 前后端类型可能不一致，增加维护成本

**解决方案**: 将前端常用的类型定义迁移到 shared 包

### 1.3 ~~缺少通用 UI 组件库~~ ✅ 已解决

**问题**: 项目使用内联样式，没有统一的 UI 组件库

**状态**: ✅ 已于 2026-04-22 完成

**解决方案**:
1. 建立 CSS 变量设计 token 系统（`globals.css` + `lib/tokens.ts` + `lib/styles.ts`）
2. 增强 `components/ui/` 组件（Button 增加 outline/ghost/danger，Card 增加 hoverable/subtitle，Badge 增加 neutral/pending/dot）
3. 消除所有紫色渐变，统一颜色为 CSS 变量引用
4. 详细文档见 `docs/DESIGN_SYSTEM.md`

---

## 2. 功能层面

### 2.1 Rating 计算未完成 [P1]

**问题**: Rating 计算逻辑尚未实现

**影响**: 比赛成绩无法自动影响学生 Rating

**涉及里程碑**: M7, M8

**状态**: 计划中

### 2.2 榜单导入匹配未完成 [P1]

**问题**: 榜单导入后的学生匹配逻辑未实现

**影响**: 比赛成绩无法正确关联学生

**涉及里程碑**: M5, M6

**状态**: 计划中

### 2.3 家长端未实现 [P2]

**问题**: 家长端页面和功能完全未实现

**影响**: 家长无法查看学生成长数据

**涉及里程碑**: M14

**状态**: 计划中

### 2.4 QOJ 部分 Cloudflare 拦截 [P2]

**问题**: QOJ 部分题目（如 1538、5341）触发 Cloudflare challenge，返回 403

**影响**: 无法拉取这些题目的题面

**解决方案**: 配置住宅代理（`BROWSER_PROXY` 环境变量）或等待 CF challenge 自动解决

**状态**: headed 模式下大部分题目 CF challenge 约 3 秒自动通过，PDF 题面可通过 `download.php` 端点下载到本地。需配置 `QOJ_SESSION` 环境变量。

### 2.5 洛谷附件下载需要登录 [P2]

**问题**: 部分洛谷附件需要登录才能下载，返回 403 Forbidden

**影响**: 未配置 Cookie 时，部分附件无法下载

**解决方案**: 在后端 `.env` 文件中配置 `LUOGU_COOKIE`

**配置方法**:
1. 登录洛谷 https://www.luogu.com.cn
2. 打开浏览器开发者工具 (F12) -> Application -> Cookies
3. 复制所有 cookie 字符串（格式如 `key1=value1; key2=value2`）
4. 在 `.env` 中添加：`LUOGU_COOKIE="你的Cookie"`

### 2.6 ~~训练排名 Admin 过滤失效~~ ✅ 已解决

**问题**: ICPC/IOI 训练排名中，owner 和 admin 教师未被正确过滤，仍然出现在排名列表中

**根因**:
- `TeamMember.userId` 存储的是 `Teacher.id` 或 `Student.id`
- `Submission.userId` 存储的是 `User.id`
- 排名代码直接用 `TeamMember.userId` 过滤 `Submission.userId`，导致 ID 不匹配

**影响**: 教师提交被计入排名，影响学生排名准确性

**涉及文件**: `apps/server/src/modules/training/training.routes.ts` 第 1333-1342 行

**解决方案**:
```typescript
// 当前代码（错误）
const adminMembers = await prisma.teamMember.findMany({
  where: { teamId, role: { in: ['owner', 'admin'] } },
  select: { userId: true },
})
const adminUserIds = adminMembers.map(m => m.userId)  // 这是 Teacher.id

// 正确做法：查询 Teacher.userId (User.id)
const adminUserIds: string[] = []
for (const m of adminMembers) {
  if (m.userType === 'teacher') {
    const teacher = await prisma.teacher.findUnique({
      where: { id: m.userId },
      select: { userId: true }
    })
    if (teacher) adminUserIds.push(teacher.userId)  // 这是 User.id
  }
}
```

**状态**: ✅ 已于 2026-04-23 解决

**修复内容**:
1. Admin 过滤：通过 Teacher/Student 表转换 TeamMember.userId → User.id
2. Problem ID 匹配：ICPC 排名中 `Submission.problemId` 存储外部 ID（如 '1005'），需用 `p.Problem.problemId` 匹配

**验证**: Training ID=4 ICPC 模拟赛，11 名学生排名正确，2 名教师不计入排名

### 2.7 ~~Carits 训练提交 ojRemoteId 缺失~~ ✅ 已解决

**问题**: 通过训练提交 API 提交的 Carits 题目，`ojRemoteId` 为 null，导致提交详情弹窗不显示远程 ID

**根因**: `training.routes.ts` 中 Carits 训练提交只 dispatch judge task，未设置 `ojRemoteId`。而 `submit.ts` 中非训练提交已正确设置 `ojRemoteId = submission.id.toString()`

**影响**: 训练提交详情弹窗不显示远程 ID

**涉及文件**: `apps/server/src/modules/training/training.routes.ts` 第 966-977 行

**解决方案**:
```typescript
// dispatchJudgeTask 后添加
await prisma.submission.update({
  where: { id: submission.id },
  data: { ojRemoteId: submission.id.toString() }
})
```

**状态**: ✅ 已于 2026-04-23 解决

**修复内容**:
1. 训练提交后设置 ojRemoteId
2. 数据修复脚本更新现有 15 条记录

**验证**: 111 条 Carits 训练提交全部有 ojRemoteId

---

## 3. 安全层面

### 3.1 Token 存储在 localStorage [P1]

**问题**: JWT Token 存储在 localStorage，存在 XSS 攻击风险

**影响**: 恶意脚本可能窃取 Token

**解决方案**: 生产环境建议使用 httpOnly Cookie

### 3.2 默认密码简单 [P1]

**问题**: 种子数据账号使用 `123456` 作为默认密码

**影响**: 生产环境部署时存在安全风险

**解决方案**:
1. 部署脚本强制修改默认密码
2. 增加密码复杂度要求

### 3.3 ~~JWT Secret 硬编码~~ ✅ 已解决

**问题**: 开发环境使用硬编码的 `dev-secret-key-12345`

**状态**: ✅ 已于 2026-03-23 解决

**解决方案**:
1. 创建 `lib/jwtSecret.ts` 统一获取 JWT Secret
2. 生产环境强制要求配置 `JWT_SECRET` 环境变量（未配置时抛出错误）
3. 开发环境使用默认值但输出警告日志

### 3.4 静态文件无认证访问 [P2] → ✅ 已解决

**问题**: `/uploads/*` 路径的静态文件完全公开，无认证

**影响**: 任何人可访问上传的文件（头像、比赛资源等）

**状态**: ✅ 已于 2026-03-26 解决

**解决方案**:
1. 创建 File 模型统一管理文件元数据
2. 创建 `/api/files/:id/download` 认证 API 访问私有文件
3. 创建 `/api/files/:id/public` 公开文件访问（无需认证）
4. 文件访问权限检查基于 ownerType + ownerId
5. 详见 `docs/FILE_STORAGE_DESIGN.md`

**遗留事项**:
- 现有文件需通过迁移脚本迁移到新系统
- 前端代码需逐步迁移到新的文件访问 API

---

## 4. 性能层面

### 4.1 前端缺少分页组件 [P2]

**问题**: 部分列表页面（如学校详情页的团队列表）没有分页

**影响**: 数据量大时加载缓慢

**解决方案**: 统一使用分页组件

### 4.2 图片未压缩 [P2]

**问题**: 上传的头像等图片未进行压缩处理

**影响**: 存储空间和加载速度

**解决方案**: 后端增加图片压缩中间件

### 4.3 ~~缺少请求缓存~~ ✅ 已解决

**问题**: 前端没有请求缓存机制

**状态**: ✅ 已于 2026-04-15 解决

**解决方案**: 新增 SWR 缓存层（`lib/fetcher.ts` + `hooks/useQuery.ts`），5 秒去重，关闭 focus 重验证

---

## 5. 代码质量

### 5.1 ~~缺少测试~~ ✅ 已解决

**问题**: 项目没有单元测试和集成测试

**状态**: ✅ 已于 2026-04-08 添加 230+ 测试

**解决方案**: vitest + supertest，覆盖认证、权限、团队、题单等模块

### 5.2 ~~缺少错误边界~~ ✅ 已解决

**问题**: 前端没有 React Error Boundary

**状态**: ✅ 已于 2026-04-27 完成

**解决方案**: 新建 `components/ErrorBoundary.tsx`，挂载到 `Providers.tsx` 最外层

### 5.3 ~~console.log 未清理~~ ✅ 已解决

**问题**: 代码中存在调试用的 console.log

**状态**: ✅ 已于 2026-04-27 完成

**解决方案**: 57 处 console.log 全部替换为 `logger.info/warn/error`

### 5.4 ~~API 输入未校验~~ ✅ 已解决

**问题**: 关键 API 路由缺少输入参数校验

**状态**: ✅ 已于 2026-04-27 完成

**解决方案**: 新建 `lib/zodValidate.ts` 校验中间件 + `modules/team/schemas/team.schemas.ts`，应用到团队模块关键路由

### 5.5 ~~userId 统一优化~~ ✅ 已解决

**问题**: 后端代码存在 41 处使用 `user.teacherId || user.studentId` 获取用户 ID，以及 `user.teacherId ? 'teacher' : 'student'` 做角色判断，这些模式冗余且不一致

**根因**: JWT payload 中包含冗余字段 `teacherId/studentId/adminId`（值都等于 `userId`），历史代码依赖这些字段做身份判断

**影响**:
- 代码冗余，增加维护成本
- 身份判断逻辑分散，不一致

**涉及文件**: `modules/team/team.service.ts`, `routes/problem-lists.ts`, `routes/teachers.ts`

**状态**: ✅ 已于 2026-04-29 完成

**解决方案**:
1. 添加 `getUserType(role)` 工具函数到 `middleware/auth.ts`
2. 所有身份判断统一改为 `userId` + `role` 模式
3. 更新文档说明冗余字段用途

**验证**: 238 个测试全部通过

---

## 6. 文档层面

### 6.1 API 文档不完整 [P2]

**问题**: `docs/api/API_REFERENCE.md` 不够详细

**影响**: 新开发者难以快速了解接口

**解决方案**: 使用 Swagger/OpenAPI 生成文档

### 6.2 组件文档缺失 [P2]

**问题**: `docs/components/COMPONENTS.md` 内容较少

**影响**: 组件复用困难

**解决方案**: 使用 Storybook 或完善文档

---

## 7. 部署层面

### 7.1 ~~仅支持 SQLite~~ ✅ 已解决

**问题**: 数据库仅支持 SQLite

**状态**: ✅ 已于 2026-04-15 解决

**解决方案**: 迁移到 PostgreSQL，schema provider 改为 postgresql，新增 Docker PostgreSQL 配置和数据迁移脚本

### 7.2 ~~缺少 Docker 配置~~ ✅ 已解决

**问题**: 没有 Docker/Docker Compose 配置

**状态**: ✅ 已于 2026-04-15 解决

**解决方案**: 新增 Dockerfile（多阶段构建）、docker-compose.yml（PostgreSQL）、ecosystem.config.js（PM2 cluster）、.dockerignore

### 7.3 缺少 CI/CD 配置 [P2]

**问题**: 没有 GitHub Actions 或其他 CI/CD 配置

**影响**: 手动部署容易出错

**解决方案**: 添加自动化流水线

---

## 8. 用户体验

### 8.1 缺少加载状态 [P2]

**问题**: 部分操作没有加载状态提示

**影响**: 用户不知道操作是否在进行

**解决方案**: 统一添加 loading 状态

### 8.2 ~~错误提示不友好~~ ✅ 已解决

**问题**: 部分错误直接使用 alert 弹窗

**影响**: 用户体验差

**解决方案**: 使用 Toast 或 Notification 组件

**状态**: ✅ 已于 2026-04-06 解决

**解决方案**:
1. 创建 `Toast` 通知系统（`components/ui/Toast.tsx`），  - `ToastProvider` 上下文 + `useToast` hook
  - 4 种类型：success / error / warning / info
  - 右上角弹出，3.5 秒自动消失
  - 独立函数 `showToastNotification` 供非 React 代码使用
2. 创建 `PasswordResetModal`（`components/ui/PasswordResetModal.tsx`）替代浏览器原生 `prompt()`
3. 将所有 `alert()` 替换为 `toast.success/error/warning()`
4. 将所有 `confirm()` 替换为 `ConfirmModal` 组件 + useState 模式
5. 将所有 `prompt()` 替换为 `PasswordResetModal` 组件

**验证**: `grep -r '\b(alert|confirm|prompt)\(' apps/web/src --include='*.tsx'` → 0 匹配

### 8.3 缺少表单验证反馈 [P2]

**问题**: 部分表单验证错误提示不清晰

**影响**: 用户不知道如何修正

**解决方案**: 统一表单验证和错误提示

---

## 9. 优先级说明

| 优先级 | 说明 | 处理时机 |
|--------|------|----------|
| P0 | 阻塞性问题 | 立即处理 |
| P1 | 重要问题 | 近期迭代处理 |
| P2 | 优化项 | 有空时处理 |

---

## 10. 问题追踪

发现新问题请按以下格式添加：

```markdown
### X.X 问题标题 [优先级]

**问题**: 问题描述

**影响**: 影响范围

**涉及文件**: 相关文件列表

**解决方案**: 建议的解决方案

**状态**: 待处理/处理中/已解决
```
