---
status: reference
audience: development
last_verified: 2026-08-01
source_of_truth: school, student, teacher, team and team-import routes
---

# 学校与团队 API

“资源”表示服务端继续检查学校、团队、owner/admin、成员或本人范围。

## 学校（28）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/schools` | 登录、角色范围 | 学校列表 |
| `POST` | `/api/schools` | 超管 | 创建学校与负责人 |
| `GET` | `/api/schools/:id` | 登录、角色范围 | 学校详情 |
| `PUT` | `/api/schools/:id` | 超管/本校负责人 | 更新学校 |
| `DELETE` | `/api/schools/:id` | 超管 | 删除学校 |
| `PUT` | `/api/schools/:id/status` | 超管 | 更新学校状态 |
| `PUT` | `/api/schools/:id/announcement` | 本校负责人 | 更新公告 |
| `POST` | `/api/schools/:id/principal` | 超管 | 指定负责人 |
| `PUT` | `/api/schools/:id/principal` | 超管 | 转移负责人 |
| `GET` | `/api/schools/:id/principal-logs` | 超管 | 负责人变更日志 |
| `POST` | `/api/schools/current/principal-transfer` | 本校负责人、规则校验 | 发起负责人转移 |
| `GET` | `/api/schools/:id/teachers` | 登录、学校范围 | 学校教师 |
| `PUT` | `/api/schools/:id/teachers/:teacherId/status` | 本校负责人 | 教师状态 |
| `GET` | `/api/schools/current/teachers` | 本校负责人/教师 | 当前学校教师 |
| `POST` | `/api/schools/current/teachers` | 本校负责人 | 创建教师 |
| `PUT` | `/api/schools/current/teachers/:teacherId` | 本校负责人 | 更新教师 |
| `GET` | `/api/schools/:id/stats` | 登录、学校范围 | 学校统计 |
| `GET` | `/api/schools/:id/student-rankings` | 校园模式、本校范围 | 校内学生 Rating 排名 |
| `GET` | `/api/schools/:id/student-solved-rankings` | 校园模式、本校范围 | 校内学生解题排名 |
| `GET` | `/api/schools/:id/students-by-grade` | 负责人/教师、学校范围 | 年级学生 |
| `GET` | `/api/schools/:schoolId/contests` | 登录、学校范围 | 学校比赛 |
| `POST` | `/api/schools/:schoolId/contests` | 负责人/教师、学校范围 | 创建学校比赛 |
| `PUT` | `/api/schools/:schoolId/contests/:id` | 负责人/教师、管理资源 | 更新学校比赛 |
| `DELETE` | `/api/schools/:schoolId/contests/:id` | 负责人/教师、管理资源 | 删除学校比赛 |
| `GET` | `/api/schools/:schoolId/problem-lists` | 登录、学校范围 | 学校题单 |
| `POST` | `/api/schools/:schoolId/problem-lists` | 负责人/教师、学校范围 | 挂载学校题单 |
| `DELETE` | `/api/schools/:schoolId/problem-lists/:id` | 负责人/教师、管理资源 | 移除学校题单 |
| `POST` | `/api/schools/init` | 超管 | 初始化平台学校 |

## 学生、教师与里程碑（17）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/students` | 登录、角色范围 | 学生列表 |
| `POST` | `/api/students` | 教师/负责人 | 创建学生 |
| `GET` | `/api/students/:id` | 登录、资源 | 学生详情 |
| `PUT` | `/api/students/:id` | 教师/负责人、资源 | 更新学生 |
| `DELETE` | `/api/students/:id` | 教师/负责人、资源 | 删除学生 |
| `PUT` | `/api/students/:id/account-status` | 教师/负责人、资源 | 学生账号状态 |
| `GET` | `/api/students/rankings` | 教师/负责人 | 学生排名 |
| `GET` | `/api/students/my-homeworks` | 学生 | 我的作业 |
| `GET` | `/api/students/my-contests` | 学生 | 我的比赛 |
| `GET` | `/api/teachers/me` | 教师/负责人 | 当前教师资料 |
| `PUT` | `/api/teachers/:id/status` | 本校负责人 | 教师状态 |
| `DELETE` | `/api/teachers/:id` | 本校负责人 | 删除教师 |
| `GET` | `/api/milestones` | 登录、角色范围 | 里程碑列表 |
| `POST` | `/api/milestones` | 教师 | 创建里程碑 |
| `GET` | `/api/milestones/:id` | 登录、资源 | 里程碑详情 |
| `PUT` | `/api/milestones/:id` | 教师、资源 | 更新里程碑 |
| `DELETE` | `/api/milestones/:id` | 教师、资源 | 删除里程碑 |

里程碑写接口当前显式允许 `teacher`，没有把 `school_principal` 列入同一 authorize
调用；调用方不要假设负责人必然继承这三个端点。

## 当前账号工作区（5）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/me/homeworks` | 工作区、当前成员关系 | 当前账号校园作业 |
| `GET` | `/api/me/contests` | 当前工作区、当前成员关系 | 当前账号比赛 |
| `GET` | `/api/me/overview` | 个人工作区 | 邀请、比赛、最近提交和个人排名摘要 |
| `GET` | `/api/rankings/personal/rating` | 任意角色个人工作区 | 平台级个人 Rating 排名，只返回用户名 |
| `GET` | `/api/rankings/personal/solved` | 任意角色个人工作区 | 平台级个人解题排名，只返回用户名 |

