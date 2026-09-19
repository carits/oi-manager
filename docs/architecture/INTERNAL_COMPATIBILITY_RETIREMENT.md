---
status: current
audience: development, operations
last_verified: 2026-09-19
source_of_truth: auth contracts, auth middleware, organization authorization, offline migration scripts
---

# 内部兼容退役清单

## 已退役

- Web 不再提供 `/teacher/**`、`/student/**` 页面；规范组织路由只有 `/org/:organizationId/**`。
- 登录与注册不再接收端角色、`mode`、`studentMode`、学校 ID 或校园档案字段。
- Session 只保存账号身份，不接受或续签旧 `role/schoolId/studentId/teacherId/studentMode` Claims。
- 浏览器与自动化脚本统一使用 HttpOnly Cookie；服务端不读取 Bearer，前端不读取 localStorage Token。
- `/api/auth/session/migrate`、`/api/admin/migration/**`、管理员测试图迁移和单题测试图迁移 HTTP 入口均已删除。
- 组织邀请只使用 OrganizationInvitation；OrganizationMembership 只保留 active/disabled/archived 成员状态。
- /api/students、/api/teachers、/api/schools 及学校题单旧接口已移除，不保留 410 路由。
- 登录审计只保存 accountRoleSnapshot，请求日志分别记录账号角色与组织角色。
- 生产 `User.role` 中的学生、教师、负责人历史值已通过可重跑脚本归一为 `user`，组织岗位仅来自成员关系。

## 保留的离线能力

- 一次性迁移服务保留为离线审计与修复实现，不挂载 HTTP 路由。
- `pnpm --filter server migrate:account-roles` 会先写快照，再校验成员关系、更新账号角色并复核；重复运行应报告零待迁移记录。
- 数据修复必须在服务器运行，输出报告并保留快照；不得临时恢复在线维护接口。

## 暂时保留的业务桥接

- Contest 到 Training 的历史桥接暂不删除。
- JudgeRun 到 Submission 的历史桥接暂不删除。

这两类桥接承载仍在使用的历史事实，不属于登录、路由或维护 API 兼容。本轮只记录边界，不改变其行为。

## 持续检查

- 静态巡检禁止新增 `/teacher/`、`/student/`、`LegacyUserRole`、`studentMode`、Bearer 浏览器认证和在线迁移路由。
- 账号平台权限统一命名为 `accountRole`，校园岗位统一命名为 `organizationRole`。
- 新功能可以使用领域内传输封装；架构门禁只阻止旧兼容、未注册直连和原始传输扩散，不再追求“功能内传输调用数量为零”。
