# 团队模块 API 契约

> 创建时间: 2026-03-25
> 状态: 规范草案

---

## 1. API 概述

### 1.1 基础信息

- **Base URL**: `/api/teams`
- **认证方式**: JWT Bearer Token
- **响应格式**: JSON
- **统一响应结构**:
  ```typescript
  {
    success: boolean
    data?: any
    message?: string
    error?: string  // 错误码
  }
  ```

### 1.2 认证要求

所有端点都需要认证，除非特别说明：

```
Authorization: Bearer <token>
```

### 1.3 错误码列表

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| UNAUTHORIZED | 401 | 未登录 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在 |
| TEAM_NOT_FOUND | 404 | 团队不存在 |
| MEMBER_NOT_FOUND | 404 | 成员不存在 |
| REQUEST_NOT_FOUND | 404 | 申请不存在 |
| NOT_TEAM_MEMBER | 403 | 非团队成员 |
| NOT_TEAM_ADMIN | 403 | 非团队管理员 |
| NOT_TEAM_OWNER | 403 | 非团队所有者 |
| SCHOOL_MISMATCH | 403 | 学校不匹配 |
| ALREADY_MEMBER | 400 | 已是成员 |
| NOT_PENDING | 400 | 状态不是待处理 |
| CANNOT_REMOVE_OWNER | 403 | 不能移除所有者 |
| CANNOT_REMOVE_SELF | 400 | 不能移除自己 |
| OWNER_MUST_TRANSFER | 400 | 所有者必须先转移 |
| TEAM_LIMIT_EXCEEDED | 400 | 团队数量超限 |
| REQUEST_ALREADY_EXISTS | 400 | 申请已存在 |
| REQUEST_ALREADY_PROCESSED | 400 | 申请已处理 |
| INVITATION_NOT_PENDING | 400 | 邀请已不是待处理 |
| CANNOT_INVITE_SELF | 400 | 不能邀请自己 |
| CANNOT_DOWNGRADE_OWNER | 400 | 不能直接降级所有者 |
| MEMBER_NOT_ACTIVE | 400 | 成员不是活跃状态 |

---

## 2. 团队 CRUD API

### 2.1 GET /api/teams - 获取团队列表

**权限要求**: 已登录用户

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 20 |
| schoolId | string | 否 | 学校 ID 筛选 |
| keyword | string | 否 | 关键词搜索 |

**响应**:
```typescript
{
  success: true,
  data: {
    teams: Array<{
      id: string
      name: string
      avatar: string | null
      description: string | null
      isPublic: boolean
      memberCount: number
      ownerName: string
      school: { id: string, name: string }
      createdAt: string
    }>,
    page: number,
    pageSize: number,
    total: number,
    totalPages: number
  }
}
```

---

### 2.2 POST /api/teams - 创建团队

**权限要求**: teacher 或 student

**请求体**:
```typescript
{
  name: string        // 必填，1-50 字符
  description?: string
  schoolId: string    // 必填，必须与当前用户同校
  isPublic: boolean   // 默认 true
}
```

**前置条件**:
- 用户拥有的团队数未达上限（教师 50，学生 5）
- schoolId 与用户同校

**响应**:
```typescript
{
  success: true,
  data: {
    id: string
    name: string
    description: string | null
    schoolId: string
    isPublic: boolean
    createdAt: string
  }
}
```

**错误**:
- `SCHOOL_MISMATCH`: 学校不匹配
- `TEAM_LIMIT_EXCEEDED`: 团队数量超限

---

### 2.3 GET /api/teams/:id - 获取团队详情

**权限要求**:
- 公开团队: 同校用户
- 私有团队: 团队成员

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 团队 ID |

