---
status: current
audience: development
last_verified: 2026-09-28
source_of_truth: apps/web/src/components/AppShell.tsx, apps/web/src/components/RoleShell.tsx, apps/web/src/features/workspace/ui/WorkspaceSwitcher.tsx
---

# UI Shell 与工作区统一：实施记录

分支：`codex/ui-shell-workspace-unification`。本记录只描述分支实现状态，不表示已合并、部署或完成生产验收。
本批不执行数据库迁移，不修改生产业务数据。

## 已完成的实现

### 固定顶栏与首帧

- 唯一品牌和工作区入口固定在顶栏左侧；消息和通知固定在右侧，侧栏展开/收起不再移动顶栏。
- 账号菜单只保留资料、安全、平台绑定和退出，不重复知识广场、我的文章或工作区切换。
- 桌面侧栏偏好使用非敏感 Cookie 按账号/设备共用，由根布局提供服务端首帧值；CSS 媒体查询决定 hydration 前形态。
- 移动抽屉不持久化，背景 inert、滚动锁和焦点恢复由 Shell 统一处理；几何动画只在用户主动操作时启用。

### 单一业务壳层与授权边界

- `Providers -> RoleShell -> AppShell` 在认证应用区只挂载一套业务壳层；个人、组织和账号路由不再分别创建 Shell。
- 组织访问边界上移到 `/org/[organizationId]/layout.tsx`，模块切换只替换内容区域。
- `RoleLayout` 保留服务端访问检查；资源接口继续独立鉴权，持久 Layout 不作为授权事实源。
- URL 与 Auth 上下文不匹配时，`RoleShell` 先屏蔽旧工作区内容，等待权威账号上下文确认。

### 安全工作区切换

- 日常 `WorkspaceSwitcher` 使用客户端软路由，不再强制整页 Document reload。
- 切换顺序固定为：未保存更改确认 -> 目标 `/auth/me` 权威预检 -> 清理旧作用域缓存 -> 软路由 -> 新 URL 下重新确认 Auth 上下文。
- 目标组织预检显式禁止触发“当前组织失效”全局事件，因此访问目标学校失败不会把原学校身份回收或重定向到 `/identity`。
- 导航保护只有在预检成功后才释放 dirty scopes；用户取消、网络失败或目标成员关系失效时，原 URL、原 Auth 上下文和未保存标记保持不变。
- `/identity` 仍只负责首次选择和身份失效恢复，允许硬进入；它不是日常工作区切换入口。
- 工作区目录继续使用账号级 Contract 与共享缓存，目录条目只用于展示和定位目标，不作为授权凭据。

### 导航信息架构

- 主导航由 `PrimaryNavigation` 统一渲染，活动项匹配集中在 `config/navigation.ts`。
- 学生管理保留一级高频入口；教师权限、加入申请、邀请、加入设置和学校资产统一归到“学校管理”父入口。
- 学校管理内部使用 URL 可恢复的 Tabs；侧栏不会重复暴露同一批二级分区。
- 学生导航只显示学生实际可用模块；账号菜单不再承担业务导航。

### 页面状态契约

- `useFeatureResource` / `AsyncRegion` 统一首次加载、刷新、错误、旧数据保留和作用域隔离；旧工作区快照不能作为新工作区占位数据。
- 训练列表将状态、团队、关键词和页码写入 URL，并恢复滚动位置；学生和教师视图共用真实错误/重试语义。
- 学校学生管理将搜索、年级、主教练、状态、页码和 pageSize 写入 URL；返回/刷新恢复同一列表状态。
- 学生管理首次读取失败显示明确错误与重试，不再同时显示“暂无学生”；已有数据刷新失败时保留旧数据并显示紧凑错误。
- 学校管理二级 Tab 继续使用 URL，浏览器前进/后退可恢复具体分区。

## 仍待验收，不属于未实现功能

以下项目是验证/集成工作，不再代表 UI 架构代码缺项：

- 在最新分支 HEAD 上运行完整 TypeScript、Web 单测、UI state/component、architecture、routes、docs 与生产 build。
- 运行双学校、多角色、未保存草稿、目标授权失败、旧请求迟到和多视口 Playwright。
- 将分支与当前 `main` 的新增提交重新对齐并处理可能冲突。
- 合并、预览、部署与生产验收；这些操作必须单独执行，本记录不声称已经发生。

## 完成定义

实现完成的判断以代码边界为准：顶栏位置稳定、单一 AppShell、组织 Layout 上移、日常安全软切换、导航层级去重以及训练/学生关键列表的统一状态契约均已落入该分支。
最终发布完成仍必须以最新 HEAD 的自动化检查、隔离 E2E 和实际发布证据为准。
