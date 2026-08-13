---
status: reference
audience: development, operations
last_verified: 2026-08-07
source_of_truth: files, testdata, admin-data and migration routes
---

# 文件与维护 API

## 文件（6）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `POST` | `/api/files/upload` | 登录、业务权限 | 上传文件 |
| `GET` | `/api/files/:id` | 登录、业务权限 | 文件元数据 |
| `GET` | `/api/files/:id/download` | 登录、业务权限 | 下载私有文件 |
| `GET` | `/api/files/:id/public` | 公开文件 | 访问公开文件 |
| `GET` | `/api/files/by-owner/:ownerType/:ownerId` | 登录、业务权限 | 按归属列出文件 |
| `DELETE` | `/api/files/:id` | 登录、管理权限 | 删除文件 |

## 测试数据（5）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/problems/:id/testdata` | 登录、题目权限 | 测试数据列表 |
| `POST` | `/api/problems/:id/testdata` | 题目管理者 | 上传测试数据 |
| `DELETE` | `/api/problems/:id/testdata/:fileId` | 题目管理者 | 删除测试数据 |
| `POST` | `/api/problems/:id/testdata/auto` | 题目管理者 | 自动识别测试数据 |
| `GET` | `/api/problems/:id/testdata/download/:filename` | 题目管理者 | 下载测试数据 |
| `GET` | `/api/problems/:id/testdata/export` | problem manager | download all testdata as ZIP |
| `GET` | `/api/problems/:id/testdata/files/:fileId/download` | problem manager | download one testdata file by file ID |

## 管理数据（7）

以下接口均要求 `super_admin | platform_admin`：

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/admin/data/submission-stats` | 管理员 | 提交数据统计 |
| `POST` | `/api/admin/data/fix-carits-remote-id` | 管理员 | 修复 Carits 远端 ID |
| `POST` | `/api/admin/data/fix-hdu-memory` | 管理员 | 修复 HDU 内存值 |
| `POST` | `/api/admin/data/clean-training-submissions` | 管理员 | 清理任务提交 |
| `POST` | `/api/admin/data/reset-user-password` | 管理员 | 维护方式重置密码 |
| `POST` | `/api/admin/data/backfill-training-participants` | 管理员 | 回填参与者 |
| `POST` | `/api/admin/data/fix-submission-visibility` | 管理员 | 修复提交可见性 |

这些接口可能修改大量数据，调用前必须备份并记录目标范围。

## 迁移（2）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `POST` | `/api/admin/migration/migrate-submission-scope` | 超管 + 开关 | 迁移提交 scope |
| `POST` | `/api/admin/migration/migrate-problem-status` | 超管 + 开关 | 迁移用户题目状态 |

开关关闭时返回 `404`，角色不足返回 `403`，未登录返回 `401`。只在维护窗口临时设置
`ENABLE_MAINTENANCE_API=true`，完成后立即关闭并重启 Server。

## 开发赛时演示（4）

以下接口只存在于开发预览，均要求 `APP_ENV=development`、
`ENABLE_DEMO_SCENARIO_API=true`、平台管理员或超级管理员身份，以及独立的
`X-Demo-Scenario-Key`。开关、密钥或身份任一不满足时不暴露接口；接口固定操作
“赛时演示 V2/V3”资源，不能接收任意比赛、用户或时间参数。

| 方法 | 路径 | 用途 |
|------|------|------|
| `POST` | `/api/admin/demo-scenario/v2/prepare` | 准备 V2 进行中与待结束比赛的固定赛时窗口 |
| `POST` | `/api/admin/demo-scenario/v2/events` | 按内置且幂等的事件编号写入真实评测队列 |
| `POST` | `/api/admin/demo-scenario/v3/prepare` | 准备 V3 三场 20 小时进行中比赛的固定赛时窗口 |
| `POST` | `/api/admin/demo-scenario/v3/events` | 按内置且幂等的复杂事件编号写入 V3 真实评测队列 |
