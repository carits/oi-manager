# 团队模块冲突场景与处理规则

> 创建时间: 2026-03-25
> 状态: 规范草案

---

## 1. 冲突分类

团队模块的冲突场景分为四大类：

1. **并发冲突**：多个请求同时操作同一资源
2. **状态冲突**：操作时目标状态不符合预期
3. **业务逻辑冲突**：违反业务规则的操作
4. **边界情况**：特殊情况需要特殊处理

---

## 2. 并发冲突（Race Condition）

### 2.1 两个管理员同时审批同一申请

**场景描述**：
管理员 A 和管理员 B 同时点击"批准"按钮，处理同一学生的加入申请。

**风险**：
- 重复创建成员记录
- 发送多次通知

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 条件更新 | team.repository.ts:532 | `updateJoinRequestIfPending()` 返回 count |
| 结果判断 | team.routes.ts | count=0 表示已被处理，返回错误 |

```typescript
// team.repository.ts:532-541
async updateJoinRequestIfPending(id: string, data: {...}): Promise<number> {
  const result = await prisma.teamJoinRequest.updateMany({
    where: { id, status: 'pending' },  // 只有 pending 才更新
    data
  })
  return result.count
}

// team.routes.ts 处理逻辑
const count = await repo.updateJoinRequestIfPending(id, data)
if (count === 0) {
  return res.status(400).json({ success: false, message: '申请已被处理' })
}
```

**错误码**：`REQUEST_ALREADY_PROCESSED`

---

### 2.2 同时邀请和申请加入

**场景描述**：
用户 A 正在申请加入团队，同时管理员 B 正在邀请用户 A 加入同一团队。

**风险**：
- 数据状态混乱
- 用户困惑

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| Upsert 操作 | team.repository.ts:439 | 使用 `upsertMember` 避免重复 |
| 邀请优先 | 业务规则 | 邀请覆盖申请 |

```typescript
// 邀请时检查是否已有申请
const existing = await repo.findMember({ teamId, userId, userType })
if (existing) {
  if (existing.status === 'pending' && existing.invitedBy === null) {
    // 已有申请，转为邀请
    await repo.updateMember(existing.id, { invitedBy: inviterId })
    return { converted: true }
  }
  throw new TeamError('ALREADY_MEMBER', '用户已是成员或有待处理邀请')
}
```

**结果**：邀请优先，申请转为邀请

---

### 2.3 审批时用户被其他管理员移除

**场景描述**：
管理员 A 正在审批用户的加入申请，同时管理员 B 移除了该用户的邀请记录。

**风险**：
- 操作的目标不存在
- 数据不一致

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 条件更新 | team.repository.ts:390 | `updateMemberStatusIfPending()` |
| 事务保护 | team.service.ts | 审批操作使用事务 |

```typescript
// 审批前检查申请状态
const request = await repo.findJoinRequestById(id)
if (!request || request.status !== 'pending') {
  return res.status(400).json({ success: false, message: '申请不存在或已处理' })
}

// 使用事务创建成员 + 更新申请状态
await repo.transaction(async (tx) => {
  // 创建/更新成员
  await tx.teamMember.upsert({...})
  // 更新申请状态
  await tx.teamJoinRequest.update({...})
})
```

**错误码**：`REQUEST_NOT_FOUND` 或 `REQUEST_ALREADY_PROCESSED`

---

### 2.4 转移所有权时新 owner 被移除

**场景描述**：
owner A 正在转移所有权给成员 B，同时管理员 C 移除了成员 B。

**风险**：
- 转移到非成员
- 团队无有效 owner

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 事务保护 | team.service.ts:701 | 转移操作使用事务 |
| 状态检查 | 事务内 | 检查新 owner 是 active 成员 |

```typescript
await repo.transaction(async (tx) => {
  // 检查新 owner 状态
  const newOwner = await tx.teamMember.findFirst({
    where: { id: newOwnerId, status: 'active' }
  })
  if (!newOwner) {
    throw new TeamError('MEMBER_NOT_ACTIVE', '新所有者不是有效成员')
  }

  // 更新原 owner
  await tx.teamMember.update({ where: { id: oldOwnerId }, data: { role: 'admin' } })

  // 更新新 owner
  await tx.teamMember.update({ where: { id: newOwnerId }, data: { role: 'owner' } })
})
```

