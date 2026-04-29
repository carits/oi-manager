# 认证与权限系统 (Auth & Permission)

> 最后更新: 2026-04-29

本文档详细描述 OI Manager V2 的认证流程和权限控制机制。

---

## 1. 角色体系

### 1.1 角色定义

| 角色 | 代码标识 | 说明 | 登录入口 |
|------|----------|------|----------|
| 超级管理员 | `super_admin` | 系统最高权限，管理所有学校和用户 | 管理员端 |
| 平台管理员 | `platform_admin` | 平台级管理，管理用户账号（不含超管和平台管理员） | 管理员端 |
| 学校负责人 | `school_principal` | 学校级管理，同时具备教师的所有权限 | 教师端 |
| 教师 | `teacher` | 团队、学生、比赛、题单管理 | 教师端 |
| 学生 | `student` | 查看个人数据、比赛、题单 | 学生端 |

### 1.2 角色层级

```
super_admin (超管)
    │
    ├── platform_admin (平台管理员)
    │
    └── school_principal (学校负责人)
            │
            └── teacher (教师)
                    │
                    └── student (学生)
```

### 1.3 登录端点映射

| 登录入口 | 允许的角色 |
|----------|------------|
| 管理员端 (`/login?role=admin`) | `super_admin`, `platform_admin` |
| 教师端 (`/login?role=teacher`) | `school_principal`, `teacher` |
| 学生端 (`/login?role=student`) | `student` |

---

## 2. 认证流程

### 2.1 登录流程

```
┌─────────┐     POST /api/auth/login      ┌─────────┐
│  前端   │ ──────────────────────────────▶│  后端   │
│         │    {username, password, role}  │         │
│         │                                │         │
│         │◀────────────────────────────── │         │
│         │    {token, userId, role, ...}  │         │
└─────────┘                                └─────────┘
     │
     │ 存储 token 到 localStorage
     ▼
┌─────────┐
│ AuthProvider │
│  管理登录状态  │
└─────────┘
```

### 2.2 登录验证步骤

1. **用户名密码验证**: 查询 User 表，验证密码哈希
2. **账号状态检查**: 检查 `status` 字段是否为 `disabled`
3. **角色匹配验证**: 确保登录入口与用户角色匹配
4. **生成 JWT Token**: 包含用户 ID、角色、关联 ID

### 2.3 Token 结构 (JWT Payload)

```typescript
interface JwtPayload {
  userId: string       // 用户 ID（核心字段）
  username: string     // 用户名
  role: UserRole       // 角色（用于身份判断）
  adminId?: string     // 管理员 ID（冗余字段，等于 userId）
  teacherId?: string   // 教师 ID（冗余字段，等于 userId）
  studentId?: string   // 学生 ID（冗余字段，等于 userId）
  schoolId?: string    // 学校 ID（教师和学生）
}
```

> **注意**：`adminId`/`teacherId`/`studentId` 字段是为了向后兼容保留的冗余字段，它们的值都等于 `userId`。代码中不应依赖这些字段做身份判断，应统一使用 `userId` + `role`。

### 2.4 Token 有效期

- **有效期**: 7 天
- **存储位置**: 前端 localStorage
- **传输方式**: HTTP Header `Authorization: Bearer <token>`

---

## 3. 权限控制

### 3.1 后端权限中间件

**文件**: `apps/server/src/middleware/auth.ts`

```typescript
// 认证中间件 - 验证 Token
export function authenticate(req, res, next)

// 授权中间件 - 检查角色
export function authorize(...roles: UserRole[])

// 检查是否为管理员
export function isAdmin(role: UserRole): boolean

// 检查是否为超级管理员
export function isSuperAdmin(role: UserRole): boolean

// 从角色推导用户类型（student → 'student'，其他 → 'teacher'）
export function getUserType(role: string): 'teacher' | 'student'
```

**使用 `getUserType` 替代冗余的身份判断**：

```typescript
// ❌ 旧模式（不推荐）
const userType = user.teacherId ? 'teacher' : 'student'
const userId = user.teacherId || user.studentId

// ✅ 新模式（推荐）
const userType = getUserType(user.role)
const userId = user.userId
```

### 3.2 使用示例

```typescript
// 仅允许教师访问
router.get('/teacher-only', authenticate, authorize('teacher', 'school_principal'), handler)

// 仅允许管理员访问
router.get('/admin-only', authenticate, authorize('super_admin', 'platform_admin'), handler)

// 所有已登录用户
router.get('/protected', authenticate, handler)
```

### 3.3 前端权限控制

**文件**: `apps/web/src/components/AuthProvider.tsx`

- 根据 `user.role` 决定显示哪些导航入口
- 页面组件内部检查 `user.role` 决定显示哪些操作按钮

---

## 4. 各角色权限详解

### 4.1 超级管理员 (super_admin)

| 权限 | 说明 |
|------|------|
| 学校管理 | 创建、编辑、删除学校 |
| 学校负责人管理 | 指定和转移学校负责人 |
| 用户管理 | 管理所有用户（含平台管理员） |
| 平台管理员创建 | 创建新的平台管理员账号 |
| 系统配置 | 系统级设置 |

