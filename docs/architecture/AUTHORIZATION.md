---
status: current
audience: development, operations
last_verified: 2026-07-30
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
  studentMode?: 'campus' | 'personal'
}
```

HTTP 请求使用 `Authorization: Bearer <token>`。缺少或无效 Token 返回 `401`；
已登录但角色或资源范围不足返回 `403`。

## 学生模式

- `campus`：以学校和已加入团队的任务为主，不能创建团队或题单。
- `personal`：可创建和管理自己的团队、题目和题单，并查看个人提交。
- `POST /api/auth/switch-mode` 只允许学生调用，返回包含新 `studentMode` 的 JWT。
- 模式是会话级权限上下文，不改变学生的 `schoolId` 或数据库角色。

## 权限矩阵

| 能力 | 超管 | 平台管理员 | 负责人 | 教师 | 校园学生 | 个人学生 |
|------|:----:|:----------:|:------:|:----:|:--------:|:--------:|
| 学校和负责人管理 | 是 | 否 | 本校部分 | 否 | 否 | 否 |
| 平台用户管理 | 是 | 受限 | 否 | 否 | 否 | 否 |
| OJ Cookie 配置 | 是 | 否 | 否 | 否 | 否 | 否 |
| OJ 任务、账号池 | 是 | 是 | 受限导入 | 受限导入 | 否 | 否 |
| 本校教师管理 | 是 | 否 | 是 | 否 | 否 | 否 |
| 学生、团队和任务 | 全局 | 否 | 本校 | 自有/参与 | 参与 | 自有/参与 |
| 私有题目和题单 | 是 | 是 | 是 | 是 | 查看/参与 | 是 |
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

### Judge

- `/ws/judge` 在开发和正式环境都要求 `JUDGE_TOKEN`。
- `ALLOW_UNAUTHENTICATED_JUDGE=true` 只用于显式 loopback 测试。
- Token 不进入浏览器、HTTP 响应或普通日志。

## 前端会话

`AuthProvider` 根据 `role:userId` 计算 `sessionKey`，用于账号切换后让组件和缓存重新
挂载。它不是数据库字段、访问令牌或后端隔离机制。真正隔离由 JWT、权限中间件和
资源查询条件完成。

浏览器登录由 Server 设置同域 `HttpOnly`、`SameSite=Lax` 会话 Cookie；正式环境同时要求
HTTPS 和 `Secure=true`。鉴权中间件暂时兼容 Bearer Token，供脚本、测试与旧会话一次性
迁移使用。旧 Token 迁移成功后会从 `localStorage` 清除，不能再把它作为浏览器长期会话来源。

