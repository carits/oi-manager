---
status: current
audience: development
last_verified: 2026-09-21
source_of_truth: apps/web/src
---

# 前端架构

## 经济系统 Feature 边界

- `features/carits` 只负责 Carits 双式账本读取与审计投影。
- `features/evaluation-credits` 只负责评测资源额度、套餐和购买命令。
- `features/account-wallet` 可以组合上述两个 Feature 的 UI，但不得定义新的“统一钱包”业务 DTO，也不得直接访问 API URL。
- Route 与校园管理页面只从各 Feature 的根 `index.ts` 装配，禁止重新引入 `components/wallet`。

## 页面与布局

页面位于 `apps/web/src/app`，按角色目录组织。每个角色 layout 使用 `RoleLayout`：

- 未登录跳转到对应登录入口。
- 已登录但角色错误时回到自身角色首页。
- 学校负责人继承教师页面。
- 平台管理员不会通过 `super_admin` 判断获得超管页面。

导航集中在 `config/navigation.ts`。所有角色根据账号与 URL 工作区上下文选择导航配置，角色 layout
始终只创建一个 `AppShell`，首页不再自行嵌套 Shell。

`AppShell` 只有两种响应式形态：`>=1100px` 默认展开 232px 完整侧栏，可完全收起；`<1100px`
默认隐藏导航，顶部菜单打开带遮罩的完整抽屉。不存在 72px 图标 rail。桌面偏好按
`userId + accountRole + personal|organizationId` 写入本机；抽屉开关不持久化。账号身份卡位于展开侧栏左下角，点击后向上
打开资料、安全、平台绑定和退出菜单，顶部不重复展示头像。

账号级 UI 能力集中在 `lib/capabilities.ts`。全局管理员工作区、个人/校园工作区、全量评测记录、
组织管理和平台密钥入口只能通过 `hasAccountCapability()` / `isGlobalAdministrator()` 判断，业务组件
不得重复拼接 `super_admin || platform_admin`。资源归属、比赛管理权、题目编辑权等动态能力仍以
后端响应和权限 API 为唯一事实源，前端能力矩阵只能决定入口展示，不能替代服务端鉴权。

业务页面静态内联样式已清零，动态尺寸、坐标和 CSS 自定义变量的受控例外见[设计系统](DESIGN_SYSTEM.md)。当前由 `AppShell`
独占普通页面的宽度、边距和导航；迁移中的旧页面通过 `data-page-host` 兼容层去除第二层
页面边距，新增和已迁移页面使用 `PageFrame`。
训练详情等全宽工作区通过显式 layout variant 获得空间，不在业务组件内部重新创建整页
Header、背景和最大宽度。

## 组件层次

| 层次 | 目录 | 职责 |
|------|------|------|
| 页面 | `app/` | 路由参数、页面编排 |
| Feature Slice | `features/<feature>/{api,model,ui}` | 业务 API、状态模型和完整交互；从根 `index.ts` 或根级按页面公共入口导出 |
| 组合组件 | `components/organization-pages` | 跨 Feature 页面编排，不拥有已迁移领域事实 |
| 通用业务 | `components/business` | 用户管理、地区等跨页面能力 |
| UI | `components/ui` | Button、Pagination 等基础控件 |
| 数据 Hooks | `hooks/data` | 缓存、加载、错误和刷新 |
| Contract Client | `lib/apiClient.ts` | 认证、作用域、超时及共享 Runtime Schema 校验 |

Assignment、Blog、Submission、Contest Rating、Solution Review、Problem、Contest、Training Session、Chat、
Organization Account、Notification、Workspace、Auth、User Profile、Team 与 Data Market 已迁入
Feature Slice。路由和跨域组件只能从 `@/features/<feature>` 根入口或根级按页面公共入口引用，不得深层导入
`api/model/ui`，也不得在 `components` 下重新建立同名业务目录。根级按页面入口用于保持 Next.js 路由的切块
边界，避免一个聚合 barrel 将同一 Feature 的全部管理工作台装入首屏。

Training Session 前端只呈现一套 Stage 驱动模型。创建入口可以“快速创建一个 Stage”或“使用 Stage 模板”，但不得形成普通训练/教练带练两套 DTO。设计器按课堂语言配置 Stage，并通过 `features/training-session/api` 调用共享 Runtime Contract；SSE 是登记的 Raw Transport。基础名单只选择参与者，Stage 分组和题目 Plan 在结构编辑器中维护。题目添加只允许共享的“平台 + 题号”组件，不恢复题库浏览或题单选题。

