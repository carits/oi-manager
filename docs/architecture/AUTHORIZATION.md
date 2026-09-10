---
status: current
audience: development, operations
last_verified: 2026-09-11
source_of_truth: packages/shared/src/index.ts, auth middleware, role layouts
---

# 认证与权限

## 登录入口

登录 API 使用唯一的用户名和密码入口。`POST /api/auth/login` 接收 `workspaceMode`；缺省或旧
`mode: "campus"` 等价于 `work`，`mode: "personal"` 保持兼容。非法模式返回 `400`。

成功登录响应中的岗位使用数据库全局角色；普通账号的组织成员关系只用于当前校园工作区的成员身份。
`super_admin` 和 `platform_admin` 永远保留全局角色，不会被学校成员关系覆盖。

## JWT

```ts
interface JwtPayload {
  userId: string
  role: 'super_admin' | 'platform_admin' | 'school_principal' | 'teacher' | 'student'
  username: string
  adminId?: string
  teacherId?: string
  studentId?: string
  schoolId?: string
  workspaceMode: 'work' | 'personal'
  /** @deprecated compatibility for old student sessions */
  studentMode?: 'campus' | 'personal'
}
```

HTTP 请求使用 `Authorization: Bearer <token>`。缺少或无效 Token 返回 `401`；
已登录但角色或资源范围不足返回 `403`。

## 工作区模式

- `role` 是账号永久岗位；切换工作区不会修改角色、岗位扩展 ID 或学校关系。
- `workspaceMode=work`：进入管理或校园工作台，业务资源使用 `resourceScope=campus`。
- `workspaceMode=personal`：五种角色共用个人工作区，业务资源使用 `resourceScope=personal`。
- 管理员工作区是严格独立的：超级管理员只进入 `/admin`，平台管理员只进入 `/platform-admin`；管理员不创建或切换个人/校园工作区。
- 全局管理员查看训练/比赛时不受当前工作区 scope 预过滤限制；仍由 `canAccessTraining`、组织关系和比赛管理权限决定最终可见范围。普通账号继续只能访问当前 `resourceScope` 的资源。
- `POST /api/auth/switch-workspace` 为所有已登录角色刷新 Cookie 和兼容 JWT；首次切入时事务性创建 `PersonalProfile`。
- 旧 `studentMode` 与 `POST /api/auth/switch-mode` 仅保留一个开发周期，分别映射至 `workspaceMode` 和新切换接口。
- 旧校园 JWT 仅携带 `schoolId` 时，服务端在 `workspaceMode=work` 且请求没有组织头的情况下，会通过
  `School.organizationId` 解析组织，再重新校验活动成员关系；不能仅凭旧字段绕过组织权限。
- 个人工作区只输出用户名、头像、公开简介和个人 Rating，不输出实名、学校、职称或后台岗位。

`organizationId` 是 `Organization.id`，用于请求头 `X-OI-Organization-ID` 和成员关系查询；
`schoolId` 是 `School.id`，仅在组织具有关联学校时返回。二者不能互换。

组织加入申请和邀请不会改变账号全局角色。普通账号始终以 `user` 作为平台身份，进入学校 URL 后才从有效 Membership 解析学生、教师或负责人身份。完整状态机、审批边界和通知上下文见 [组织申请、邀请与成员关系](ORGANIZATION_JOIN.md)。

### 提交组织归属

校园提交同时保存 `workspaceScope=campus` 与创建时的 `organizationId`；个人提交的
`organizationId` 为 `null`。校园评测列表、题目提交列表、详情、通用重评和远程代码重新抓取都必须
匹配当前请求组织，不能只按“提交者目前属于该校园”推断历史提交归属。这样同一账号加入多个校园时，
在 B 校产生的提交不会出现在 A 校教师或该账号的 A 校工作区中。

通用重评与重新抓取只允许提交本人；比赛管理者使用活动范围重测接口，全局管理员继续使用独立管理入口。
历史校园提交依次按活动组织、校内题组织和唯一有效成员关系回填；无法确定的多组织历史记录保持空值并从
校园列表隐藏，禁止猜测归属。

## 权限矩阵

| 能力 | 超管工作区 | 平台管理员工作区 | 负责人工作区 | 教师工作区 | 学生校园工作区 | 普通角色个人工作区 |
|------|:----------:|:------------------:|:------------:|:----------:|:----------------:|:------------------:|
| 学校和负责人管理 | 是 | 否 | 本校部分 | 否 | 否 | 否 |
| 平台用户管理 | 是 | 受限 | 否 | 否 | 否 | 否 |
| OJ Cookie 配置 | 是 | 否 | 否 | 否 | 否 | 否 |
| OJ 任务、账号池 | 是 | 是 | 受限导入 | 受限导入 | 否 | 否 |
| 平台题库 | 管理 | 管理 | 使用已发布题 | 使用已发布题 | 仅教学活动 | 使用已发布题 |
| 校内题库 | 不可见 | 不可见 | 本校全部管理 | 本校已发布/自己草稿 | 仅授权教学活动 | 不可见 |
| 本校教师管理 | 是 | 否 | 是 | 否 | 否 | 否 |
| 团队、比赛、题单和提交 | 管理范围 | 管理范围 | 本校/参与 | 自有/参与 | 参与 | 个人作用域内相同规则 |
| 维护迁移 API | 开关开启时 | 否 | 否 | 否 | 否 | 否 |

