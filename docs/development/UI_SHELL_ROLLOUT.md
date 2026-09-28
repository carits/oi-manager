---
status: current
audience: development
last_verified: 2026-09-28
source_of_truth: apps/web/src/components/AppShell.tsx, apps/web/src/components/RoleShell.tsx, apps/web/src/features/workspace/ui/WorkspaceSwitcher.tsx
---

# UI Shell 与工作区统一：架构与发布记录

初始统一壳层代码由 `codex/ui-shell-workspace-unification` 合并至 `main`。发布代码提交为
`f04b0aa50adb8b0dfe95310f179378db25a1ac4a`，对应线上 Web BUILD_ID 为
`TPv-g5acV9SKdg2qySdoI`。后续代码将工作区入口收回左侧导航顶部，并把桌面“完全隐藏侧栏”改为 64px 可操作窄栏；这些代码事实与下方历史发布证据分开记录，不能把旧 BUILD_ID 当成后续调整已经上线的证明。

## 背景与问题

旧实现同时存在三个相互影响的问题：

1. 个人、组织和账号路由各自拥有 Shell 生命周期，模块或工作区切换可能重建 Header、导航和 Provider。
2. 工作区发现、URL 意图、账号身份和组织授权曾被混在同一个“切换身份”动作中；浏览器已经使用
   `X-OI-Organization-ID`，但部分 SSR 与客户端流程仍沿用旧硬跳转或全局角色假设。
3. `768–1199px` 的 72px 图标 Rail 破坏导航层级，并产生重复 Logo、裁剪品牌、原生滚动条和不可识别图标。

这类问题不能通过给某个页面增加 loading 或放宽角色白名单解决。最终边界固定为：

```text
URL                        = 用户希望进入的工作区
/api/auth/me + 组织 Header = 当前请求的权威身份与成员关系
Workspace Directory        = 可发现目标，不是授权凭据
RoleLayout                 = 服务端访问边界
RoleShell / AppShell       = 唯一持久 UI 外壳
业务 API                    = 最终资源权限边界
```

## 最终架构

### 单一壳层与首帧

- `Providers -> RoleShell -> AppShell` 在认证应用区只挂载一套业务壳层。
- 组织访问边界位于 `/org/[organizationId]/layout.tsx`；模块切换只替换内容区域。
- `RoleLayout` 只负责服务端访问检查，不拥有导航状态，也不替代资源接口鉴权。
- 根布局读取非敏感侧栏 Cookie，CSS 媒体查询在 hydration 前决定桌面侧栏或窄屏抽屉，避免首帧闪烁。
- URL 与 Auth 上下文不一致时，`RoleShell` 不渲染旧工作区业务内容，直到权威身份与 URL 对齐。

### 工作区切换事务

日常切换不修改 JWT，也不调用旧式“切换角色”接口。它按以下顺序执行：

```text
同目标 no-op
→ 记录账号、来源、目标、切换代数与 dirty revision
→ 未保存更改确认
→ 使用目标组织 Header 预检 /api/auth/me
→ 校验账号身份和切换代数仍有效
→ 清理旧作用域缓存
→ 再次检查 dirty revision
→ 如预检期间产生新编辑，重新确认但不重复预检
→ router.push 目标 URL
→ AuthProvider 按新 URL 重新确认权威上下文
```

关键故障语义：

- 目标组织 `403/404`、网络失败或身份服务降级时，保留原 URL、原 Auth 上下文、缓存和未保存内容。
- 目标预检显式抑制“当前组织不可用”全局事件，访问目标失败不能回收当前学校身份。
- 组织不可用事件携带产生它的 organizationId；事件与当前 URL 不匹配时必须忽略，避免 A 的迟到请求把 B 踢回身份页。
- 新的切换会递增 generation；旧切换的迟到响应不得提交路由或清理新工作区状态。
- 预检完成后用户若继续编辑，必须再次确认。取消二次确认只取消导航，不丢失新编辑，也不重新发起授权预检。
- `/identity` 只用于首次选择和身份失效恢复，允许硬进入；日常个人↔组织、组织 A↔组织 B 使用软路由。

### 导航与偏好

