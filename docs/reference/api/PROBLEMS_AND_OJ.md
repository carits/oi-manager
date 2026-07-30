---
status: reference
audience: development
last_verified: 2026-07-30
source_of_truth: problem modules, problem-list, OJ and platform-binding routes
---

# 题目与 OJ API

## 题目（21）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/problems` | 登录、角色/可见性 | 题目分页列表 |
| `POST` | `/api/problems` | 管理员/教师/个人学生 | 创建题目 |
| `GET` | `/api/problems/:id` | 登录、可见性 | 题目详情 |
| `PUT` | `/api/problems/:id` | 所有者/管理员 | 更新题目 |
| `DELETE` | `/api/problems/:id` | 所有者/管理员 | 删除题目 |
| `GET` | `/api/problems/:id/note` | 登录、本人 | 题目笔记 |
| `PUT` | `/api/problems/:id/note` | 登录、本人 | 保存题目笔记 |
| `GET` | `/api/problems/:id/attachments` | 登录、题目可见 | 附件列表 |
| `POST` | `/api/problems/:id/attachments` | 所有者/管理员 | 上传附件 |
| `DELETE` | `/api/problems/:id/attachments/:attachmentId` | 所有者/管理员 | 删除附件 |
| `POST` | `/api/problems/:id/statement-pdf` | 所有者/管理员 | 上传题面 PDF |
| `POST` | `/api/problems/:id/solution-pdf` | 所有者/管理员 | 上传题解 PDF |
| `POST` | `/api/problems/:id/statements/pdf` | 所有者/管理员 | 新增 PDF 题面 |
| `PUT` | `/api/problems/:id/statements/:statementId/visibility` | 所有者/管理员 | 题面可见性 |
| `DELETE` | `/api/problems/:id/statements/:statementId` | 所有者/管理员 | 删除题面 |
| `GET` | `/api/problems/:id/judge-config` | 题目管理者 | Judge 配置 |
| `PUT` | `/api/problems/:id/judge-config` | 题目管理者 | 更新 Judge 配置 |
| `GET` | `/api/problems/:id/submissions` | 登录、提交可见性 | 题目提交 |
| `POST` | `/api/problems/:id/ai/translate` | 题目管理者、AI 已配置 | 翻译题面 |
| `POST` | `/api/problems/:id/ai/format` | 题目管理者、AI 已配置 | 格式整理 |
| `GET` | `/api/problems/:id/ai/usage` | 题目管理者 | AI 使用记录 |

测试数据接口在[文件与维护 API](FILES_AND_MAINTENANCE.md)。

## 题单（19）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/problem-lists` | 登录、可见性 | 题单列表 |
| `POST` | `/api/problem-lists` | 教师/负责人/个人学生 | 创建题单 |
| `GET` | `/api/problem-lists/:id` | 登录、可见性 | 题单详情 |
| `PUT` | `/api/problem-lists/:id` | owner/write share | 更新题单 |
| `DELETE` | `/api/problem-lists/:id` | owner | 删除题单 |
| `POST` | `/api/problem-lists/:id/sections` | 可编辑 | 添加章节 |
| `PUT` | `/api/problem-lists/:id/sections/reorder` | 可编辑 | 章节排序 |
| `PUT` | `/api/problem-lists/sections/:sectionId` | 可编辑 | 更新章节 |
| `DELETE` | `/api/problem-lists/sections/:sectionId` | 可编辑 | 删除章节 |
| `POST` | `/api/problem-lists/sections/:sectionId/entries/single` | 可编辑 | 添加单题 |
| `PUT` | `/api/problem-lists/sections/:sectionId/entries/reorder` | 可编辑 | 条目排序 |
| `PUT` | `/api/problem-lists/entries/:entryId` | 可编辑 | 更新条目 |
| `DELETE` | `/api/problem-lists/entries/:entryId` | 可编辑 | 删除条目 |
| `POST` | `/api/problem-lists/:id/entries/resolve` | 可编辑 | 解析批量题号 |
| `GET` | `/api/problem-lists/:id/shares` | owner | 分享列表 |
| `GET` | `/api/problem-lists/:id/share-candidates` | owner | 分享候选 |
| `POST` | `/api/problem-lists/:id/shares` | owner | 创建分享 |
| `DELETE` | `/api/problem-lists/:id/shares/:shareId` | owner | 删除分享 |
| `POST` | `/api/problem-lists/:id/publish-homework` | 教师/负责人、资源 | 发布为作业 |

