---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/development/FRONTEND.md
---

> 历史文档：本文件保留当时的设计、调查或实现记录，不代表当前系统行为。请以 `docs/development/FRONTEND.md` 为准。

# 前端组件库文档

## 组件概述

项目使用 React + TypeScript 开发，组件采用内联样式，使用 CSS 变量统一管理主题。

## 组件目录结构

```
apps/web/src/components/
├── ui/                    # 通用 UI 组件（设计 token 驱动）
│   ├── Button.tsx         # 按钮（primary/secondary/outline/ghost/danger/text）
│   ├── Card.tsx           # 卡片（padding/hoverable/subtitle）
│   ├── Table.tsx          # 表格（CSS 变量 hover）
│   ├── Modal.tsx          # 模态框组件
│   ├── Badge.tsx          # 徽章（success/error/warning/info/neutral/pending + dot + getResultVariant）
│   ├── Pagination.tsx     # 分页组件
│   ├── PageHeader.tsx     # 页面头部组件
│   ├── MarkdownRenderer.tsx # Markdown 渲染组件
│   ├── MarkdownEditor.tsx # Markdown 编辑组件
│   ├── Empty.tsx          # 空状态组件
│   ├── ConfirmModal.tsx   # 确认对话框组件
│   ├── Toast.tsx          # Toast 通知组件
│   └── PasswordResetModal.tsx # 密码重置弹窗组件
├── business/              # 业务组件
│   ├── RegionSelector.tsx # 区域选择器
│   └── UserManagement.tsx # 用户管理组件
├── team/                  # 团队相关组件
│   ├── TeamCard.tsx       # 团队卡片
│   ├── TeamHeader.tsx     # 团队头部
│   ├── TeamMemberList.tsx # 成员列表
│   ├── TeamDetailPage.tsx # 团队详情页
│   └── TeamProblemListsTab.tsx # 团队题单
├── training/              # 训练相关组件
│   ├── TeamTrainingList.tsx    # 训练列表
│   ├── TrainingDetailPage.tsx  # 训练详情页
│   ├── TrainingCreateModal.tsx # 创建训练弹窗
│   ├── TrainingEditPage.tsx    # 编辑训练页
│   └── TrainingFormModal.tsx   # 训练表单弹窗
├── problem/               # 题目相关组件
│   ├── ProblemDetail.tsx       # 题目详情页
│   ├── ProblemForm.tsx         # 题目表单
│   ├── ProblemListPage.tsx     # 题单列表页
│   ├── ProblemListDetailPage.tsx # 题单详情页
│   ├── ProblemNote.tsx         # 写思路
│   ├── JudgeSettingsTab.tsx    # 评测设置
│   └── TranslateModal.tsx      # 翻译弹窗
├── submission/            # 评测记录组件
│   ├── SubmissionList.tsx      # 评测记录列表
│   ├── SubmissionDetailPage.tsx # 提交详情页
│   └── SubmissionDetailModal.tsx # 提交详情弹窗
├── profile/               # 个人资料组件
│   ├── ProfileEditor.tsx  # 资料编辑组件
│   └── PasswordEditor.tsx # 密码修改组件
├── AppShell.tsx           # 应用外壳（导航布局）
├── AuthProvider.tsx       # 认证上下文
├── ProtectedRoute.tsx     # 路由保护组件
├── Providers.tsx          # 全局 Provider 封装
├── Loading.tsx            # 加载状态组件
└── ContestDetail.tsx      # 比赛详情共用组件
```

## UI 组件

### 1. Button (按钮)

**文件**: `apps/web/src/components/ui/Button.tsx`

**Props**:
```typescript
interface ButtonProps {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'text'
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  fullWidth?: boolean
  style?: React.CSSProperties
}
```

**使用示例**:
```tsx
<Button variant="primary">保存</Button>
<Button variant="secondary">取消</Button>
<Button variant="outline">边框按钮</Button>
<Button variant="ghost">幽灵按钮</Button>
<Button variant="danger">删除</Button>
<Button variant="text">文字链接</Button>
<Button fullWidth>占满宽度</Button>
```

**样式变体**:
- `primary`: 主要按钮（蓝色纯色背景，禁止渐变）
- `secondary`: 次要按钮（灰色背景）
- `outline`: 边框按钮（蓝色边框 + 白色背景）
- `ghost`: 幽灵按钮（透明背景，悬停显示底色）
- `danger`: 危险操作（红色背景）
- `text`: 文本按钮（无背景，仅文字）