- `>=1100px` 使用 232px 完整侧栏与 64px 窄栏两种稳定状态；收起只隐藏文字和分组标题，工作区、功能导航图标和账号入口仍可操作，正文按 64px 留出空间。
- `<1100px` 仍使用默认关闭的完整抽屉，不持久化抽屉开关；移动端不显示桌面窄栏。
- 工作区切换器固定在左侧导航顶部：完整侧栏显示“学校/个人空间 + 当前身份”，64px 窄栏保留学校/个人图标与完整无障碍标签。工作区面板通过 document.body Portal 脱离侧栏和顶栏的裁剪与层叠上下文：桌面从侧栏向右展开；移动抽屉中从工作区入口下方展开，不再由顶栏承载。
- 顶栏只保留导航开关、唯一品牌入口以及消息/通知等全局动作；账号入口固定在侧栏底部，与工作区切换职责分离。
- 桌面偏好写入 `oi_sidebar_<encoded userId>` Cookie，按账号和设备共用；该偏好现在表示“完整侧栏 / 64px 窄栏”，不再表示桌面侧栏完全消失。
- 旧的 `sidebarNavigation:<role>:<userId>:<context>` localStorage 键只做一次客户端迁移：在没有新 Cookie 时
  读取可确认的旧值、写入新 Cookie 并删除旧键。迁移不是首帧授权事实，后续以 Cookie 为准。
- 主导航由 `PrimaryNavigation` 统一渲染；学生管理保留一级入口，教师权限、申请、邀请、加入设置和学校资产归入学校管理 Tabs。
- 任意状态最多只有一个可见且可聚焦的品牌入口；窄栏不得复制或裁剪 Logo。

### 页面状态与缓存

- `useFeatureResource` / `AsyncRegion` 区分首次加载、刷新、错误与旧数据保留。
- 缓存 key 必须包含账号与工作区作用域；预检成功后、导航提交前清理来源作用域缓存。
- 旧工作区快照不能作为新工作区占位数据，迟到请求也不能覆盖新 key。
- 训练列表和学生管理列表把筛选、页码写入 URL；返回、刷新和浏览器前进/后退恢复相同状态。

## 验证与发布证据

发布代码在最新 `main` 上完成：

- Web TypeScript 检查通过。
- Web 单元/组件测试 53 个文件、279 项全部通过。
- Web production build 通过。
- `pnpm ui:state-check`、`pnpm architecture:check`、`pnpm routes:audit`、`pnpm docs:check` 通过。
- Web canary 与 promote 后的生产双账号消息闭环通过，消息序号分别为 368/369 与 370/371。
- 线上 `/login`、构建清单和 API readiness 正常；发布 BUILD_ID 为 `TPv-g5acV9SKdg2qySdoI`。

以上发布证据只对应 `f04b0aa50adb8b0dfe95310f179378db25a1ac4a` 与当时的线上构建；后续工作区入口/64px 窄栏调整必须重新执行 Web 定向测试、production build、`pnpm routes:audit` 与对应浏览器验收后才能作为发布证据。

消息闭环用于确认新 Web、Cookie 会话、API、SSE 与路由发布链健康，不替代工作区切换专项 E2E。
工作区回归规范、视口和故障矩阵以 [全 UI E2E](UI_E2E.md) 为准；后续改动必须继续执行对应
Playwright 套件，不能只依赖构建或静态扫描。

## 维护约束

- 不得重新在个人、组织或账号 layout 中挂载第二套 AppShell。
- 不得通过把全局 `user` 加入组织 allowedRoles 绕过上下文授权。
- 不得使用 Workspace Directory 的 role/capability 作为请求授权事实。
- 不得恢复旧的 72px 中间断点 rail；桌面窄栏固定为当前 64px 结构，并必须保留工作区、主导航和账号三个可操作层级。不得复制或裁剪 Logo，也不得持久化移动抽屉。
- 不得把工作区切换器重新塞回顶栏或账号菜单；工作区决定导航与数据作用域，入口固定在侧栏顶部。
- 不得在目标预检成功前清理来源缓存或 dirty scope。
- 所有组织失效事件必须带来源 organizationId，所有异步切换必须受 generation/fencing 保护。
