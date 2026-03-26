# 团队模块权限规则

> 创建时间: 2026-03-25
> 状态: 规范草案

---

## 1. 权限模型概述

### 1.1 权限来源

团队模块的权限来自两个层面：

1. **系统角色**：super_admin, platform_admin, school_principal, teacher, student
2. **团队角色**：owner, admin, member

**优先级**：系统角色 > 团队角色

### 1.2 权限检查顺序

```
1. 系统角色检查（超管绕过所有检查）
2. 学校归属检查（同校才能操作）
3. 团队角色检查（owner/admin/member）
4. 资源所有权检查（本人才能操作）
```

---

## 2. 团队角色定义

### 2.1 角色层级

```
owner (所有者)
   │
   └── admin (管理员)
          │
          └── member (普通成员)
```

### 2.2 角色权限对比

| 权限项 | owner | admin | member | outsider |
|--------|:-----:|:-----:|:------:|:--------:|
| 查看公开团队信息 | ✅ | ✅ | ✅ | ✅ |
| 查看私有团队信息 | ✅ | ✅ | ✅ | ❌ |
| 编辑团队基本信息 | ✅ | ✅ | ❌ | ❌ |
| 修改团队可见性 | ✅ | ❌ | ❌ | ❌ |
| 发布团队公告 | ✅ | ✅ | ❌ | ❌ |
| 上传团队头像 | ✅ | ✅ | ❌ | ❌ |
| 邀请成员加入 | ✅ | ✅ | ❌ | ❌ |
| 批量邀请成员 | ✅ | ✅ | ❌ | ❌ |
| 审批加入申请 | ✅ | ✅ | ❌ | ❌ |
| 拒绝加入申请 | ✅ | ✅ | ❌ | ❌ |
| 移除普通成员 | ✅ | ✅ | ❌ | ❌ |
| 移除管理员 | ✅ | ❌ | ❌ | ❌ |
| 设为管理员 | ✅ | ❌ | ❌ | ❌ |
| 取消管理员 | ✅ | ❌ | ❌ | ❌ |
| 转移团队所有权 | ✅ | ❌ | ❌ | ❌ |
| 解散团队 | ✅ | ❌ | ❌ | ❌ |
| 退出团队 | ✅* | ✅ | ✅ | N/A |
| 申请加入公开团队 | N/A | N/A | N/A | ✅ |
| 接受邀请 | N/A | N/A | N/A | ✅** |
| 拒绝邀请 | N/A | N/A | N/A | ✅** |

\* owner 退出 = 解散团队（需无其他成员）
\** 仅被邀请人本人

---

## 3. 操作权限矩阵

### 3.1 团队生命周期操作

| 操作 | 权限要求 | 前置条件 | 限制 |
|------|----------|----------|------|
| 创建团队 | teacher 或 school_principal | 同校 | 教师最多 50 个团队，学生最多 5 个团队 |
| 编辑团队信息 | owner 或 admin | 同校 | - |
| 修改团队可见性 | owner | 同校 | - |
| 发布团队公告 | owner 或 admin | 同校 | - |
| 上传团队头像 | owner 或 admin | 同校 | - |
| 解散团队 | owner | 无其他成员 | 需确认 |
| 删除团队 | super_admin | - | 需确认 |

### 3.2 成员管理操作

| 操作 | 权限要求 | 目标限制 | 学校限制 |
|------|----------|----------|----------|
| 邀请教师 | owner 或 admin | 非成员、同校教师 | 同校 |
| 邀请学生 | owner 或 admin | 非成员、同校学生 | 同校 |
| 批量邀请 | owner 或 admin | 非成员、同校 | 同校 |
| 移除成员 | owner 或 admin | 非 owner | 同校 |
| 移除 admin | owner | 非 owner | 同校 |
| 设为管理员 | owner | active 成员 | 同校 |
| 取消管理员 | owner | admin | 同校 |
| 接受邀请 | 被邀请人本人 | status=pending | 同校 |
| 拒绝邀请 | 被邀请人本人 | status=pending | - |
| 取消邀请 | owner 或 admin | status=pending | - |

