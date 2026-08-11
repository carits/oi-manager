---
status: reference
audience: development
last_verified: 2026-07-30
source_of_truth: apps/server/src/index.ts, routes and modules
---

# HTTP 接口

基础路径为 `/api`，Judge WebSocket 为 `/ws/judge`。当前目录登记源码中的 253 个
HTTP 端点。

| 文档 | 端点范围 |
|------|----------|
| [认证与管理员](AUTH_AND_ADMIN.md) | health、auth、users、stats |
| [学校与团队](ORGANIZATION_AND_TEAMS.md) | schools、teachers、students、teams、import、milestones |
| [题目与 OJ](PROBLEMS_AND_OJ.md) | problems、problem-lists、bindings、OJ、archive |
| [训练与提交](TRAININGS_AND_SUBMISSIONS.md) | trainings、submit、submissions |
| [文件与维护](FILES_AND_MAINTENANCE.md) | files、testdata、admin data、migration |

## 认证

除表中标为“公开”的端点外，请求使用：

```http
Authorization: Bearer <JWT>
```

访问列中的“资源”表示除登录外还检查学校、团队、所有者、成员、参与者或可见性。
“管理员”表示 `super_admin | platform_admin`，“教师”表示接口列出的
`teacher/school_principal`，两者不能互相替代。

## 通用响应

```json
{
  "success": true,
  "data": {}
}
```

```json
{
  "success": false,
  "message": "错误信息",
  "code": "OPTIONAL_CODE"
}
```

分页、状态码和字段规则见[字段契约](../FIELD_CONTRACTS.md)。

## 敏感端点

- OJ Cookie 配置：仅超级管理员，响应不得包含原文。
- `/api/admin/migration/*`：仅超级管理员且维护开关开启；关闭时 `404`。
- `/api/admin/data/*`：超级管理员和平台管理员。
- `/api/oj-accounts/*`：超级管理员和平台管理员。
- Judge WebSocket 使用独立 Token，不使用浏览器 JWT。

`pnpm docs:check` 从 Express 源码提取静态 method/path，与本目录中的表格比较。
