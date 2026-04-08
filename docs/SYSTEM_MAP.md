# 系统全景图 (System Map)

> 最后更新: 2026-04-07

本文档描述 OI Manager V2 的完整系统结构，帮助快速理解项目全貌。

---

## 1. 项目结构

```
oi-manager-v2/
├── apps/
│   ├── web/                 # Next.js 前端应用 (端口 3000)
│   │   ├── src/
│   │   │   ├── app/         # 页面路由 (App Router)
│   │   │   ├── components/  # React 组件
│   │   │   ├── hooks/       # 自定义 Hooks
│   │   │   ├── lib/         # 工具函数
│   │   │   └── config/      # 配置文件
│   │   └── public/          # 静态资源
│   │
│   └── server/              # Express 后端应用 (端口 3001)
│       ├── src/
│       │   ├── routes/      # API 路由
│       │   ├── middleware/  # 中间件
│       │   └── index.ts     # 入口文件
│       └── prisma/
│           ├── schema.prisma  # 数据库模型
│           └── seed.ts        # 种子数据
│
├── packages/
│   └── shared/              # 共享类型定义 (暂未使用)
│
├── docs/                    # 项目文档
└── test/                    # 测试文件
```

---

## 2. 角色与入口

| 角色 | 入口路径 | 说明 |
|------|----------|------|
| 超级管理员 | `/admin/*`, `/super_admin/*` | 系统最高权限，管理学校和用户 |
| 平台管理员 | `/platform-admin/*` | 平台级管理，管理用户账号 |
| 学校负责人 | `/admin/schools/[id]/*` | 学校级管理，继承教师权限 |
| 教师 | `/teacher/*` | 团队、学生、比赛、题单管理 |
| 学生 | `/student/*` | 查看个人数据、比赛、题单 |

---

## 3. 前端页面路由

### 3.1 公共页面
| 路径 | 说明 |
|------|------|
| `/` | 首页/登录 |
| `/login` | 登录页 |
| `/profile/teacher/[id]` | 教师公开资料页 |
| `/profile/student/[id]` | 学生公开资料页 |

### 3.2 超级管理员 (`/admin/*`, `/super_admin/*`)
| 路径 | 说明 |
|------|------|
| `/admin` | 管理首页 |
| `/admin/schools` | 学校列表 |
| `/admin/schools/new` | 新建学校 |
| `/admin/schools/[id]` | 学校详情 |
| `/admin/schools/[id]/edit` | 编辑学校 |
| `/admin/users` | 用户管理 |
| `/admin/users/new-platform-admin` | 新建平台管理员 |
| `/admin/users/[id]` | 用户详情 |
| `/admin/profile` | 个人资料 |
| `/admin/security` | 安全设置 |
| `/super_admin` | 超管首页 |

### 3.3 平台管理员 (`/platform-admin/*`)
| 路径 | 说明 |
|------|------|
| `/platform-admin` | 管理首页 |
| `/platform-admin/users` | 用户管理 |
| `/platform-admin/submissions` | 评测记录 |
| `/admin/profile` | 个人资料 (共用) |
| `/admin/security` | 安全设置 (共用) |

### 3.4 教师 (`/teacher/*`)
| 路径 | 说明 |
|------|------|
| `/teacher` | 教师首页 |
| `/teacher/school` | 学校信息 |
| `/teacher/school-teachers` | 学校教师列表 |
| `/teacher/teachers` | 教师管理 |
| `/teacher/students` | 学生管理 |
| `/teacher/teams` | 团队列表 |
| `/teacher/teams/[id]` | 团队详情 |
| `/teacher/classes` | 班级/团队管理 |
| `/teacher/contests` | 比赛管理 |
| `/teacher/contests/[id]` | 比赛详情 |
| `/teacher/problems` | 题目管理 |
| `/teacher/submissions` | 评测记录 |
| `/teacher/problem-lists` | 题单管理 |
| `/teacher/scores` | 成绩管理 |
| `/teacher/rankings` | 排名查看 |
| `/teacher/profile` | 个人资料 |
| `/teacher/security` | 安全设置 |

