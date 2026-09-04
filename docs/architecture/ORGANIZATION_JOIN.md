---
status: current
audience: development, operations
last_verified: 2026-09-05
source_of_truth: Prisma schema, organization-join and organization-creation application services, notification application service
---

# 组织申请、邀请与成员关系

第一版只为 `Organization.type=school` 提供加入流程。普通账号的全局角色是 `user`；学生、教师和学校负责人均由当前有效 `OrganizationMembership.memberRole` 决定。组织上下文继续由 URL 与 `X-OI-Organization-ID` 解析。

## 领域边界

- `OrganizationJoinApplication` 保存用户主动申请及审核结果。
- `OrganizationInvitation` 保存学校主动邀请及用户响应。
- `OrganizationMembership` 只保存正式或历史成员关系，目标状态为 `active/disabled/archived`。
- `UserNotification` 只负责消息展示；已读状态不是申请或邀请状态。
- `OrganizationAuditLog` 持久化加入策略、申请审批和邀请操作。
- `OrganizationCreationApplication` 专用于普通账号申请创建学校，不与加入申请、邀请或 Membership 复用。
- `PlatformAuditLog` 保存创建申请、撤销、审核和超管直接创建的平台级审计。

现有学校和新学校默认 `joinPolicy=invite_only`。`approval` 开放申请，`closed` 同时关闭申请和普通邀请。负责人可以修改策略；超级管理员可以管理和审计，但不通过个人入口加入学校。

## 权限

负责人可处理全校学生和教师申请、邀请学生或教师。普通教师只能查看学生申请、邀请学生，并且批准或邀请后的学生必须归属该教师。教师不能读取或处理教师申请。`disabled` Membership 不能通过申请或邀请恢复；`archived` Membership 可原位恢复以保留历史关系。

所有审批、接受邀请和 Membership/Profile 写入都在同一 Serializable 事务及组织 advisory lock 内完成。并发重复处理返回明确 409，不允许产生两个成员关系。

## 创建学校

只有状态正常且全局角色为 `user` 的账号能提交学校创建申请。一个账号可以同时加入或负责多个学校，但同时最多一条 pending 创建申请，滚动 24 小时最多提交 3 次。被拒绝的同一规范化学校名称对原申请人冷却 24 小时。

正式学校名称按 NFKC、去除首尾空白、合并连续空白和小写化生成 `School.nameKey`，数据库全局唯一。超管批准和直接创建共用 `createSchoolOrganizationCore()`：一次事务内创建 Organization、School、`school_principal/employee` Membership、TeacherProfile、负责人指针和审计。批准只增加组织身份，申请人的 `User.role` 仍为 `user`，工作区由 `/api/workspaces` 动态读取。

## 通知上下文

通知使用：

```text
account
organization:<organizationId>
```

个人空间读取 account；组织空间读取 account 加当前 organization。学校邀请和申请结果属于 account，加入申请待办属于 organization。铃铛未读数和业务 pending 数量分别计算。

## 兼容迁移

`GET/POST /api/admin/migration/organization-join` 受超级管理员与 `ENABLE_MAINTENANCE_API=true` 双重保护。检查和应用过程会迁移旧 pending/rejected Membership 邀请、规范 relationType，并尽可能解析旧 campus 通知的组织；无法解析的通知取消操作入口并进入报告。迁移期保留旧 Membership 和旧邀请响应接口，稳定发布周期后再清理。

`GET/POST /api/admin/migration/school-name-keys` 以同样的超管维护门禁检查/幂等回填历史学校 `nameKey`。发现标准化后重名时 apply 停止并返回报告，不自动合并。
