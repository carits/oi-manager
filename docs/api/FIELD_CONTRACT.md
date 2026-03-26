# 前后端字段契约规范

> 最后更新: 2026-03-25

本文档定义 OI Manager V2 项目的前后端字段契约，确保 API 响应结构与前端期望一致。

---

## 1. 核心原则

### 1.1 扁平字段优先

API 返回优先使用扁平字段，而非嵌套对象：

```typescript
// 推荐 ✅
{
  teacherId: "xxx",
  studentId: "xxx",
  schoolId: "xxx",
  schoolName: "雅礼中学"
}

// 不推荐 ❌
{
  teacher: { id: "xxx", name: "张老师" },
  student: { id: "xxx", name: "李同学" },
  school: { id: "xxx", name: "雅礼中学" }
}
```

### 1.2 嵌套对象使用小写字段名

如需返回嵌套对象，字段名使用小写：

```typescript
// 推荐 ✅
{
  profile: {
    name: "张老师",
    school: { id: "xxx", name: "雅礼中学" }
  }
}

// 不推荐 ❌ - 暴露 Prisma 内部结构
{
  profile: user.Teacher  // 包含大写关联字段如 School, User
}
```

### 1.3 避免返回原始 Prisma 对象

原始 Prisma 对象包含大写关联字段，直接返回会导致前后端字段不一致：

```typescript
// 错误 ❌
res.json({ success: true, data: { profile: user.Teacher } })

// 正确 ✅
const profileData = {
  id: user.Teacher.id,
  name: user.Teacher.name,
  // 只返回需要的字段
}
res.json({ success: true, data: { profile: profileData } })
```

---

## 2. Prisma 查询规范

### 2.1 关联字段名必须大写

Prisma Schema 中定义的关联字段名是大写，查询时必须一致：

```typescript
// 错误 ❌ - 小写会导致 500 错误
await prisma.user.findUnique({
  include: { teacher: true, student: true }
})

// 正确 ✅
await prisma.user.findUnique({
  include: { Teacher: true, Student: true }
})
```

### 2.2 访问关联对象使用大写

查询结果中的关联对象使用大写字段名访问：

```typescript
const user = await prisma.user.findUnique({
  include: { Teacher: true }
})

// 错误 ❌ - 返回 undefined
const name = user.teacher?.name

// 正确 ✅
const name = user.Teacher?.name
```

### 2.3 _count 聚合使用大写

```typescript
// 错误 ❌
include: {
  _count: { select: { teams: true, students: true } }
}

// 正确 ✅
include: {
  _count: { select: { Team: true, Student: true } }
}
```

---

## 3. Schema 关联字段对照表

| 模型 | 关联字段名（大写） |
|------|-------------------|
| User | `Admin`, `Student`, `Teacher` |
| School | `PrincipalTransferLog`, `Student`, `Teacher`, `Team` |
| Teacher | `Milestone`, `Student`, `TaskList`, `School`, `User` |
| Student | `ContestProblemNote`, `ContestProblemScore`, `ContestResult`, `Milestone`, `Teacher`, `School`, `User`, `TaskProgress`, `TeamJoinRequest` |
| Team | `Contest`, `School`, `TeamJoinRequest`, `TeamMember` |
| TeamMember | `Team` |

---

## 4. 核心接口响应结构

### 4.1 POST /auth/login

```typescript
// 请求
{
  username: string,
  password: string,
  role: "admin" | "teacher" | "student"
}

// 响应
{
  success: true,
  data: {
    token: string,
    userId: string,
    role: string,
    username: string,
    avatar: string | null,
    adminId?: string,
    teacherId?: string,
    studentId?: string,
    schoolId?: string
  }
}
```

### 4.2 GET /auth/me

```typescript
// 响应
{
  success: true,
  data: {
    userId: string,
    username: string,
    role: string,
    avatar: string | null,
    phone: string | null,
    email: string | null,
    bio: string | null,
    profile: {
      id: string,
      name: string,
      // ...其他基本字段
    } | null,
    adminId?: string,
    teacherId?: string,
    studentId?: string,
    schoolId?: string,
    schoolName?: string
  }
}
```

### 4.3 GET /users/:userId/profile

```typescript
// 响应
{
  success: true,
  data: {
    id: string,
    name: string,
    username: string,
    avatar: string | null,
    bio: string | null,
    userType: "teacher" | "student",
    school: { id: string, name: string } | null
  }
}
```

### 4.4 GET /users/:id（管理端）

```typescript
// 响应
{
  success: true,
  data: {
    id: string,
    username: string,
    role: string,
    status: string,
    avatar: string | null,
    phone: string | null,
    email: string | null,
    bio: string | null,
    createdAt: string,
    updatedAt: string,
    profile?: {
      id: string,
      name: string,
      schoolId?: string,
      schoolName?: string
    }
  }
}
```

---

## 5. 常见错误与修复

### 5.1 Prisma 查询 500 错误

**症状**：API 返回 500 错误，日志显示 Prisma 查询失败

**原因**：`include`/`select` 使用小写关联字段名

**修复**：改为大写

```typescript
// 错误
include: { teacher: true }

// 正确
include: { Teacher: true }
```

### 5.2 字段访问返回 undefined

**症状**：`user.teacher?.name` 返回 undefined

**原因**：查询结果使用大写字段名

**修复**：使用大写访问

```typescript
// 错误
user.teacher?.name

// 正确
user.Teacher?.name
```

### 5.3 前端字段不匹配

**症状**：前端无法正确读取 API 返回的数据

**原因**：API 返回原始 Prisma 对象，包含大写关联字段

**修复**：在返回前转换数据结构

```typescript
// 错误
res.json({ success: true, data: { profile: user.Teacher } })

// 正确
const profileData = user.Teacher ? {
  id: user.Teacher.id,
  name: user.Teacher.name,
  schoolId: user.Teacher.schoolId
} : null
res.json({ success: true, data: { profile: profileData } })
```

---

## 6. 代码审查检查清单

审查 API 相关代码时，检查以下项目：

- [ ] Prisma `include`/`select` 使用大写关联字段名
- [ ] 访问关联对象使用大写字段名
- [ ] `_count` 聚合使用大写关联字段名
- [ ] API 返回扁平字段优先
- [ ] 不直接返回原始 Prisma 对象
- [ ] 嵌套对象字段名使用小写

---

## 7. 参考资料

- [Prisma Schema](../database/DATABASE_MODELS.md) - 数据库模型定义
- [API Reference](./API_REFERENCE.md) - API 接口文档
- [Auth & Permission](../AUTH_AND_PERMISSION.md) - 认证与权限系统

---

## 8. 更新日志

### 2026-03-25
- 创建文档
- 定义核心原则和规范
- 记录常见错误与修复方法