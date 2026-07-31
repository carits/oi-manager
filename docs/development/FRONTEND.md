---
status: current
audience: development
last_verified: 2026-07-30
source_of_truth: apps/web/src
---

# 前端架构

## 页面与布局

页面位于 `apps/web/src/app`，按角色目录组织。每个角色 layout 使用 `RoleLayout`：

- 未登录跳转到对应登录入口。
- 已登录但角色错误时回到自身角色首页。
- 学校负责人继承教师页面。
- 平台管理员不会通过 `super_admin` 判断获得超管页面。

导航集中在 `config/navigation.ts`。学生导航根据 `studentMode` 选择校园或个人配置。

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

列表和详情至少包含：

1. 加载中：稳定占位，不改变布局尺寸。
2. 错误：显示服务端消息，并提供重试。
3. 空数据：只在成功响应且集合为空时显示。
4. 成功：渲染数据和允许的操作。

图片、菜单、表格行和图标操作使用可聚焦的按钮或链接。图标按钮必须有
`aria-label` 或 tooltip。

## 数据缓存

SWR/Hooks 的 key 包含接口和查询参数。`sessionKey=role:userId` 用于切换账号后隔离
前端缓存；它不能用于后端权限判断。写操作成功后只刷新受影响 key。

## 视口

当前验收重点是 `1440×900` 和 `1280×720` 桌面端。固定格式控件使用明确的
grid、min/max、aspect-ratio 或稳定按钮尺寸，避免动态内容导致布局跳动。