**错误码**：`MEMBER_NOT_ACTIVE`

---

### 2.5 同时删除团队和处理申请

**场景描述**：
owner A 正在删除团队，同时管理员 B 正在处理该团队的加入申请。

**风险**：
- 外键约束错误
- 操作目标不存在

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 级联删除 | schema.prisma | `onDelete: Cascade` |
| 事务隔离 | 数据库级别 | PostgreSQL MVCC 行级锁 |

```prisma
// schema.prisma
model Team {
  TeamMember TeamMember[]  // onDelete: Cascade
  TeamJoinRequest TeamJoinRequest[]
}

model TeamMember {
  Team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
}
```

**结果**：团队删除时，相关记录自动删除

---

## 3. 状态冲突

### 3.1 接受已过期的邀请

**场景描述**：
用户尝试接受一个已经被取消的邀请。

**风险**：
- 数据错误
- 状态混乱

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 状态检查 | team.repository.ts:390 | `updateMemberStatusIfPending()` |
| 返回 count | 条件更新 | count=0 表示邀请已不存在 |

**错误码**：`INVITATION_NOT_PENDING`

---

### 3.2 重复申请加入

**场景描述**：
学生已经申请过加入团队，再次提交申请。

**风险**：
- 重复记录
- 管理员困惑

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 唯一约束 | schema.prisma | `@@unique([teamId, studentId])` |
| Upsert | team.repository.ts | 更新现有记录而非创建新记录 |

```typescript
// 申请加入
const existing = await repo.findJoinRequest({ teamId, studentId })
if (existing) {
  if (existing.status === 'pending') {
    return res.status(400).json({ success: false, message: '已有待处理的申请' })
  }
  // 之前被拒绝，允许重新申请
  await repo.updateJoinRequest(existing.id, { status: 'pending', message })
} else {
  await repo.createJoinRequest({ teamId, studentId, message })
}
```

**错误码**：`REQUEST_ALREADY_EXISTS`

---

### 3.3 已是成员再次申请

**场景描述**：
用户已经是团队成员，但仍然尝试申请加入。

**风险**：
- 状态混乱
- 数据重复

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 成员检查 | team.service.ts | 申请前检查是否已是成员 |

```typescript
const member = await repo.findMember({ teamId, userId, userType })
if (member && member.status === 'active') {
  return res.status(400).json({ success: false, message: '已是团队成员' })
}
```

**错误码**：`ALREADY_MEMBER`

---

### 3.4 成员被移除后重新邀请

**场景描述**：
用户曾被移除，现在管理员想重新邀请。

**风险**：
- 旧记录残留
- 唯一约束冲突

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| Upsert | team.repository.ts:439 | 更新现有记录 |
| 状态重置 | 业务逻辑 | 将已删除的记录恢复 |

```typescript
// 检查是否有任何记录（包括已离开的）
const existing = await repo.findMember({ teamId, userId, userType })
if (existing) {
  // 更新为新的邀请
  await repo.updateMember(existing.id, {
    role: 'member',
    status: 'pending',
    invitedBy: inviterId
  })
} else {
  await repo.createMember({...})
}
```

**结果**：允许重新邀请

---

### 3.5 角色变更时的权限检查

**场景描述**：
管理员尝试将普通成员设为管理员，但操作者不是 owner。

**风险**：
- 越权操作
- 权限提升攻击

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 角色检查 | team.service.ts | 只有 owner 可以设置管理员 |
| 前置断言 | assertTeamOwner | 断言失败抛出错误 |

```typescript
// 设为管理员
async setAdmin(teamId: string, targetId: string, operatorId: string) {
  const operatorRole = await this.getMemberRole(teamId, operatorId)
  if (operatorRole !== 'owner') {
    throw new TeamError('NOT_OWNER', '只有所有者可以设置管理员')
  }
  // ...
}
```

**错误码**：`NOT_OWNER`

