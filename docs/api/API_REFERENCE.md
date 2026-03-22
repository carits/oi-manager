# API 接口文档

## API 概述

- **Base URL**: `http://localhost:3001/api`
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

## 接口分类

### 1. [认证接口](./auth.md)
- POST `/auth/login` - 用户登录
- POST `/auth/register` - 用户注册
- GET `/auth/me` - 获取当前用户信息

### 2. [用户管理接口](./users.md)
- GET `/users` - 获取用户列表（分页）
- GET `/users/:id` - 获取用户详情
- POST `/users/:id/reset-password` - 重置用户密码
- PUT `/users/:id/status` - 更新用户状态

### 3. [学校管理接口](./schools.md)
- GET `/schools` - 获取学校列表
- GET `/schools/:id` - 获取学校详情
- POST `/schools` - 创建学校
- PUT `/schools/:id` - 更新学校信息
- PUT `/schools/:id/status` - 更新学校状态
- GET `/schools/:id/stats` - 获取学校统计数据
- GET `/schools/:id/student-rankings` - 获取学校学生 Rating 排名
- PUT `/schools/:id/announcement` - 更新学校公告
- GET `/schools/:id/teachers` - 获取学校教师列表
- POST `/schools/current/teachers` - 创建本校教师
- PUT `/schools/current/teachers/:teacherId` - 更新本校教师
- PUT `/schools/:id/teachers/:teacherId/status` - 更新教师状态
- POST `/schools/current/principal-transfer` - 转移学校负责人

### 4. [教师管理接口](./teachers.md)
- GET `/teachers` - 获取教师列表
- GET `/teachers/:id` - 获取教师详情
- GET `/teachers/me` - 获取当前教师信息
- POST `/teachers` - 创建教师
- PUT `/teachers/:id` - 更新教师信息
- DELETE `/teachers/:id` - 删除教师
- PUT `/teachers/:id/status` - 更新教师状态

### 5. [学生管理接口](./students.md)
- GET `/students` - 获取学生列表
- GET `/students/:id` - 获取学生详情
- POST `/students` - 创建学生
- PUT `/students/:id` - 更新学生信息
- DELETE `/students/:id` - 删除学生

### 6. [团队管理接口](./teams.md)
- GET `/teams` - 获取团队列表
- GET `/teams/:id` - 获取团队详情
- POST `/teams` - 创建团队
- PUT `/teams/:id` - 更新团队信息
- DELETE `/teams/:id` - 删除团队
- POST `/teams/:id/members` - 添加团队成员
- DELETE `/teams/:id/members/:studentId` - 移除团队成员

### 7. [比赛管理接口](./contests.md)
- GET `/contests` - 获取比赛列表
- GET `/contests/:id` - 获取比赛详情
- POST `/contests` - 创建比赛
- PUT `/contests/:id` - 更新比赛信息
- DELETE `/contests/:id` - 删除比赛

### 8. [题单管理接口](./task-lists.md)
- GET `/task-lists` - 获取题单列表
- GET `/task-lists/:id` - 获取题单详情
- POST `/task-lists` - 创建题单
- PUT `/task-lists/:id` - 更新题单信息
- DELETE `/task-lists/:id` - 删除题单

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
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# 使用 token 访问接口
curl -X GET http://localhost:3001/api/users \
  -H "Authorization: Bearer <token>"
```

### 使用 Postman

1. 创建环境变量 `baseUrl`: `http://localhost:3001/api`
2. 创建环境变量 `token`: 登录后获取的 token
3. 在请求头中添加 `Authorization: Bearer {{token}}`

## 更新日志

### 2026-03-18
- ✅ 添加用户管理分页接口
- ✅ 添加学校统计数据接口
- ✅ 添加学校负责人转移接口
- ✅ 添加教师联系方式必填验证
- ✅ 完善权限检查逻辑
