# 团队模块测试场景文档

> 创建时间: 2026-04-06
> 状态: 审计验证
> 关联文档: [状态机](./TEAM_STATE_MACHINE.md) | [权限规则](./TEAM_PERMISSION_RULES.md) | [冲突规则](./TEAM_CONFLICT_RULES.md) | [API契约](./TEAM_API_CONTRACT.md)

---

## 目录

- [A. ID 类型回归测试](#a-id-类型回归测试) — 核心bug回归（6个场景）
- [B. 成员生命周期测试](#b-成员生命周期测试) — 状态机流转（10个场景）
- [C. 权限测试](#c-权限测试) — 角色权限边界（12个场景）
- [D. 冲突场景测试](#d-冲突场景测试) — 并发与竞争条件（10个场景）
- [E. 边界与特殊场景](#e-边界与特殊场景) — 极端情况（8个场景）

---

## 前置说明

### ID 类型说明

团队模块存在三种 ID，这是理解测试场景的关键前提：

| ID 类型 | 来源 | 示例 | 说明 |
|---------|------|------|------|
| `User.id` | User 表主键 | `usr_xxx` | 认证用户 ID |
| `Teacher.id` / `Student.id` | Profile 表主键 | `tch_xxx` / `stu_xxx` | 存储在 `TeamMember.userId` 字段 |
| `TeamMember.id` | TeamMember 表主键 | `mem_xxx` | 成员记录 ID |

**前端实际发送的是 Teacher/Student ID**，因为 `getTeamDetail` → `getMemberDetails(m.userId, m.userType)` → 返回 `{ id: teacher.id/student.id }`。

**已修复的 bug**：`POST /:id/admins` 和 `DELETE /:id/admins/:adminId` 曾错误使用 `findMemberById()`（期望 TeamMember 记录 ID），现已改为 `findMember({ teamId, userId, userType })`。

### 测试账号

| 角色 | 用途 | 说明 |
|------|------|------|
| teacher-owner | 团队所有者 | 拥有全部权限 |
| teacher-admin | 团队管理员 | 可管理成员，不可管理 admin |
| teacher-member | 团队普通教师成员 | 无管理权限 |
| student-admin | 团队管理员（学生） | student 可被设为 admin |
| student-member | 团队普通学生成员 | 无管理权限 |
| teacher-outsider | 非团队成员/外校教师 | 用于测试权限隔离 |

---

## A. ID 类型回归测试

> **目的**: 验证已修复的 ID 歧义 bug 不会回归。
> **涉及端点**: DELETE /:id/members/:memberId, POST /:id/admins, DELETE /:id/admins/:adminId, POST /:id/transfer

### A1. 移除教师成员 — 传 Teacher ID + memberType

- **端点**: `DELETE /api/teams/:id/members/:memberId?memberType=teacher`
- **URL 参数**: `:memberId` = Teacher.id（不是 TeamMember.id）
- **查询参数**: `memberType=teacher`
- **测试步骤**:
  1. 以 owner 身份登录
  2. 获取团队详情，记下目标教师成员的 `id`（实际为 Teacher.id）
  3. 调用 `DELETE /api/teams/{teamId}/members/{teacherId}?memberType=teacher`
- **预期结果**: 200, `{ success: true, message: "成员已移除" }`
- **回归关联**: 修复的 DELETE member ID bug

### A2. 移除学生成员 — 传 Student ID + memberType

- **端点**: `DELETE /api/teams/:id/members/:memberId?memberType=student`
- **URL 参数**: `:memberId` = Student.id
- **查询参数**: `memberType=student`
- **测试步骤**:
  1. 以 owner 身份登录
  2. 获取团队详情，记下目标学生成员的 `id`
  3. 调用 `DELETE /api/teams/{teamId}/members/{studentId}?memberType=student`
- **预期结果**: 200, `{ success: true, message: "成员已移除" }`
- **回归关联**: 修复的 DELETE member ID bug

### A3. 设置教师为管理员 — 传 Teacher ID + memberType

- **端点**: `POST /api/teams/:id/admins`
- **请求体**: `{ memberId: teacherId, memberType: 'teacher' }`
- **测试步骤**:
  1. 以 owner 身份登录
  2. 获取团队详情，找到角色为 `member` 的教师
  3. 调用 `POST /api/teams/{teamId}/admins` 发送 `{ memberId: teacherId, memberType: 'teacher' }`
- **预期结果**: 200, `{ success: true, message: "已设置为管理员", data: { role: 'admin' } }`
- **回归关联**: 修复的 POST admins ID bug（此前返回"该成员不存在"）

### A4. 设置学生为管理员 — 传 Student ID + memberType

- **端点**: `POST /api/teams/:id/admins`
- **请求体**: `{ memberId: studentId, memberType: 'student' }`
- **测试步骤**: 同 A3，但目标是学生成员
- **预期结果**: 200, 学生被设为 admin
- **回归关联**: 修复的 POST admins ID bug

### A5. 取消教师管理员 — 传 Teacher ID + adminType

- **端点**: `DELETE /api/teams/:id/admins/:adminId?adminType=teacher`
- **URL 参数**: `:adminId` = Teacher.id
- **查询参数**: `adminType=teacher`
- **测试步骤**:
  1. 以 owner 身份登录
  2. 先将一名教师设为管理员（A3 通过）
  3. 调用 `DELETE /api/teams/{teamId}/admins/{teacherId}?adminType=teacher`
- **预期结果**: 200, `{ success: true, message: "移除成功" }`
- **回归关联**: 修复的 DELETE admins ID bug + 死代码清理

### A6. 取消学生管理员 — 传 Student ID + adminType

- **端点**: `DELETE /api/teams/:id/admins/:adminId?adminType=student`
- **URL 参数**: `:adminId` = Student.id
- **查询参数**: `adminType=student`
- **测试步骤**: 同 A5，但目标是学生管理员
- **预期结果**: 200, 管理员角色降为 member
- **回归关联**: 修复的 DELETE admins ID bug

---

## B. 成员生命周期测试

> **目的**: 验证成员从加入到退出的完整状态流转。
> **关联文档**: [TEAM_STATE_MACHINE.md](./TEAM_STATE_MACHINE.md)

### B1. 完整生命周期: 邀请 → 接受 → 设admin → 取消admin → 退出

- **状态路径**: 不存在 → pending(active member) → active(admin) → active(member) → 已退出
- **测试步骤**:
  1. Owner 邀请学生: `POST /api/teams/{id}/members { members: [{ id: studentId, type: 'student' }] }`
  2. 学生接受邀请: `POST /api/teams/invitations/{memberId}/accept`
  3. Owner 设为管理员: `POST /api/teams/{id}/admins { memberId: studentId, memberType: 'student' }`
  4. Owner 取消管理员: `DELETE /api/teams/{id}/admins/{studentId}?adminType=student`
  5. 学生退出: `POST /api/teams/{id}/leave`
- **每步预期**:
  1. 200, 成员记录创建，status=pending
  2. 200, status 变为 active
  3. 200, role 变为 admin
  4. 200, role 变为 member
  5. 200, "已退出团队"
- **相关文档**: TEAM_STATE_MACHINE.md § 成员状态流转

### B2. 邀请 → 拒绝

- **测试步骤**:
  1. Owner 邀请学生: `POST /api/teams/{id}/members`
  2. 学生拒绝邀请: `POST /api/teams/invitations/{memberId}/reject`
- **预期结果**: 步骤2返回200，"已拒绝邀请"，成员记录被删除
- **相关文档**: TEAM_STATE_MACHINE.md § INVITED 状态

### B3. 邀请 → 取消邀请

- **测试步骤**:
  1. Owner 邀请学生
  2. Owner 取消邀请: `DELETE /api/teams/{id}/invites/{inviteId}`
- **预期结果**: 步骤2返回200，"邀请已取消"，成员记录被删除
- **相关文档**: TEAM_STATE_MACHINE.md § INVITED 状态

### B4. 学生申请加入 → 批准 → 退出

- **测试步骤**:
  1. 学生申请加入公开团队: `POST /api/teams/{id}/join-request { message: "申请加入" }`
  2. 管理员批准: `POST /api/teams/requests/{requestId}/approve`
  3. 学生退出: `POST /api/teams/{id}/leave`
- **预期结果**: 步骤2后学生成为active成员，步骤3后退出
- **相关文档**: TEAM_STATE_MACHINE.md § REQUESTED 状态

### B5. 学生申请加入 → 拒绝

- **测试步骤**:
  1. 学生申请加入: `POST /api/teams/{id}/join-request`
  2. 管理员拒绝: `POST /api/teams/requests/{requestId}/reject`
- **预期结果**: 步骤2返回200，申请状态变为rejected
- **相关文档**: TEAM_STATE_MACHINE.md § REQUESTED 状态

### B6. 教师申请加入 → 批准

- **测试步骤**:
  1. 教师申请加入: `POST /api/teams/{id}/teacher-join-request { message: "想加入团队" }`
  2. 管理员批准: `POST /api/teams/teacher-join-requests/{memberId}/approve`
- **预期结果**: 教师成为active成员
- **相关文档**: TEAM_STATE_MACHINE.md § 教师加入流程

### B7. 教师申请加入 → 拒绝

- **测试步骤**:
  1. 教师申请加入
  2. 管理员拒绝: `POST /api/teams/teacher-join-requests/{memberId}/reject`
- **预期结果**: 申请被拒绝，pending成员记录被删除
- **相关文档**: TEAM_STATE_MACHINE.md § 教师加入流程

### B8. 被移除后重新邀请

- **状态路径**: 不存在 → invited → active → removed → invited → active
- **测试步骤**:
  1. 邀请学生并接受
  2. Owner 移除该学生: `DELETE /api/teams/{id}/members/{studentId}?memberType=student`
  3. 再次邀请同一学生
  4. 学生接受
- **预期结果**: 步骤3使用 upsert 成功，步骤4后学生再次成为 active 成员
- **相关文档**: TEAM_STATE_MACHINE.md § 重新加入

### B9. 退出后重新申请加入

- **状态路径**: active → left → requested → active
- **测试步骤**:
  1. 学生主动退出团队
  2. 学生再次申请加入（如果是公开团队）
  3. 管理员批准
- **预期结果**: 步骤2成功提交申请，步骤3后重新成为成员
- **相关文档**: TEAM_STATE_MACHINE.md § 重新加入

### B10. Owner 转移后降为 admin 再退出

- **状态路径**: owner → admin → left
- **测试步骤**:
  1. Owner 转移所有权: `POST /api/teams/{id}/transfer { newOwnerId, newOwnerType }`
  2. 原owner（现为admin）退出团队
- **预期结果**: 步骤1返回200，原owner变为admin，新owner变为owner。步骤2成功退出
- **相关文档**: TEAM_STATE_MACHINE.md § 所有权转移

---

## C. 权限测试

> **目的**: 验证不同角色的操作权限边界。
> **关联文档**: [TEAM_PERMISSION_RULES.md](./TEAM_PERMISSION_RULES.md)

### C1. Owner 移除 member — 成功

- **操作者**: owner
- **目标**: member 角色成员
- **预期**: 200 成功

### C2. Owner 移除 admin — 成功

- **操作者**: owner
- **目标**: admin 角色成员
- **预期**: 200 成功
- **说明**: owner 有权移除任何非 owner 成员

### C3. Admin 移除 member — 成功

- **操作者**: admin
- **目标**: member 角色成员
- **预期**: 200 成功
- **相关文档**: TEAM_PERMISSION_RULES.md § admin 权限范围

### C4. Admin 移除 admin — 禁止

- **操作者**: admin
- **目标**: admin 角色成员
- **测试步骤**: admin 调用 `DELETE /api/teams/{id}/members/{adminMemberId}?memberType=student`
- **预期结果**: 403, "无权限移除管理员"
- **相关文档**: TEAM_PERMISSION_RULES.md § admin 不能移除 admin

### C5. Member 移除 member — 禁止

- **操作者**: member 角色成员
- **目标**: 其他 member 角色成员
- **预期**: 403, 权限不足
- **说明**: member 无任何管理权限

### C6. Owner 设 admin — 成功

- **操作者**: owner
- **目标**: member 角色
- **预期**: 200 成功

### C7. Admin 设 admin — 禁止

- **操作者**: admin
- **目标**: member 角色
- **测试步骤**: admin 调用 `POST /api/teams/{id}/admins { memberId, memberType }`
- **预期结果**: 403, "只有团队所有者可以添加管理员"
- **相关文档**: TEAM_PERMISSION_RULES.md § 只有 owner 可管理 admin

### C8. Owner 取消 admin — 成功

- **操作者**: owner
- **目标**: admin 角色
- **预期**: 200 成功，admin 降为 member

### C9. Admin 取消 admin — 禁止

- **操作者**: admin
- **目标**: 另一个 admin
- **预期**: 403, "只有团队所有者可以移除管理员"
- **相关文档**: TEAM_PERMISSION_RULES.md § 只有 owner 可管理 admin

### C10. Owner 移除自己 — 禁止

- **操作者**: owner
- **目标**: owner 自己
- **测试步骤**: owner 调用 `DELETE /api/teams/{id}/members/{ownerId}?memberType=teacher`
- **预期结果**: 403, "不能移除所有者" / "不能移除自己"
- **相关文档**: TEAM_PERMISSION_RULES.md § owner 不能被移除

### C11. Admin 退出团队 — 成功

- **操作者**: admin
- **测试步骤**: admin 调用 `POST /api/teams/{id}/leave`
- **预期结果**: 200, "已退出团队"
- **说明**: admin 可以自由退出

### C12. 非成员查看私有团队 — 禁止

- **操作者**: 非团队成员
- **测试步骤**: 外部用户调用 `GET /api/teams/{privateTeamId}`
- **预期结果**: 403, "无权查看私有团队"
- **说明**: 公开团队对同校用户可见，私有团队仅对成员可见

---

## D. 冲突场景测试

> **目的**: 验证并发操作和竞争条件下的正确性。
> **关联文档**: [TEAM_CONFLICT_RULES.md](./TEAM_CONFLICT_RULES.md)

### D1. 两个 admin 同时审批同一申请

- **冲突规则**: TEAM_CONFLICT_RULES.md #2.1
- **测试步骤**:
  1. 学生提交加入申请
  2. 两个 admin 几乎同时调用 `POST /api/teams/requests/{requestId}/approve`
- **预期结果**: 第一个成功（200），第二个返回 400 "该申请已处理"
- **安全机制**: 条件更新 `updateMany({ where: { status: 'pending' } })`，count=0 时返回已处理
- **验证**: 数据库中只有一条 approved 记录

### D2. 同时邀请和申请加入

- **冲突规则**: TEAM_CONFLICT_RULES.md #2.2
- **测试步骤**:
  1. 学生正在申请加入团队
  2. 管理员同时邀请了同一学生
- **预期结果**: 邀请创建成功（upsert），申请可能失败或邀请优先
- **说明**: upsert 机制确保最终一致性

### D3. 取消已接受的邀请

- **测试步骤**:
  1. Owner 邀请学生
  2. 学生接受邀请（status 变为 active）
  3. Owner 尝试取消邀请: `DELETE /api/teams/{id}/invites/{inviteId}`
- **预期结果**: 步骤3返回 400, "邀请已不是待处理" / 成员已是 active 状态
- **安全机制**: `deleteMemberIfPending()` — 只删除 pending 状态的记录

### D4. 转移时新 owner 被移除

- **测试步骤**:
  1. 准备两个操作者：owner 和另一个将要成为新 owner 的 admin
  2. 在转移过程中，另一个 admin 被移除
  3. 尝试转移所有权给该已移除的 admin
- **预期结果**: 转移失败，"不是有效成员" 或 "不是活跃成员"
- **安全机制**: 转移前检查新 owner 是 active 成员

### D5. 批量邀请：部分已是成员

- **测试步骤**:
  1. 准备3个用户：A（已入团）、B（未入团）、C（未入团）
  2. 批量邀请: `POST /api/teams/{id}/members { members: [{ id: A }, { id: B }, { id: C }] }`
- **预期结果**: 200，返回分类结果:
  ```json
  {
    "invited": ["B", "C"],
    "alreadyMember": ["A"],
    "notFound": [],
    "notSameSchool": []
  }
  ```

### D6. 重复申请加入

- **测试步骤**:
  1. 学生提交加入申请（成功）
  2. 学生再次提交加入申请
- **预期结果**: 步骤2返回 400, "已有待处理的申请" 或 "申请已存在"
- **相关文档**: TEAM_CONFLICT_RULES.md #3.2

### D7. 已是成员再次申请

- **测试步骤**:
  1. 学生已是团队 active 成员
  2. 学生尝试申请加入同一团队
- **预期结果**: 返回 400, "已是团队成员"
- **相关文档**: TEAM_CONFLICT_RULES.md #3.3

### D8. 邀请外校成员

- **测试步骤**:
  1. Owner 尝试邀请另一所学校的教师
- **预期结果**: 返回 400 或被归类到 `notSameSchool`
- **说明**: 邀请接口中检查 `memberUser.schoolId !== team.schoolId`

### D9. Owner 退出有成员的团队 — 禁止

- **测试步骤**:
  1. 团队中有 owner + admin + 若干 member
  2. Owner 调用 `POST /api/teams/{id}/leave`
- **预期结果**: 400, "还有其他成员，请先转移所有权"
- **相关文档**: TEAM_PERMISSION_RULES.md § owner 退出条件

### D10. 转移给达团队数量上限的用户

- **测试步骤**:
  1. 目标用户已拥有团队数量达上限（教师50/学生5）
  2. Owner 调用 `POST /api/teams/{id}/transfer { newOwnerId, newOwnerType }`
- **预期结果**: 400, "该用户拥有的团队数量已达上限"
- **说明**: 限制检查在 service 层 `transferTeam` 方法中

---

## E. 边界与特殊场景

> **目的**: 验证极端情况和特殊操作路径。

### E1. 创建团队数量达上限

- **测试步骤**:
  1. 教师已拥有 50 个团队（上限）
  2. 尝试创建第 51 个团队
- **预期结果**: 400, "您拥有的团队数量已达上限"
- **说明**: 上限值 — 教师 50，学生 5

### E2. 自己邀请自己

- **测试步骤**:
  1. Owner 尝试邀请自己加入自己创建的团队
- **预期结果**: 400, "不能邀请自己"
- **说明**: 邀请前检查是否已是成员时自动覆盖此场景

### E3. Owner 直接降级 — 禁止

- **测试步骤**:
  1. Owner 尝试取消自己的 owner 角色（通过取消管理员接口）
- **预期结果**: 403, "不能直接降级所有者"
- **说明**: owner 必须先转移所有权才能退出

### E4. Owner 退出无其他成员 = 解散

- **测试步骤**:
  1. 团队中只有 owner 一人
  2. Owner 调用 `POST /api/teams/{id}/leave`
- **预期结果**: 200, "团队已解散"
- **说明**: 此时团队被删除
- **验证**: `GET /api/teams/{id}` 返回 404

### E5. 删除有成员的团队

- **测试步骤**:
  1. 团队中有多名成员
  2. Owner 调用 `DELETE /api/teams/{id}`
- **预期结果**: 403, "还有其他成员" / "仅剩 owner 时可删除"
- **说明**: 安全措施防止误删有成员的团队

### E6. 处理已过期/已处理的邀请

- **测试步骤**:
  1. 邀请已被接受（active 状态）
  2. 学生尝试再次接受: `POST /api/teams/invitations/{memberId}/accept`
- **预期结果**: 400, "邀请已不是待处理"
- **安全机制**: `updateMemberStatusIfPending()` — 条件更新，只处理 pending 状态

### E7. 批量邀请用户名不存在

- **测试步骤**:
  1. 通过用户名批量邀请: `POST /api/teams/{id}/members { usernames: ["不存在用户1", "不存在用户2"] }`
- **预期结果**: 200, 返回 `{ invited: [], notFound: ["不存在用户1", "不存在用户2"] }`

### E8. 兼容模式：不传 memberType 的删除成员

- **测试步骤**:
  1. 不传 `memberType` 查询参数
  2. 调用 `DELETE /api/teams/{id}/members/{teamMemberRecordId}`（传 TeamMember 记录 ID）
- **预期结果**: 200 成功（回退到 `findMemberById` 兼容模式）
- **说明**: 此兼容路径保留给未来可能的内部调用，前端不会使用

---

## 测试验证方法

### 后端代码验证

修复完成后，运行以下命令确认代码状态：

```bash
# 确认 findMemberById 只在兼容回退路径使用
grep -n 'findMemberById' apps/server/src/modules/team/team.routes.ts

# 确认死代码已清理
grep -n 'whereClause' apps/server/src/modules/team/team.routes.ts

# 确认无浏览器原生弹窗
grep -r '\b(alert|confirm|prompt)\(' apps/web/src --include='*.tsx'
```

### 手动端到端验证

建议按以下顺序进行验证：

1. **A组（ID回归）** — 通过前端操作验证移除成员、设为管理员、取消管理员
2. **B组（生命周期）** — 完整走一遍邀请→接受→设admin→退出
3. **C组（权限）** — 切换不同角色账号验证权限边界
4. **D组（冲突）** — 模拟并发操作（两个浏览器标签页同时操作）
5. **E组（边界）** — 验证极端情况

### 启动服务

```bash
# 杀死已有进程重启
cd apps/server && pnpm dev    # 后端 :3002
cd apps/web && pnpm dev       # 前端 :3000
```

---

## 修复记录

| 日期 | 修复内容 | 涉及文件 |
|------|----------|----------|
| 2026-04-06 | POST /:id/admins ID 歧义修复 | `team.routes.ts` 行 902-973 |
| 2026-04-06 | DELETE /:id/admins/:adminId ID 歧义修复 + 死代码清理 | `team.routes.ts` 行 975-1034 |
| 2026-04-06 | DELETE /:id/members/:memberId ID 歧义修复（此前已完成） | `team.routes.ts` 行 758+ |
| 2026-04-06 | API 契约文档 ID 语义修正 | `TEAM_API_CONTRACT.md` §3.2, §6.1, §6.2, §7.1 |