---

## 4. 业务逻辑冲突

### 4.1 邀请外校成员

**场景描述**：
管理员尝试邀请非本校的用户加入团队。

**风险**：
- 数据隔离失效
- 权限泄露

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 学校验证 | team.service.ts | 验证被邀请人同校 |
| 查询限制 | team.repository.ts | 只返回本校用户 |

```typescript
// 邀请成员
const team = await repo.findById(teamId)
const targetSchoolId = await getUserSchoolId(targetUserId, targetType)

if (targetSchoolId !== team.schoolId) {
  throw new TeamError('SCHOOL_MISMATCH', '只能邀请本校成员')
}
```

**错误码**：`SCHOOL_MISMATCH`

---

### 4.2 学生邀请教师

**场景描述**：
学生尝试邀请教师加入团队。

**风险**：
- 权限越级
- 角色混乱

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 角色检查 | team.routes.ts | 只有 owner/admin 可以邀请 |
| 权限中间件 | permissions.ts | 检查操作者权限 |

**结果**：学生没有邀请权限，直接拒绝

**错误码**：`NOT_TEAM_ADMIN`

---

### 4.3 owner 退出时还有成员

**场景描述**：
owner 尝试退出团队，但团队中还有其他成员。

**风险**：
- 团队无主
- 管理混乱

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 成员检查 | team.service.ts | 检查是否只剩 owner |
| 强制转移 | 业务规则 | 要求先转移所有权 |

```typescript
// 退出团队
async leaveTeam(teamId: string, userId: string) {
  const memberCount = await repo.countMembers(teamId, excludeMemberId)
  const userRole = await this.getMemberRole(teamId, userId)

  if (userRole === 'owner' && memberCount > 0) {
    throw new TeamError('OWNER_MUST_TRANSFER', '请先转移所有权或解散团队')
  }
  // ...
}
```

**错误码**：`OWNER_MUST_TRANSFER`

---

### 4.4 转移给非成员

**场景描述**：
owner 尝试将所有权转移给一个非团队成员。

**风险**：
- 数据错误
- 团队无有效 owner

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 成员验证 | team.service.ts | 新 owner 必须是 active 成员 |
| 状态检查 | 事务内 | 检查成员状态 |

```typescript
const newOwner = await repo.findMemberById(newOwnerId)
if (!newOwner || newOwner.status !== 'active' || newOwner.teamId !== teamId) {
  throw new TeamError('NOT_ACTIVE_MEMBER', '新所有者必须是团队的有效成员')
}
```

**错误码**：`NOT_ACTIVE_MEMBER`

---

### 4.5 转移给已达上限的用户

**场景描述**：
owner 尝试将所有权转移给一个已拥有 50 个团队的用户。

**风险**：
- 业务规则违反
- 用户体验问题

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 数量检查 | team.service.ts | 检查目标用户拥有的团队数 |
| 限制提示 | 业务规则 | 返回具体限制数量 |

```typescript
const ownedTeams = await repo.countUserOwnedTeams(newOwnerUserId, newOwnerUserType)
const limit = newOwnerUserType === 'teacher' ? 50 : 5

if (ownedTeams >= limit) {
  throw new TeamError('TEAM_LIMIT_EXCEEDED', `该用户已拥有 ${ownedTeams} 个团队，达到上限`)
}
```

**错误码**：`TEAM_LIMIT_EXCEEDED`

---

## 5. 边界情况

### 5.1 团队无所有者

**场景描述**：
由于数据错误，团队没有 owner 成员。

**风险**：
- 系统异常
- 无法管理团队

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 事务保证 | team.service.ts | 创建团队时事务保证 |
| 数据修复 | 手动 | 联系管理员手动修复 |

```typescript
// 创建团队时的事务保证
await repo.transaction(async (tx) => {
  // 1. 创建团队
  const team = await tx.team.create({...})

  // 2. 创建 owner 成员
  await tx.teamMember.create({
    data: { teamId: team.id, userId, userType, role: 'owner', status: 'active' }
  })
})
```

**预防**：创建团队使用事务，确保团队和 owner 同时创建

