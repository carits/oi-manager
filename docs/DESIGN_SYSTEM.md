# 前端设计系统 (Design System)

> 最后更新: 2026-04-22

本文档描述 OI Manager V2 的前端设计 token 系统、样式规范和组件使用约定。

---

## 1. 设计 Token

设计 token 是视觉决策的唯一来源（single source of truth），分为两层：

| 层级 | 文件 | 用途 |
|------|------|------|
| CSS 变量 | `apps/web/src/styles/globals.css` | CSS 内和内联样式引用 |
| JS 常量 | `apps/web/src/lib/tokens.ts` | JS/TS 内联样式引用 |
| 样式预设 | `apps/web/src/lib/styles.ts` | 表单、表格、卡片等场景样式 |

### 1.1 色彩

```css
/* 主色 */
--primary: #2563eb;
--primary-hover: #1d4ed8;
--primary-light: #dbeafe;
--primary-text: #1e40af;

/* 语义色（每个有 base/light/text 三个变体） */
--success / --success-light / --success-text
--warning / --warning-light / --warning-text
--error   / --error-light   / --error-text
--info    / --info-light    / --info-text
```

**使用规则**：
- 按钮/链接/强调 → `var(--primary)`
- 成功提示/通过状态 → `var(--success)` / `var(--success-light)` 背景
- 错误提示/失败状态 → `var(--error)` / `var(--error-light)` 背景
- 警告/待处理 → `var(--warning)` / `var(--warning-light)` 背景
- 禁止使用紫色渐变或硬编码 hex 颜色值

### 1.2 背景与文字

```css
/* 背景 */
--bg-page: #f5f7fa;     /* 页面底色 */
--bg-card: #ffffff;     /* 卡片/面板底色 */
--bg-hover: #f1f5f9;    /* 悬停/选中底色 */
--bg-muted: #f8fafc;    /* 次级背景（表格条纹等） */

/* 文字（按层级递减） */
--text-primary: #1e293b;    /* 标题、主文字 */
--text-secondary: #475569;  /* 副标题、描述 */
--text-muted: #94a3b8;      /* 占位符、禁用态 */
--text-inverse: #ffffff;    /* 深色背景上的文字 */
```

**使用规则**：
- 文字颜色只使用 `--text-primary/secondary/muted/inverse`，不使用 `--gray-*`
- 背景颜色只使用 `--bg-page/card/hover/muted`，不使用 `--gray-50/100` 等
- 边框使用 `--border`（常规）/ `--border-hover`（悬态）

### 1.3 圆角、阴影、间距、字号

```css
/* 圆角 */
--radius-sm: 4px;    /* 小元素（badge、tag） */
--radius: 6px;       /* 输入框、按钮 */
--radius-md: 8px;    /* 卡片、弹窗内部 */
--radius-lg: 12px;   /* 卡片、弹窗外层 */
--radius-full: 9999px; /* 头像、圆形标签 */

/* 阴影（从轻到重） */
--shadow-xs / --shadow-sm / --shadow / --shadow-md / --shadow-lg

/* 间距（4px 基数） */
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 20px;  --space-6: 24px;
--space-8: 32px;  --space-10: 40px;

/* 字号 */
--text-xs: 0.75rem;   --text-sm: 0.875rem;  --text-base: 1rem;
--text-lg: 1.125rem;  --text-xl: 1.25rem;   --text-2xl: 1.5rem;
```

---

## 2. JS Token 使用

在 TSX 内联样式中，通过 `lib/tokens.ts` 引用：

```tsx
import { colors, radius, shadow, fontSize } from '@/lib/tokens'

<div style={{
  color: colors.textPrimary,
  background: colors.bgCard,
  borderRadius: radius.md,
  boxShadow: shadow.sm,
  fontSize: fontSize.sm,
}}>
```

也可直接使用 CSS 变量字符串：

```tsx
<div style={{ color: 'var(--text-primary)', borderRadius: 'var(--radius-md)' }}>
```

---

## 3. 样式预设

`lib/styles.ts` 导出场景化的样式对象：

