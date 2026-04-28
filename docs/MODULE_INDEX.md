# 业务模块索引 (Module Index)

> 最后更新: 2026-04-27

本文档列出 OI Manager V2 的所有业务模块及其对应的前后端代码位置。

---

## 1. 模块总览

| 模块 | 状态 | 说明 |
|------|------|------|
| 认证 | ✅ 完成 | 登录、注册、Token 管理 |
| 用户管理 | ✅ 完成 | 用户 CRUD、状态管理 |
| 学校管理 | ✅ 完成 | 学校 CRUD、负责人管理（已拆分路由） |
| 教师管理 | ✅ 完成 | 教师 CRUD、权限管理 |
| 学生管理 | ✅ 完成 | 学生 CRUD、Rating 管理 |
| 团队管理 | ✅ 完成 | 团队 CRUD、成员管理、邀请/申请（已拆分路由 + zod 校验） |
| 训练模块 | ✅ 完成 | 训练 CRUD、题目管理、提交评测、排名（已拆分路由） |
| 比赛模块 | ✅ 完成 | 比赛 CRUD、OI/IOI/ICPC 赛制支持 |
| 题目模块 | ✅ 完成 | 题目 CRUD、PDF上传、AI翻译、评测配置（已拆分路由） |
| 题单管理 | ✅ 完成 | 飞书文档式权限题单（题单→章节→题目） |
| 评测记录 | ✅ 完成 | 评测记录列表、筛选、详情（教师/学生/管理员端） |
| Rating 系统 | 🔄 进行中 | Rating 计算、历史记录 |
| 成绩中心 | 📋 计划中 | 成绩统计、报告生成 |
| 文件存储 | ✅ 完成 | 统一文件管理、权限控制、软删除 |

---

## 2. 认证模块 (Auth)

### 功能
- 用户登录（支持多角色入口）
- Token 生成和验证
- 密码修改
- 头像上传

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/login/page.tsx` | 登录页面 |
| `components/AuthProvider.tsx` | 认证状态管理 |
| `lib/auth.ts` | 认证工具函数 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/auth.ts` | 认证 API 路由 |
| `middleware/auth.ts` | 认证中间件 |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户 |
| PUT | `/api/auth/profile` | 更新资料 |
| POST | `/api/auth/avatar` | 上传头像 |
| PUT | `/api/auth/password` | 修改密码 |

---

## 3. 用户管理模块 (Users)

### 功能
- 用户列表（分页、筛选）
- 用户详情
- 启用/禁用用户
- 重置密码
- 创建平台管理员

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/admin/users/page.tsx` | 用户列表（超管） |
| `app/platform-admin/users/page.tsx` | 用户列表（平台管理员） |
| `app/admin/users/[id]/page.tsx` | 用户详情 |
| `app/admin/users/new-platform-admin/page.tsx` | 新建平台管理员 |
| `components/business/UserManagement.tsx` | 用户管理组件 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/users.ts` | 用户 API 路由 |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users` | 用户列表 |
| GET | `/api/users/:id` | 用户详情 |
| PUT | `/api/users/:id` | 更新用户 |
| DELETE | `/api/users/:id` | 删除用户 |
| PUT | `/api/users/:id/status` | 启用/禁用 |
| POST | `/api/users/:id/reset-password` | 重置密码 |

---

## 4. 学校管理模块 (Schools)

### 功能
- 学校列表
- 创建/编辑/删除学校
- 指定学校负责人
- 发布学校公告
- 年级分布统计

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/admin/schools/page.tsx` | 学校列表 |
| `app/admin/schools/new/page.tsx` | 新建学校 |
| `app/admin/schools/[id]/page.tsx` | 学校详情 |
| `app/admin/schools/[id]/edit/page.tsx` | 编辑学校 |
| `app/teacher/school/page.tsx` | 学校信息（教师端） |
| `app/student/school/page.tsx` | 学校信息（学生端） |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/schools.ts` | 学校 API 路由 |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schools` | 学校列表 |
| POST | `/api/schools` | 创建学校 |
| GET | `/api/schools/:id` | 学校详情 |
| PUT | `/api/schools/:id` | 更新学校 |
| DELETE | `/api/schools/:id` | 删除学校 |
| PUT | `/api/schools/:id/principal` | 转移负责人 |