---

### 5.2 成员数统计不准

**场景描述**：
缓存或计算错误导致显示的成员数不准确。

**风险**：
- 显示错误
- 误导用户

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 实时计算 | team.routes.ts | 使用 `_count` 聚合 |
| 不缓存 | 业务规则 | 成员数不缓存 |

```typescript
const team = await prisma.team.findUnique({
  where: { id },
  include: {
    _count: { select: { TeamMember: { where: { status: 'active' } } } }
  }
})
const memberCount = team._count.TeamMember
```

**建议**：始终使用 `_count` 实时计算

---

### 5.3 用户被删除后成员记录残留

**场景描述**：
用户被删除，但其团队成员记录仍然存在。

**风险**：
- 外键错误
- 数据不一致

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 级联删除 | schema.prisma | `onDelete: Cascade` |
| 事务删除 | 用户删除时 | 同时删除成员记录 |

**结果**：用户删除时，成员记录自动删除

---

### 5.4 学校被删除后团队残留

**场景描述**：
学校被删除，但其下团队仍然存在。

**风险**：
- 外键错误
- 数据孤立

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 前置检查 | schools.ts | 删除学校前检查是否有团队 |
| 禁止删除 | 业务规则 | 有团队的学校不能删除 |

```typescript
const teamCount = await prisma.team.count({ where: { schoolId } })
if (teamCount > 0) {
  return res.status(400).json({
    success: false,
    message: `该学校有 ${teamCount} 个团队，请先删除或转移`
  })
}
```

**建议**：删除学校前必须处理所有团队

---

### 5.5 批量邀请部分失败

**场景描述**：
批量邀请 10 人，其中 3 人已是成员，邀请失败。

**风险**：
- 部分成功状态不清晰
- 用户困惑

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 返回详细结果 | team.service.ts | 返回每个用户的处理结果 |
| 不使用事务 | 业务选择 | 部分失败不影响其他 |

```typescript
// 返回格式
{
  success: true,
  data: {
    invited: ['user1', 'user2', ...],     // 成功邀请
    alreadyMember: ['user3', ...],         // 已是成员
    notFound: ['user4', ...],              // 用户不存在
    schoolMismatch: ['user5', ...]         // 非同校用户
  }
}
```

**结果**：返回详细结果，前端分类显示

---

### 5.6 取消邀请时用户已接受

**场景描述**：
管理员尝试取消邀请，但用户已经接受了邀请。

**风险**：
- 状态不一致
- 操作冲突

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 条件删除 | team.repository.ts:422 | `deleteMemberIfPending()` |
| 返回 count | 条件删除 | count=0 表示已不是 pending |

```typescript
const count = await repo.deleteMemberIfPending(inviteId)
if (count === 0) {
  return res.status(400).json({ success: false, message: '邀请已被接受' })
}
```

**错误码**：`INVITATION_NOT_PENDING`

---

### 5.7 自己邀请自己

**场景描述**：
管理员尝试邀请自己加入团队（自己已经是成员）。

**风险**：
- 数据异常
- 业务逻辑错误

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| ID 检查 | team.routes.ts | 检查被邀请人不是操作者 |
| 前置验证 | 业务逻辑 | 邀请前验证 |

```typescript
if (inviterId === targetId && inviterType === targetType) {
  return res.status(400).json({ success: false, message: '不能邀请自己' })
}
```

**错误码**：`CANNOT_INVITE_SELF`

---

### 5.8 owner 把自己降级

**场景描述**：
owner 尝试将自己的角色从 owner 改为 admin 或 member。

**风险**：
- 团队无主
- 权限混乱

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 角色检查 | team.service.ts | 禁止直接降级 owner |
| 强制转移 | 业务规则 | 必须通过转移所有权 |

```typescript
if (memberId === operatorId && member.role === 'owner') {
  throw new TeamError('CANNOT_DOWNGRADE_OWNER', '所有者必须先转移所有权')
}
```

**错误码**：`CANNOT_DOWNGRADE_OWNER`

---

### 5.9 移除自己

**场景描述**：
管理员尝试从成员列表中移除自己。

