---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/architecture/modules/TEAMS.md
---

> 历史文档：本文件保留当时的设计、调查或实现记录，不代表当前系统行为。请以 `docs/architecture/modules/TEAMS.md` 为准。

# 团队模块状态机规范

> 创建时间: 2026-03-25
> 状态: 规范草案

---

## 1. 背景

团队模块涉及多种实体状态流转，包括成员关系、加入申请、团队本身等。当前代码中状态转换逻辑分散在多处，缺乏统一的状态机定义，导致：

1. 状态转换规则不明确，容易遗漏边界情况
2. 并发操作可能导致状态不一致
3. 新开发者难以理解完整的业务流程

本文档明确定义所有状态机，作为代码实现的依据。

---

## 2. 与当前代码的关系

| 状态机 | 对应模型 | 代码位置 |
|--------|----------|----------|
| Membership | `TeamMember` | `prisma/schema.prisma:444-460` |
| Request | `TeamJoinRequest` + `TeamMember(status=pending)` | `prisma/schema.prisma:429-442` |
| Team | `Team` | `prisma/schema.prisma:408-427` |

**当前问题**：
- 学生的加入申请使用 `TeamJoinRequest` 表
- 教师的加入申请使用 `TeamMember(status=pending, invitedBy=null)`
- 邀请使用 `TeamMember(status=pending, invitedBy!=null)`

---

## 3. Membership 状态机

### 3.1 状态定义

| 状态 | 值 | 含义 | 是否终态 |
|------|-----|------|----------|
| INVITED | `pending` + `invitedBy != null` | 已被邀请，等待响应 | 否 |
| REQUESTED | `pending` + `invitedBy == null` | 主动申请，等待审批 | 否 |
| ACTIVE | `active` | 正式成员 | 否 |
| LEFT | (已删除记录) | 主动退出 | 终态 |
| REMOVED | (已删除记录) | 被移除 | 终态 |
| REJECTED | (已删除记录) | 申请/邀请被拒绝 | 终态 |
| CANCELLED | (已删除记录) | 邀请被取消/申请被撤回 | 终态 |

### 3.2 状态转换图

```
                          ┌────────────────────────────────────┐
                          │                                    │
                          ▼                                    │
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     │
│   INVITED    │────▶│    ACTIVE    │────▶│   REMOVED    │     │
│  (被邀请)    │     │   (正式成员)  │     │   (被移除)   │     │
└──────────────┘     └──────────────┘     └──────────────┘     │
       │                    │                     ▲             │
       │                    │                     │             │
       ▼                    ▼                     │             │
┌──────────────┐     ┌──────────────┐             │             │
│   REJECTED   │     │     LEFT     │─────────────┘             │
│ (拒绝邀请)   │     │   (主动退出)  │                           │
└──────────────┘     └──────────────┘                           │
                          │                                      │
                          │ 角色变更                              │
                          ▼                                      │
                   ┌──────────────┐                              │
                   │    ACTIVE    │──────────────────────────────┘
                   │  (角色变更)   │     角色降级后退出
                   └──────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  REQUESTED   │────▶│    ACTIVE    │────▶│   REMOVED    │
│  (申请加入)   │     │   (正式成员)  │     │   (被移除)   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│   REJECTED   │     │     LEFT     │
│ (申请被拒绝)  │     │   (主动退出)  │
└──────────────┘     └──────────────┘
```

### 3.3 状态转换规则表