---

### 2. Card (卡片)

**文件**: `apps/web/src/components/ui/Card.tsx`

**Props**:
```typescript
interface CardProps {
  children: React.ReactNode
  style?: React.CSSProperties
  padding?: boolean        // 是否添加内边距，默认 true
  hoverable?: boolean      // 是否显示悬停效果
  subtitle?: string        // 卡片副标题
  onClick?: () => void     // 点击事件
}
```

**使用示例**:
```tsx
<Card>
  <h3>标题</h3>
  <p>内容</p>
</Card>
<Card hoverable onClick={handleClick}>可点击卡片</Card>
<Card subtitle="副标题">带副标题</Card>
```

**默认样式**:
- 白色背景（`var(--bg-card)`）
- 圆角 `var(--radius-md)`
- 边框 `1px solid var(--border)`
- 阴影 `var(--shadow-sm)`

---

### 3. Table (表格)

**文件**: `apps/web/src/components/ui/Table.tsx`

**Props**:
```typescript
interface TableProps<T> {
  data: T[]
  columns: Array<{
    key: string
    label: string
    render?: (item: T, index: number) => React.ReactNode
  }>
  loading?: boolean
  emptyText?: string
  actions?: (item: T) => React.ReactNode
}
```

**使用示例**:
```tsx
<Table
  data={users}
  loading={loading}
  emptyText="暂无数据"
  columns={[
    { key: 'name', label: '姓名' },
    { key: 'email', label: '邮箱' },
    {
      key: 'status',
      label: '状态',
      render: (user) => (
        <Badge variant={user.status === 'active' ? 'success' : 'error'}>
          {user.status === 'active' ? '正常' : '禁用'}
        </Badge>
      )
    }
  ]}
  actions={(user) => (
    <>
      <Button variant="text" onClick={() => handleEdit(user)}>编辑</Button>
      <Button variant="text" onClick={() => handleDelete(user)}>删除</Button>
    </>
  )}
/>
```

**特性**:
- 支持自定义列渲染
- 支持操作列
- 支持加载状态
- 支持空数据提示

---

### 4. Modal (模态框)

**文件**: `apps/web/src/components/ui/Modal.tsx`

**Props**:
```typescript
interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: string
}
```

**使用示例**:
```tsx
<Modal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="编辑用户"
  width="600px"
>
  <form onSubmit={handleSubmit}>
    {/* 表单内容 */}
  </form>
</Modal>
```

**特性**:
- 遮罩层点击关闭
- ESC 键关闭
- 自定义宽度
- 居中显示

---

### 5. Badge (徽章)

**文件**: `apps/web/src/components/ui/Badge.tsx`

**Props**:
```typescript
interface BadgeProps {
  children: React.ReactNode
  variant?: 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'pending'
  dot?: boolean    // 显示圆点指示器
}
```

**使用示例**:
```tsx
<Badge variant="success">正常</Badge>
<Badge variant="error">禁用</Badge>
<Badge variant="warning">待审核</Badge>
<Badge variant="info">进行中</Badge>
<Badge variant="neutral">中性</Badge>
<Badge variant="pending">待处理</Badge>
<Badge dot>带圆点</Badge>
```

**辅助函数**:
```tsx
import { getResultVariant } from '@/components/ui/Badge'
// 评测结果自动匹配颜色：Accepted→success, WrongAnswer→error, ...
<Badge variant={getResultVariant(result)}>{result}</Badge>
```

**样式变体**:
- `success`: 绿色（成功状态）
- `error`: 红色（错误状态）
- `warning`: 黄色（警告状态）
- `info`: 蓝色（信息状态）
- `neutral`: 灰色（中性状态）
- `pending`: 蓝灰色（待处理状态）

---

### 6. Pagination (分页)

**文件**: `apps/web/src/components/ui/Pagination.tsx`

**Props**:
```typescript
interface PaginationProps {
  currentPage: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  showQuickJumper?: boolean
  showTotal?: boolean
}
```

**使用示例**:
```tsx
<Pagination
  currentPage={pagination.page}
  totalPages={pagination.totalPages}
  total={pagination.total}
  pageSize={pagination.pageSize}
  onPageChange={handlePageChange}
  onPageSizeChange={handlePageSizeChange}
  pageSizeOptions={[10, 20, 50, 100]}
  showTotal={true}
  showQuickJumper={true}
/>
```

