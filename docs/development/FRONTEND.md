---
status: current
audience: development
last_verified: 2026-10-03
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

导航集中在 `config/navigation.ts`。根级 `Providers -> RoleShell -> AppShell` 为认证应用区提供唯一业务壳层；
个人、组织与账号路由的 layout 只保留各自服务端访问边界，不再重复创建 Shell。

`AppShell` 使用固定位置的全宽顶栏：唯一品牌与工作区切换在左，消息和通知固定在右；侧栏展开、
收起均不移动顶栏入口。账号身份卡只提供资料、安全、平台绑定和退出，不重复业务或工作区入口。
组织访问边界位于 organizationId 层，模块切换只替换内容；服务端数据接口继续独立鉴权。

响应式形态仍只有 `>=1100px` 的 232px 完整侧栏与 `<1100px` 默认关闭的模态抽屉，不引入图标 rail。
桌面展开/收起偏好以非敏感 Cookie 按 userId 在当前设备共用，由根布局读取并传入首帧；
CSS 媒体查询负责 JavaScript 执行前的形态，viewport Effect 只负责交互，不再修正桌面初始宽度。
无新 Cookie 时首次访问默认展开。旧版按角色/学校拆分的 localStorage 偏好只迁移一次：客户端仅在
Cookie 缺失时读取可确认的旧键，写入按账号统一的新 Cookie 后立即删除旧键；它不参与服务端首帧授权，
也不会覆盖已经存在的新偏好。
抽屉开关不持久化；打开时锁定背景滚动并令顶栏和正文 inert，关闭时恢复原状态和焦点。
只有用户主动操作启用几何过渡，刷新、切页和断点同步不播放；减少动态效果偏好关闭过渡。

日常工作区切换采用带未保存保护的客户端软路由：先确认离开，再用目标组织 Header 对 `/auth/me` 做无副作用权威预检；
预检成功后才清理旧作用域缓存并导航。目标学校拒绝或网络失败不得触发当前学校身份回收，dirty scopes 也不得提前清空。
切换流程用 generation/fencing 拒绝旧请求迟到提交；组织不可用事件必须携带来源 organizationId，
与当前 URL 不匹配的事件一律忽略。预检期间若用户继续编辑，导航前重新比较 dirty revision 并再次确认，
但复用已经成功的目标授权结果；取消后保留新增编辑。URL 表达目标工作区，`/auth/me` 返回的账号/成员关系
表达当前权威上下文，Workspace Directory 只负责发现，三者不得互相替代。
`/identity` 只承担首次选择和身份失效恢复，仍可使用硬进入。阶段状态与验证范围见 [UI Shell 实施记录](UI_SHELL_ROLLOUT.md)。

这个分层源自账号身份与组织身份拆分后的 SSR 回归：全局账号角色始终可能只是 `user`，组织角色必须由
URL organizationId 与显式 `X-OI-Organization-ID` 在服务端实时解析。不能通过让组织页面接受全局 `user`
来绕过授权，也不能把目录条目里的展示角色当成服务端访问凭据。

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

## 用户信息与诊断信息边界

数据库、API、并发控制和数据一致性字段不能直接进入界面。Domain/API 数据必须先经过显式
Presentation Adapter，再分别进入用户信息或诊断信息通道：

- 用户信息只表达业务事实、影响和可执行动作。业务枚举、评测结果、平台、角色和状态必须使用完整
  mapper；未知值返回通用业务文案或省略，严禁回退到原始输入。
- `revision`、内部 ID、哈希、fencing token、slot、canonical 标识、原始枚举、协议 key、契约名和
  后端原始错误只能进入日志、遥测或有权限且默认收起的诊断区域，不能作为标题、状态、Toast、表格值
  或导出字段。
- `ApiError.userMessage` 是业务组件唯一可展示的错误字段；`debugMessage`、原始响应和校验详情只用于
  诊断。未知错误采用固定、可操作的安全文案，不根据后端 `message` 猜测是否适合展示。
- requestId 只在用户主动展开或复制诊断信息时出现。原始 JSON 不得直接渲染到 JSX；需要展示的证据
  必须转换为结构化业务摘要。
- CSV、下载包、通知和浏览器错误页同样属于呈现边界，不能绕过上述规则。

`scripts/ui-language-check.mjs` 扫描完整 `apps/web/src`，并由 `pnpm ui:state-check` 和文档工作流执行。
新增 mapper 必须用 `FUTURE_INTERNAL_VALUE` 验证未知值不会穿透到展示结果。完整审计与实例见
[前端呈现边界审计](UI_PRESENTATION_BOUNDARY_AUDIT.md)。

Assignment、Blog、Submission、Contest Rating、Solution Review、Problem、Contest、Training Session、Chat、
Organization Account、Notification、Workspace、Auth、User Profile、Team 与 Data Market 已迁入
Feature Slice。路由和跨域组件只能从 `@/features/<feature>` 根入口或根级按页面公共入口引用，不得深层导入
`api/model/ui`，也不得在 `components` 下重新建立同名业务目录。根级按页面入口用于保持 Next.js 路由的切块
边界，避免一个聚合 barrel 将同一 Feature 的全部管理工作台装入首屏。

Training Session 前端只呈现一套全局 Stage 驱动模型。创建入口由教师手动选择题目并生成一个 Stage，需要多阶段或分层流程时再进入课堂编排器，不展示训练模板或使用场景。不得形成普通训练/教练带练两套 DTO。设计器按课堂语言配置 Stage，并通过 `features/training-session/api` 调用共享 Runtime Contract；SSE 是登记的 Raw Transport。基础名单选择参与者，稳定 Group 表达当前归属，Stage 编辑唯一默认计划与可选 Group 覆盖。题目添加只允许共享的“平台 + 题号”组件，不恢复题库浏览或题单选题。

普通题目页的多题面工作区以左侧版本栏作为版本名称、身份和创建入口的唯一展示位置；右侧
只渲染题面正文，不重复标题、作者、语言、格式、来源或派生入口。只有用户自己的版本在右侧
正文上方显示紧凑编辑操作，官方和他人公开版本不显示操作头部。

比赛、训练和作业的基础编辑弹窗只管理活动元数据、题目顺序、别名和分值。活动页面不提供
个人题面或题解的创建、派生、删除和共享入口；题面通过独立“题面选择”矩阵选择，题解通过
当前题目的“题解选择”弹窗选择。只有 `training.isAdmin` 用户显示活动快照编辑入口，编辑
Markdown 或替换 PDF 后必须刷新到新的不可变 revision。

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
2. 错误：显示经过 Presentation Adapter 处理的 `userMessage`；可重试错误提供重试，原始服务端消息仅进入诊断通道。
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

## Training Engine V2 前端约定

设计器以 Stage 时间线、StageGroup 矩阵和题目计划为核心；UI 使用课堂语言解释规则，复杂的 Subtask/ANY-ALL 配置放入高级设置。Training Feature API 是唯一 JSON 访问入口，组件不直接调用 apiClient。

