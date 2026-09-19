---
status: reference
audience: development
last_verified: 2026-09-14
source_of_truth: packages/contracts/src and apps/web/src/lib/apiClient.ts
---

# 字段契约

## HTTP 响应

成功响应：

```json
{
  "success": true,
  "data": {}
}
```

错误响应：

```json
{
  "success": false,
  "message": "面向用户的错误信息",
  "code": "OPTIONAL_BUSINESS_CODE"
}
```

前端传输结果 `ApiClientResponse<T>` 额外带客户端解析出的 `status`。网络错误或超时为 `0`，HTTP
响应保留真实状态。服务端不应把错误包在 `200 success:false` 中。

服务端与浏览器不得分别手写请求/响应类型。`packages/contracts` 的 Endpoint Contract 是唯一事实源，
同时提供 Runtime Schema、推导类型、HTTP 方法和作用域。已接入的 Assignment 进度/人工完成、Blog 公共发现、
Contest Rating、题解相似度与 Training 结构设计接口，在请求进入业务服务、响应离开服务端以及浏览器消费成功数据时都会执行同一 Schema。
日期 Schema 同时接受服务端 `Date` 并序列化为 ISO 8601，浏览器契约输出永远是字符串。

Training 设计保存使用 `expectedRevision`、稳定 Stage/Assignment ID 与客户端草稿 key。服务端校验请求后完成
事务更新，再重新读取规范 Design DTO 并通过同一响应 Schema 输出；不得把内部 Session ORM 结果冒充设计响应。

## 组织加入

组织目录返回公开学校资料和当前用户的一种聚合关系：`membership/application/invitation/null`。申请身份仅允许 `student/teacher`；成员类型按身份分别限定为 `enrolled/preselected` 和 `employee/external_coach`。审核结果分别使用申请人可见的 `decisionMessage` 与仅组织审核人员可见的 `internalReviewNote`。

通知返回 `contextType/contextKey/organizationId`，并由服务端计算 `actionable` 与 `actions`。客户端不得根据通知类型自行假定业务仍可处理。

## 状态码

| 状态 | 语义 |
|------|------|
| `200/201` | 成功 |
| `400` | 参数或业务状态不合法 |
| `401` | 缺少、无效或过期认证 |
| `403` | 角色或资源范围不足 |
| `404` | 资源不存在；关闭的维护 API 也使用此状态 |
| `409` | 唯一约束、版本或并发冲突 |
| `429` | 限流 |
| `5xx` | 服务端或上游失败 |

## 登录

```ts
const LoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  workspaceMode: z.enum(['work', 'personal']).optional(),
}).strict()

const LoginResponseDataSchema = z.object({
  userId: z.string(),
  accountRole: z.enum(['user', 'platform_admin', 'super_admin']),
  username: z.string(),
  workspaceMode: z.enum(['work', 'personal']),
  avatar: z.string().nullable().optional(),
  next: z.string().startsWith('/'),
})
```

Schema 与 TypeScript 类型均来自 `packages/contracts/src/auth.ts`。登录响应不返回 JWT、管理员/教师/学生
扩展实体 ID 或学校 ID；账号身份使用 `accountRole`，组织岗位在进入明确组织上下文后单独解析。

`workspaceMode` 是唯一会话工作区字段。旧 `mode`、`role` 和 `studentMode` 输入会被严格拒绝。

`schoolId` 始终是 `School.id`，仅在当前组织关联学校时出现；`organizationId` 是
`Organization.id`，用于成员关系与 `X-OI-Organization-ID`。调用方不得用组织 ID 填充
`schoolId`。

## 工作区切换

`POST /api/auth/switch-workspace` 需要已认证会话，请求体如下：

```ts
{ workspaceMode: 'work' | 'personal' }
```

旧客户端可传 `mode: 'campus' | 'personal'`。成功响应返回 `role` 和
`workspaceMode`，并刷新 HttpOnly 会话 Cookie；浏览器响应不包含 Token。切入 `personal` 会按需创建
`PersonalProfile`。

`GET /api/auth/me` 不带组织请求头时只返回账号上下文，不自动选择任一学校。携带
`X-OI-Organization-ID` 时只返回该组织的 Membership 身份。认证依赖失败使用
`503 AUTH_SERVICE_UNAVAILABLE`，会话代数不匹配使用 `401 SESSION_REVOKED`。

## 分页

请求使用 `page`、`pageSize` 和模块特定筛选参数。列表响应统一包含：

```ts
{
  items: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}
```

旧接口可能使用业务名作为集合字段；新增接口应优先使用共享分页工具，并在改变既有
字段前更新调用方和测试。

## Prisma 到 API

Prisma 关联字段因历史 schema 可能使用大写名称。路由层不要直接返回完整 Prisma
对象，应显式 `select` 并映射为小写 API 字段：

```ts
{
  id: user.id,
  username: user.username,
  school: user.School
    ? { id: user.School.id, name: user.School.name }
    : null
}
```

这样可以避免泄露 `passwordHash`、加密 Cookie、内部日志关系和不稳定的 ORM 命名。

## ID、日期和空值

- UUID/字符串 ID 在 API 中保持字符串；`Submission.id` 等数字 ID 保持 number。
- 日期使用 ISO 8601 字符串。
- 可空值使用 `null`，不要在同一字段混用空字符串。
- 空列表使用 `[]`，错误不能伪装为空列表。
- 未返回的敏感字段应省略，不使用掩码值替代真实业务字段，除非接口明确叫 masked。