### 3.3 申请处理操作

| 操作 | 权限要求 | 目标状态 |
|------|----------|----------|
| 申请加入 | 非成员、公开团队 | - |
| 批准申请 | owner 或 admin | pending |
| 拒绝申请 | owner 或 admin | pending |
| 撤回申请 | 申请人本人 | pending |

### 3.4 所有权操作

| 操作 | 权限要求 | 前置条件 |
|------|----------|----------|
| 转移所有权 | owner | 新 owner 是 active 成员、同校 |
| 接收所有权 | - | 必须是 active 成员 |

### 3.5 退出操作

| 操作者 | 前置条件 | 后果 |
|--------|----------|------|
| owner | 无其他成员 | 团队解散 |
| owner | 有其他成员 | 禁止（需先转移） |
| admin | - | 退出成功 |
| member | - | 退出成功 |

---

## 4. 特殊权限规则

### 4.1 超级管理员权限

super_admin 拥有所有权限，无需检查团队角色：

```typescript
// permissions.ts:366
export async function canManageTeam(req: AuthRequest, teamId: string): Promise<boolean> {
  const role = req.user!.role
  // 超管可以管理所有团队
  if (role === 'super_admin') return true
  // ...
}
```

### 4.2 学校负责人权限

school_principal 继承教师权限，可以：
- 创建和管理团队
- 查看本校所有团队

但**不能**绕过团队角色检查。

### 4.3 平台管理员限制

platform_admin **不能**管理团队，权限范围仅限于用户管理。

### 4.4 学生创建团队限制

学生可以创建团队，但限制：
- 最多创建 5 个团队（教师 50 个）
- 只能邀请同校成员
- 创建后自动成为 owner

---

## 5. 学校归属检查

### 5.1 规则

所有团队操作都要求操作者和团队属于同一学校。

### 5.2 例外情况

| 操作 | 学校检查 |
|------|----------|
| super_admin 操作 | 跳过检查 |
| 查看公开团队 | 需同校 |
| 查看私有团队 | 需同校且是成员 |
| 邀请成员 | 需同校 |
| 申请加入 | 需同校 |

### 5.3 代码实现

```typescript
// team.service.ts
async createTeam(userId: string, userType: MemberType, data: CreateTeamDTO) {
  // 获取用户学校
  const userSchoolId = await this.getUserSchoolId(userId, userType)

  // 验证学校归属
  if (data.schoolId !== userSchoolId) {
    throw new TeamError('SCHOOL_MISMATCH', '只能创建本校团队')
  }
  // ...
}
```

---

## 6. 前端权限显示规则

### 6.1 按钮显示 vs 实际权限

⚠️ **重要原则**：前端按钮显示只是提示，实际权限由后端检查。

```typescript
// 错误做法 ❌
{user.role === 'owner' && <button onClick={handleTransfer}>转移所有权</button>}

// 正确做法 ✅
{canTransfer && <button onClick={handleTransfer}>转移所有权</button>}
```

### 6.2 权限判断函数

```typescript
// 前端权限判断示例
function canManageTeam(userRole: MemberRole, targetRole: MemberRole): boolean {
  if (userRole === 'owner') return true
  if (userRole === 'admin' && targetRole === 'member') return true
  return false
}

function canRemoveMember(userRole: MemberRole, targetRole: MemberRole): boolean {
  if (targetRole === 'owner') return false
  if (userRole === 'owner') return true
  if (userRole === 'admin' && targetRole === 'member') return true
  return false
}

function canChangeRole(userRole: MemberRole, targetRole: MemberRole, newRole: MemberRole): boolean {
  if (userRole !== 'owner') return false
  if (targetRole === 'owner') return false // owner 必须先转移
  return true
}
```

### 6.3 敏感操作二次确认

以下操作需要二次确认：

