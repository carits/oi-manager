---
status: current
audience: development, operations
last_verified: 2026-09-18
source_of_truth: packages/contracts/src/identity.ts, auth middleware, authorization capabilities, role layouts
---

# 认证与权限

## 登录入口

登录 API 使用唯一的用户名和密码入口。`POST /api/auth/login` 接收 `workspaceMode`；缺省或旧
`mode: "campus"` 等价于 `work`，`mode: "personal"` 保持兼容。非法模式返回 `400`。

成功登录响应中的账号身份将历史持久化角色规范为 `user | platform_admin | super_admin`；普通账号的组织成员关系只用于当前校园工作区的成员身份。
`super_admin` 和 `platform_admin` 永远保留全局角色，不会被学校成员关系覆盖。

登录失败保护使用“规范化用户名五分钟失败桶 + 高阈值 IP 一分钟失败洪泛桶”；机房共享网络中的成功登录不会占用失败额度。注册保留较高的共享 IP 上限，已登录密码操作按 `userId` 分桶。API 反向代理只信任 loopback，客户端不能伪造转发 IP。

## JWT

```ts
interface JwtPayload {
  userId: string
  sessionVersion?: number
  accountRole: 'user' | 'super_admin' | 'platform_admin'
  role: 'user' | 'super_admin' | 'platform_admin' | 'school_principal' | 'teacher' | 'student'
  organizationRole?: 'student' | 'teacher' | 'school_principal'
  organizationCapabilities?: string[]
  organizationId?: string
  organizationMembershipId?: string
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

浏览器只使用同域 HttpOnly Session Cookie，登录、注册和工作区切换响应不向 JavaScript 返回 JWT。
Bearer 仅供脚本、测试与旧客户端兼容。缺少、无效、过期或被撤销的会话返回 `401`；已登录但角色或资源范围不足返回 `403`；数据库/认证依赖暂时故障返回 `503 AUTH_SERVICE_UNAVAILABLE`，浏览器不会因此清除会话。

`User.sessionVersion` 是账号级会话代数。修改密码、管理员重置密码或“退出其他设备”会原子递增；当前浏览器同时获得新 Cookie，其他旧 Token 在下一次请求返回 `401 SESSION_REVOKED`。迁移前未携带该声明的 Token 按第 1 代兼容。

新签名 Session 使用独立的 `SessionJwtPayload`，只持久化 `userId/sessionVersion/accountRole/username/workspaceMode`；
组织 ID、Membership ID、组织岗位与 Capability 都是请求期事实，绝不能写入 Cookie。历史 Token 中的
`studentId/teacherId/schoolId/studentMode` 在剩余有效期内仅被 JWT 解析器容忍，不参与身份或权限计算；登录、切换工作区、
会话迁移、改密或退出其他设备任一续签动作都会通过字段白名单移除这些旧 Claims。服务端业务消费的是认证中间件重建后的
`JwtPayload` 请求身份，不得直接把解码前的 Session Claims 传入领域服务。

## 工作区模式

- `role` 是账号平台身份；普通账号通常为 `user`。学校学生/教师/负责人身份只从当前 URL 对应的有效 Membership 解析。
- `workspaceMode=work`：进入管理或校园工作台，业务资源使用 `resourceScope=campus`。
- `workspaceMode=personal`：五种角色共用个人工作区，业务资源使用 `resourceScope=personal`。
- 管理员工作区是严格独立的：超级管理员只进入 `/admin`，平台管理员只进入 `/platform-admin`；管理员不创建或切换个人/校园工作区。
- 全局管理员查看训练/比赛时不受当前工作区 scope 预过滤限制；仍由 `canAccessTraining`、组织关系和比赛管理权限决定最终可见范围。普通账号继续只能访问当前 `resourceScope` 的资源。
- `POST /api/auth/switch-workspace` 为旧客户端保留并刷新 Cookie；响应不返回 Token。当前 Web 以 URL 与工作区目录切换身份。
- 旧 `studentMode` 仅作为尚未过期的历史 JWT 输入被容忍；新 Session 不再写入，也没有运行时工作区语义。
- 旧 JWT 中的 `schoolId` 仅在历史 Token 自然过期前被容忍且不会续签，不再隐式选择组织。校园请求必须显式携带
  `X-OI-Organization-ID`，服务端再按该组织校验当前活动 Membership；账号级请求因此不会漂移到“最早加入的学校”。
- 个人工作区只输出用户名、头像、公开简介和个人 Rating，不输出实名、学校、职称或后台岗位。

`organizationId` 是 `Organization.id`，用于请求头 `X-OI-Organization-ID` 和成员关系查询；
`schoolId` 是 `School.id`，仅在组织具有关联学校时返回。二者不能互换。

Web 的浏览器请求与 Next.js SSR 必须遵守相同的显式上下文规则。访问
`/org/:organizationId/*` 时，根布局和组织 `RoleLayout` 都从可信路由参数解析 Organization ID，
并在服务端请求 `/api/auth/me` 时携带 `X-OI-Organization-ID`。组织页面只使用响应中的
`organizationRole` 校验页面岗位；个人和平台页面使用 `accountRole`。不得因为 SSR 缺少组织上下文而把
全局 `user` 加入组织角色白名单，也不得把组织岗位重新写入 Cookie。组织不存在、被隔离或 Membership
无效时返回身份选择页，不按匿名会话跳到登录页；浏览器 hydration 后的上下文刷新只作为导航兜底。

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

具体业务接口还会检查学校、团队、创建者、Capability、资源范围和可见性。前端隐藏按钮只是体验，
不能替代后端权限校验。

服务端业务域不得互相导入对方的角色判断函数。稳定组织/团队能力集中在
`modules/authorization/capabilities.ts`，Assignment 等领域再用自己的 policy 组合资源所有权、创建者和状态。
全局路由中间件 `authorize()` 只接受并校验 `AccountRole=user|platform_admin|super_admin`；不得把
`organizationRole`、兼容 `role` 或 Membership 展示岗位传给全局管理员判断。需要同时处理平台与组织范围的应用服务，
上下文必须显式携带 `accountRole` 和 `organizationRole` 两个字段（Submission Command/Query 即采用此契约），禁止再定义
一个含混的 `role` 后按取值猜测身份来源。普通“登录即可读取”的路由只使用 `authenticate`，资源、平台和组织范围继续由领域
Policy 校验，不能用学生/教师/负责人枚举代替登录态。

`OrganizationMembershipRole` 与 `OrganizationMembershipCapability` 是组织授权的唯一事实源。认证中间件先把持久化兼容角色规范为
`accountRole`，再按请求中的组织 ID 解析唯一基础 RoleAssignment 和 CapabilityGrant；缺少基础角色或同时存在多个基础角色时返回
`403 ORGANIZATION_AUTHORIZATION_INCOMPLETE`，不会猜测或按更高岗位兜底。生产已完成 20,186 条 Membership 对账，授权路径不再读取
`memberRole` 的旧能力映射，也没有 hybrid/legacy 运行开关。成员、题库、团队导入、组织钱包、Assignment、Training、Rating、
Data Market 与 Candidate 预算均消费规范 Capability；`problem.manage` 保留教师 own、负责人 all 的资源范围。
所有创建、恢复、导入和负责人转移必须在同一事务调用
`syncOrganizationMembershipBaseRole()`；`memberRole` 只保留学生/教师资料判别和岗位展示用途。受保护的
`GET/POST /api/admin/migration/membership-roles` 继续作为幂等一致性检查和修复入口，并同时报告缺失、冲突基础角色和未知角色。

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

根布局通过服务器 Session 初始化全站唯一的 `AuthProvider`；`RoleLayout` 只做权限、上下文和 AppShell 选择，不能创建第二份客户端身份状态。这样从校园或个人工作区进入公共内容时不会因卸载内层 Provider 退化成匿名。`AuthProvider` 根据 `role:organizationId:organizationRole:userId` 计算 `sessionKey`，用于账号或工作区切换后让组件和缓存重新
挂载。它不是数据库字段、访问令牌或后端隔离机制。真正隔离由 JWT、权限中间件和
资源查询条件完成。

前端导航上下文先按全局角色约束，再按 URL 解析组织或个人工作区。超级管理员与平台管理员访问 `/account/*` 时仍属于平台上下文；Logo 和全局内容入口必须直接返回 `/admin` 或 `/platform-admin`，不得经过不存在的个人工作区。组织上下文失效后返回 `/identity?organizationUnavailable=1`，由用户选择仍有效的身份。

普通账号在校园页面的负责人、教师和学生能力必须来自当前 URL 的组织 ID 对应的有效 Membership，解析结果写入 `organizationRole`；账号页面的 `/auth/me` 不选择“最早加入的学校”。教师与负责人导航必须提供评测记录诊断入口，负责人额外提供教师与权限入口。校园 Dashboard 的团队查询必须携带当前组织上下文；即使同一账号属于多个学校，也只能统计当前学校的数据。

组织上下文明确返回 `ORGANIZATION_ACCESS_DENIED` 或 `ORGANIZATION_NOT_AVAILABLE` 时，当前 `/org/:id` 页面清除该组织缓存并回到身份选择；普通资源级 `403` 不触发工作区退出。

浏览器登录由 Server 设置同域 `HttpOnly`、`SameSite=Lax` 会话 Cookie；正式环境同时要求
HTTPS 和 `Secure=true`。鉴权中间件暂时兼容 Bearer Token，供脚本、测试与旧会话一次性
迁移使用。旧 Token 迁移成功后会从 `localStorage` 清除，不能再把它作为浏览器长期会话来源。

账号资料只编辑用户名之外的全局字段：用户名只读，头像、邮箱、手机号和简介属于账号。学校真实姓名属于各自 Membership Profile，不允许账号页将某一学校姓名冒充为全局姓名。

右上角铃铛保持“账号 + 当前学校”上下文；`/account/notifications?view=account` 是全账号消息中心，聚合账号通知和用户全部有效学校通知并标注来源学校。`legacy` 学校不进入聚合，可操作状态始终由服务端按通知对应学校实时计算。
