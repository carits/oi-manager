# 前端风格统一重构总结

> 完成日期: 2026-04-22

## 背景

前端存在大量视觉不一致问题：
- 29,361 行 TSX 代码、2,411 个内联样式对象
- 10+ 处紫色渐变按钮（#667eea → #764ba2）
- borderRadius 有 4px/6px/8px/12px 四种值混用
- boxShadow 有 10+ 种不同值
- fontSize 有 20+ 种非标准值（含 0.76rem、0.8rem 等）
- 73 处硬编码 #6b7280（应使用 var(--gray-500)）
- CSS 变量缺失 warning/info/radius/shadow/spacing/typography token

## 解决方案

采用 5 阶段渐进式重构：

### 第 1 阶段：设计 Token 与基础规范

建立统一的设计 token，所有视觉决策有唯一来源。

**新增文件**：
- `apps/web/src/styles/globals.css` — 扩展 CSS 变量
- `apps/web/src/lib/tokens.ts` — JS 设计 token 常量

**CSS 变量扩展**：
```css
:root {
  /* 色彩 */
  --primary: #2563eb;
  --primary-light: #dbeafe;
  --success: #16a34a;
  --success-light: #dcfce7;
  --success-text: #166534;
  --warning: #f59e0b;
  --warning-light: #fef3c7;
  --warning-text: #92400e;
  --error: #ef4444;
  --error-light: #fee2e2;
  --error-text: #991b1b;
  --info: #2563eb;
  --info-light: #dbeafe;
  --info-text: #1e40af;

  /* 背景 */
  --bg-page: #f5f7fa;
  --bg-card: #ffffff;
  --bg-hover: #f9fafb;
  --bg-muted: #f1f5f9;

  /* 文字 */
  --text-primary: #1e293b;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --text-inverse: #ffffff;

  /* 边框 */
  --border: #e2e8f0;
  --border-hover: #cbd5e1;

  /* 圆角 */
  --radius-sm: 4px;
  --radius: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* 阴影 */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04);

  /* 间距 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;

  /* 字号 */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
}
```

### 第 2 阶段：底层组件统一

重构 `ui/` 组件，使其符合统一 token 规范。

**修改文件**：
| 组件 | 改动 |
|------|------|
| `Button.tsx` | 增加 outline/ghost/fullWidth 变体 |
| `Card.tsx` | 增加 hoverable/padding/subtitle/onClick props |
| `Badge.tsx` | 增加 neutral/pending 变体，dot prop，getResultVariant() |
| `Table.tsx` | hover 改为 CSS class，使用 CSS 变量 |
| `PageHeader.tsx` | 描述颜色从 var(--gray-600) 改为 var(--text-secondary) |
| `AppShell.tsx` | 移除内联 Card/PageHeader 定义（34 行），改用 ui/ 组件 |

### 第 3 阶段：高频核心页面重构

重构学生和教师最常用的核心页面。

**修改文件**：
| 文件 | 改动 |
|------|------|
| `ProblemDetail.tsx` | 3 处紫色渐变 → var(--primary) |
| `TrainingDetailPage.tsx` | 2 处紫色渐变 → var(--primary) |
| `SubmissionList.tsx` | RESULT_COLORS 改为 CSS 变量 |
| `TeamTrainingList.tsx` | STATUS_MAP 颜色改为 CSS 变量 |
| `Toast.tsx` | typeConfig 改为 CSS 变量 |

### 第 4 阶段：低频页面批量替换

通过 sed 批量替换 92 个 TSX 文件中的硬编码颜色：

| 原值 | 替换为 | 说明 |
|------|--------|------|
| `#1e293b`, `#374151`, `#111827` | `var(--text-primary)` | 主要文字 |
| `#475569`, `#6b7280`, `#64748b` | `var(--text-secondary)` | 次要文字 |
| `#9ca3af`, `#94a3b8`, `#999` | `var(--text-muted)` | 弱化文字 |
| `#f9fafb`, `#f3f4f6`, `#f8fafc` | `var(--bg-muted)` | 背景色 |
| `#e5e7eb`, `#e2e8f0`, `#ccc` | `var(--border)` | 边框色 |
| `#3b82f6`, `#2563eb`, `#667eea` | `var(--primary)` | 主色 |
| `#ef4444`, `#dc2626` | `var(--error)` | 错误色 |
| `#16a34a`, `#22c55e`, `#10b981` | `var(--success)` | 成功色 |
| `#f59e0b`, `#d97706` | `var(--warning)` | 警告色 |

### 第 5 阶段：一致性校验与冗余清理

- borderRadius `12px` → `var(--radius-lg)`（10 个文件）
- borderRadius `3px` → `var(--radius-sm)`（6 个文件）

## 结果

| 指标 | 原值 | 新值 | 减少 |
|------|------|------|------|
| 紫色渐变 | 17 处 | 0 处 | 100% |
| 硬编码颜色 | 351 处 | 56 处 | 84% |
| 非标准 borderRadius | 2 种 | 0 种 | 100% |

**剩余 56 处硬编码颜色**：图表调色板（年级分布彩虹色、分数颜色渐变）等数据可视化用途，有意保留。

## 验收检查

```bash
# 无紫色渐变
grep -rn "linear-gradient" apps/web/src --include='*.tsx'
# → 0 结果

# 无残留紫色（除图表）
grep -rn "#8b5cf6\|#764ba2\|#667eea" apps/web/src --include='*.tsx'
# → 1 结果（图表调色板）

# TypeScript 编译通过
cd apps/web && npx tsc --noEmit
# → 无错误
```

## 使用指南

### 添加新组件时

1. 优先使用 `components/ui/` 下的共享组件
2. 颜色值使用 CSS 变量（`var(--primary)` 而非 `#2563eb`）
3. 圆角使用 `var(--radius)` / `var(--radius-md)` / `var(--radius-lg)`
4. 阴影使用 `var(--shadow)` / `var(--shadow-md)` / `var(--shadow-lg)`
5. 字号使用 `var(--text-sm)` / `var(--text-base)` 等

### 常用样式常量

```typescript
import { colors, radius, shadow, fontSize } from '@/lib/tokens'

// 或使用 lib/styles.ts 中的预定义样式
import { buttonStyles, cardStyles, formStyles } from '@/lib/styles'
```

## 未完成项

- 剩余 56 处硬编码颜色（图表调色板）可考虑统一到专门的 `chartColors` 常量
- 表格 hover 状态建议改为纯 CSS（已部分完成）