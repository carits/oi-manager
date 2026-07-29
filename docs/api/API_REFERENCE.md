# API 接口文档

> ⚠️ **文档状态**: 本文档为概要版，详细接口文档待完善。以下列出的是主要接口，部分接口可能未完整记录。

## API 概述

- **Base URL**: `http://localhost:3002/api`
- **认证方式**: JWT Bearer Token
- **响应格式**: JSON
- **统一响应结构**:
  ```typescript
  {
    success: boolean
    data?: any
    message?: string
  }
  ```

## 认证说明

所有需要认证的接口都需要在请求头中携带 JWT Token:

```
Authorization: Bearer <token>
```

Token 通过登录接口获取，包含用户信息：
- `userId`: 用户 ID
- `role`: 用户角色
- `schoolId`: 学校 ID（如果有）

> 📖 **相关文档**: [前后端字段契约规范](./FIELD_CONTRACT.md) - 定义 API 响应结构与前端期望的一致性规范

## 接口分类

### 1. 认证接口
- POST `/auth/login` - 用户登录
- POST `/auth/register` - 用户注册
- GET `/auth/me` - 获取当前用户信息
- PUT `/auth/profile` - 更新个人资料
- POST `/auth/avatar` - 上传头像
- PUT `/auth/password` - 修改密码

### 2. 用户管理接口
- GET `/users` - 获取用户列表（分页）
- GET `/users/:id` - 获取用户详情
- GET `/users/:userId/profile` - 获取用户公开资料
- POST `/users/platform-admin` - 创建平台管理员
- PUT `/users/:id/status` - 更新用户状态
- POST `/users/:id/reset-password` - 重置用户密码
- GET `/users/:id/logs` - 获取用户操作日志

### 3. 学校管理接口
- GET `/schools` - 获取学校列表
- GET `/schools/:id` - 获取学校详情
- POST `/schools` - 创建学校
- PUT `/schools/:id` - 更新学校信息
- DELETE `/schools/:id` - 删除学校
- PUT `/schools/:id/status` - 更新学校状态
- PUT `/schools/:id/principal` - 转移学校负责人
- POST `/schools/:id/principal` - 创建并指定负责人
- GET `/schools/:id/principal-logs` - 获取负责人转移日志
- GET `/schools/:id/stats` - 获取学校统计数据
- GET `/schools/:id/student-rankings` - 获取学校学生 Rating 排名
- PUT `/schools/:id/announcement` - 更新学校公告
- GET `/schools/:id/teachers` - 获取学校教师列表
- GET `/schools/:id/students-by-grade` - 获取按年级分组的学生
- PUT `/schools/:id/teachers/:teacherId/status` - 更新教师状态
- GET `/schools/current/teachers` - 获取本校教师（学校负责人）
- POST `/schools/current/teachers` - 创建本校教师
- PUT `/schools/current/teachers/:teacherId` - 更新本校教师
- POST `/schools/current/principal-transfer` - 转移负责人

### 4. 教师管理接口
- GET `/teachers/me` - 获取当前教师信息
- PUT `/teachers/:id/status` - 更新教师状态
- DELETE `/teachers/:id` - 删除教师

### 5. 学生管理接口
- GET `/students` - 获取学生列表
- GET `/students/:id` - 获取学生详情
- POST `/students` - 创建学生
- PUT `/students/:id` - 更新学生信息
- DELETE `/students/:id` - 删除学生
- GET `/students/rankings` - 获取学生排名