**风险**：
- 操作歧义（移除 vs 退出）

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 身份检查 | team.routes.ts | 禁止移除自己 |
| 引导退出 | 业务规则 | 引导使用退出功能 |

```typescript
if (memberId === operatorId) {
  return res.status(400).json({
    success: false,
    message: '如需退出团队，请使用退出功能'
  })
}
```

**错误码**：`CANNOT_REMOVE_SELF`

---

### 5.10 审批人不是 admin/owner

**场景描述**：
普通成员尝试审批加入申请。

**风险**：
- 越权操作
- 权限漏洞

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 权限检查 | team.service.ts | 检查操作者是 admin/owner |
| 中间件 | permissions.ts | 使用 canManageTeam |

```typescript
const canManage = await canManageTeam(req, teamId)
if (!canManage) {
  return res.status(403).json({ success: false, message: '无权限处理申请' })
}
```

**错误码**：`NOT_TEAM_ADMIN`

---

## 6. 数据一致性冲突

### 6.1 TeamMember 和 TeamJoinRequest 不一致

**场景描述**：
学生的加入申请在 TeamJoinRequest 中状态为 pending，但在 TeamMember 中已有 active 记录。

**风险**：
- 数据分歧
- 显示错误

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 单一真相源 | 业务规则 | 以 TeamMember 为准 |
| 定时同步 | 可选 | 清理不一致数据 |

```sql
-- 清理脚本示例
UPDATE TeamJoinRequest
SET status = 'approved', processedAt = NOW()
WHERE status = 'pending'
AND studentId IN (
  SELECT userId FROM TeamMember WHERE status = 'active'
)
```

**建议**：统一使用 TeamMember 模型

---

### 6.2 用户身份变更

**场景描述**：
用户的角色从教师变为学生，但团队成员记录的 userType 仍是 teacher。

**风险**：
- 成员记录类型错误
- 权限异常

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 不支持变更 | 业务规则 | userType 一旦创建不能变更 |
| 重新加入 | 变通方案 | 需退出后重新加入 |

**说明**：当前系统不支持用户身份变更

---

### 6.3 批量操作部分失败

**场景描述**：
批量移除成员时，部分成员移除成功，部分失败。

**风险**：
- 事务不完整
- 状态混乱

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 使用事务 | team.service.ts | 全部成功或全部回滚 |
| 返回详细结果 | 业务规则 | 返回每个操作的结果 |

```typescript
await repo.transaction(async (tx) => {
  for (const memberId of memberIds) {
    const member = await tx.teamMember.findUnique({ where: { id: memberId } })
    if (member?.role === 'owner') {
      throw new Error('Cannot remove owner')
    }
    await tx.teamMember.delete({ where: { id: memberId } })
  }
})
```

**建议**：批量操作使用事务

---

### 6.4 审计日志丢失

**场景描述**：
操作成功但审计日志写入失败。

**风险**：
- 无法追溯
- 安全隐患

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 独立事务 | team.repository.ts:564 | 日志写入不影响主流程 |
| 异步写入 | 可选 | 使用消息队列 |

```typescript
async logOperation(params: TeamOperationLogParams) {
  try {
    await prisma.teamOperationLog.create({ data: {...} })
  } catch (error) {
    // 日志写入失败不影响主流程
    logger.error('team_operation_log_error', error, {...})
  }
}
```

**说明**：日志写入失败不阻塞主流程

---

### 6.5 头像/公告更新失败

**场景描述**：
团队成员头像或公告更新失败，但其他操作成功。

**风险**：
- 显示错误
- 数据不一致

**处理方案**：

| 方案 | 实现位置 | 说明 |
|------|----------|------|
| 独立 API | team.routes.ts | 头像/公告有独立接口 |
| 重试机制 | 前端 | 失败后可重试 |

**说明**：头像和公告使用独立的 API 端点

---

## 7. 冲突处理速查表