### 3.5 学生 (`/student/*`)
| 路径 | 说明 |
|------|------|
| `/student` | 学生首页 |
| `/student/school` | 学校信息 |
| `/student/team` | 我的团队 |
| `/student/team/browse` | 浏览可加入团队 |
| `/student/team/[id]` | 团队详情 |
| `/student/contests` | 比赛列表 |
| `/student/contests/[id]` | 比赛详情 |
| `/student/problems` | 题目列表 |
| `/student/submissions` | 评测记录 |
| `/student/problem-lists` | 题单任务 |
| `/student/scores` | 成绩查看 |
| `/student/rating` | Rating 查看 |
| `/student/profile` | 个人资料 |
| `/student/security` | 安全设置 |

---

## 4. 后端 API 路由

### 4.1 认证相关 (`/api/auth/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| PUT | `/api/auth/avatar` | 更新头像 |
| PUT | `/api/auth/password` | 修改密码 |

### 4.2 用户管理 (`/api/users/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users` | 用户列表 (分页) |
| GET | `/api/users/:id` | 用户详情 |
| PUT | `/api/users/:id` | 更新用户 |
| DELETE | `/api/users/:id` | 删除用户 |
| PUT | `/api/users/:id/status` | 启用/禁用用户 |
| POST | `/api/users/:id/reset-password` | 重置密码 |

### 4.3 学校管理 (`/api/schools/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schools` | 学校列表 |
| POST | `/api/schools` | 创建学校 |
| GET | `/api/schools/:id` | 学校详情 |
| PUT | `/api/schools/:id` | 更新学校 |
| DELETE | `/api/schools/:id` | 删除学校 |
| PUT | `/api/schools/:id/principal` | 转移负责人 |

### 4.4 教师管理 (`/api/teachers/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/teachers` | 教师列表 |
| POST | `/api/teachers` | 创建教师 |
| GET | `/api/teachers/:id` | 教师详情 |
| PUT | `/api/teachers/:id` | 更新教师 |
| DELETE | `/api/teachers/:id` | 删除教师 |
| PUT | `/api/teachers/:id/status` | 启用/禁用教师 |

### 4.5 学生管理 (`/api/students/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/students` | 学生列表 |
| POST | `/api/students` | 创建学生 |
| GET | `/api/students/:id` | 学生详情 |
| PUT | `/api/students/:id` | 更新学生 |
| DELETE | `/api/students/:id` | 删除学生 |
| GET | `/api/students/rankings` | 学生排名 |

### 4.6 团队管理 (`/api/teams/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/teams` | 团队列表 |
| POST | `/api/teams` | 创建团队 |
| GET | `/api/teams/:id` | 团队详情 |
| PUT | `/api/teams/:id` | 更新团队 |
| DELETE | `/api/teams/:id` | 删除团队 |
| POST | `/api/teams/:id/members` | 添加成员 |
| DELETE | `/api/teams/:id/members/:memberId` | 移除成员 |
| POST | `/api/teams/:id/invite` | 邀请加入 |
| POST | `/api/teams/join` | 加入团队 |
| POST | `/api/teams/leave` | 退出团队 |

### 4.7 比赛管理 (`/api/contests/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/contests` | 比赛列表 |
| POST | `/api/contests` | 创建比赛 |
| GET | `/api/contests/:id` | 比赛详情 |
| PUT | `/api/contests/:id` | 更新比赛 |
| DELETE | `/api/contests/:id` | 删除比赛 |
| GET | `/api/contests/:id/results` | 比赛成绩 |
| POST | `/api/contests/:id/results` | 导入成绩 |
| GET | `/api/contests/:id/resources` | 比赛资源 |
| POST | `/api/contests/:id/resources` | 上传资源 |
| DELETE | `/api/contests/:id/resources/:resourceId` | 删除资源 |

### 4.8 题单管理 (`/api/problem-lists/*`)