**特性**:
- 页码显示（智能省略）
- 上一页/下一页按钮
- 每页条数选择
- 快速跳转
- 总数显示

---

### 7. PageHeader (页面头部)

**文件**: `apps/web/src/components/ui/PageHeader.tsx`

**Props**:
```typescript
interface PageHeaderProps {
  title: string
  children?: React.ReactNode
}
```

**使用示例**:
```tsx
<PageHeader title="用户管理">
  <Button onClick={handleCreate}>+ 创建用户</Button>
</PageHeader>
```

**特性**:
- 标题显示
- 右侧操作区域

---

### 8. MarkdownRenderer (Markdown 渲染)

**文件**: `apps/web/src/components/ui/MarkdownRenderer.tsx`

**Props**:
```typescript
interface MarkdownRendererProps {
  content: string
  className?: string
}
```

**使用示例**:
```tsx
<MarkdownRenderer content={announcement} />
```

**特性**:
- 支持 GitHub Flavored Markdown (GFM)
- 支持 LaTeX 数学公式
- 使用 KaTeX 渲染数学公式
- 自动代码高亮

**依赖**:
- `react-markdown`: Markdown 渲染
- `remark-gfm`: GFM 支持
- `remark-math`: 数学公式支持
- `rehype-katex`: KaTeX 渲染
- `katex`: LaTeX 渲染引擎

---

## 业务组件

### 1. RegionSelector (区域选择器)

**文件**: `apps/web/src/components/business/RegionSelector.tsx`

**Props**:
```typescript
interface RegionSelectorProps {
  province: string
  city: string
  district: string
  onProvinceChange: (province: string) => void
  onCityChange: (city: string) => void
  onDistrictChange: (district: string) => void
}
```

**使用示例**:
```tsx
<RegionSelector
  province={form.province}
  city={form.city}
  district={form.district}
  onProvinceChange={(province) => setForm({ ...form, province, city: '', district: '' })}
  onCityChange={(city) => setForm({ ...form, city, district: '' })}
  onDistrictChange={(district) => setForm({ ...form, district })}
/>
```

**特性**:
- 三级联动（省/市/区）
- 数据来源：中国行政区划数据
- 自动清空下级选项

---

## 工具组件

### 1. AuthProvider (认证上下文)

**文件**: `apps/web/src/components/AuthProvider.tsx`

**提供的上下文**:
```typescript
interface AuthContextType {
  user: {
    userId: string
    role: string
    schoolId?: string
  } | null
  loading: boolean
}
```

**使用示例**:
```tsx
import { useAuth } from '@/components/AuthProvider'

function MyComponent() {
  const { user, loading } = useAuth()

  if (loading) return <div>加载中...</div>
  if (!user) return <div>未登录</div>

  return <div>欢迎，{user.role}</div>
}
```

---

### 2. ProtectedRoute (路由保护)

**文件**: `apps/web/src/components/ProtectedRoute.tsx`

**Props**:
```typescript
interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: string | string[]
}
```

**使用示例**:
```tsx
<ProtectedRoute requiredRole="super_admin">
  <AdminPage />
</ProtectedRoute>

<ProtectedRoute requiredRole={['super_admin', 'platform_admin']}>
  <UsersPage />
</ProtectedRoute>
```

**特性**:
- 检查用户登录状态
- 检查用户角色权限
- 自动重定向到登录页

---

## 团队组件

### 1. TeamCard (团队卡片)

**文件**: `apps/web/src/components/team/TeamCard.tsx`

**用途**: 展示团队基本信息卡片，用于团队列表页

**特性**:
- 显示团队名称、头像、描述
- 显示成员数量
- 支持点击进入详情

---

### 2. TeamHeader (团队头部)

**文件**: `apps/web/src/components/team/TeamHeader.tsx`

**用途**: 团队详情页头部组件

**特性**:
- 显示团队完整信息
- 编辑/删除操作（权限控制）
- 转移团队功能

---

### 3. TeamMemberList (成员列表)

**文件**: `apps/web/src/components/team/TeamMemberList.tsx`

**用途**: 团队成员列表展示

**特性**:
- 分角色显示成员（负责人/管理员/成员）
- 支持邀请/移除成员
- 支持设置管理员