**API 路由**:
- `GET/POST /api/schools`
- `GET/PUT/DELETE /api/schools/:id`
- `PUT /api/schools/:id/principal`
- `GET/POST /api/users`

### 4.2 平台管理员 (platform_admin)

| 权限 | 说明 |
|------|------|
| 用户查看 | 查看所有用户（不含超管和平台管理员） |
| 用户管理 | 重置密码、启用/禁用账号 |
| 数据统计 | 查看系统统计数据 |

**API 路由**:
- `GET /api/users`
- `PUT /api/users/:id/status`
- `POST /api/users/:id/reset-password`

### 4.3 学校负责人 (school_principal)

| 权限 | 说明 |
|------|------|
| 学校信息编辑 | 编辑本校信息、发布公告 |
| 教师管理 | 创建、编辑、删除本校教师 |
| 教师权限 | 继承教师的所有权限 |

**API 路由**:
- `PUT /api/schools/:id`
- `GET/POST /api/teachers`
- `PUT/DELETE /api/teachers/:id`

### 4.4 教师 (teacher)

| 权限 | 说明 |
|------|------|
| 团队管理 | 创建和管理团队 |
| 学生管理 | 管理团队内的学生 |
| 比赛管理 | 创建和管理比赛 |
| 题单管理 | 创建和管理题单 |
| 成绩导入 | 导入比赛成绩 |
| 数据查看 | 查看学生成长数据 |

**API 路由**:
- `GET/POST /api/teams`
- `GET/POST /api/students`
- `GET/POST /api/contests`
- `GET/POST /api/problem-lists`
- `POST /api/contests/:id/results`

### 4.5 学生 (student)

| 权限 | 说明 |
|------|------|
| 个人数据 | 查看个人训练数据 |
| 比赛查看 | 查看参加的比赛 |
| 题单任务 | 查看分配的题单 |
| 成绩查看 | 查看自己的成绩 |
| 资源下载 | 下载比赛资源 |

**API 路由**:
- `GET /api/contests`
- `GET /api/problem-lists`
- `GET /api/problem-lists` (可见的题单)
- `GET /api/students/:id` (仅自己的数据)

---

## 5. 数据隔离

### 5.1 sessionKey 机制

每个用户在创建时生成唯一的 `sessionKey`，用于：
- 确保用户只能访问自己的数据
- 防止跨账号数据泄露

### 5.2 学校隔离

- 教师只能管理本校学生
- 学生只能看到本校数据
- 学校负责人只能管理本校教师

### 5.3 团队隔离

- 教师只能管理自己负责的团队
- 学生只能看到自己所属的团队

---

## 6. 前端权限实现

### 6.1 AuthProvider

```tsx
// 管理全局登录状态
const { user, loading, login, logout } = useAuth()

// 检查角色
{user?.role === 'super_admin' && <AdminPanel />}
{user?.role === 'teacher' && <TeacherPanel />}
```

### 6.2 路由保护

```tsx
// 页面组件内部检查
if (!user || user.role !== 'teacher') {
  return <Navigate to="/login" />
}
```

### 6.3 条件渲染

```tsx
// 按钮级别权限控制
{isCreator && <button onClick={handleEdit}>编辑</button>}
{canDelete && <button onClick={handleDelete}>删除</button>}
```

---

## 7. 安全注意事项

### 7.1 密码安全

- 密码使用 bcrypt 加密存储
- 最小长度 6 位
- 修改密码需验证当前密码

### 7.2 Token 安全

- Token 存储在 localStorage（生产环境建议使用 httpOnly Cookie）
- Token 有效期 7 天
- 敏感操作建议重新验证

### 7.3 API 安全

- 所有 API 请求需要 Token
- 后端验证用户角色
- 关键操作验证资源所有权

### 7.4 XSS 防护

- React 自动转义输出
- Markdown 渲染使用安全配置

---

## 8. 权限检查速查表

| 操作 | super_admin | platform_admin | school_principal | teacher | student |
|------|:-----------:|:--------------:|:----------------:|:-------:|:-------:|
| 创建学校 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 删除学校 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 管理所有用户 | ✅ | ✅* | ❌ | ❌ | ❌ |
| 管理本校教师 | ✅ | ❌ | ✅ | ❌ | ❌ |
| 创建团队 | ✅ | ❌ | ✅ | ✅ | ❌ |
| 管理学生 | ✅ | ❌ | ✅ | ✅ | ❌ |
| 创建比赛 | ✅ | ❌ | ✅ | ✅ | ❌ |
| 查看比赛 | ✅ | ❌ | ✅ | ✅ | ✅ |
| 查看个人数据 | ✅ | ✅ | ✅ | ✅ | ✅ |

> *平台管理员不能管理超管和平台管理员账号

---

## 9. 故障排查

### 9.1 登录失败

**症状**: 提示"用户名或密码错误"

**排查**:
1. 检查用户名是否正确
2. 检查密码是否正确
3. 检查账号是否被禁用

### 9.2 权限不足

**症状**: API 返回 403 错误

**排查**:
1. 检查 Token 是否有效
2. 检查用户角色是否有权限
3. 检查资源是否属于当前用户

### 9.3 Token 过期

**症状**: API 返回 401 错误

**解决**: 重新登录获取新 Token
