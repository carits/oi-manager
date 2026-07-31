---
status: reference
audience: development
last_verified: 2026-07-30
source_of_truth: auth, user and stats routes
---

# 认证与管理员 API

## 目录

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/health` | 公开 | Server 健康检查 |
| `POST` | `/api/auth/login` | 公开、限流 | 登录并设置 HttpOnly 会话 Cookie，同时兼容返回 JWT |
| `POST` | `/api/auth/register` | 公开、限流 | 个人学生注册 |
| `GET` | `/api/auth/me` | 登录 | 当前用户资料与模式 |
| `POST` | `/api/auth/session/migrate` | Bearer 登录 | 将旧浏览器会话迁移为 HttpOnly Cookie |
| `POST` | `/api/auth/logout` | Cookie 或 Bearer | 清除浏览器会话 Cookie |
| `PUT` | `/api/auth/profile` | 登录 | 更新当前资料 |
| `POST` | `/api/auth/avatar` | 登录 | 上传当前头像 |
| `PUT` | `/api/auth/password` | 登录、限流 | 修改当前密码 |
| `POST` | `/api/auth/switch-mode` | 学生 | 切换校园/个人模式并刷新 JWT |
| `GET` | `/api/users` | 管理员、范围 | 分页查询用户 |
| `GET` | `/api/users/:id` | 管理员、范围 | 管理端用户详情 |
| `GET` | `/api/users/:userId/profile` | 登录 | 教师/学生资料 |
| `POST` | `/api/users/platform-admin` | 超管 | 创建平台管理员 |
| `PUT` | `/api/users/:id/status` | 管理员、范围 | 启用或禁用用户 |
| `POST` | `/api/users/:id/reset-password` | 管理员、范围、限流 | 重置密码 |
| `GET` | `/api/users/:id/logs` | 管理员、范围 | 用户审计日志 |
| `GET` | `/api/stats/global` | 管理员 | 全局统计 |
| `GET` | `/api/stats/schools` | 管理员 | 学校统计 |

## 登录请求

```json
{
  "username": "user",
  "password": "not-shown-in-docs",
  "role": "student",
  "mode": "campus"
}
```

`role` 是登录入口类型，只接受 `admin | teacher | student`。`mode` 仅对学生生效；
未传时默认为 `campus`。

成功响应的 `data` 包含 `token`、`userId`、数据库 `role`、角色扩展 ID、`schoolId`
和可选 `studentMode`。登录日志记录结果、入口、角色、IP 和 User-Agent，不记录密码。

## 管理范围

- 超级管理员可管理平台管理员和普通用户。
- 平台管理员查询与状态/密码操作不包含超级管理员和平台管理员目标。
- 普通教师和学生不能访问用户管理端点。
- 资料接口只返回显式公开字段，不返回密码哈希、平台凭据和内部关联。