| 起始状态 | 触发事件 | 目标状态 | 执行者 | 前置条件 | 不可逆 |
|----------|----------|----------|--------|----------|--------|
| null | invite | INVITED | owner/admin | 用户非成员、同校 | 否 |
| null | request | REQUESTED | 本人 | 公开团队、非成员 | 否 |
| INVITED | accept | ACTIVE | 被邀请人 | status=pending | 是 |
| INVITED | reject | REJECTED | 被邀请人 | status=pending | 是 |
| INVITED | cancel | CANCELLED | owner/admin | status=pending | 是 |
| REQUESTED | approve | ACTIVE | owner/admin | status=pending | 是 |
| REQUESTED | reject | REJECTED | owner/admin | status=pending | 是 |
| REQUESTED | withdraw | CANCELLED | 申请人 | status=pending | 是 |
| ACTIVE | remove | REMOVED | owner/admin | 非 owner | 是 |
| ACTIVE | leave | LEFT | 本人 | 非 owner 或无其他成员 | 是 |
| ACTIVE | role_change | ACTIVE | owner | 目标非 owner | 否 |

### 3.4 终态与不可逆规则

**终态（不可恢复）**：
- LEFT：退出后需重新申请/邀请
- REMOVED：被移除后需重新申请/邀请
- REJECTED：被拒绝后可重新申请（视为新记录）
- CANCELLED：取消后可重新邀请

**不可逆操作**：
- 接受邀请后不能撤回
- 批准申请后不能撤回
- 退出团队后不能自动恢复
- 被移除后不能自动恢复

---

## 4. Request 状态机

### 4.1 背景：双轨制问题

当前系统存在两种申请机制：

| 用户类型 | 申请机制 | 存储位置 |
|----------|----------|----------|
| 学生 | TeamJoinRequest | 独立表 |
| 教师 | TeamMember(status=pending) | 成员表 |

**推荐统一方案**：使用 `invitedBy` 字段区分

| 类型 | invitedBy | 含义 |
|------|-----------|------|
| 邀请 | 邀请人ID | 被邀请加入 |
| 申请 | null | 主动申请加入 |

### 4.2 申请状态机

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   PENDING    │────▶│   APPROVED   │────▶│    ACTIVE    │
│   (待审批)   │     │   (已批准)   │     │   (已加入)   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│   REJECTED   │     │   WITHDRAWN  │
│   (已拒绝)   │     │   (已撤回)   │
└──────────────┘     └──────────────┘
```

### 4.3 邀请状态机

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   PENDING    │────▶│   ACCEPTED   │────▶│    ACTIVE    │
│   (待响应)   │     │   (已接受)   │     │   (已加入)   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│   REJECTED   │     │   CANCELLED  │
│   (已拒绝)   │     │   (已取消)   │
└──────────────┘     └──────────────┘
```

### 4.4 状态转换规则

| 起始状态 | 触发事件 | 目标状态 | 执行者 | 后续操作 |
|----------|----------|----------|--------|----------|
| PENDING | approve | APPROVED | owner/admin | 创建/更新 TeamMember(status=active) |
| PENDING | reject | REJECTED | owner/admin | 更新 processedAt/processedBy |
| PENDING | withdraw | WITHDRAWN | 申请人 | 删除 TeamMember 记录 |
| PENDING | accept | ACCEPTED | 被邀请人 | 更新 TeamMember(status=active) |
| PENDING | reject_invite | REJECTED | 被邀请人 | 删除 TeamMember 记录 |
| PENDING | cancel | CANCELLED | owner/admin | 删除 TeamMember 记录 |

---

## 5. Team 状态机

### 5.1 状态定义

团队本身没有显式状态字段，但存在隐式生命周期：

| 阶段 | 条件 | 可执行操作 |
|------|------|------------|
| 创建中 | 刚创建，仅 owner | owner 设置团队信息 |
| 正常运营 | 有成员 | 所有正常操作 |
| 待解散 | 仅剩 owner | owner 可解散或转让 |
| 已解散 | (记录已删除) | 无 |

### 5.2 团队生命周期

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    创建中    │────▶│   正常运营   │────▶│   已解散    │
│  (仅owner)   │     │  (有成员)    │     │  (已删除)   │
└──────────────┘     └──────────────┘     └──────────────┘
                           │
                           │ 成员全部退出
                           ▼
                    ┌──────────────┐
                    │   待解散     │
                    │ (仅剩owner)  │
                    └──────────────┘