## 团队 CRUD 与成员（25）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/teams` | 登录、角色范围 | 团队列表 |
| `POST` | `/api/teams` | 工作区教师/负责人，或任意角色个人工作区 | 创建当前作用域团队 |
| `GET` | `/api/teams/:id` | 登录、可见性 | 团队详情 |
| `PUT` | `/api/teams/:id` | owner/admin | 更新团队 |
| `DELETE` | `/api/teams/:id` | owner | 删除团队 |
| `GET` | `/api/teams/school/:schoolId` | 登录、学校范围 | 学校团队 |
| `GET` | `/api/teams/student/:studentId` | 登录、资源 | 学生团队 |
| `GET` | `/api/teams/check-team-id` | 登录 | 检查团队 ID |
| `PUT` | `/api/teams/:id/announcement` | owner/admin | 更新公告 |
| `POST` | `/api/teams/:id/avatar` | owner/admin | 上传头像 |
| `POST` | `/api/teams/:id/transfer` | owner | 转让团队 |
| `POST` | `/api/teams/:id/leave` | 成员 | 退出团队 |
| `GET` | `/api/teams/:id/available-members` | owner/admin | 可添加成员 |
| `POST` | `/api/teams/:id/members` | owner/admin | 添加成员 |
| `DELETE` | `/api/teams/:id/members/:memberId` | owner/admin、规则 | 移除成员 |
| `GET` | `/api/teams/:id/admins` | owner/admin | 管理员列表 |
| `POST` | `/api/teams/:id/admins` | owner | 设置管理员 |
| `DELETE` | `/api/teams/:id/admins/:adminId` | owner | 移除管理员 |
| `GET` | `/api/teams/:id/pending-invites` | owner/admin | 待处理邀请 |
| `DELETE` | `/api/teams/:id/invites/:inviteId` | owner/admin | 撤销邀请 |
| `GET` | `/api/teams/:teamId/problem-lists` | 登录、团队范围 | 团队题单 |
| `POST` | `/api/teams/:teamId/problem-lists` | owner/admin/教师 | 挂载题单 |
| `DELETE` | `/api/teams/:teamId/problem-lists/:id` | 管理资源 | 移除题单 |
| `GET` | `/api/teams/:teamId/trainings` | 登录、团队范围 | 团队任务 |
| `POST` | `/api/teams/:teamId/trainings` | owner/admin/教师 | 创建团队任务 |

团队具有服务端维护的 `scope=campus|personal`。校园团队按学校隔离并必须有 `schoolId`；
个人团队的 `schoolId` 为 `null`，所有角色统一以 `user` 成员身份在平台范围内浏览和加入，
成员响应只使用用户名。当前模式与团队作用域不一致时返回 `403` 或详情型 `404`，客户端
传入的 `schoolId` 或 `scope` 不能改变该边界。

## 邀请与申请（15）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/teams/invitations` | 登录、本人 | 我的通用邀请 |
| `POST` | `/api/teams/invitations/:invitationId/accept` | 登录、本人 | 接受通用邀请 |
| `POST` | `/api/teams/invitations/:invitationId/reject` | 登录、本人 | 拒绝通用邀请 |
| `GET` | `/api/teams/admin-invitations` | 登录、本人 | 管理员邀请 |
| `POST` | `/api/teams/admin-invitations/:invitationId/accept` | 登录、本人 | 接受管理员邀请 |
| `POST` | `/api/teams/admin-invitations/:invitationId/reject` | 登录、本人 | 拒绝管理员邀请 |
| `GET` | `/api/teams/member-invitations` | 登录、本人 | 成员邀请 |
| `POST` | `/api/teams/member-invitations/:invitationId/accept` | 登录、本人 | 接受成员邀请 |
| `POST` | `/api/teams/member-invitations/:invitationId/reject` | 登录、本人 | 拒绝成员邀请 |
| `GET` | `/api/teams/my-admin-teams` | 登录、本人 | 管理的团队 |
| `GET` | `/api/teams/my-member-teams` | 登录、本人 | 加入的团队 |
| `POST` | `/api/teams/:id/join-request` | 登录、申请人 | 申请加入 |
| `GET` | `/api/teams/:id/join-requests` | owner/admin | 申请列表 |
| `POST` | `/api/teams/join-requests/:requestId/approve` | owner/admin | 批准申请 |
| `POST` | `/api/teams/join-requests/:requestId/reject` | owner/admin | 拒绝申请 |

## 团队导入（15）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/team-import/platforms` | 教师/负责人、资源 | 支持平台 |
| `GET` | `/api/team-import/teams` | 教师/负责人、资源 | 可导入团队 |
| `POST` | `/api/team-import/start` | 教师/负责人、资源 | 创建通用导入批次 |
| `GET` | `/api/team-import/:batchId/preview` | 发起者/管理者 | 批次预览 |
| `POST` | `/api/team-import/:batchId/confirm` | 发起者/管理者 | 确认导入 |
| `GET` | `/api/team-import/:batchId/result` | 发起者/管理者 | 导入结果 |
| `GET` | `/api/team-import/history/:teamId` | 团队管理者 | 导入历史 |
| `GET` | `/api/team-import/vjudge/groups` | 教师/负责人 | VJudge 组 |
| `POST` | `/api/team-import/vjudge/preview` | 教师/负责人 | VJudge 预览 |
| `POST` | `/api/team-import/vjudge/validate` | 教师/负责人 | VJudge 冲突校验 |
| `POST` | `/api/team-import/vjudge/import` | 教师/负责人、团队权限 | VJudge 导入 |
| `GET` | `/api/team-import/luogu/groups` | 教师/负责人 | 洛谷团队 |
| `POST` | `/api/team-import/luogu/preview` | 教师/负责人 | 洛谷预览 |
| `POST` | `/api/team-import/luogu/validate` | 教师/负责人 | 洛谷冲突校验 |
| `POST` | `/api/team-import/luogu/import` | 教师/负责人、团队权限 | 洛谷导入 |