---

## 5. 教师管理模块 (Teachers)

### 功能
- 教师列表
- 创建/编辑/删除教师
- 启用/禁用教师
- 联系方式验证（邮箱或手机号必填）

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/teacher/teachers/page.tsx` | 教师管理 |
| `app/teacher/school-teachers/page.tsx` | 学校教师列表 |
| `app/profile/teacher/[id]/page.tsx` | 教师公开资料 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/teachers.ts` | 教师 API 路由 |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/teachers` | 教师列表 |
| POST | `/api/teachers` | 创建教师 |
| GET | `/api/teachers/:id` | 教师详情 |
| PUT | `/api/teachers/:id` | 更新教师 |
| DELETE | `/api/teachers/:id` | 删除教师 |
| PUT | `/api/teachers/:id/status` | 启用/禁用 |

---

## 6. 学生管理模块 (Students)

### 功能
- 学生列表
- 创建/编辑/删除学生
- 主教练绑定
- Rating 管理
- 年级自动计算
- 排名查看

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/teacher/students/page.tsx` | 学生管理 |
| `app/profile/student/[id]/page.tsx` | 学生公开资料 |
| `app/student/rating/page.tsx` | Rating 查看 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/students.ts` | 学生 API 路由 |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/students` | 学生列表 |
| POST | `/api/students` | 创建学生 |
| GET | `/api/students/:id` | 学生详情 |
| PUT | `/api/students/:id` | 更新学生 |
| DELETE | `/api/students/:id` | 删除学生 |
| GET | `/api/students/rankings` | 学生排名 |

---

## 7. 团队管理模块 (Teams)

### 功能
- 团队列表
- 创建/编辑/删除团队
- 成员管理（教师、学生）
- 团队邀请
- 加入/退出团队

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/teacher/teams/page.tsx` | 团队列表（教师端） |
| `app/teacher/teams/[id]/page.tsx` | 团队详情（教师端） |
| `app/teacher/classes/page.tsx` | 班级管理 |
| `app/student/team/page.tsx` | 我的团队（学生端） |
| `app/student/team/browse/page.tsx` | 浏览可加入团队 |
| `app/student/team/[id]/page.tsx` | 团队详情（学生端） |
| `components/team/TeamCard.tsx` | 团队卡片 |
| `components/team/TeamHeader.tsx` | 团队头部 |
| `components/team/TeamMemberList.tsx` | 成员列表 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `modules/team/team.routes.ts` | 路由挂载入口 |
| `modules/team/team.crud.routes.ts` | 团队 CRUD（12 路由） |
| `modules/team/team.members.routes.ts` | 成员管理（9 路由） |
| `modules/team/team.invitations.routes.ts` | 邀请处理（11 路由） |
| `modules/team/team.requests.routes.ts` | 申请处理（10 路由） |
| `modules/team/schemas/team.schemas.ts` | zod 校验 schema |
| `modules/team/team.service.ts` | 业务逻辑层 |
| `modules/team/team.repository.ts` | 数据访问层 |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/teams` | 团队列表 |
| POST | `/api/teams` | 创建团队 |
| GET | `/api/teams/:id` | 团队详情 |
| PUT | `/api/teams/:id` | 更新团队 |
| DELETE | `/api/teams/:id` | 删除团队 |
| POST | `/api/teams/:id/members` | 添加成员 |
| DELETE | `/api/teams/:id/members/:memberId` | 移除成员 |
| POST | `/api/teams/join` | 加入团队 |
| POST | `/api/teams/leave` | 退出团队 |

---

## 8. 比赛管理模块 (Contests)