```

### 5.3 解散条件

团队可解散当且仅当：
1. 仅剩 owner 一个成员
2. owner 主动退出或删除团队

**禁止事项**：
- 团队有其他成员时，owner 不能直接退出
- 团队有其他成员时，不能直接删除团队

---

## 6. 角色状态机

### 6.1 角色定义

| 角色 | 值 | 权限范围 |
|------|-----|----------|
| owner | `owner` | 全部权限 + 转移所有权 |
| admin | `admin` | 邀请、移除成员、审批申请、编辑团队 |
| member | `member` | 查看团队、退出团队 |

### 6.2 角色变更规则

```
        ┌───────────────────────────────────────┐
        │             owner 转移                │
        │                                       ▼
   ┌─────────┐     设为管理员     ┌─────────┐     ┌─────────┐
   │ MEMBER  │─────────────────▶│  ADMIN  │◀────│  OWNER  │
   └─────────┘                   └─────────┘     └─────────┘
        ▲                             │               │
        │                             │               │
        └─────────────────────────────┴───────────────┘
                  取消管理员 / 转移后降级
```

### 6.3 角色变更规则表

| 操作 | 当前角色 | 目标角色 | 执行者 | 前置条件 | 约束 |
|------|----------|----------|--------|----------|------|
| 设为管理员 | member | admin | owner | 无 | 无 |
| 取消管理员 | admin | member | owner | 无 | 无 |
| 转移所有权 | owner | admin | owner | 新 owner 必须是 active 成员 | 原 owner 降为 admin |
| 转移所有权 | owner | member | owner | 新 owner 必须是 active 成员 | 原 owner 降为 admin |

### 6.4 禁止的角色变更

| 操作 | 原因 |
|------|------|
| owner 直接降级为 member | 必须先转移所有权 |
| owner 移除自己 | 必须先转移所有权或解散团队 |
| admin 提升 member 为 admin | 仅 owner 可设置管理员 |
| member 变更任何人的角色 | 无权限 |

---

## 7. 典型操作的状态变化

### 7.1 邀请成员

```
初始: TeamMember 不存在
  │
  ▼
POST /teams/:id/members
  │
  ├── 验证: 操作者是 owner/admin
  ├── 验证: 被邀请人非成员
  ├── 验证: 被邀请人同校
  │
  ▼
创建: TeamMember(status=pending, invitedBy=操作者ID)
  │
  ▼
结果: 成员状态 = INVITED
```

### 7.2 申请加入

```
初始: TeamMember 不存在
  │
  ▼
POST /teams/:id/join-request
  │
  ├── 验证: 团队是公开的
  ├── 验证: 申请人是同校学生/教师
  ├── 验证: 申请人非成员
  │
  ▼
学生: 创建 TeamJoinRequest(status=pending)
教师: 创建 TeamMember(status=pending, invitedBy=null)
  │
  ▼
结果: 成员状态 = REQUESTED
```

### 7.3 审批申请

```
初始: TeamMember(status=pending, invitedBy=null) 或 TeamJoinRequest(status=pending)
  │
  ▼
POST /teams/requests/:id/approve
  │
  ├── 验证: 操作者是 owner/admin
  ├── 验证: 申请状态是 pending
  ├── 并发安全: updateMany({status: 'pending'})
  │
  ▼
更新: status = active
  │
  ▼
结果: 成员状态 = ACTIVE
```

### 7.4 接受邀请

```
初始: TeamMember(status=pending, invitedBy=邀请人ID)
  │
  ▼
POST /teams/invitations/:id/accept
  │
  ├── 验证: 操作者是被邀请人本人
  ├── 验证: 邀请状态是 pending
  │
  ▼
更新: status = active
  │
  ▼
结果: 成员状态 = ACTIVE
```

### 7.5 移除成员

```
初始: TeamMember(status=active, role=member/admin)
  │
  ▼