具体业务接口还会检查学校、团队、创建者、成员角色和可见性。前端隐藏按钮只是体验，
不能替代后端权限校验。

服务端业务域不得互相导入对方的角色判断函数。稳定组织/团队能力集中在
`modules/authorization/capabilities.ts`，Assignment 等领域再用自己的 policy 组合资源所有权、创建者和状态。
当前 `OrganizationMembershipRole` 与 `OrganizationMembershipCapability` 是规范化授权来源；迁移期间默认
`MEMBERSHIP_CAPABILITY_SOURCE=hybrid`，先读取规范化分配和显式能力，同时保留 `memberRole` 映射。受保护的
`GET/POST /api/admin/migration/membership-roles` 对账并回填后，生产才可显式切到 `normalized`。切换不会改变
`memberRole` 的学生/教师资料判别用途。

资源所有权回归矩阵同时固定以下边界：平台管理员和超级管理员都可读取全局提交；组织活动只有负责人、
创建者和超级管理员可管理，平台管理员仅有全局只读访问；校园团队同样只有 owner/admin 与超级管理员
可管理；平台管理员与超级管理员可以管理平台题，但都不能绕过组织上下文读取或修改校内题库。

## 敏感边界

### OJ 配置

- `GET/PUT /api/oj-fetcher/platforms/:platform/config`：仅 `super_admin`。
- 读取只返回配置状态和脱敏信息，不返回 Cookie 原文。
- 抓题任务：`super_admin` 和 `platform_admin`。

### 维护 API

- `/api/admin/migration/*`：先认证，再要求 `super_admin`。
- `ENABLE_MAINTENANCE_API !== true` 时统一返回 `404`。
- 操作完成后必须立即关闭开关。

### 评测机

- `/ws/judge` 在开发和正式环境都要求 `JUDGE_TOKEN`。
- `ALLOW_UNAUTHENTICATED_JUDGE=true` 只用于显式 loopback 测试。
- Token 不进入浏览器、HTTP 响应或普通日志。

### 校内题库

- 题目列表、详情、附件、测试数据、Judge 配置、AI 和提交共用服务端题目访问策略。
- 学生访问原始题库列表返回 `403 TEACHER_ONLY`；指定题目或文件 ID 时返回 `404`。
- 教师必须处于 `work` 工作区且具有学校关系。不满足时分别返回
  `WORKSPACE_MODE_REQUIRED` 或 `SCHOOL_MEMBERSHIP_REQUIRED`。
- 跨校题和学校题对平台/超级管理员都返回 `404`，平台岗位不是学校内容的旁路。

平台题库的管理权限不要求 `organizationId`：平台/超级管理员在独立平台工作区可以管理平台草稿、题面、评测配置和 Checker；学校题仍必须匹配当前组织和学校岗位。

### 学校组织生命周期

学校列表、创建/编辑学校、负责人和校园成员总览接口仅允许 `super_admin`；`platform_admin` 不得通过 API 旁路进入学校管理。

## 前端会话

根布局通过服务器 Session 初始化全站唯一的 `AuthProvider`；`RoleLayout` 只做权限、上下文和 AppShell 选择，不能创建第二份客户端身份状态。这样从校园或个人工作区进入公共内容时不会因卸载内层 Provider 退化成匿名。`AuthProvider` 根据 `role:userId:workspaceMode` 计算 `sessionKey`，用于账号或工作区切换后让组件和缓存重新
挂载。它不是数据库字段、访问令牌或后端隔离机制。真正隔离由 JWT、权限中间件和
资源查询条件完成。

前端导航上下文先按全局角色约束，再按 URL 解析组织或个人工作区。超级管理员与平台管理员访问 `/account/*` 时仍属于平台上下文；Logo 和全局内容入口必须直接返回 `/admin` 或 `/platform-admin`，不得经过不存在的个人工作区。组织上下文失效后返回 `/identity?organizationUnavailable=1`，由用户选择仍有效的身份。

浏览器登录由 Server 设置同域 `HttpOnly`、`SameSite=Lax` 会话 Cookie；正式环境同时要求
HTTPS 和 `Secure=true`。鉴权中间件暂时兼容 Bearer Token，供脚本、测试与旧会话一次性
迁移使用。旧 Token 迁移成功后会从 `localStorage` 清除，不能再把它作为浏览器长期会话来源。
