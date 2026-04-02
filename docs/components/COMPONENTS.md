# 前端组件库文档

## 组件概述

项目使用 React + TypeScript 开发，组件采用内联样式，使用 CSS 变量统一管理主题。

## 组件目录结构

```
apps/web/src/components/
├── ui/                    # 通用 UI 组件
│   ├── Button.tsx         # 按钮组件
│   ├── Card.tsx           # 卡片组件
│   ├── Table.tsx          # 表格组件
│   ├── Modal.tsx          # 模态框组件
│   ├── Badge.tsx          # 徽章组件
│   ├── Pagination.tsx     # 分页组件
│   ├── PageHeader.tsx     # 页面头部组件
│   ├── MarkdownRenderer.tsx # Markdown 渲染组件
│   ├── Empty.tsx          # 空状态组件
│   └── ConfirmModal.tsx   # 确认对话框组件
├── business/              # 业务组件
│   ├── RegionSelector.tsx # 区域选择器
│   └── UserManagement.tsx # 用户管理组件
├── team/                  # 团队相关组件
│   ├── TeamCard.tsx       # 团队卡片
│   ├── TeamHeader.tsx     # 团队头部
│   ├── TeamMemberList.tsx # 成员列表
│   ├── TeamInviteListModal.tsx # 邀请列表弹窗
│   ├── TeamInviteModal.tsx # 邀请弹窗
│   ├── TeamEditModal.tsx  # 编辑弹窗
│   ├── TeamTransferModal.tsx # 转移弹窗
│   ├── TeamListPage.tsx   # 团队列表页面组件
│   ├── TeamDetailPage.tsx # 团队详情页面组件
│   └── InvitationCard.tsx # 邀请卡片
├── profile/               # 个人资料组件
│   ├── ProfileEditor.tsx  # 资料编辑组件
│   └── PasswordEditor.tsx # 密码修改组件
├── submission/            # 评测记录组件
│   └── SubmissionList.tsx # 评测记录列表（共用组件）
├── AppShell.tsx           # 应用外壳，导航布局
├── AuthProvider.tsx       # 认证上下文
├── ProtectedRoute.tsx     # 路由保护组件
├── Providers.tsx          # 全局 Provider 封装
├── Loading.tsx            # 加载状态组件
├── ContestDetail.tsx      # 比赛详情共用组件
```

## UI 组件

### 1. Button (按钮)

**文件**: `apps/web/src/components/ui/Button.tsx`

**Props**:
```typescript
interface ButtonProps {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'text'
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  style?: React.CSSProperties
}
```

**使用示例**:
```tsx
<Button onClick={handleClick}>保存</Button>
<Button variant="secondary">取消</Button>
<Button variant="text">编辑</Button>
<Button disabled>禁用</Button>
```

**样式变体**:
- `primary`: 主要按钮（蓝色背景）
- `secondary`: 次要按钮（灰色背景）
- `text`: 文本按钮（无背景）

---

### 2. Card (卡片)

**文件**: `apps/web/src/components/ui/Card.tsx`

**Props**:
```typescript
interface CardProps {
  children: React.ReactNode
  style?: React.CSSProperties
}
```

**使用示例**:
```tsx
<Card>
  <h3>标题</h3>
  <p>内容</p>
</Card>
```

**默认样式**:
- 白色背景
- 圆角 8px
- 边框 1px solid var(--border)
- 内边距 1.5rem

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
  variant?: 'success' | 'error' | 'warning' | 'info'
}
```

**使用示例**:
```tsx
<Badge variant="success">正常</Badge>
<Badge variant="error">禁用</Badge>
<Badge variant="warning">待审核</Badge>
<Badge variant="info">进行中</Badge>
```

**样式变体**:
- `success`: 绿色（成功状态）
- `error`: 红色（错误状态）
- `warning`: 黄色（警告状态）
- `info`: 蓝色（信息状态）

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

**用途**: 确认操作弹窗

**Props**:
```typescript
interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
}
```

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

### CSS 变量

**文件**: `apps/web/src/app/globals.css`

```css
:root {
  /* 颜色 */
  --primary: #3b82f6;
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;

  /* 灰度 */
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-200: #e5e7eb;
  --gray-300: #d1d5db;
  --gray-400: #9ca3af;
  --gray-500: #6b7280;
  --gray-600: #4b5563;
  --gray-700: #374151;
  --gray-800: #1f2937;
  --gray-900: #111827;

  /* 边框 */
  --border: #e5e7eb;

  /* 圆角 */
  --radius: 6px;
  --radius-lg: 8px;
}
```

### 表单样式

**文件**: `apps/web/src/lib/styles.ts`

```typescript
export const formStyles = {
  field: {
    marginBottom: '1rem'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    marginBottom: '0.5rem',
    color: 'var(--gray-700)'
  },
  input: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    boxSizing: 'border-box' as const
  },
  select: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    boxSizing: 'border-box' as const
  },
  textarea: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const
  }
}
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