| 操作 | 确认方式 |
|------|----------|
| 解散团队 | 弹窗确认 + 输入团队名称 |
| 转移所有权 | 弹窗确认 |
| 移除成员 | 弹窗确认 |
| 批量移除 | 弹窗确认 + 输入数量 |

---

## 7. 权限检查代码位置

### 7.1 后端权限中间件

| 文件 | 函数 | 用途 |
|------|------|------|
| permissions.ts:84 | canAccessSchool | 学校访问权限 |
| permissions.ts:309 | canViewTeam | 团队查看权限 |
| permissions.ts:362 | canManageTeam | 团队管理权限 |
| permissions.ts:394 | getTeamMemberRole | 获取团队角色 |

### 7.2 Service 层权限检查

| 文件 | 方法 | 用途 |
|------|------|------|
| team.service.ts | getMemberRole | 获取用户在团队中的角色 |
| team.service.ts | isTeamAdmin | 判断是否为管理员 |
| team.service.ts | assertTeamMember | 断言为团队成员 |
| team.service.ts | assertTeamAdmin | 断言为管理员 |
| team.service.ts | assertTeamOwner | 断言为所有者 |

### 7.3 Routes 层权限检查

```typescript
// team.routes.ts 示例
router.post('/:id/members', authenticate, async (req, res) => {
  const teamId = req.params.id
  const userId = req.user!.userId

  // 1. 获取团队角色
  const role = await teamService.getMemberRole(teamId, userId)

  // 2. 检查权限
  if (role !== 'owner' && role !== 'admin') {
    return res.status(403).json({ success: false, message: '需要管理员权限' })
  }

  // 3. 执行操作
  // ...
})
```

---

## 8. 权限错误码

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| UNAUTHORIZED | 401 | 未登录 |
| FORBIDDEN | 403 | 无权限 |
| NOT_TEAM_MEMBER | 403 | 非团队成员 |
| NOT_TEAM_ADMIN | 403 | 非团队管理员 |
| NOT_TEAM_OWNER | 403 | 非团队所有者 |
| SCHOOL_MISMATCH | 403 | 学校不匹配 |
| ALREADY_MEMBER | 400 | 已是成员 |
| NOT_PENDING | 400 | 状态不是待处理 |
| CANNOT_REMOVE_OWNER | 403 | 不能移除所有者 |
| CANNOT_REMOVE_SELF | 400 | 不能移除自己（应使用退出） |
| OWNER_MUST_TRANSFER | 400 | 所有者必须先转移 |

---

## 9. 权限矩阵速查表

### 9.1 按操作

| 我想... | 需要... |
|---------|---------|
| 创建团队 | teacher 或 student 角色 |
| 编辑团队 | owner 或 admin |
| 邀请成员 | owner 或 admin |
| 移除成员 | owner 或 admin（不能移除 owner/admin） |
| 移除管理员 | owner |
| 设为管理员 | owner |
| 审批申请 | owner 或 admin |
| 转移团队 | owner |
| 解散团队 | owner（无其他成员） |
| 退出团队 | 非 owner 或 owner 且无其他成员 |

### 9.2 按角色

| 角色 | 能做什么 |
|------|----------|
| owner | 全部权限 + 转移所有权 + 解散团队 |
| admin | 邀请、审批、移除 member、编辑团队 |
| member | 查看团队、退出团队 |
| outsider | 申请加入公开团队、接受/拒绝邀请 |

---

## 10. 常见权限问题

### Q1: 为什么 admin 不能移除 admin？

A: 防止管理员之间互相踢出，只有 owner 才能管理 admin。

### Q2: 为什么 owner 不能直接退出？

A: owner 退出会导致团队无主。必须先转移所有权或确保无其他成员后解散。

### Q3: 学生能创建团队吗？

A: 可以，但限制最多 5 个团队。

### Q4: 外校用户能加入团队吗？

A: 不能。所有邀请和申请都要求同校。

### Q5: 平台管理员能管理团队吗？

A: 不能。platform_admin 只能管理用户账号，不能管理团队。