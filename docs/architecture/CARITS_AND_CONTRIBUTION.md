---
status: current
audience: development, operations
last_verified: 2026-08-15
source_of_truth: apps/server/prisma/schema.prisma and apps/server/src/modules
---

# Carits币与贡献 V1

## 当前状态

Carits币和贡献均处于“暂未开放”阶段。系统提供个人、校园和平台管理入口，
但不会创建账户、余额、流水、贡献事件或排行榜数据。

页面与接口只能返回功能状态、中文说明和空集合，禁止使用 `0 C`、空账单或空榜单
伪造已经存在的业务事实。

## 领域边界

Carits币与贡献是两个独立领域：

- Carits币未来使用账户、交易与不可变分录组成双向账本。
- 贡献未来使用可验证的贡献事件、规则版本、证据快照、采纳与撤销记录。
- 贡献奖励 Carits币时，必须通过独立业务关联和账本交易实现；不能把贡献值当余额。

V1 没有任何通用写接口。客户端未来只能购买或申请具体资源，不能传入金额、
贡献分值或组织成员关系。

## 组织上下文

校园访问以 URL 中的组织 ID 与有效 `OrganizationMembership` 为唯一事实来源。
认证层在服务端写入 `organizationMembershipId`；前端不能提交或指定它。

旧 `User.schoolId` 仅用于兼容历史资源，不得用于 Carits、贡献、预算或归因。
读取工作区列表不会再自动补写成员关系；历史核对只能通过一次性、可重跑并留有审计
记录的迁移任务完成。

## 数据约束

- 账户只允许属于个人、组织或系统三者之一。
- 账户、交易、分录和贡献事实均禁止因用户、成员或组织删除而级联删除。
- 已入账交易和所有账本分录不可修改或删除；未来只能以冲正交易修正。
- 已入账交易的分录金额总和必须为零。
- 一条贡献事件在 V1 数据模型中最多归因一个组织。

## 路由与接口

| 范围 | Carits币 | 贡献 |
|------|----------|------|
| 个人 | `/personal/carits` | `/personal/contributions` |
| 校园 | `/org/:organizationId/carits` | `/org/:organizationId/contributions` |
| 平台管理 | `/platform-admin/carits` | `/platform-admin/contributions` |

只读接口统一返回 `featureStatus: "planned"`。不得返回余额字段、流水金额、
贡献值、成员资料、学校资料或联系方式。

未来公开的个人贡献榜仅可返回公开用户名、头像、贡献值和名次；不得返回姓名、
学校、组织关系、手机号、邮箱或其他校园资料。