**响应**:
```typescript
{
  success: true,
  data: {
    id: string
    name: string
    avatar: string | null
    description: string | null
    announcement: string | null
    schoolId: string
    isPublic: boolean
    createdAt: string
    updatedAt: string
    school: {
      id: string
      name: string
    },
    members: Array<{
      id: string
      userId: string
      userType: 'teacher' | 'student'
      role: 'owner' | 'admin' | 'member'
      status: 'pending' | 'active'
      joinedAt: string
      name: string
      avatar: string | null
      invitedBy: string | null
    }>,
    myRole?: 'owner' | 'admin' | 'member' | null  // 当前用户的角色
  }
}
```

**错误**:
- `TEAM_NOT_FOUND`: 团队不存在
- `FORBIDDEN`: 无权查看私有团队

---

### 2.4 PUT /api/teams/:id - 更新团队信息

**权限要求**: owner 或 admin

**请求体**:
```typescript
{
  name?: string        // 1-50 字符
  description?: string
  isPublic?: boolean   // 仅 owner 可修改
  announcement?: string
}
```

**状态检查**:
- 无（任何状态都可编辑）

**响应**:
```typescript
{
  success: true,
  data: {
    id: string
    name: string
    // ... 更新后的团队信息
  }
}
```

**错误**:
- `TEAM_NOT_FOUND`: 团队不存在
- `NOT_TEAM_ADMIN`: 非管理员
- `NOT_TEAM_OWNER`: 尝试修改 isPublic 但不是 owner

---

### 2.5 DELETE /api/teams/:id - 删除团队

**权限要求**: owner 且无其他成员，或 super_admin

**前置条件**:
- 仅剩 owner 一个成员，或
- 操作者是 super_admin

**响应**:
```typescript
{
  success: true,
  message: "团队已删除"
}
```

**错误**:
- `TEAM_NOT_FOUND`: 团队不存在
- `NOT_TEAM_OWNER`: 非 owner
- `FORBIDDEN`: 有其他成员

---

## 3. 成员管理 API

### 3.1 POST /api/teams/:id/members - 邀请成员

**权限要求**: owner 或 admin

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 团队 ID |

**请求体**:
```typescript
// 单个邀请
{
  userId: string
  userType: 'teacher' | 'student'
  role?: 'member' | 'admin'  // 默认 member
}

// 批量邀请
{
  members: Array<{
    userId: string
    userType: 'teacher' | 'student'
    role?: 'member' | 'admin'
  }>
}
```

**前置条件**:
- 被邀请人与团队同校
- 被邀请人不是团队成员
- 邀请人不是被邀请人自己
- admin 只能邀请 member，owner 可邀请 admin

**响应**:
```typescript
// 单个邀请
{
  success: true,
  data: {
    id: string           // 成员记录 ID
    userId: string
    userType: string
    role: string
    status: 'pending'
    invitedBy: string
  }
}

// 批量邀请
{
  success: true,
  data: {
    invited: Array<{ userId: string, userType: string }>,
    alreadyMember: Array<{ userId: string, userType: string }>,
    notFound: Array<{ userId: string, userType: string }>,
    schoolMismatch: Array<{ userId: string, userType: string }>
  }
}
```

**错误**:
- `TEAM_NOT_FOUND`: 团队不存在
- `NOT_TEAM_ADMIN`: 非管理员
- `SCHOOL_MISMATCH`: 被邀请人非同校
- `ALREADY_MEMBER`: 已是成员
- `CANNOT_INVITE_SELF`: 邀请自己

---

### 3.2 DELETE /api/teams/:id/members/:memberId - 移除成员

**权限要求**: owner 或 admin

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 团队 ID |
| memberId | string | **用户 ID**（Teacher/Student ID，非 TeamMember 记录 ID） |

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| memberType | string | 推荐 | 用户类型：`teacher` / `student`。不传时回退到 TeamMember 记录 ID 查找（兼容模式） |

**前置条件**:
- 目标成员存在且属于该团队
- 目标成员不是 owner
- admin 只能移除 member，owner 可移除 admin
- 不能移除自己