DELETE /teams/:id/members/:memberId
  │
  ├── 验证: 操作者是 owner/admin
  ├── 验证: 目标不是 owner
  ├── 验证: admin 只能移除 member（owner 可移除 admin）
  │
  ▼
删除: TeamMember 记录
  │
  ▼
结果: 成员状态 = REMOVED（记录已删除）
```

### 7.6 退出团队

```
初始: TeamMember(status=active)
  │
  ▼
POST /teams/:id/leave
  │
  ├── 验证: 操作者是本人
  ├── 验证: 如果是 owner，无其他成员
  │
  ├── owner + 无其他成员
  │     │
  │     ▼
  │   删除: Team 记录（团队解散）
  │
  └── 非 owner 或有其他成员
        │
        ▼
      删除: TeamMember 记录
  │
  ▼
结果: 成员状态 = LEFT（记录已删除）
```

### 7.7 转移所有权

```
初始: TeamMember(A, role=owner), TeamMember(B, role=admin/member)
  │
  ▼
POST /teams/:id/transfer
  │
  ├── 验证: 操作者是 owner
  ├── 验证: 新 owner 是 active 成员
  ├── 验证: 新 owner 同校
  ├── 验证: 新 owner 未达团队数量上限
  │
  ▼
事务:
  ├── 更新: TeamMember(A, role=admin)
  └── 更新: TeamMember(B, role=owner)
  │
  ▼
结果: A=admin, B=owner
```

---

## 8. 并发安全与状态一致性

### 8.1 乐观锁模式

当前代码使用条件更新实现乐观锁：

```typescript
// team.repository.ts
async updateMemberStatusIfPending(id: string, status: MemberStatus): Promise<number> {
  const result = await prisma.teamMember.updateMany({
    where: { id, status: 'pending' },
    data: { status, joinedAt: new Date() }
  })
  return result.count
}
```

**使用场景**：
- 审批申请：count=0 表示已被处理
- 拒绝申请：count=0 表示已被处理

### 8.2 事务保护

以下操作必须使用事务：

| 操作 | 事务内容 |
|------|----------|
| 创建团队 | 创建 Team + 创建 owner TeamMember |
| 转移所有权 | 更新原 owner + 更新新 owner |
| 审批学生申请 | 更新 TeamJoinRequest + 创建/更新 TeamMember |

### 8.3 状态检查顺序

推荐的状态检查顺序：

1. **身份验证**：确认操作者身份
2. **权限检查**：确认操作者有权限
3. **状态检查**：确认目标状态正确
4. **并发控制**：使用条件更新
5. **执行操作**：更新状态
6. **记录审计**：写入操作日志

---

## 9. 后续改代码必须遵守的约束

1. **所有状态变更必须经过状态机校验**
   - 不允许绕过状态机直接修改 status
   - 不允许创建非法状态组合

2. **并发操作必须使用条件更新**
   - 审批、拒绝、取消操作必须检查 status='pending'
   - 使用 updateMany/deleteMany 返回 count 判断成功

3. **敏感操作必须使用事务**
   - 创建团队、转移所有权、审批申请

4. **终态不可恢复**
   - 不允许恢复已删除的成员记录
   - 重新加入视为新记录

5. **角色变更必须记录审计日志**
   - 所有 role_change 操作写入 TeamOperationLog

6. **状态变更必须更新 joinedAt**
   - 激活时更新 joinedAt 为当前时间

---

## 10. 术语表

| 术语 | 定义 |
|------|------|
| INVITED | 被邀请状态，status=pending 且 invitedBy 非空 |
| REQUESTED | 申请中状态，status=pending 且 invitedBy 为空 |
| ACTIVE | 正式成员，status=active |
| LEFT | 已退出，成员记录已删除 |
| REMOVED | 已移除，成员记录已删除 |
| owner | 团队所有者，role=owner |
| admin | 团队管理员，role=admin |
| member | 普通成员，role=member |