---
status: reference
audience: development
last_verified: 2026-08-02
source_of_truth: training modules, submit and submissions routes
---

# 训练与提交 API

访问中的“资源”表示任务管理者、参与者或提交可见性检查。

## 训练（28）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `GET` | `/api/trainings/:id` | 登录、资源 | 任务详情 |
| `GET` | `/api/trainings/:id/overview` | 登录、资源 | 首屏任务、题目摘要及当前用户题目状态 |
| `PUT` | `/api/trainings/:id` | 教师/负责人、管理资源 | 更新任务 |
| `DELETE` | `/api/trainings/:id` | 教师/负责人、管理资源 | 删除任务 |
| `PUT` | `/api/trainings/:id/end-time` | 教师/负责人、管理资源 | 修改截止时间 |
| `POST` | `/api/trainings/:id/create-makeup-homework` | 教师/负责人 | 创建补题作业 |
| `GET` | `/api/trainings/:id/problems` | 登录、资源 | 题目列表 |
| `POST` | `/api/trainings/:id/problems` | 教师/负责人、管理资源 | 添加题目 |
| `PUT` | `/api/trainings/:id/problems/reorder` | 教师/负责人、管理资源 | 题目排序 |
| `PUT` | `/api/trainings/:id/problems/:problemId` | 教师/负责人、管理资源 | 更新任务题目 |
| `DELETE` | `/api/trainings/:id/problems/:problemId` | 教师/负责人、管理资源 | 移除题目 |
| `GET` | `/api/trainings/:id/problems/:problemId/detail` | 登录、资源 | 任务题面与当前用户笔记工作区 |
| `GET` | `/api/trainings/:id/problems/:problemId/attachments` | 登录、资源 | 任务题目附件 |
| `GET` | `/api/trainings/:id/problems/:problemId/files/:fileId` | 登录、任务上下文 | 读取已授权题面或附件的私有文件 |
| `GET` | `/api/trainings/:id/problems/:problemId/solution` | 登录、可见性 | 题解 |
| `GET` | `/api/trainings/:id/solutions` | 登录、可见性 | 批量题解 |
| `GET` | `/api/trainings/:id/attachments` | 登录、资源 | 批量附件 |
| `GET` | `/api/trainings/:id/problems/:problemId/note` | 登录、本人 | 个人笔记 |
| `PUT` | `/api/trainings/:id/problems/:problemId/note` | 登录、本人 | 保存个人笔记 |
| `GET` | `/api/trainings/:id/problem-status` | 登录、资源 | 用户题目状态 |
| `GET` | `/api/trainings/:id/ranking` | 登录、资源 | 排名 |
| `GET` | `/api/trainings/:id/record` | 登录、本人/管理者 | 比赛记录 |
| `PUT` | `/api/trainings/:id/record` | 登录、本人 | 保存比赛记录 |
| `POST` | `/api/trainings/:id/submit` | 参与者 | 在任务中提交 |
| `GET` | `/api/trainings/:id/submissions` | 登录、资源 | 任务提交列表 |
| `GET` | `/api/trainings/:id/submissions/:submissionId` | 登录、资源 | 任务提交详情 |
| `POST` | `/api/trainings/:id/rejudge` | 教师/负责人、资源 | 重评任务提交 |

团队任务的创建接口 `GET/POST /api/teams/:teamId/trainings` 记录在
[学校与团队 API](ORGANIZATION_AND_TEAMS.md)。
任务上下文文件接口不会赋予学生原始题库权限；切换题目、训练或文件 ID 都会失去授权。

## 全局提交（5）

| 方法 | 路径 | 访问 | 用途 |
|------|------|------|------|
| `POST` | `/api/submit` | 登录、题目可见 | 创建 Carits 或外部 OJ 提交 |
| `POST` | `/api/submit/rejudge` | 登录 | 按 submissionId 重评 |
| `GET` | `/api/submissions` | 登录、角色范围 | 提交分页列表 |
| `GET` | `/api/submissions/:id` | 登录、可见性 | 提交详情与源码 |
| `POST` | `/api/submissions/:id/refetch-code` | 登录、可见性 | 重新拉取外部源码 |

`POST /api/submit/rejudge` 当前路由只声明登录认证，未在路由层细分管理员角色；调用方
不能把它视为管理员专属接口。正式上线前应结合 submission scope 再审计授权策略。

## 本地提交请求

```json
{
  "problemId": "internal-or-platform-id",
  "oj": "carits",
  "language": "cpp17",
  "code": "source code",
  "submitMethod": "myAccount"
}
```

任务内提交使用 `/api/trainings/:id/submit` 并包含任务题目上下文。Carits 提交进入
`queuing`，Judge 完成后写入结果、用时、内存、分数、cases 和 subtasks。

两个提交入口都接受 `Idempotency-Key` 请求头。相同用户、相同键和相同请求体在
十分钟内返回同一提交；同一键对应不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。
当前开发服务器使用单进程内存登记，进程重启后登记失效，正式多实例部署前需要
替换为共享持久化存储。