**状态检查**:
- 目标成员可以是 active 或 pending 状态

**响应**:
```typescript
{
  success: true,
  message: "成员已移除"
}
```

**错误**:
- `TEAM_NOT_FOUND`: 团队不存在
- `MEMBER_NOT_FOUND`: 成员不存在
- `NOT_TEAM_ADMIN`: 非管理员
- `CANNOT_REMOVE_OWNER`: 不能移除 owner
- `CANNOT_REMOVE_SELF`: 不能移除自己

---

### 3.3 POST /api/teams/:id/leave - 退出团队

**权限要求**: 团队成员

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 团队 ID |

**前置条件**:
- 非 owner: 直接退出
- owner 且无其他成员: 团队解散
- owner 且有其他成员: 禁止，需先转移

**状态检查**:
- 必须是 active 成员

**响应**:
```typescript
{
  success: true,
  message: "已退出团队" | "团队已解散"
}
```

**错误**:
- `TEAM_NOT_FOUND`: 团队不存在
- `NOT_TEAM_MEMBER`: 非团队成员
- `OWNER_MUST_TRANSFER`: owner 需先转移所有权

---

## 4. 邀请管理 API

### 4.1 GET /api/teams/:id/pending-invites - 获取待处理邀请

**权限要求**: owner 或 admin

**响应**:
```typescript
{
  success: true,
  data: Array<{
    id: string
    userId: string
    userType: 'teacher' | 'student'
    role: 'member' | 'admin'
    status: 'pending'
    invitedBy: string
    joinedAt: string
    user: {
      id: string
      name: string
      avatar: string | null
    }
  }>
}
```

---

### 4.2 GET /api/teams/invitations - 获取我的邀请列表

**权限要求**: 已登录用户

**响应**:
```typescript
{
  success: true,
  data: {
    pending: Array<{
      id: string
      teamId: string
      teamName: string
      teamAvatar: string | null
      role: 'member' | 'admin'
      invitedBy: string
      inviterName: string
      joinedAt: string
    }>,
    adminInvites: Array<{...}>,  // 同上
    memberInvites: Array<{...}>  // 同上
  }
}
```

---

### 4.3 POST /api/teams/invitations/:id/accept - 接受邀请

**权限要求**: 被邀请人本人

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 成员记录 ID（邀请记录） |

**状态检查**:
- 邀请状态必须是 pending
- 使用条件更新保证并发安全

**响应**:
```typescript
{
  success: true,
  message: "已加入团队",
  data: {
    teamId: string
    role: string
  }
}
```

**错误**:
- `MEMBER_NOT_FOUND`: 邀请不存在
- `INVITATION_NOT_PENDING`: 邀请已不是待处理状态

---

### 4.4 POST /api/teams/invitations/:id/reject - 拒绝邀请

**权限要求**: 被邀请人本人

**状态检查**:
- 邀请状态必须是 pending
- 使用条件删除保证并发安全

**响应**:
```typescript
{
  success: true,
  message: "已拒绝邀请"
}
```

**错误**:
- `MEMBER_NOT_FOUND`: 邀请不存在
- `INVITATION_NOT_PENDING`: 邀请已不是待处理状态

---

### 4.5 DELETE /api/teams/:id/invites/:inviteId - 取消邀请

**权限要求**: owner 或 admin

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 团队 ID |
| inviteId | string | 邀请记录 ID |

**状态检查**:
- 邀请状态必须是 pending

**响应**:
```typescript
{
  success: true,
  message: "邀请已取消"
}
```

**错误**:
- `MEMBER_NOT_FOUND`: 邀请不存在
- `INVITATION_NOT_PENDING`: 邀请已被接受

---

## 5. 加入申请 API

### 5.1 POST /api/teams/:id/join-request - 申请加入

**权限要求**: 非成员，公开团队

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 团队 ID |

