---
status: current
audience: development
last_verified: 2026-08-22
source_of_truth: apps/web/src
---

# 前端架构

## 页面与布局

页面位于 `apps/web/src/app`，按角色目录组织。每个角色 layout 使用 `RoleLayout`：

- 未登录跳转到对应登录入口。
- 已登录但角色错误时回到自身角色首页。
- 学校负责人继承教师页面。
- 平台管理员不会通过 `super_admin` 判断获得超管页面。

导航集中在 `config/navigation.ts`。所有角色根据 `workspaceMode` 选择工作或个人配置，且均使用
`AppShell` 的左侧抽屉导航。角色 layout 始终只创建一个 `AppShell`，首页不再自行嵌套 Shell。

导航默认隐藏，只能通过顶部菜单按钮主动打开；不会因悬停、路由切换、刷新或工作区切换自行显示。
展开状态按 `userId + role + workspaceMode` 写入本机偏好。账号身份卡位于展开侧栏左下角，点击后向上
打开资料、安全、平台绑定和退出菜单，顶部不重复展示头像。

页面仍有部分历史内联样式，整改基线见[设计系统](DESIGN_SYSTEM.md)。当前由 `AppShell`
独占普通页面的宽度、边距和导航；迁移中的旧页面通过 `data-page-host` 兼容层去除第二层
页面边距，新增和已迁移页面使用 `PageFrame`。
训练详情等全宽工作区通过显式 layout variant 获得空间，不在业务组件内部重新创建整页
Header、背景和最大宽度。

## 组件层次

| 层次 | 目录 | 职责 |
|------|------|------|
| 页面 | `app/` | 路由参数、页面编排 |
| 业务组件 | `components/problem`, `team`, `training`, `submission` | 可复用业务交互 |
| 通用业务 | `components/business` | 用户管理、地区等跨页面能力 |
| UI | `components/ui` | Button、Pagination 等基础控件 |
| 数据 Hooks | `hooks/data` | 缓存、加载、错误和刷新 |
| API | `lib/apiClient.ts` | 认证、超时和响应解析 |

大型组件按正在修改的业务区域渐进拆分，不进行无关的整体重写。

普通题目页的多题面工作区以左侧版本栏作为版本名称、身份和创建入口的唯一展示位置；右侧
只渲染题面正文，不重复标题、作者、语言、格式、来源或派生入口。只有用户自己的版本在右侧
正文上方显示紧凑编辑操作，官方和他人公开版本不显示操作头部。

比赛、训练和作业的基础编辑弹窗只管理活动元数据、题目顺序、别名和分值。活动页面不提供
个人题面或题解的创建、派生、删除和共享入口；题面通过独立“题面选择”矩阵选择，题解通过
当前题目的“题解选择”弹窗选择。只有 `training.isAdmin` 用户显示活动快照编辑入口，编辑
Markdown 或替换 PDF 后必须刷新到新的不可变 revision。

## API 响应

```ts
interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  status: number
  code?: string
}
```

客户端先读取文本，再尝试 JSON 解析，因此能处理 JSON、纯文本和空响应。HTTP 错误保留
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

路由级 `error.tsx`、`global-error.tsx` 和 `not-found.tsx` 负责渲染异常与不存在页面。CI 的
`pnpm ui:state-check` 会拒绝页面级 `mounted` 渲染门、重复 `ProtectedRoute`、“加载中”
文案和业务组件中的原生 `fetch`。

图片、菜单、表格行和图标操作使用可聚焦的按钮或链接。图标按钮必须有
`aria-label` 或 tooltip。

统一基础控件包括 `PageFrame`、`PageHeader`、`Toolbar`、`Tabs`、
`SegmentedControl`、`Table`、`FormField`、`StatusBadge`、`Empty`、`Pagination`
和 `Modal`。样式由 CSS Modules 与全局 Token 组成；Lucide 提供通用操作图标。

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