---

### 4. TeamInviteModal (邀请弹窗)

**文件**: `apps/web/src/components/team/TeamInviteModal.tsx`

**用途**: 邀请学生/教师加入团队的弹窗

**特性**:
- 搜索可邀请的用户
- 批量邀请
- 权限检查

---

### 5. TeamListPage (团队列表页)

**文件**: `apps/web/src/components/team/TeamListPage.tsx`

**用途**: 团队列表页面组件，被教师端和学生端共用

**特性**:
- 展示团队卡片列表
- 支持创建团队（教师）
- 支持申请加入（学生）

---

### 6. TeamDetailPage (团队详情页)

**文件**: `apps/web/src/components/team/TeamDetailPage.tsx`

**用途**: 团队详情页面组件

**特性**:
- 展示团队完整信息
- 成员管理
- 团队设置

---

## 评测记录组件

### 1. SubmissionList (评测记录列表)

**文件**: `apps/web/src/components/submission/SubmissionList.tsx`

**用途**: 评测记录列表页面，被教师端、学生端、平台管理员端共用

**Props**:
```typescript
interface SubmissionListProps {
  viewRole: 'teacher' | 'student' | 'admin'
}
```

**特性**:
- 筛选栏：用户名（输入）、OJ（下拉含"本OJ"）、题号（输入）、评测结果（14选项下拉）、语言（20选项下拉）
- 表格列：用户名、OJ、题号、评测结果、耗时(ms)、内存(MB)、代码长度(B)、语言、提交时间
- 评测结果彩色 Badge（Accepted 绿色、WA/TLE/RE 红色/黄色等）
- 分页控件
- 过滤/重置按钮

**依赖常量**:
- `lib/judge-constants.ts` — 评测结果和语言选项
- `lib/oj-platforms.ts` — OJ 平台选项

---

## 个人资料组件

### 1. ProfileEditor (资料编辑)

**文件**: `apps/web/src/components/profile/ProfileEditor.tsx`

**用途**: 编辑用户个人资料

**特性**:
- 修改姓名、简介
- 上传头像
- 表单验证

---

### 2. PasswordEditor (密码修改)

**文件**: `apps/web/src/components/profile/PasswordEditor.tsx`

**用途**: 修改用户密码

**特性**:
- 验证当前密码
- 设置新密码
- 密码强度要求

---

## 其他组件

### 1. AppShell (应用外壳)

**文件**: `apps/web/src/components/AppShell.tsx`

**用途**: 应用主布局，包含导航栏和侧边栏

**特性**:
- 响应式导航
- 角色菜单切换
- 用户信息展示

---

### 2. ContestDetail (比赛详情)

**文件**: `apps/web/src/components/ContestDetail.tsx`

**用途**: 比赛详情页面共用组件

**特性**:
- 展示比赛信息
- 题目列表
- 成绩榜单（教师）
- 资源下载

---

### 3. Loading (加载组件)

**文件**: `apps/web/src/components/Loading.tsx`

**用途**: 全局加载状态组件

---

### 4. Empty (空状态)

**文件**: `apps/web/src/components/ui/Empty.tsx`

**用途**: 空数据状态展示

---

### 5. ConfirmModal (确认弹窗)

**文件**: `apps/web/src/components/ui/ConfirmModal.tsx`

**用途**: 替代浏览器原生 `confirm()`，用于需要用户确认的危险操作（如删除、解散等）。

**Props**:
```typescript
interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string   // 默认 '确认'
  cancelText?: string    // 默认 '取消'
  danger?: boolean       // 危险样式（红色按钮），默认 false
  loading?: boolean      // 确认按钮 loading 状态，默认 false
}
```

**使用示例**:
```tsx
const [confirmState, setConfirmState] = useState<{
  id: string
  message: string
  action: () => Promise<void>
} | null>(null)

// 触发确认
<button onClick={() => setConfirmState({
  id: item.id,
  message: '确定要删除吗？',
  action: async () => { await apiClient.delete(`/api/items/${item.id}`) }
})}>
  删除
</button>

// 确认弹窗
<ConfirmModal
  isOpen={!!confirmState}
  onClose={() => setConfirmState(null)}
  onConfirm={() => { confirmState?.action(); setConfirmState(null) }}
  title="确认操作"
  message={confirmState?.message || ''}
  confirmText="确认"
  danger
/>
```