### 6. 团队管理接口
- GET `/teams` - 获取团队列表
- GET `/teams/:id` - 获取团队详情
- POST `/teams` - 创建团队
- PUT `/teams/:id` - 更新团队信息
- DELETE `/teams/:id` - 删除团队
- PUT `/teams/:id/announcement` - 更新团队公告
- POST `/teams/:id/avatar` - 上传团队头像
- GET `/teams/:id/available-members` - 获取可添加的成员
- POST `/teams/:id/members` - 添加团队成员
- DELETE `/teams/:id/members/:memberId` - 移除团队成员
- GET `/teams/:id/pending-invites` - 获取待处理邀请
- GET `/teams/:id/admins` - 获取团队管理员
- POST `/teams/:id/admins` - 添加管理员
- DELETE `/teams/:id/admins/:adminId` - 移除管理员
- POST `/teams/:id/join-request` - 学生申请加入
- GET `/teams/:id/join-requests` - 获取加入申请列表
- POST `/teams/requests/:requestId/approve` - 批准申请
- POST `/teams/requests/:requestId/reject` - 拒绝申请
- POST `/teams/:id/transfer` - 转移团队
- POST `/teams/:id/leave` - 退出团队
- GET `/teams/school/:schoolId` - 获取学校团队
- GET `/teams/student/:studentId` - 获取学生所在团队
- GET `/teams/invitations` - 获取学生邀请列表
- GET `/teams/my-admin-teams` - 获取管理的团队
- GET `/teams/my-member-teams` - 获取加入的团队

### 7. 比赛管理接口
- GET `/contests` - 获取比赛列表
- GET `/contests/:id` - 获取比赛详情
- POST `/contests` - 创建比赛
- PUT `/contests/:id` - 更新比赛信息
- DELETE `/contests/:id` - 删除比赛
- GET `/contests/:id/problems` - 获取比赛题目
- POST `/contests/:id/problems` - 添加题目
- PUT `/contests/:id/problems/:problemId` - 更新题目
- DELETE `/contests/:id/problems/:problemId` - 删除题目
- GET `/contests/:id/results` - 获取比赛成绩
- POST `/contests/:id/results` - 录入成绩
- POST `/contests/:id/results/import` - 导入成绩
- POST `/contests/:id/resources` - 上传资源
- DELETE `/contests/:id/resources/:resourceId` - 删除资源

### 8. 题单管理接口（飞书文档式权限）

> 三级结构：题单 (ProblemList) → 章节 (Section) → 题目条目 (Entry)
> 权限分享：school/team/teacher/student × view/edit/admin

- GET `/problem-lists` - 获取题单列表（tab=mine/shared/all）
- GET `/problem-lists/:id` - 获取题单详情（含章节→条目→Problem）
- POST `/problem-lists` - 创建题单（含默认章节）
- PUT `/problem-lists/:id` - 更新题单元信息
- DELETE `/problem-lists/:id` - 删除题单（硬删除）
- POST `/problem-lists/:id/sections` - 添加章节
- PUT `/problem-lists/sections/:sectionId` - 更新章节
- DELETE `/problem-lists/sections/:sectionId` - 删除章节
- PUT `/problem-lists/:id/sections/reorder` - 重排章节
- POST `/problem-lists/sections/:sectionId/entries/single` - 添加题目
- POST `/problem-lists/:id/entries/resolve` - 批量解析题号
- PUT `/problem-lists/entries/:entryId` - 更新条目
- DELETE `/problem-lists/entries/:entryId` - 删除条目
- GET `/problem-lists/:id/shares` - 获取分享列表
- POST `/problem-lists/:id/shares` - 添加/更新分享
- DELETE `/problem-lists/:id/shares/:shareId` - 移除分享

### 9. 里程碑接口
- GET `/milestones` - 获取里程碑列表
- GET `/milestones/:id` - 获取里程碑详情
- POST `/milestones` - 创建里程碑
- PUT `/milestones/:id` - 更新里程碑
- DELETE `/milestones/:id` - 删除里程碑

### 9.1 训练/比赛/作业接口

> 训练、比赛、作业共用 Training 表，通过 `type` 字段区分

