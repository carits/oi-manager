---
status: current
audience: development
last_verified: 2026-07-30
source_of_truth: school, user, teacher and student routes
---

# 学校与用户模块

## 边界

平台由一个特殊学校承载管理员关联；普通学校包含负责人、教师、学生和团队。
`User` 保存登录身份，`Admin/Teacher/Student` 保存角色扩展信息。

## 核心流程

### 创建学校

超级管理员创建学校时同时创建或指定负责人。学校的
`currentPrincipalTeacherId` 必填，用户、教师、学校和日志写入必须在事务中完成。

### 负责人转移

只有超级管理员或符合当前学校规则的负责人可执行。流程更新旧/新用户角色、学校当前
负责人并写入 `PrincipalTransferLog`。失败时事务整体回滚。

### 教师管理

学校负责人可创建、编辑、禁用本校教师。普通教师不能获得负责人专属管理能力。
负责人仍使用 `/teacher/*` 页面，不存在单独的学校管理员前端。

### 学生管理

教师和负责人按学校/团队范围创建、导入、更新和禁用学生。导入采用分阶段
`input → preview → bind → result`，在确认前不写正式数据。

### 平台用户管理

- 超级管理员可创建平台管理员并管理更广范围账号。
- 平台管理员不能管理超级管理员或其他平台管理员。
- 密码重置、状态修改和登录结果写入审计日志。

## 不变量

- 用户名唯一，密码只保存 bcrypt 哈希。
- 所有用户必须关联学校。
- 教师、学生扩展表 ID 与 User ID 对齐。
- 删除或禁用前必须检查负责人、团队、任务和提交等关联。

接口目录见[认证与管理员](../../reference/api/README.md)和
[学校与团队](../../reference/api/README.md)。