---

### 6. Toast (通知提示)

**文件**: `apps/web/src/components/ui/Toast.tsx`

**用途**: 替代浏览器原生 `alert()`，用于操作成功/失败的轻量级反馈通知。在右上角弹出，3.5 秒自动消失。

**导出**:
- `ToastProvider` — 上下文 Provider，需在 `Providers.tsx` 中挂载
- `useToast` — React 组件内使用的 Hook
- `showToastNotification` — 非 React 上下文中使用的独立函数

**Toast 类型**:
| 类型 | 颜色 | 图标 | 用途 |
|------|------|------|------|
| `success` | 绿色 | ✓ | 操作成功反馈 |
| `error` | 红色 | ✕ | 操作失败反馈 |
| `warning` | 黄色 | ! | 输入验证警告 |
| `info` | 蓝色 | i | 一般信息提示 |

**Hook 使用示例** (React 组件内):
```tsx
import { useToast } from '@/components/ui/Toast'

function MyComponent() {
  const { toast } = useToast()

  const handleSave = async () => {
    try {
      const result = await apiClient.post('/api/items', data)
      if (result.success) {
        toast.success('保存成功')
      } else {
        toast.error(result.message || '保存失败')
      }
    } catch {
      toast.error('操作失败')
    }
  }
}
```

**独立函数使用示例** (非 React 组件代码):
```tsx
import { showToastNotification } from '@/components/ui/Toast'

// 在模块级函数中使用
function handleFileDownload() {
  if (!isLoggedIn) {
    showToastNotification('请先登录', 'warning')
    return
  }
}
```

**挂载方式**:
在 `Providers.tsx` 中用 `<ToastProvider>` 包裹 children，页面需要有 `<div id="toast-root" />` 供独立函数使用。

---

### 7. PasswordResetModal (密码重置弹窗)

**文件**: `apps/web/src/components/ui/PasswordResetModal.tsx`

**用途**: 替代浏览器原生 `prompt()`，用于管理员重置用户密码的场景。

**Props**:
```typescript
interface PasswordResetModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string           // 目标用户 ID
  username: string         // 目标用户名（显示用）
  onSuccess?: (newPassword: string) => void  // 重置成功回调
}
```

**使用示例**:
```tsx
const [resetTarget, setResetTarget] = useState<{ userId: string; username: string } | null>(null)

// 触发
<button onClick={() => setResetTarget({ userId: user.id, username: user.username })}>
  重置密码
</button>

// 弹窗
<PasswordResetModal
  isOpen={!!resetTarget}
  onClose={() => setResetTarget(null)}
  userId={resetTarget?.userId || ''}
  username={resetTarget?.username || ''}
  onSuccess={(newPassword) => {
    toast.success(`密码已重置为: ${newPassword}`)
    setResetTarget(null)
  }}
/>
```

**特性**:
- 密码最少 6 位
- 自动调用 `/api/users/:id/reset-password` 接口
- 内置 loading 和错误提示状态

---

## Hooks

### 1. useModal

**文件**: `apps/web/src/hooks/form/useModal.ts`

**返回值**:
```typescript
interface UseModalReturn<T> {
  isOpen: boolean
  data: T | null
  open: (data?: T) => void
  close: () => void
}
```

**使用示例**:
```tsx
const modal = useModal<User>()

// 打开模态框
<Button onClick={() => modal.open(user)}>编辑</Button>

// 模态框组件
{modal.isOpen && (
  <Modal isOpen={true} onClose={modal.close} title="编辑用户">
    <UserForm user={modal.data} onSuccess={modal.close} />
  </Modal>
)}
```

---

### 2. useForm

**文件**: `apps/web/src/hooks/form/useForm.ts`

**参数**:
```typescript
function useForm<T>(
  initialValues: T,
  onSubmit: (values: T) => Promise<void>
)
```

**返回值**:
```typescript
interface UseFormReturn<T> {
  values: T
  handleChange: (key: keyof T, value: any) => void
  handleSubmit: (e: React.FormEvent) => void
}
```

**使用示例**:
```tsx
const form = useForm(
  { name: '', email: '' },
  async (values) => {
    await api.createUser(values)
  }
)

<form onSubmit={form.handleSubmit}>
  <input
    value={form.values.name}
    onChange={(e) => form.handleChange('name', e.target.value)}
  />
  <input
    value={form.values.email}
    onChange={(e) => form.handleChange('email', e.target.value)}
  />
  <button type="submit">提交</button>
</form>
```

