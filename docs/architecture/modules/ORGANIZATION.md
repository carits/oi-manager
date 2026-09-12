---
status: current
audience: development, operations
last_verified: 2026-09-12
source_of_truth: apps/server/prisma/schema.prisma, apps/server/src/modules/organization, apps/server/src/modules/organization-join, apps/server/src/modules/organization-creation, apps/server/src/modules/authorization, apps/server/src/routes/workspaces.ts
---

# 组织与学校领域

## 边界与身份

`User` 是平台账号，全局身份只应使用 `user | platform_admin | super_admin`。学生、教师和学校负责人是某个组织内的
`OrganizationMembership.memberRole`，不得通过改写账号全局角色授予。一个账号可以同时加入或负责多个学校。

组织上下文由 URL `/org/:organizationId/*` 和 `X-OI-Organization-ID` 显式选择。服务端必须重新查询当前账号在该组织的
有效 Membership；不从 JWT 旧 `schoolId/teacherId/studentId` 或“最早加入的学校”推断。

```text
Account Identity
  User(user | platform_admin | super_admin)
        │
        ├─ OrganizationMembership(student | teacher | school_principal)
        │       ├─ StudentProfile / TeacherProfile
        │       ├─ RoleAssignment
        │       └─ explicit CapabilityGrant
        └─ PersonalProfile
```

## 核心模型

- `Organization`：组织聚合根；首版自助申请只支持 `type=school`。
- `School`：学校资料、规范化 `nameKey`、业务状态和目录状态。
- `OrganizationMembership`：正式或历史成员关系，目标状态为 `active | disabled | archived`。
- `OrganizationMembershipRole` / `OrganizationMembershipCapability`：规范化岗位分配和显式能力授予。
- `OrganizationJoinApplication`：用户主动申请加入，与 Membership 分离。
- `OrganizationInvitation`：学校主动邀请，与申请独立。
- `OrganizationCreationApplication`：申请创建新学校，不复用加入申请。
- `OrganizationAuditLog` / `PlatformAuditLog`：分别记录组织内和平台级敏感操作。

## 目录治理

`Organization.status` 和 `School.status` 表示业务启停；`School.directoryStatus` 单独表示发现与隔离：

| 状态 | 公开目录 | 已有成员工作区 | 用途 |
|---|---:|---:|---|
| `verified` | 是 | 是 | 正式学校 |
| `pending` | 否 | 是 | 等待平台核验 |
| `hidden` | 否 | 是 | 合法但不公开 |
| `legacy` | 否 | 否 | 历史测试/脏数据永久隔离 |

`legacy` 不进入目录、本人组织、工作区、申请或邀请流程，也不占用正式学校名称唯一键；关联历史数据保留。

## 加入、邀请与创建

`joinPolicy` 为 `invite_only | approval | closed`。只有 `approval` 接受主动申请；`closed` 同时阻止新申请和普通邀请。
现有和新建学校默认 `invite_only`。

审批、接受邀请和创建学校必须在 Serializable 事务和 advisory lock 内完成：锁定业务记录、校验 pending/名称/成员状态、
创建或恢复 Membership/Profile、更新状态、写审计和通知，任一步失败整体回滚。并发重复操作返回 409。

教师只能邀请或审批最终归属自己的学生；负责人管理全校学生与教师。`disabled` Membership 不能通过申请自行恢复；
`archived` 恢复时复用原 Membership ID 以保留历史关系。

超管批准学校创建申请和直接创建共用 `createSchoolOrganizationCore()`。创建事务同时产生 Organization、`verified` School、
`school_principal/employee` Membership、TeacherProfile、负责人指针和审计；不改写现有账号的全局角色。

## Capability 授权迁移

岗位是资料和默认能力模板，Capability 才是授权事实。当前读取模式由
`MEMBERSHIP_CAPABILITY_SOURCE=legacy|hybrid|normalized` 控制；迁移期默认 `hybrid`。受保护的
`/api/admin/migration/membership-roles` check/apply 负责幂等回填 RoleAssignment 与 CapabilityGrant。

切换 `normalized` 前必须同时满足：未解析 Membership 为 0，角色与能力差异为 0，持续观察期无新拒绝差异。切换后禁止授权
路径回退读取 `memberRole` 映射，但 `memberRole` 继续用于学生/教师资料分类和 UI 岗位展示。

## 通知与工作区

通知上下文为 `account` 或 `organization:<organizationId>`。邀请与申请结果是账号通知，学校待审是组织通知；未读数与业务
pending 数分离。`/api/workspaces` 动态读取有效 Membership，新组织不需重签 JWT。工作区失效时返回
`ORGANIZATION_NOT_AVAILABLE` 或 `ORGANIZATION_ACCESS_DENIED`，Web 清理当前组织上下文并回到身份选择。

## 不变量

- 用户名全局唯一，密码只存 bcrypt 哈希。
- 学校正式全称的 `nameKey` 在 `pending/verified/hidden` 中全局唯一。
- 平台管理员不因全局角色自动成为学校成员，也不能跳过组织资源范围。
- 前端隐藏按钮不是权限；每个写接口在事务前重新校验 Membership、Capability 和资源所有权。
- 不物理删除仍被提交、比赛、训练、题单、团队或审计引用的组织数据。

详细状态机见 [组织申请、邀请与成员关系](../ORGANIZATION_JOIN.md)，鉴权边界见 [认证与权限](../AUTHORIZATION.md)。