| # | 场景 | 风险 | 处理方案 | 错误码 |
|---|------|------|----------|--------|
| 1 | 同时审批同一申请 | 重复添加 | 条件更新 | REQUEST_ALREADY_PROCESSED |
| 2 | 同时邀请和申请 | 状态混乱 | Upsert + 邀请优先 | - |
| 3 | 审批时用户被移除 | 目标不存在 | 条件更新 + 事务 | REQUEST_NOT_FOUND |
| 4 | 转移时新 owner 被移除 | 无有效 owner | 事务内检查 | MEMBER_NOT_ACTIVE |
| 5 | 同时删除团队和处理申请 | 外键错误 | 级联删除 | - |
| 6 | 接受过期邀请 | 数据错误 | 条件更新 | INVITATION_NOT_PENDING |
| 7 | 重复申请加入 | 重复记录 | 唯一约束 | REQUEST_ALREADY_EXISTS |
| 8 | 已是成员再申请 | 状态混乱 | 成员检查 | ALREADY_MEMBER |
| 9 | 被移除后重新邀请 | 旧记录残留 | Upsert | - |
| 10 | 角色变更越权 | 权限提升 | 角色检查 | NOT_OWNER |
| 11 | 邀请外校成员 | 数据隔离失效 | 学校验证 | SCHOOL_MISMATCH |
| 12 | 学生邀请教师 | 权限越级 | 角色检查 | NOT_TEAM_ADMIN |
| 13 | owner 退出有成员 | 团队无主 | 强制转移 | OWNER_MUST_TRANSFER |
| 14 | 转移给非成员 | 数据错误 | 成员验证 | NOT_ACTIVE_MEMBER |
| 15 | 转移给达上限用户 | 业务违规 | 数量检查 | TEAM_LIMIT_EXCEEDED |
| 16 | 团队无所有者 | 系统异常 | 事务保证 | - |
| 17 | 成员数统计不准 | 显示错误 | 实时计算 | - |
| 18 | 用户删除后残留 | 外键错误 | 级联删除 | - |
| 19 | 学校删除后残留 | 外键错误 | 前置检查 | - |
| 20 | 批量邀请部分失败 | 状态不清晰 | 返回详细结果 | - |
| 21 | 取消已接受的邀请 | 状态不一致 | 条件删除 | INVITATION_NOT_PENDING |
| 22 | 自己邀请自己 | 数据异常 | ID 检查 | CANNOT_INVITE_SELF |
| 23 | owner 自己降级 | 团队无主 | 禁止操作 | CANNOT_DOWNGRADE_OWNER |
| 24 | 移除自己 | 操作歧义 | 引导退出 | CANNOT_REMOVE_SELF |
| 25 | 普通成员审批 | 越权操作 | 权限检查 | NOT_TEAM_ADMIN |
| 26 | 双模型数据不一致 | 数据分歧 | 单一真相源 | - |
| 27 | 用户身份变更 | 类型错误 | 不支持变更 | - |
| 28 | 批量操作部分失败 | 事务不完整 | 使用事务 | - |
| 29 | 审计日志丢失 | 无法追溯 | 独立事务 | - |
| 30 | 头像更新失败 | 显示错误 | 独立 API | - |

---

## 8. 代码位置索引

### 8.1 并发安全方法

| 方法 | 文件 | 行号 |
|------|------|------|
| updateMemberStatusIfPending | team.repository.ts | 390-396 |
| deleteMemberIfPending | team.repository.ts | 422-427 |
| updateJoinRequestIfPending | team.repository.ts | 532-541 |

### 8.2 权限检查方法

| 方法 | 文件 | 说明 |
|------|------|------|
| canManageTeam | permissions.ts:362 | 团队管理权限 |
| getTeamMemberRole | permissions.ts:394 | 获取团队角色 |
| assertTeamAdmin | team.service.ts | 断言管理员 |
| assertTeamOwner | team.service.ts | 断言所有者 |

### 8.3 事务使用位置

| 操作 | 文件 | 说明 |
|------|------|------|
| 创建团队 | team.service.ts:435 | 创建 Team + owner TeamMember |
| 转移所有权 | team.service.ts:701 | 更新旧 owner + 新 owner |
| 审批学生申请 | team.routes.ts | 更新 TeamJoinRequest + TeamMember |