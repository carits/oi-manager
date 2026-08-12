---
status: reference
audience: development, testing
last_verified: 2026-08-07
source_of_truth: apps/web/src/app and e2e/fixtures/routes.ts
---

# 页面路由

当前共有 110 个 `page.tsx`。动态参数：`[id]` 为资源 ID，`[cid]` 为作业/比赛 ID，
`[tid]` 为训练 ID。

## 公共入口（2）

| 路径 | 身份 | 页面 |
|------|------|------|
| `/` | 公开 | 角色入口 |
| `/login` | 公开 | 登录表单 |

## 超级管理员（12）

| 路径 | 身份 | 页面 |
|------|------|------|
| `/super_admin` | 超管 | 兼容首页 |
| `/admin` | 超管 | 管理首页 |
| `/admin/platform-bindings` | 超管 | 自身平台绑定 |
| `/admin/profile` | 超管 | 个人资料 |
| `/admin/schools` | 超管 | 学校列表 |
| `/admin/schools/[id]` | 超管 | 学校详情 |
| `/admin/schools/[id]/edit` | 超管 | 编辑学校 |
| `/admin/schools/new` | 超管 | 创建学校 |
| `/admin/security` | 超管 | 安全设置 |
| `/admin/users` | 超管 | 用户管理 |
| `/admin/users/[id]` | 超管 | 用户详情 |
| `/admin/users/new-platform-admin` | 超管 | 创建平台管理员 |

## 平台管理员（11）

| 路径 | 身份 | 页面 |
|------|------|------|
| `/platform-admin` | 平台管理员 | 首页 |
| `/platform-admin/oj-accounts` | 平台管理员 | OJ 账号池 |
| `/platform-admin/platform-bindings` | 平台管理员 | 自身平台绑定 |
| `/platform-admin/problems` | 平台管理员 | 平台题库与 OJ 抓题 |
| `/platform-admin/problems/[id]` | 平台管理员 | 题目详情 |
| `/platform-admin/problems/[id]/edit` | 平台管理员 | 编辑题目 |
| `/platform-admin/problems/[id]/note` | 平台管理员 | 题目笔记 |
| `/platform-admin/problems/new` | 平台管理员 | 创建题目 |
| `/platform-admin/submissions` | 平台管理员 | 提交列表 |
| `/platform-admin/submissions/[id]` | 平台管理员 | 提交详情 |
| `/platform-admin/users` | 平台管理员 | 用户管理 |

## 资料页（2）

资料页本身没有角色 layout，但数据 API 要求登录。

| 路径 | 身份 | 页面 |
|------|------|------|
| `/profile/student/[id]` | 已登录 | 学生公开资料 |
| `/profile/teacher/[id]` | 已登录 | 教师公开资料 |
| `/profile/user/[id]` | logged in, personal-safe profile | ordinary account public profile |

## 账号设置（3）

账号设置在工作和个人工作区共享，不改变业务资源作用域。

| 路径 | 身份 | 页面 |
|------|------|------|
| `/account/profile` | 全部已登录角色 | 账号资料 |
| `/account/security` | 全部已登录角色 | 安全设置 |
| `/account/platform-bindings` | 全部已登录角色 | 平台绑定 |

## 个人工作区（16）

五种数据库角色均可访问。个人页面只显示用户名与个人身份，不展示学校、实名、职称或后台岗位。

| 路径 | 身份 | 页面 |
|------|------|------|
| `/personal` | 个人工作区 | 个人首页 |
| `/personal/teams` | 个人工作区 | 团队列表与邀请 |
| `/personal/teams/[id]` | 个人工作区、可见资源 | 团队详情 |
| `/personal/teams/[id]/contests/[cid]` | 个人工作区、团队资源 | 团队比赛 |
| `/personal/teams/[id]/trainings/[tid]` | 个人工作区、团队资源 | 团队训练 |
| `/personal/problems` | 个人工作区 | 已发布平台题 |
| `/personal/problems/[id]` | 个人工作区、公开题目 | 题目详情 |
| `/personal/contests` | 个人工作区 | 个人团队比赛 |
| `/personal/contests/[id]` | 个人工作区、可见资源 | 比赛详情 |
| `/personal/campus` | 个人工作区 | 兼容入口，返回个人首页 |
| `/personal/problem-lists` | 个人工作区 | 个人题单 |
| `/personal/problem-lists/new` | 个人工作区 | 创建题单 |
| `/personal/problem-lists/[id]` | 个人工作区、可见资源 | 题单详情 |
| `/personal/problem-lists/[id]/edit` | 个人工作区、所有者 | 编辑题单 |
| `/personal/submissions` | 个人工作区 | 个人提交 |
| `/personal/submissions/[id]` | 个人工作区、本人 | 提交详情 |
| `/personal/rankings` | 个人工作区 | 个人 Rating 与解题排名 |

## 组织工作区（1）

学校工作区统一通过 URL 选择当前组织；服务端按组织成员关系验证访问范围。首期仅开放学校组织，页面组件复用现有校园业务页面。

| 路径 | 身份 | 页面 |
|------|------|------|
| `/org/[organizationId]/[module]` | 有效学校成员 | 组织概览、校园、成员、团队、作业、比赛、题库、题单或排名 |

## 学生与旧兼容入口（27）