**请求体**:
```typescript
{
  message?: string  // 申请留言
}
```

**前置条件**:
- 团队是公开的
- 申请人不是成员
- 申请人与团队同校
- 没有待处理的申请

**响应**:
```typescript
{
  success: true,
  message: "申请已提交",
  data: {
    id: string
    teamId: string
    studentId: string
    status: 'pending'
    message: string | null
    createdAt: string
  }
}
```

**错误**:
- `TEAM_NOT_FOUND`: 团队不存在
- `ALREADY_MEMBER`: 已是成员
- `SCHOOL_MISMATCH`: 非同校
- `REQUEST_ALREADY_EXISTS`: 已有待处理的申请

---

### 5.2 GET /api/teams/:id/join-requests - 获取加入申请列表

**权限要求**: owner 或 admin

**响应**:
```typescript
{
  success: true,
  data: Array<{
    id: string
    teamId: string
    studentId: string
    status: 'pending' | 'approved' | 'rejected'
    message: string | null
    createdAt: string
    processedAt: string | null
    processedBy: string | null
    student: {
      id: string
      name: string
      avatar: string | null
      rating: number
      enrollmentYear: number | null
    }
  }>
}
```

---

### 5.3 POST /api/teams/requests/:requestId/approve - 批准申请

**权限要求**: owner 或 admin

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| requestId | string | 申请记录 ID |

**状态检查**:
- 申请状态必须是 pending
- 使用条件更新保证并发安全

**响应**:
```typescript
{
  success: true,
  message: "申请已批准",
  data: {
    memberId: string
    teamId: string
    role: 'member'
  }
}
```

**错误**:
- `REQUEST_NOT_FOUND`: 申请不存在
- `REQUEST_ALREADY_PROCESSED`: 申请已处理

---

### 5.4 POST /api/teams/requests/:requestId/reject - 拒绝申请

**权限要求**: owner 或 admin

**状态检查**:
- 申请状态必须是 pending

**响应**:
```typescript
{
  success: true,
  message: "申请已拒绝"
}
```

**错误**:
- `REQUEST_NOT_FOUND`: 申请不存在
- `REQUEST_ALREADY_PROCESSED`: 申请已处理

---

### 5.5 POST /api/teams/requests/:requestId/withdraw - 撤回申请

**权限要求**: 申请人本人

**状态检查**:
- 申请状态必须是 pending

**响应**:
```typescript
{
  success: true,
  message: "申请已撤回"
}
```

**错误**:
- `REQUEST_NOT_FOUND`: 申请不存在
- `REQUEST_ALREADY_PROCESSED`: 申请已处理

---

## 6. 角色管理 API

### 6.1 POST /api/teams/:id/admins - 设为管理员

**权限要求**: owner

**请求体**:
```typescript
{
  memberId: string     // 用户 ID（Teacher/Student ID），非 TeamMember 记录 ID
  memberType: string   // 必填。用户类型：'teacher' | 'student'
}
```

> **ID 语义说明**: `memberId` 是 Teacher 或 Student 表的主键 ID，后端通过 `teamId + userId + userType` 复合唯一键查找 TeamMember 记录。

**前置条件**:
- 目标成员是 active 成员
- 目标成员当前角色是 member

**响应**:
```typescript
{
  success: true,
  message: "已设为管理员",
  data: {
    id: string
    role: 'admin'
  }
}
```

**错误**:
- `MEMBER_NOT_FOUND`: 成员不存在
- `NOT_TEAM_OWNER`: 非 owner
- `MEMBER_NOT_ACTIVE`: 成员不是活跃状态

---

### 6.2 DELETE /api/teams/:id/admins/:adminId - 取消管理员

**权限要求**: owner

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 团队 ID |
| adminId | string | **用户 ID**（Teacher/Student ID），非 TeamMember 记录 ID |

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| adminType | string | 推荐 | 用户类型：`teacher` / `student`。不传时回退到 TeamMember 记录 ID 查找（兼容模式） |