普通题目页的多题面工作区以左侧版本栏作为版本名称、身份和创建入口的唯一展示位置；右侧
只渲染题面正文，不重复标题、作者、语言、格式、来源或派生入口。只有用户自己的版本在右侧
正文上方显示紧凑编辑操作，官方和他人公开版本不显示操作头部。

比赛、训练和作业的基础编辑弹窗只管理活动元数据、题目顺序、别名和分值。活动页面不提供
个人题面或题解的创建、派生、删除和共享入口；题面通过独立“题面选择”矩阵选择，题解通过
当前题目的“题解选择”弹窗选择。只有 `training.isAdmin` 用户显示活动快照编辑入口，编辑
Markdown 或替换 PDF 后必须刷新到新的不可变 revision。

## 高频编辑工作台交互

题单、比赛/训练和题面版本等长表单/高频编辑工作台必须遵循以下约束：

- 未保存修改在关闭弹窗、切换资源或离开页面前必须有明确保护，不能静默丢稿。
- 一个“保存成功”提示只能在本轮所有必需子操作都成功后出现；部分失败必须保留失败项并允许直接重试。
- 批量独立请求使用受限并发，避免逐项串行等待，也避免一次性无限并发压垮 API。
- 排序等可安全回滚的操作优先乐观更新；失败时恢复原状态并给出明确提示，不整页闪回加载态。
- 404、403、超时、网络错误和服务端错误必须展示不同语义，不得把传输故障伪装成“无权限/不存在”或“暂无数据”。
- 复杂编辑器不得使用浏览器原生 `prompt/confirm` 作为主要交互，应使用统一 Dialog 组件。

## API 契约与响应

账号认证与资料能力由 `packages/contracts/src/auth.ts` 和 `features/auth` 共同形成唯一边界。登录、注册、
`/auth/me`、退出、资料更新、改密和退出其他设备必须经 `authApi`；布局和业务组件从
`@/features/auth` 读取 `useAuth()`，不得重新创建认证 Context、直接请求 Auth JSON 接口或在页面内声明账号 DTO。
头像上传是 multipart Raw Transport 例外，仍由 Auth Feature 封装。Server Session 在使用 `/auth/me` 同型数据前
执行 `CurrentAccountSchema` 校验；可选兼容字段只能在共享 Contract 中显式登记，不能依赖 Zod 未知字段透传。

公开账号/校园成员资料和身份链接统一由 `features/user-profile` 提供。页面不得直接调用
`/api/users/:id/profile` 或自行声明资料 DTO。该接口属于上下文契约：个人上下文只暴露账号公开字段，显式
Organization Header 才能选择当前组织内的学生/教师 Profile；链接组件根据当前工作区生成相同语义的资料 URL。

账号工作区目录由 `packages/contracts/src/workspace.ts` 定义，浏览器只能经
`features/workspace/api/workspaceApi.ts` 的账号级 Client 读取。身份页、切换器以及 Blog、Problem Hack、
组织管理、Data Market 等消费者不得再次声明 `WorkspaceSummary` 或直接调用 `/api/workspaces`；校园页面发起
该请求时也不能继承 `X-OI-Organization-ID`。

团队领域统一由 `packages/contracts/src/team.ts` 与 `features/team` 形成边界。列表、详情、成员、邀请、
加入申请、公告和负责人转移不得在页面或组合组件内直接请求 `/api/teams/*`，也不得重新声明 Team DTO。
头像上传属于 multipart Raw Transport 例外，但仍必须由 Team Feature API 封装；团队比赛、训练和题单的
聚合展示属于跨领域组合，不应被塞入 Team Contract 伪装成团队实体字段。

数据商品、授权、购买和质量事故统一由 `features/data-market` 与 `packages/contracts/src/data-market.ts`
管理；页面不得直接拼装价格或绕过 Contract。题目、版本和比赛选择属于跨领域读取，但必须由该 Feature
的 API 层集中适配，UI 不直接访问通用 Client。

跨端 DTO 的事实源位于 `packages/contracts`。一个 Endpoint Contract 同时声明方法、作用域、请求、查询和成功
响应 Runtime Schema，并由 Zod 推导 TypeScript 类型。Server Route Adapter 使用 `parseContractBody()`、
`parseContractQuery()`、`sendContractData()`；Feature API 使用 `queryContract()`、`mutateContract()`。
契约不匹配必须显式失败：请求为 422，服务端生成错误响应为 500，浏览器收到不合规成功响应时抛出
`invalid_response`，不得将其伪装成空状态。

```ts
const Contract = defineApiEndpoint({
  key: 'assignment.progress',
  method: 'GET',
  scope: 'organization',
  query: AssignmentProgressQuerySchema,
  data: AssignmentProgressDataSchema,
})
```