- GET `/teams/:teamId/trainings` - 获取团队训练列表（支持 `?type=contest|homework|training`）
- GET `/trainings/:id` - 获取训练详情
- POST `/teams/:teamId/trainings` - 创建训练/比赛
- PUT `/trainings/:id` - 更新训练
- DELETE `/trainings/:id` - 删除训练
- GET `/trainings/:id/problems` - 获取训练题目列表
- POST `/trainings/:id/problems` - 添加题目（自动生成快照）
- GET `/trainings/:id/problem-status` - 获取学生做题状态
- POST `/trainings/:id/submit` - 提交代码
- GET `/trainings/:id/ranking` - 获取排名
- **POST `/trainings/:id/create-makeup-homework`** - 创建补题作业（仅已结束的训练，需团队管理权限）

#### 创建补题作业

```
POST /api/trainings/:id/create-makeup-homework
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "可选，默认 {原标题} - 补题练习",
  "startTime": "可选，默认当前时间，允许过去时间",
  "endTime": "必填，ISO 8601 格式"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": 1130,
    "title": "OI赛 - 补题练习",
    "type": "homework",
    "sourceTrainingId": 17,
    "startTime": "2026-06-24T00:00:00.000Z",
    "endTime": "2026-07-01T00:00:00.000Z",
    "format": "oi",
    "teamId": "team-contest",
    "problemCount": 9
  }
}
```

**前置条件**: 原训练 status 为 finished（`now > endTime`）
**权限**: 团队 owner/admin 或校级管理员
**默认设置**: `problemIdVisible: true`、`solutionVisible: true`

### 9.5 学校题单接口
- GET `/schools/:schoolId/problem-lists` - 获取学校题单列表（本校成员可见）
- POST `/schools/:schoolId/problem-lists` - 添加题单到学校（负责人/教师，仅 owner 的题单）
- DELETE `/schools/:schoolId/problem-lists/:id` - 移除学校题单（负责人可删所有，教师仅自己添加的）

### 9.6 团队题单接口
- GET `/teams/:teamId/problem-lists` - 获取团队题单列表（团队成员可见）
- POST `/teams/:teamId/problem-lists` - 添加题单到团队（owner/admin/教师成员，仅 owner 的题单）
- DELETE `/teams/:teamId/problem-lists/:id` - 移除团队题单（owner 可删所有，非 owner 仅自己添加的）

### 11. 统计接口
- GET `/stats/global` - 获取全局统计
- GET `/stats/schools` - 获取学校统计
- GET `/stats/contests` - 获取比赛统计

### 12. 文件管理接口
- POST `/files/upload` - 上传文件
- GET `/files/:id/download` - 下载文件（需认证）
- GET `/files/:id/public` - 访问公开文件（无需认证）
- GET `/files/:id` - 获取文件信息
- DELETE `/files/:id` - 删除文件（软删除）
- GET `/files/by-owner/:ownerType/:ownerId` - 按业务对象获取文件列表

## 权限说明

### 角色权限矩阵

| 接口分类 | super_admin | platform_admin | school_principal | teacher | student |
|---------|-------------|----------------|------------------|---------|---------|
| 认证接口 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 用��管理 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 学校管理 | ✅ | ❌ | ✅（本校） | ❌ | ❌ |
| 教师管理 | ✅ | ❌ | ✅（本校） | ❌ | ❌ |
| 学生管理 | ✅ | ❌ | ✅（本校） | ✅（本团队） | ❌ |
| 团队管理 | ✅ | ❌ | ✅（本校） | ✅（本团队） | ❌ |
| 比赛管理 | ✅ | ❌ | ✅（本校） | ✅（本团队） | ❌ |
| 题单管理 | ✅ | ❌ | ✅（本校） | ✅ | ❌ |
| 文件管理 | ✅ | ❌ | ✅（本校） | ✅（本团队） | ✅（自己的文件） |

### 权限检查流程

1. **Token 验证**: 检查 JWT Token 是否有效
2. **角色验证**: 检查用户角色是否有权限访问该接口
3. **资源验证**: 检查用户是否有权限操作该资源（如本校、本团队）

## 错误码说明