`/student` 是校园工作区。旧学生个人模式地址在个人会话中由服务端重定向至
`/personal/*` 或 `/account/*`；不存在对应新能力的旧编辑地址回到最接近的可用页面。

| 路径 | 模式 | 页面 |
|------|------|------|
| `/student` | 全部 | 学生首页 |
| `/student/contests` | 全部 | 比赛列表 |
| `/student/contests/[cid]` | 全部 | 比赛详情 |
| `/student/homeworks` | 校园 | 作业列表 |
| `/student/homeworks/[cid]` | 校园 | 作业详情 |
| `/student/platform-bindings` | 全部 | 平台绑定 |
| `/student/problem-lists` | 全部 | 题单列表 |
| `/student/problem-lists/[id]` | 全部 | 题单详情 |
| `/student/problem-lists/new` | 个人创建 | 创建题单 |
| `/student/problems` | 旧兼容入口 | 个人模式跳转 `/personal/problems`，校园模式回首页 |
| `/student/problems/[id]` | 旧兼容入口 | 个人模式跳转个人题目详情 |
| `/student/problems/[id]/edit` | 旧兼容入口 | 不再提供学生题库编辑 |
| `/student/problems/[id]/note` | 旧兼容入口 | 个人模式跳转个人笔记 |
| `/student/problems/new` | 旧兼容入口 | 不再提供学生题库创建 |
| `/student/profile` | 全部 | 个人资料 |
| `/student/rating` | 全部 | Rating |
| `/student/school` | 校园 | 学校信息 |
| `/student/school/contests/[cid]` | 校园 | 学校比赛 |
| `/student/scores` | 校园 | 成绩 |
| `/student/security` | 全部 | 安全设置 |
| `/student/submissions` | 个人 | 提交列表 |
| `/student/submissions/[id]` | 个人 | 提交详情 |
| `/student/team` | 全部 | 我的团队 |
| `/student/team/[id]` | 成员/可见 | 团队详情 |
| `/student/team/[id]/contests/[cid]` | 成员 | 团队比赛 |
| `/student/team/[id]/trainings/[tid]` | 成员 | 团队训练 |
| `/student/team/browse` | 全部 | 浏览团队 |

## 教师与学校负责人（36）

| 路径 | 身份 | 页面 |
|------|------|------|
| `/teacher` | 负责人/教师 | 首页 |
| `/teacher/contests` | 负责人/教师 | 比赛列表 |
| `/teacher/homeworks` | 负责人/教师 | 作业列表 |
| `/teacher/homeworks/[cid]` | 负责人/教师 | 作业详情 |
| `/teacher/platform-bindings` | 负责人/教师 | 平台绑定 |
| `/teacher/problem-lists` | 负责人/教师 | 题单列表 |
| `/teacher/problem-lists/[id]` | 负责人/教师 | 题单详情 |
| `/teacher/problem-lists/new` | 负责人/教师 | 创建题单 |
| `/teacher/problems` | 负责人/教师 | 独立的“校内题库 / 平台题库”标签 |
| `/teacher/problems/[id]` | 负责人/教师 | 题目详情 |
| `/teacher/problems/[id]/edit` | 作者/本校负责人 | 编辑学校题目 |
| `/teacher/problems/[id]/note` | 负责人/教师 | 题目笔记 |
| `/teacher/problems/new` | 负责人/教师 | 创建题目 |
| `/teacher/profile` | 负责人/教师 | 个人资料 |
| `/teacher/rankings` | 负责人/教师 | 排名 |
| `/teacher/school` | 负责人/教师 | 学校信息 |
| `/teacher/school/contests/[cid]` | 负责人/教师 | 学校比赛 |
| `/teacher/school-teachers` | 负责人/教师 | 兼容入口，服务端跳转至学校教师标签 |
| `/teacher/scores` | 负责人/教师 | 成绩 |
| `/teacher/security` | 负责人/教师 | 安全设置 |
| `/teacher/students` | 负责人/教师 | 学生管理 |
| `/teacher/students/import` | 负责人/教师 | 学生导入入口 |
| `/teacher/students/import/bind` | 负责人/教师 | 绑定已有学生 |
| `/teacher/students/import/input` | 负责人/教师 | 导入输入 |
| `/teacher/students/import/preview` | 负责人/教师 | 导入预览 |
| `/teacher/students/import/result` | 负责人/教师 | 导入结果 |
| `/teacher/submissions` | 负责人/教师 | 提交列表 |
| `/teacher/submissions/[id]` | 负责人/教师 | 提交详情 |
| `/teacher/teachers` | 学校负责人 | 教师管理 |
| `/teacher/team-import/luogu` | 负责人/教师 | 洛谷团队导入 |
| `/teacher/team-import/vjudge` | 负责人/教师 | VJudge 团队导入 |
| `/teacher/teams` | 负责人/教师 | 团队列表 |
| `/teacher/teams/[id]` | 管理者/成员 | 团队详情 |
| `/teacher/teams/[id]/contests/[cid]` | 管理者/成员 | 团队比赛 |
| `/teacher/teams/[id]/homeworks/[cid]` | 管理者/成员 | 团队作业 |
| `/teacher/teams/[id]/trainings/[tid]` | 管理者/成员 | 团队训练 |

`pnpm docs:check` 会将本表中的反引号路径与实际 `page.tsx` 及 E2E route manifest 比较。