> **ID 语义说明**: `adminId` 是 Teacher 或 Student 表的主键 ID，后端通过 `teamId + userId + userType` 复合唯一键查找 TeamMember 记录。

**响应**:
```typescript
{
  success: true,
  message: "已取消管理员",
  data: {
    id: string
    role: 'member'
  }
}
```

**错误**:
- `MEMBER_NOT_FOUND`: 成员不存在
- `NOT_TEAM_OWNER`: 非 owner

---

## 7. 所有权转移 API

### 7.1 POST /api/teams/:id/transfer - 转移所有权

**权限要求**: owner

**请求体**:
```typescript
{
  newOwnerId: string    // 新 owner 的用户 ID（Teacher/Student ID）
  newOwnerType: string   // 必填。用户类型：'teacher' | 'student'
}
```

> **ID 语义说明**: `newOwnerId` 是 Teacher 或 Student 表的主键 ID，后端通过 `teamId + userId + userType` 复合唯一键查找 TeamMember 记录。

**前置条件**:
- 新 owner 是 active 成员
- 新 owner 与团队同校
- 新 owner 未达团队数量上限

**响应**:
```typescript
{
  success: true,
  message: "所有权已转移",
  data: {
    oldOwner: {
      id: string
      role: 'admin'
    },
    newOwner: {
      id: string
      role: 'owner'
    }
  }
}
```

**错误**:
- `TEAM_NOT_FOUND`: 团队不存在
- `NOT_TEAM_OWNER`: 非 owner
- `MEMBER_NOT_ACTIVE`: 新 owner 不是活跃成员
- `SCHOOL_MISMATCH`: 新 owner 非同校
- `TEAM_LIMIT_EXCEEDED`: 新 owner 团队数量超限

---

## 8. 辅助 API

### 8.1 GET /api/teams/:id/available-members - 获取可邀请成员

**权限要求**: owner 或 admin

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 否 | 搜索关键词 |
| type | string | 否 | 筛选类型：teacher / student |

**响应**:
```typescript
{
  success: true,
  data: {
    students: Array<{
      id: string
      name: string
      avatar: string | null
      username: string
    }>,
    teachers: Array<{...}>
  }
}
```

---

### 8.2 POST /api/teams/:id/avatar - 上传团队头像

**权限要求**: owner 或 admin

**请求格式**: multipart/form-data

**字段**:
| 字段 | 类型 | 说明 |
|------|------|------|
| avatar | File | 图片文件，最大 2MB |

**响应**:
```typescript
{
  success: true,
  data: {
    avatar: string  // 头像 URL
  }
}
```

---

### 8.3 PUT /api/teams/:id/announcement - 更新团队公告

**权限要求**: owner 或 admin

**请求体**:
```typescript
{
  announcement: string  // 支持 Markdown
}
```

**响应**:
```typescript
{
  success: true,
  data: {
    announcement: string
  }
}
```

---

## 9. 学校团队 API

### 9.1 GET /api/teams/school/:schoolId - 获取学校公开团队

**权限要求**: 已登录用户

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| schoolId | string | 学校 ID |

**响应**:
```typescript
{
  success: true,
  data: Array<{
    id: string
    name: string
    avatar: string | null
    description: string | null
    memberCount: number
    ownerName: string
    isPublic: boolean
    createdAt: string
  }>
}
```

---

## 10. 用户团队 API

### 10.1 GET /api/teams/student/:studentId - 获取学生所在团队

**权限要求**: 本人或管理员

**响应**:
```typescript
{
  success: true,
  data: {
    owned: Array<{...}>,   // 作为 owner 的团队
    admin: Array<{...}>,   // 作为 admin 的团队
    member: Array<{...}>,  // 作为 member 的团队
    pending: Array<{...}>  // 待处理的邀请
  }
}
```

---