| HTTP 状态码 | 说明 | 示例 |
|------------|------|------|
| 200 | 成功 | `{ success: true, data: {...} }` |
| 400 | 请求参数错误 | `{ success: false, message: "参数错误" }` |
| 401 | 未认证 | `{ success: false, message: "未登录" }` |
| 403 | 无权限 | `{ success: false, message: "无权限操作" }` |
| 404 | 资源不存在 | `{ success: false, message: "资源不存在" }` |
| 500 | 服务器错误 | `{ success: false, message: "服务器错误" }` |

## 分页参数

支持分页的接口统一使用以下参数：

**请求参数**:
- `page`: 页码（从 1 开始），默认 1
- `pageSize`: 每页条数，默认 20

**响应格式**:
```typescript
{
  success: true,
  data: {
    users: [...],      // 数据列表
    page: 1,           // 当前页码
    pageSize: 20,      // 每页条数
    total: 100,        // 总记录数
    totalPages: 5      // 总页数
  }
}
```

## 筛选参数

支持筛选的接口统一使用以下参数：

- `role`: 角色筛选
- `status`: 状态筛选
- `keyword`: 关键词搜索（用户名、姓名等）
- `schoolId`: 学校 ID 筛选
- `teamId`: 团队 ID 筛选

## 排序参数

支持排序的接口统一使用以下参数：

- `sortBy`: 排序字段（如 `createdAt`, `rating`）
- `sortOrder`: 排序方向（`asc` 升序 / `desc` 降序）

## 请求示例

### 获取用户列表（分页 + 筛选）

```bash
GET /api/users?page=1&pageSize=20&role=teacher&status=active&keyword=张
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "username": "teacher_zhang",
        "role": "teacher",
        "status": "active",
        "profile": {
          "name": "张老师",
          "schoolName": "雅礼中学"
        },
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### 创建学校

```bash
POST /api/schools
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "雅礼中学",
  "region": "湖南省/长沙市/岳麓区",
  "schoolType": "初中+高中",
  "educationSystem": "6-3-3",
  "contactPerson": "王老师",
  "contactPhone": "13900000000",
  "contactEmail": "wang@example.com",
  "username": "principal_wang",
  "password": "password123",
  "teacherName": "王老师",
  "teacherTitle": "校长"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "school": {
      "id": "uuid",
      "name": "雅礼中学",
      "region": "湖南省/长沙市/岳麓区",
      "schoolType": "初中+高中",
      "educationSystem": "6-3-3",
      "currentPrincipalTeacherId": "uuid",
      "createdAt": "2024-01-01T00:00:00.000Z"
    },
    "principal": {
      "id": "uuid",
      "name": "王老师",
      "title": "校长",
      "userId": "uuid"
    }
  }
}
```

## 开发工具

### 使用 curl 测试

```bash
# 登录获取 token
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"123456"}'

# 使用 token 访问接口
curl -X GET http://localhost:3002/api/users \
  -H "Authorization: Bearer <token>"
```

### 使用 Postman

1. 创建环境变量 `baseUrl`: `http://localhost:3002/api`
2. 创建环境变量 `token`: 登录后获取的 token
3. 在请求头中添加 `Authorization: Bearer {{token}}`

## 更新日志

### 2026-03-23
- ✅ 移除不存在的子文档引用（auth.md, users.md 等）
- ✅ 补充认证接口（/me, /profile, /avatar, /password）
- ✅ 补充用户管理接口（/:id/logs, /platform-admin）
- ✅ 补充学校管理接口（principal-logs, students-by-grade 等）
- ✅ 大幅扩充团队管理接口（约 25 个端点）
- ✅ 补充比赛管理接口（题目管理、资源管理、成绩导入）
- ✅ 新增任务进度接口文档
- ✅ 新增里程碑接口文档
- ✅ 新增统计接口文档

### 2026-03-18
- ✅ 添加用户管理分页接口
- ✅ 添加学校统计数据接口
- ✅ 添加学校负责人转移接口
- ✅ 添加教师联系方式必填验证
- ✅ 完善权限检查逻辑