> 飞书文档式权限题单系统，三级结构：题单 → 章节 → 题目条目

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/problem-lists` | 题单列表（tab=mine/shared/all） |
| POST | `/api/problem-lists` | 创建题单（含默认章节） |
| GET | `/api/problem-lists/:id` | 题单详情（含章节→条目→Problem） |
| PUT | `/api/problem-lists/:id` | 更新题单元信息 |
| DELETE | `/api/problem-lists/:id` | 删除题单（硬删除） |
| POST | `/api/problem-lists/:id/sections` | 添加章节 |
| PUT | `/api/problem-lists/sections/:sectionId` | 更新章节 |
| DELETE | `/api/problem-lists/sections/:sectionId` | 删除章节 |
| PUT | `/api/problem-lists/:id/sections/reorder` | 重排章节 |
| POST | `/api/problem-lists/sections/:sectionId/entries/single` | 添加题目 |
| POST | `/api/problem-lists/:id/entries/resolve` | 批量解析题号 |
| PUT | `/api/problem-lists/entries/:entryId` | 更新条目 |
| DELETE | `/api/problem-lists/entries/:entryId` | 删除条目 |
| PUT | `/api/problem-lists/sections/:sectionId/entries/reorder` | 重排条目 |
| GET | `/api/problem-lists/:id/shares` | 获取分享列表 |
| POST | `/api/problem-lists/:id/shares` | 添加/更新分享 |
| DELETE | `/api/problem-lists/:id/shares/:shareId` | 移除分享 |

### 4.9 里程碑 (`/api/milestones/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/milestones` | 里程碑列表 |
| POST | `/api/milestones` | 创建里程碑 |
| PUT | `/api/milestones/:id` | 更新里程碑 |
| DELETE | `/api/milestones/:id` | 删除里程碑 |

### 4.9.1 学校题单 (`/api/schools/:schoolId/problem-lists`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schools/:schoolId/problem-lists` | 获取学校题单列表 |
| POST | `/api/schools/:schoolId/problem-lists` | 添加题单到学校 |
| DELETE | `/api/schools/:schoolId/problem-lists/:id` | 移除学校题单 |

### 4.9.2 团队题单 (`/api/teams/:teamId/problem-lists`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/teams/:teamId/problem-lists` | 获取团队题单列表 |
| POST | `/api/teams/:teamId/problem-lists` | 添加题单到团队 |
| DELETE | `/api/teams/:teamId/problem-lists/:id` | 移除团队题单 |

### 4.10 统计数据 (`/api/stats/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/overview` | 总览统计 |
| GET | `/api/stats/school/:id` | 学校统计 |

### 4.11 评测记录 (`/api/submissions/*`)
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/submissions` | 评测记录列表（骨架，暂返回空数组） |

---

## 5. 数据库模型

### 5.1 核心模型关系

```
School (学校)
  │
  ├── SchoolPrincipal (学校负责人) 1:1
  │
  ├── Teacher (教师) 1:N
  │     │
  │     └── Team (团队) via TeamMember N:M
  │
  ├── Student (学生) 1:N
  │     ├── Team (团队) via TeamMember N:M
  │     ├── ContestResult (比赛成绩) 1:N
  │     ├── RatingHistory (Rating历史) 1:N
  │     └── Milestone (里程碑) 1:N
  │
  └── Team (团队) 1:N
        ├── TeamMember (成员) N:M
        ├── Contest (比赛) 1:N
        └── ProblemList (题单) 1:N