### 功能
- 比赛列表
- 创建/编辑/删除比赛
- 题目管理
- 成绩导入
- 榜单展示
- 资源上传

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/teacher/contests/page.tsx` | 比赛管理（教师端） |
| `app/teacher/contests/[id]/page.tsx` | 比赛详情（教师端） |
| `app/student/contests/page.tsx` | 比赛列表（学生端） |
| `app/student/contests/[id]/page.tsx` | 比赛详情（学生端） |
| `components/ContestDetail.tsx` | 比赛详情共用组件 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/contests.ts` | 比赛 API 路由 |

### API
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

---

## 9. 题单管理模块 (Problem Lists)

### 功能
- 题单 CRUD
- 三级结构：题单 → 章节 → 题目条目
- 飞书文档式分享权限（school/team/teacher/student × view/edit/admin）
- 自动题目解析（resolve API + 自动保存）
- 教师和学生均可创建和管理

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/teacher/problem-lists/page.tsx` | 题单列表（教师端） |
| `app/teacher/problem-lists/[id]/page.tsx` | 题单详情（教师端） |
| `app/teacher/problem-lists/new/page.tsx` | 新建题单（教师端） |
| `app/student/problem-lists/page.tsx` | 题单列表（学生端） |
| `app/student/problem-lists/[id]/page.tsx` | 题单详情（学生端） |
| `app/student/problem-lists/new/page.tsx` | 新建题单（学生端） |
| `components/problem/ProblemListPage.tsx` | 题单列表页共享组件 |
| `components/problem/ProblemListDetailPage.tsx` | 题单详情页共享组件（含章节管理、题目添加、分享面板） |
| `components/problem/NewProblemListPage.tsx` | 新建题单共享组件 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/problem-lists.ts` | 题单 API 路由（含章节、条目、分享管理） |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/problem-lists` | 题单列表（tab=mine/shared/all） |
| POST | `/api/problem-lists` | 创建题单（含默认章节） |
| GET | `/api/problem-lists/:id` | 题单详情（含章节→条目→Problem） |
| PUT | `/api/problem-lists/:id` | 更新题单元信息 |
| DELETE | `/api/problem-lists/:id` | 删除题单（硬删除） |
| POST | `/api/problem-lists/:id/sections` | 添加章节 |
| PUT | `/api/problem-lists/sections/:sectionId` | 更新章节 |
| DELETE | `/api/problem-lists/sections/:sectionId` | 删除章节（至少保留一个） |
| PUT | `/api/problem-lists/:id/sections/reorder` | 重排章节 |
| POST | `/api/problem-lists/sections/:sectionId/entries/single` | 添加题目 |
| POST | `/api/problem-lists/:id/entries/resolve` | 批量解析题号 |
| PUT | `/api/problem-lists/entries/:entryId` | 更新条目 |
| DELETE | `/api/problem-lists/entries/:entryId` | 删除条目 |
| PUT | `/api/problem-lists/sections/:sectionId/entries/reorder` | 重排条目 |
| GET | `/api/problem-lists/:id/shares` | 获取分享列表 |
| POST | `/api/problem-lists/:id/shares` | 添加/更新分享 |
| DELETE | `/api/problem-lists/:id/shares/:shareId` | 移除分享 |

### 数据模型
```
ProblemList → ProblemListSection → ProblemListEntry → Problem
                ↕ ProblemListShare (权限分享)
```

---

## 10. 统计模块 (Stats)

### 功能
- 总览统计
- 学校统计
- 年级分布

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/teacher/rankings/page.tsx` | 排名查看 |
| `app/teacher/scores/page.tsx` | 成绩管理 |
| `app/student/scores/page.tsx` | 成绩查看 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/stats.ts` | 统计 API 路由 |
| `routes/students.ts` | 排名 API |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/overview` | 总览统计 |
| GET | `/api/stats/school/:id` | 学校统计 |
| GET | `/api/students/rankings` | 学生排名 |

---

## 12. 评测记录模块 (Submissions)