---

## 样式系统

> 详细设计文档：`docs/DESIGN_SYSTEM.md`

### CSS 变量

**文件**: `apps/web/src/styles/globals.css`

所有视觉值通过 CSS 变量管理，JS 侧通过 `lib/tokens.ts` 引用。

```css
:root {
  /* 主色 */
  --primary: #2563eb;  --primary-hover: #1d4ed8;
  --primary-light: #dbeafe;  --primary-text: #1e40af;

  /* 语义色（success/warning/error/info 各有 base/light/text 变体） */
  --success / --success-light / --success-text
  --warning / --warning-light / --warning-text
  --error   / --error-light   / --error-text
  --info    / --info-light    / --info-text

  /* 背景 */
  --bg-page / --bg-card / --bg-hover / --bg-muted

  /* 文字 */
  --text-primary / --text-secondary / --text-muted / --text-inverse

  /* 边框 */
  --border / --border-hover

  /* 圆角 */
  --radius-sm: 4px;  --radius: 6px;  --radius-md: 8px;  --radius-lg: 12px;

  /* 阴影 */
  --shadow-xs / --shadow-sm / --shadow / --shadow-md / --shadow-lg

  /* 间距（4px 基数） */
  --space-1 ~ --space-10

  /* 字号 */
  --text-xs: 0.75rem;  --text-sm: 0.875rem;  --text-base: 1rem;
  --text-lg: 1.125rem;  --text-xl: 1.25rem;  --text-2xl: 1.5rem;
}
```

### JS Token

**文件**: `apps/web/src/lib/tokens.ts`

与 CSS 变量一一对应的 JS 常量，供内联样式使用：

```tsx
import { colors, radius, shadow, fontSize } from '@/lib/tokens'

<div style={{ color: colors.textPrimary, borderRadius: radius.md }}>
```

### 样式预设

**文件**: `apps/web/src/lib/styles.ts`

导出 `formStyles`、`tableStyles`、`cardStyles`、`modalStyles`、`badgeStyles`、`layoutStyles` 等场景样式。所有值均使用 CSS 变量。

```tsx
import { formStyles } from '@/lib/styles'
<input style={formStyles.input} />
```

---

## 组件开发规范

### 1. 命名规范
- 组件文件名使用 PascalCase（如 `Button.tsx`）
- 组件函数名使用 PascalCase（如 `function Button() {}`）
- Props 接口名使用 `ComponentNameProps`（如 `ButtonProps`）

### 2. 样式规范
- 优先使用内联样式
- 使用 CSS 变量统一主题
- 避免使用 CSS 类名（除非必要）

### 3. TypeScript 规范
- 所有 Props 必须定义接口
- 避免使用 `any` 类型
- 使用泛型提高组件复用性

### 4. 组件复用
- 通用组件放在 `components/ui/`
- 业务组件放在 `components/business/`
- 避免重复代码，提取公共逻辑

### 5. 性能优化
- 使用 `React.memo` 优化渲染
- 使用 `useCallback` 和 `useMemo` 优化性能
- 避免在渲染函数中创建新对象

---

## 更新日志

### 2026-04-22
- ✅ 更新样式系统文档（CSS 变量、JS Token、样式预设）
- ✅ 更新 Button（新增 outline/ghost/danger/fullWidth 变体）
- ✅ 更新 Card（新增 padding/hoverable/subtitle/onClick）
- ✅ 更新 Badge（新增 neutral/pending/dot/getResultVariant）
- ✅ 更新组件目录结构（新增 training/、problem/、submission/）

### 2026-03-23
- ✅ 添加团队组件文档（TeamCard, TeamHeader, TeamMemberList 等）
- ✅ 添加个人资料组件文档（ProfileEditor, PasswordEditor）
- ✅ 添加其他组件文档（AppShell, ContestDetail, Loading, Empty, ConfirmModal）
- ✅ 更新组件目录结构
- ✅ 移除 UserManagement "未使用"的错误标注

### 2026-03-18
- ✅ 添加 Pagination 组件
- ✅ 添加 MarkdownRenderer 组件
- ✅ 优化 Table 组件支持自定义渲染
- ✅ 添加 Badge 组件多种变体
- ✅ 完善组件文档
