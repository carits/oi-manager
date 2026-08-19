---
status: reference
audience: development, testing
last_verified: 2026-08-16
source_of_truth: apps/web/src/app and e2e/fixtures/routes.ts
---

# 页面路由

本清单由实际页面生成并与 E2E 路由清单同步。组织页面统一使用组织路径，个人页面使用个人路径，平台页面使用平台路径。教师和学生旧路径仅保留退役提示页，不承担业务功能。

| 路径 | 访问范围 | 用途 |
|---|---|---|
| `/` | 见页面权限布局 | 当前页面 |
| `/account/platform-bindings` | 见页面权限布局 | 当前页面 |
| `/account/profile` | 见页面权限布局 | 当前页面 |
| `/account/security` | 见页面权限布局 | 当前页面 |
| `/account/wallet` | 见页面权限布局 | 当前页面 |
| `/admin` | 见页面权限布局 | 当前页面 |
| `/admin/platform-bindings` | 见页面权限布局 | 当前页面 |
| `/admin/profile` | 见页面权限布局 | 当前页面 |
| `/admin/schools` | 见页面权限布局 | 当前页面 |
| `/admin/schools/[id]` | 见页面权限布局 | 当前页面 |
| `/admin/schools/[id]/edit` | 见页面权限布局 | 当前页面 |
| `/admin/schools/new` | 见页面权限布局 | 当前页面 |
| `/admin/security` | 见页面权限布局 | 当前页面 |
| `/admin/submissions` | 见页面权限布局 | 当前页面 |
| `/admin/submissions/[id]` | 见页面权限布局 | 当前页面 |
| `/admin/users` | 见页面权限布局 | 当前页面 |
| `/admin/users/[id]` | 见页面权限布局 | 当前页面 |
| `/admin/users/new-platform-admin` | 见页面权限布局 | 当前页面 |
| `/identity` | 见页面权限布局 | 当前页面 |
| `/login` | 见页面权限布局 | 当前页面 |
| `/org/[organizationId]/[module]` | 见页面权限布局 | 当前页面 |
| `/org/[organizationId]/[module]/[...segments]` | 见页面权限布局 | 当前页面 |
| `/personal` | 见页面权限布局 | 当前页面 |
| `/personal/campus` | 见页面权限布局 | 当前页面 |
| `/personal/carits` | 见页面权限布局 | 当前页面 |
| `/personal/contests` | 见页面权限布局 | 当前页面 |
| `/personal/contests/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/contributions` | 见页面权限布局 | 当前页面 |
| `/personal/problem-lists` | 见页面权限布局 | 当前页面 |
| `/personal/problem-lists/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/problem-lists/[id]/edit` | 见页面权限布局 | 当前页面 |
| `/personal/problem-lists/new` | 见页面权限布局 | 当前页面 |
| `/personal/problems` | 见页面权限布局 | 当前页面 |
| `/personal/problems/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/rankings` | 见页面权限布局 | 当前页面 |
| `/personal/submissions` | 见页面权限布局 | 当前页面 |
| `/personal/submissions/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/teams` | 见页面权限布局 | 当前页面 |
| `/personal/teams/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/teams/[id]/contests/[cid]` | 见页面权限布局 | 当前页面 |
| `/personal/teams/[id]/trainings/[tid]` | 见页面权限布局 | 当前页面 |
| `/platform-admin` | 见页面权限布局 | 当前页面 |
| `/platform-admin/carits` | 见页面权限布局 | 当前页面 |
| `/platform-admin/contributions` | 见页面权限布局 | 当前页面 |
| `/platform-admin/oj-accounts` | 见页面权限布局 | 当前页面 |
| `/platform-admin/platform-bindings` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems/[id]` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems/[id]/edit` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems/[id]/note` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems/new` | 见页面权限布局 | 当前页面 |
| `/platform-admin/submissions` | 见页面权限布局 | 当前页面 |
| `/platform-admin/submissions/[id]` | 见页面权限布局 | 当前页面 |
| `/platform-admin/users` | 见页面权限布局 | 当前页面 |
| `/profile/student/[id]` | 见页面权限布局 | 当前页面 |
| `/profile/teacher/[id]` | 见页面权限布局 | 当前页面 |
| `/profile/user/[id]` | 见页面权限布局 | 当前页面 |
| `/student/[[...legacy]]` | 见页面权限布局 | 当前页面 |
| `/super_admin` | 见页面权限布局 | 当前页面 |
| `/teacher/[[...legacy]]` | 见页面权限布局 | 当前页面 |