### 功能
- 评测记录列表（UI 骨架已完成，暂无实际数据）
- 筛选：用户名、OJ平台（含本OJ）、题号、评测结果（14选项）、编程语言（20选项）

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/teacher/submissions/page.tsx` | 评测记录（教师端） |
| `app/student/submissions/page.tsx` | 评测记录（学生端） |
| `app/platform-admin/submissions/page.tsx` | 评测记录（平台管理员端） |
| `components/submission/SubmissionList.tsx` | 共用评测记录列表组件 |
| `lib/judge-constants.ts` | 评测结果 + 编程语言全局常量 |
| `lib/oj-platforms.ts` | OJ 平台选项（含 SUBMISSION_OJ_OPTIONS） |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/submissions.ts` | 评测记录 API 骨架（返回空数组） |

### API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/submissions` | 评测记录列表（骨架） |

### 常量定义
- **评测结果**（14选项）: `lib/judge-constants.ts` → `JUDGE_RESULT_OPTIONS`
- **编程语言**（20选项）: `lib/judge-constants.ts` → `LANGUAGE_OPTIONS`
- **OJ 选项**（含本OJ）: `lib/oj-platforms.ts` → `SUBMISSION_OJ_OPTIONS`

---

## 13. 个人中心模块 (Profile)

### 功能
- 个人资料查看/编辑
- 密码修改
- 头像上传

### 前端代码
| 文件 | 说明 |
|------|------|
| `app/admin/profile/page.tsx` | 个人资料（管理员） |
| `app/teacher/profile/page.tsx` | 个人资料（教师） |
| `app/student/profile/page.tsx` | 个人资料（学生） |
| `app/*/security/page.tsx` | 安全设置 |
| `components/profile/ProfileEditor.tsx` | 资料编辑组件 |
| `components/profile/PasswordEditor.tsx` | 密码修改组件 |

### 后端代码
| 文件 | 说明 |
|------|------|
| `routes/auth.ts` | 认证相关 API |

---

## 14. 模块依赖关系

```
认证模块 (Auth)
    │
    ├──▶ 用户管理 (Users)
    │
    ├──▶ 学校管理 (Schools)
    │       │
    │       ├──▶ 教师管理 (Teachers)
    │       │       │
    │       │       └──▶ 团队管理 (Teams)
    │       │               │
    │       │               ├──▶ 学生管理 (Students)
    │       │               │
    │       │               ├──▶ 比赛管理 (Contests)
    │       │               │
    │       │               └──▶ 题单管理 (Problem Lists)
    │       │
    │       └──▶ 学生管理 (Students)
    │
    └──▶ 统计模块 (Stats)
```

---

## 15. 新增模块开发指南

### 13.1 开发步骤

1. **定义数据模型**
   - 编辑 `apps/server/prisma/schema.prisma`
   - 运行 `pnpm prisma:push`

2. **创建后端路由**
   - 在 `apps/server/src/routes/` 创建路由文件
   - 在 `apps/server/src/index.ts` 注册路由

3. **创建前端页面**
   - 在 `apps/web/src/app/` 对应角色目录创建页面

4. **创建 Hooks**
   - 在 `apps/web/src/hooks/data/` 创建数据获取 Hook
   - 在 `apps/web/src/hooks/actions/` 创建操作 Hook

5. **更新文档**
   - 更新本文档
   - 更新 SYSTEM_MAP.md
   - 更新 API_REFERENCE.md

### 13.2 代码模板

**后端路由模板**:
```typescript
import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth'
import { prisma } from '../prisma'

export const myModuleRouter = Router()

myModuleRouter.get('/', authenticate, async (req, res) => {
  // 列表逻辑
})

myModuleRouter.post('/', authenticate, authorize('teacher'), async (req, res) => {
  // 创建逻辑
})
```

**前端 Hook 模板**:
```typescript
export function useMyData() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiClient.get('/api/my-module').then(res => {
      if (res.success) setData(res.data)
      setLoading(false)
    })
  }, [])

  return { data, loading }
}
```
