---
status: current
audience: development, operations
last_verified: 2026-09-20
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

- 已完成且无运行时引用的一次性迁移服务已删除：Assignment 11/11 已迁移，Judge Program 10/10 已迁移，Membership Role 20,186/20,186 已规范化，School Name Key 2/2 已校验；Submission I/O 与 Economy Loop 审计均为零阻塞。
- Training Engine 审计仍有 6 条无法安全自动归属的历史记录，因此只保留离线审计与显式修复服务；不得默认补组织或重新挂载 HTTP API。
- School Directory 的 `legacy` 状态仍是当前目录治理事实，保留离线目录状态修复能力，不作为登录、授权或资源归属回退。
- `pnpm --filter server migrate:account-roles` 会先写快照，再校验成员关系、更新账号角色并复核；重复运行应报告零待迁移记录。
- 数据修复必须在服务器运行，输出报告并保留快照；不得临时恢复在线维护接口。

## 业务桥接退役

- Contest 直接拥有公开数字 ID、题目、参赛者、生命周期和 Rating 事实；不再创建、更新或查询
  Training(type=contest) 镜像，也不保留 runtimeTrainingId/runtimeTrainingProblemId。
- 比赛题目状态只保存 Contest/ContestProblem 身份；旧整数比赛与题目键已删除。
- Submission 只保存不可变提交意图，当前和历史执行结果只来自 JudgeRun/JudgeAttempt；
  Submission 上的 12 个执行镜像列、轮询器和双写迁移服务已删除。
- 历史 Training 比赛行可作为不再读取的旧数据保留，迁移后不会参与任何比赛业务写入或查询。
- 架构门禁同时禁止恢复 Training 投影写入、旧 Contest 聚合服务和 Submission 结果镜像。

## 持续检查

- 静态巡检禁止新增 `/teacher/`、`/student/`、`LegacyUserRole`、`studentMode`、Bearer 浏览器认证和在线迁移路由。
- 账号平台权限统一命名为 `accountRole`，校园岗位统一命名为 `organizationRole`。
- 新功能可以使用领域内传输封装；架构门禁只阻止旧兼容、未注册直连和原始传输扩散，不再追求“功能内传输调用数量为零”。