学校和团队挂载题单的六个端点记录在
[学校与团队 API](ORGANIZATION_AND_TEAMS.md)。

## 用户归档题（7）

所有端点要求登录，并限定为当前用户自己的归档记录。

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/archived-problems` | 本人 | 归档列表 |
| `POST` | `/api/archived-problems` | 本人 | 新增归档 |
| `DELETE` | `/api/archived-problems` | 本人 | 批量清空 |
| `GET` | `/api/archived-problems/:id` | 本人 | 归档详情 |
| `PUT` | `/api/archived-problems/:id` | 本人 | 更新归档 |
| `DELETE` | `/api/archived-problems/:id` | 本人 | 删除归档 |
| `GET` | `/api/archived-problems/stats/summary` | 本人 | 归档统计 |

## OJ 抓题（9）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/oj-fetcher/platforms` | 公开 | 支持平台列表 |
| `GET` | `/api/oj-fetcher/:platform/:problemId` | 登录 | 抓取单题 |
| `POST` | `/api/oj-fetcher/download-attachment` | 登录 | 下载题目附件 |
| `GET` | `/api/oj-fetcher/jobs` | 管理员 | 抓题任务列表 |
| `POST` | `/api/oj-fetcher/jobs/batch` | 管理员 | 创建批量任务 |
| `POST` | `/api/oj-fetcher/jobs/:id/retry` | 管理员 | 重试任务 |
| `DELETE` | `/api/oj-fetcher/jobs/:id` | 管理员 | 删除任务 |
| `GET` | `/api/oj-fetcher/platforms/:platform/config` | 超管 | 获取脱敏配置状态 |
| `PUT` | `/api/oj-fetcher/platforms/:platform/config` | 超管 | 更新平台 Cookie |

配置响应不得包含 Cookie 原文。教师使用单题抓取或受限导入，不具备全局任务权限。

## OJ 账号池（8）

全部要求 `super_admin | platform_admin`：

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/oj-accounts` | 管理员 | 账号列表 |
| `GET` | `/api/oj-accounts/stats` | 管理员 | 账号统计 |
| `POST` | `/api/oj-accounts` | 管理员 | 创建账号 |
| `PUT` | `/api/oj-accounts/:id` | 管理员 | 更新账号 |
| `DELETE` | `/api/oj-accounts/:id` | 管理员 | 删除账号 |
| `POST` | `/api/oj-accounts/:id/verify` | 管理员 | 验证账号 |
| `POST` | `/api/oj-accounts/:id/login` | 管理员 | 刷新登录状态 |
| `POST` | `/api/oj-accounts/batch-verify` | 管理员 | 批量验证 |

密码和 Cookie 使用 `ACCOUNT_ENCRYPT_KEY` 加密，列表响应只返回必要状态。

## 用户平台绑定（12）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/platform-bindings/platforms` | 公开 | 支持绑定的平台 |
| `GET` | `/api/platform-bindings/:platform/config-schema` | 公开 | 平台配置字段 |
| `GET` | `/api/platform-bindings` | 登录、本人 | 全部绑定状态 |
| `GET` | `/api/platform-bindings/:platform` | 登录、本人 | 单平台绑定 |
| `POST` | `/api/platform-bindings/:platform/bind` | 登录、本人 | 绑定或验证 |
| `POST` | `/api/platform-bindings/:platform/refresh` | 登录、本人 | 刷新绑定 |
| `DELETE` | `/api/platform-bindings/:platform` | 登录、本人 | 解除绑定 |
| `POST` | `/api/platform-bindings/codeforces/sync-archive` | 登录、本人 | 同步 CF 归档 |
| `POST` | `/api/platform-bindings/codeforces/sync-submissions` | 登录、本人 | 同步 CF 提交 |
| `POST` | `/api/platform-bindings/luogu/sync-archive` | 登录、本人 | 同步洛谷归档 |
| `POST` | `/api/platform-bindings/luogu/sync-submissions` | 登录、本人 | 同步洛谷提交 |
| `POST` | `/api/platform-bindings/admin/cleanup-submissions` | 管理员 | 去重和修复同步提交 |

## 解析辅助（1）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `POST` | `/api/resolve-problems` | 登录 | 批量解析题目标识 |

