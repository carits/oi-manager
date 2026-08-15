---
status: reference
audience: development
last_verified: 2026-08-15
source_of_truth: apps/server/src/modules/carits/carits.routes.ts and apps/server/src/modules/contribution/contribution.routes.ts
---

# Carits币与贡献接口

所有接口均要求登录，当前只返回 `featureStatus: "planned"`、中文说明与空集合。
接口不返回余额、流水金额、贡献值、排行榜或任何写操作。

| 方法 | 路径 | 访问范围 |
|------|------|----------|
| `GET` | `/api/carits/me` | 当前个人 |
| `GET` | `/api/carits/me/transactions` | 当前个人 |
| `GET` | `/api/carits/organizations/:organizationId` | 当前 URL 对应的有效校园成员 |
| `GET` | `/api/carits/organizations/:organizationId/transactions` | 当前 URL 对应的有效校园成员 |
| `GET` | `/api/carits/platform` | 平台管理员 |
| `GET` | `/api/contributions/me/summary` | 当前个人 |
| `GET` | `/api/contributions/me/events` | 当前个人 |
| `GET` | `/api/contributions/rankings/users` | 已登录用户；当前为空 |
| `GET` | `/api/contributions/rankings/organizations` | 已登录用户；当前为空 |
| `GET` | `/api/contributions/organizations/:organizationId` | 当前 URL 对应的有效校园成员 |
| `GET` | `/api/contributions/organizations/:organizationId/events` | 当前 URL 对应的有效校园成员 |
| `GET` | `/api/contributions/platform` | 平台管理员 |

组织接口由服务端从 URL 对应成员关系解析权限，客户端不得传入成员关系 ID。
未来公开的个人贡献榜只允许返回用户名、头像、贡献值与名次。
