---
status: current
audience: development, operations
last_verified: 2026-08-02
source_of_truth: packages/shared/src/index.ts, auth middleware, role layouts
---

# 认证与权限

## 登录入口

| 登录模式 | 可登录数据库角色 | 登录后首页 |
|----------|------------------|------------|
| `admin` / `platform-admin` 页面别名 | `super_admin`, `platform_admin` | `/admin` 或 `/platform-admin` |
| `teacher` | `school_principal`, `teacher` | `/teacher` |
| `student` | `student` | `/student` |

前端把 `platform-admin` 规范化为管理员登录模式；后端登录 API 接受
`admin | teacher | student`。错误角色登录返回认证失败，不会自动提升权限。

## JWT

```ts
interface JwtPayload {
  userId: string
  role: 'super_admin' | 'platform_admin' | 'school_principal' | 'teacher' | 'student'
  username: string
  adminId?: string
  teacherId?: string
  studentId?: string
  schoolId?: string
  workspaceMode: 'work' | 'personal'
  /** @deprecated compatibility for old student sessions */
  studentMode?: 'campus' | 'personal'
}
```

HTTP 请求使用 `Authorization: Bearer <token>`。缺少或无效 Token 返回 `401`；
已登录但角色或资源范围不足返回 `403`。

## 工作区模式

- `role` 是账号永久岗位；切换工作区不会修改角色、岗位扩展 ID 或学校关系。
- `workspaceMode=work`：进入管理或校园工作台，业务资源使用 `resourceScope=campus`。
- `workspaceMode=personal`：五种角色共用个人工作区，业务资源使用 `resourceScope=personal`。
- `POST /api/auth/switch-workspace` 为所有已登录角色刷新 Cookie 和兼容 JWT；首次切入时事务性创建 `PersonalProfile`。
- 旧 `studentMode` 与 `POST /api/auth/switch-mode` 仅保留一个开发周期，分别映射至 `workspaceMode` 和新切换接口。
- 个人工作区只输出用户名、头像、公开简介和个人 Rating，不输出实名、学校、职称或后台岗位。

## 权限矩阵

| 能力 | 超管工作区 | 平台管理员工作区 | 负责人工作区 | 教师工作区 | 学生校园工作区 | 任意角色个人工作区 |
|------|:----------:|:------------------:|:------------:|:----------:|:----------------:|:------------------:|
| 学校和负责人管理 | 是 | 否 | 本校部分 | 否 | 否 | 否 |
| 平台用户管理 | 是 | 受限 | 否 | 否 | 否 | 否 |
| OJ Cookie 配置 | 是 | 否 | 否 | 否 | 否 | 否 |
| OJ 任务、账号池 | 是 | 是 | 受限导入 | 受限导入 | 否 | 否 |
| 平台题库 | 管理 | 管理 | 使用已发布题 | 使用已发布题 | 仅教学活动 | 使用已发布题 |
| 校内题库 | 不可见 | 不可见 | 本校全部管理 | 本校已发布/自己草稿 | 仅授权教学活动 | 不可见 |
| 本校教师管理 | 是 | 否 | 是 | 否 | 否 | 否 |
| 团队、比赛、题单和提交 | 管理范围 | 管理范围 | 本校/参与 | 自有/参与 | 参与 | 个人作用域内相同规则 |
| 维护迁移 API | 开关开启时 | 否 | 否 | 否 | 否 | 否 |

具体业务接口还会检查学校、团队、创建者、成员角色和可见性。前端隐藏按钮只是体验，
不能替代后端权限校验。

## 敏感边界

### OJ 配置

- `GET/PUT /api/oj-fetcher/platforms/:platform/config`：仅 `super_admin`。
- 读取只返回配置状态和脱敏信息，不返回 Cookie 原文。
- 抓题任务：`super_admin` 和 `platform_admin`。

### 维护 API

- `/api/admin/migration/*`：先认证，再要求 `super_admin`。
- `ENABLE_MAINTENANCE_API !== true` 时统一返回 `404`。
- 操作完成后必须立即关闭开关。

### 评测机

- `/ws/judge` 在开发和正式环境都要求 `JUDGE_TOKEN`。
- `ALLOW_UNAUTHENTICATED_JUDGE=true` 只用于显式 loopback 测试。
- Token 不进入浏览器、HTTP 响应或普通日志。

### 校内题库

- 题目列表、详情、附件、测试数据、Judge 配置、AI 和提交共用服务端题目访问策略。
- 学生访问原始题库列表返回 `403 TEACHER_ONLY`；指定题目或文件 ID 时返回 `404`。
- 教师必须处于 `work` 工作区且具有学校关系。不满足时分别返回
  `WORKSPACE_MODE_REQUIRED` 或 `SCHOOL_MEMBERSHIP_REQUIRED`。
- 跨校题和学校题对平台/超级管理员都返回 `404`，平台岗位不是学校内容的旁路。

## 前端会话

`AuthProvider` 根据 `role:userId:workspaceMode` 计算 `sessionKey`，用于账号或工作区切换后让组件和缓存重新
挂载。它不是数据库字段、访问令牌或后端隔离机制。真正隔离由 JWT、权限中间件和
资源查询条件完成。

浏览器登录由 Server 设置同域 `HttpOnly`、`SameSite=Lax` 会话 Cookie；正式环境同时要求
HTTPS 和 `Secure=true`。鉴权中间件暂时兼容 Bearer Token，供脚本、测试与旧会话一次性
迁移使用。旧 Token 迁移成功后会从 `localStorage` 清除，不能再把它作为浏览器长期会话来源。