### 10.2 GET /api/teams/my-admin-teams - 获取我管理的团队

**权限要求**: 已登录用户

**响应**:
```typescript
{
  success: true,
  data: Array<{
    id: string
    name: string
    role: 'owner' | 'admin'
    memberCount: number
    school: { id: string, name: string }
  }>
}
```

---

## 11. 请求/响应示例

### 11.1 创建团队

```bash
POST /api/teams
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "雅礼中学OI队",
  "description": "雅礼中学信息学竞赛训练队",
  "schoolId": "school-123",
  "isPublic": true
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "team-456",
    "name": "雅礼中学OI队",
    "description": "雅礼中学信息学竞赛训练队",
    "schoolId": "school-123",
    "isPublic": true,
    "createdAt": "2026-03-25T10:00:00.000Z"
  }
}
```

### 11.2 批量邀请成员

```bash
POST /api/teams/team-456/members
Authorization: Bearer <token>
Content-Type: application/json

{
  "members": [
    { "userId": "student-1", "userType": "student" },
    { "userId": "student-2", "userType": "student" },
    { "userId": "teacher-1", "userType": "teacher", "role": "admin" }
  ]
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "invited": [
      { "userId": "student-1", "userType": "student" },
      { "userId": "teacher-1", "userType": "teacher" }
    ],
    "alreadyMember": [
      { "userId": "student-2", "userType": "student" }
    ],
    "notFound": [],
    "schoolMismatch": []
  }
}
```

### 11.3 接受邀请

```bash
POST /api/teams/invitations/member-789/accept
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "message": "已加入团队",
  "data": {
    "teamId": "team-456",
    "role": "member"
  }
}
```

### 11.4 转移所有权

```bash
POST /api/teams/team-456/transfer
Authorization: Bearer <token>
Content-Type: application/json

{
  "newOwnerId": "member-789"
}
```

**响应**:
```json
{
  "success": true,
  "message": "所有权已转移",
  "data": {
    "oldOwner": {
      "id": "member-123",
      "role": "admin"
    },
    "newOwner": {
      "id": "member-789",
      "role": "owner"
    }
  }
}
```

---

## 12. 并发安全说明

以下 API 使用条件更新/删除保证并发安全：

| API | 安全措施 | 失败处理 |
|-----|----------|----------|
| POST /teams/invitations/:id/accept | `updateMemberStatusIfPending()` | 返回 `INVITATION_NOT_PENDING` |
| POST /teams/invitations/:id/reject | `deleteMemberIfPending()` | 返回 `INVITATION_NOT_PENDING` |
| DELETE /teams/:id/invites/:inviteId | `deleteMemberIfPending()` | 返回 `INVITATION_NOT_PENDING` |
| POST /teams/requests/:requestId/approve | `updateJoinRequestIfPending()` | 返回 `REQUEST_ALREADY_PROCESSED` |
| POST /teams/requests/:requestId/reject | `updateJoinRequestIfPending()` | 返回 `REQUEST_ALREADY_PROCESSED` |

---

## 13. 事务保护说明

以下 API 使用数据库事务：

| API | 事务内容 |
|-----|----------|
| POST /teams | 创建 Team + 创建 owner TeamMember |
| POST /teams/:id/transfer | 更新旧 owner + 更新新 owner |
| POST /teams/requests/:requestId/approve | 更新 TeamJoinRequest + 创建/更新 TeamMember |

---

## 14. 审计日志

以下操作会记录审计日志：

| 操作 | action 值 |
|------|----------|
| 添加成员 | member_add |
| 移除成员 | member_remove |
| 成员角色变更 | role_change |
| 所有权转移 | ownership_transfer |
| 团队删除 | team_delete |
| 邀请发送 | invite_send |
| 邀请接受 | invite_accept |
| 邀请拒绝 | invite_reject |
| 申请批准 | join_approve |
| 申请拒绝 | join_reject |