```

### 5.2 模型清单

| 模型 | 说明 | 关键字段 |
|------|------|----------|
| `User` | 用户基础表 | username, password, role, status, sessionKey |
| `School` | 学校 | name, principalId, announcement, gradeSystem |
| `Teacher` | 教师 | userId, schoolId, email, phone |
| `Student` | 学生 | userId, schoolId, mainCoachId, rating, enrollmentYear |
| `Team` | 团队 | name, schoolId, leaderId, avatar |
| `TeamMember` | 团队成员关系 | teamId, userId, role |
| `Contest` | 比赛 | title, teamId, contestDate, type, status |
| `ContestProblem` | 比赛题目 | contestId, orderIndex, title, points |
| `ContestResult` | 比赛成绩 | contestId, studentId, score, ranks |
| `Resource` | 资源文件 | fileName, fileType, fileUrl, contestProblemId |
| `ProblemList` | 题单 | title, schoolId, ownerId, visibility, sortOrder |
| `ProblemListSection` | 题单章节 | problemListId, title, sortOrder |
| `ProblemListEntry` | 题单条目 | sectionId, problemId, ojName, alias, sortOrder |
| `ProblemListShare` | 题单分享 | problemListId, targetType, targetId, permission |
| `SchoolProblemList` | 学校题单 | schoolId, problemListId, addedBy, addedByRole |
| `TeamProblemList` | 团队题单 | teamId, problemListId, addedBy, addedByRole |
| `RatingHistory` | Rating 历史 | studentId, oldRating, newRating, contestId |
| `Milestone` | 里程碑 | studentId, title, date, type |

---

## 6. 前端组件架构

### 6.1 核心组件

| 组件 | 路径 | 说明 |
|------|------|------|
| `AppShell` | `components/AppShell.tsx` | 应用外壳，导航布局 |
| `AuthProvider` | `components/AuthProvider.tsx` | 认证状态管理 |
| `ContestDetail` | `components/ContestDetail.tsx` | 比赛详情共用组件 |

### 6.2 业务组件目录

```
components/
├── business/          # 业务组件
│   └── UserManagement.tsx
├── profile/           # 个人资料组件
│   ├── ProfileEditor.tsx
│   └── PasswordEditor.tsx
├── team/              # 团队相关组件
│   ├── TeamCard.tsx
│   ├── TeamHeader.tsx
│   ├── TeamMemberList.tsx
│   └── TeamInviteListModal.tsx
└── ui/                # 通用 UI 组件 (待补充)
```

### 6.3 Hooks 结构

```
hooks/
├── data/              # 数据获取 Hooks
│   ├── useTeams.ts
│   ├── useTeamDetail.ts
│   ├── useStudents.ts
│   ├── useTeachers.ts
│   └── ...
└── actions/           # 操作 Hooks
    ├── useDelete.ts
    └── useToggleStatus.ts
```

---

## 7. 配置与工具

### 7.1 环境配置

| 文件 | 说明 |
|------|------|
| `apps/web/src/config/env.ts` | 编译时环境变量 |
| `apps/web/src/config/runtime.ts` | 运行时配置 |
| `apps/web/src/lib/assets.ts` | 资源 URL 辅助 |

### 7.2 工具函数

| 文件 | 说明 |
|------|------|
| `lib/apiClient.ts` | 统一 API 客户端 |
| `lib/api.ts` | API 客户端类 |
| `lib/auth.ts` | 认证工具函数 |

---

## 8. 关键技术点

### 8.1 认证流程
1. 用户登录 → JWT Token 生成
2. Token 存储到 localStorage
3. 请求头携带 `Authorization: Bearer <token>`
4. 后端中间件验证 Token
5. 前端 AuthProvider 管理登录状态

### 8.2 权限控制
- **后端**: 中间件检查 `user.role`
- **前端**: AuthProvider 根据 role 显示不同入口
- **sessionKey**: 用于账号隔离，确保数据安全

### 8.3 数据流
```
前端组件 → hooks/data/* → apiClient → /api/* 代理 → 后端路由 → Prisma → SQLite
```

---

## 9. 快速定位

| 需求 | 查看位置 |
|------|----------|
| 添加新页面 | `apps/web/src/app/` 对应角色目录 |
| 添加新 API | `apps/server/src/routes/` |
| 修改数据库 | `apps/server/prisma/schema.prisma` |
| 修改权限逻辑 | `apps/server/src/middleware/auth.ts` |
| 修改导航 | `apps/web/src/components/AppShell.tsx` |
| 修改认证逻辑 | `apps/web/src/components/AuthProvider.tsx` |