| 导出 | 用途 |
|------|------|
| `formStyles` | 表单字段、标签、输入框、下拉框、文本域 |
| `buttonStyles` | 按钮变体样式（已集成到 Button 组件） |
| `tableStyles` | 表格头、行、单元格 |
| `cardStyles` | 卡片容器变体 |
| `modalStyles` | 弹窗遮罩、内容、头部 |
| `badgeStyles` | 状态徽章变体 |
| `layoutStyles` | 页面容器、网格 |
| `emptyStyles` | 空状态 |
| `loadingStyles` | 加载状态 |

使用示例：

```tsx
import { formStyles } from '@/lib/styles'

<input style={formStyles.input} />
<select style={formStyles.select} />
```

---

## 4. UI 组件

通用 UI 组件在 `components/ui/` 目录下，均使用设计 token。

### 4.1 Button

```tsx
<Button variant="primary">主要操作</Button>
<Button variant="secondary">次要操作</Button>
<Button variant="outline">边框按钮</Button>
<Button variant="ghost">幽灵按钮</Button>
<Button variant="danger">危险操作</Button>
<Button variant="text">文字链接</Button>
<Button fullWidth>占满宽度</Button>
```

### 4.2 Card

```tsx
<Card padding>带内边距卡片</Card>
<Card hoverable onClick={handleClick}>可悬停卡片</Card>
<Card subtitle="副标题">带副标题卡片</Card>
```

### 4.3 Badge

```tsx
<Badge variant="success">成功</Badge>
<Badge variant="error">失败</Badge>
<Badge variant="warning">警告</Badge>
<Badge variant="info">信息</Badge>
<Badge variant="neutral">中性</Badge>
<Badge variant="pending">待处理</Badge>
<Badge dot>带圆点</Badge>

// 评测结果自动匹配颜色
<Badge variant={getResultVariant('Accepted')}>AC</Badge>
```

### 4.4 Table

```tsx
<Table data={items} columns={columns} loading={loading} />
// hover 行高亮自动通过 CSS 变量实现
```

---

## 5. 样式规范

### 必须遵守

1. **颜色**：使用 `var(--xxx)` 或 `tokens.ts` 导出，禁止硬编码 hex 值（`#xxxxxx`）
2. **圆角**：使用 `var(--radius-xx)`，禁止 `3px`、`12px` 等非标值
3. **字号**：使用 `var(--text-xx)`，禁止 `0.76rem`、`0.85rem` 等非标值
4. **阴影**：使用 `var(--shadow-xx)`
5. **按钮**：禁止渐变背景，使用纯色 `var(--primary)`

### 例外

图表调色板（如年级分布彩虹色、分数颜色渐变）允许使用硬编码颜色值，因为这些是数据可视化的语义需要。

### 检查命令

```bash
cd apps/web
# 检查残留渐变
grep -rn "linear-gradient" --include='*.tsx' src/

# 检查紫色
grep -rn "#8b5cf6\|#7c3aed\|#6366f1\|#764ba2\|#667eea" --include='*.tsx' src/

# 检查硬编码文字色（应使用 var(--text-xxx)）
grep -rn "color: '#1e293b\|color: '#6b7280\|color: '#9ca3af" --include='*.tsx' src/
```

---

## 6. 文件清单

| 文件 | 职责 |
|------|------|
| `apps/web/src/styles/globals.css` | CSS 变量定义（唯一来源） |
| `apps/web/src/lib/tokens.ts` | JS token 常量（与 CSS 变量一一对应） |
| `apps/web/src/lib/styles.ts` | 场景样式预设（表单、表格、卡片等） |
| `apps/web/src/components/ui/` | 通用 UI 组件（Button, Card, Badge, Table, Modal 等） |

---

## 更新日志

### 2026-04-22
- 创建设计系统文档
- 建立 CSS 变量 token 体系（色彩、背景、文字、边框、圆角、阴影、间距、字号）
- 创建 `lib/tokens.ts` JS token 常量
- 重写 `lib/styles.ts` 全面使用 CSS 变量
- 增强 Button/Card/Badge/Table 组件
- 批量替换 92 个 TSX 文件的硬编码颜色
- 消除全部紫色渐变和非标 borderRadius