Wire Envelope 固定为 `{ success: true, data } | { success: false, code?, message, details? }`；
`ApiClientResponse` 只是浏览器传输结果，不是另一套服务端 Contract。客户端先读取文本，再尝试 JSON 解析，
因此能处理 JSON、纯文本和空响应。HTTP 错误保留
真实 `status`；网络错误和超时使用 `status: 0`。页面不得把服务端错误显示为
“网络错误”，也不得把失败显示为“暂无数据”。

## 页面状态

读取型请求使用 `apiClient.query()` 和 `useResource()`。`query()` 在失败时抛出带 `kind`、
`status`、`retryable` 和可选请求编号的 `ApiError`，总截止时间为四秒；`401/403/404/429`
不自动重试，早期网络错误和 `5xx` 最多在截止时间内重试一次。

列表和详情使用 `pending/ready/empty/error` 资源状态，并遵守：

1. 首次请求：导航、标题和操作立即显示，只有数据区域使用稳定骨架，不显示整页等待文案。
2. 错误：显示服务端消息，并提供重试。
3. 空数据：只在成功响应且集合为空时显示。
4. 重新验证：保留旧数据，只显示非阻塞刷新状态。

浏览器业务代码不得直接调用原生 `fetch`。读取、写入和文件下载分别通过
`apiClient.query()`、`apiClient.mutate()` 和 `apiClient.download()`，确保 Cookie、
四秒读取截止时间、取消与请求编号处理一致。切页、参数变化和组件卸载会取消旧读取，
旧 key 的迟到响应不能覆盖当前资源。

浏览器认证是 Cookie-only；登录响应、客户端状态与 localStorage 都不持有 JWT。`AuthProvider`
根据当前 `/org/:organizationId` 重新读取权威 Membership 身份，离开组织 URL 时恢复纯账号上下文。
只有当前组织明确不可用/无成员关系时才触发身份回收，数据库 `503` 和普通资源 `403` 均保留会话。

`/account/notifications` 必须使用 `view=account + accountScoped`，汇总全部有效学校并显示来源；
铃铛仍继承当前 URL 组织上下文。跨学校通知动作必须显式携带该通知的 `organizationId`，不能复用页面上下文猜测。

路由级 `error.tsx`、`global-error.tsx` 和 `not-found.tsx` 负责渲染异常与不存在页面。CI 的
`pnpm ui:state-check` 会拒绝页面级 `mounted` 渲染门、重复 `ProtectedRoute`、“加载中”
文案、业务组件中的原生 `fetch`，以及绕过账号能力矩阵的全局管理员复合角色判断。

图片、菜单、表格行和图标操作使用可聚焦的按钮或链接。图标按钮必须有
`aria-label` 或 tooltip。

统一基础控件包括 `PageFrame`、`PageHeader`、`Toolbar`、`Tabs`、
`SegmentedControl`、`Table`、`FormField`、`StatusBadge`、`Empty`、`Pagination`
和 `Modal`。样式由 CSS Modules 与全局 Token 组成；Lucide 提供通用操作图标。

2026-08-25 起新增代码必须使用统一表单控件、DataTable、Section、Menu/Popover，以及
FormDialog、ConfirmDialog、DetailDialog 三类业务弹窗。静态样式放入 CSS Modules，内联样式只允许
动态尺寸、坐标和 CSS 自定义变量。门禁同时检查对象字面量和 `formStyles/cardStyle` 等静态对象引用；
遗留基线按文件计数且只能下降，门禁命令为
`pnpm ui:state-check`；确需重建基线必须在同一提交中说明减少项，不能用于放宽新增违规。

109 路由的目标、页面类型、筛选和交互契约见[UI 路由与交互矩阵](UX_ROUTE_MATRIX.md)。

## 数据缓存

SWR/Hooks 的 key 包含接口、查询参数和 `sessionKey=role:userId:workspaceMode`。登出和工作区
切换会清除旧作用域的浏览器资源缓存；`sessionKey` 不能用于后端权限判断。写操作成功后只刷新
受影响 key。

`/personal/*` 是五种角色共用的个人路由，固定导航为首页、团队、题库、比赛、题单、评测记录和排名。
`/account/*` 是两个工作区共享的账号资料、安全和平台绑定。个人 Shell 只展示用户名与“个人工作区”，
不得渲染岗位、学校、职称或实名。

## 视口

当前验收重点是 `1440×900` 和 `1280×720` 桌面端。固定格式控件使用明确的
grid、min/max、aspect-ratio 或稳定按钮尺寸，避免动态内容导致布局跳动。
