---
status: current
audience: development
last_verified: 2026-07-30
source_of_truth: apps/web/src/styles/globals.css and UI components
---

# 设计系统

## 原则

- 管理工具以扫描、比较和重复操作效率为主，不使用营销式大 Hero。
- 页面区域保持无框架布局；卡片只用于重复实体、弹窗和真正需要边界的工具。
- 不嵌套卡片，不使用装饰性渐变、光斑或大面积单一色主题。
- 文本、按钮和固定格式控件在两个桌面验收视口都不能溢出或重叠。

## Token

全局颜色、背景、文字、边框、圆角、阴影和间距定义在 `styles/globals.css`。组件优先
使用 CSS 变量，例如：

| 语义 | Token |
|------|-------|
| 主操作 | `--primary`, `--primary-hover`, `--primary-light` |
| 成功 | `--success`, `--success-light`, `--success-text` |
| 警告 | `--warning`, `--warning-light`, `--warning-text` |
| 错误 | `--error`, `--error-light`, `--error-text` |
| 页面/卡片 | `--bg-page`, `--bg-card`, `--bg-muted` |
| 文字 | `--text-primary`, `--text-secondary`, `--text-muted` |

业务组件不要新增可被现有 Token 表达的 hex 颜色。图表和具有明确语义的多色状态可以
保留专用调色板，但应集中定义。

## 控件

- 工具按钮优先使用已有图标库图标；保存、删除、编辑等熟悉操作不绘制自定义 SVG。
- 二元设置使用 toggle/checkbox，模式使用 segmented control，选项集合使用 select/menu。
- 卡片圆角不超过 8px，除非现有组件规范要求。
- 标题字号匹配容器；紧凑面板不使用 Hero 级字号。
- 按钮、棋盘、表格列和分页器使用稳定尺寸，hover 不改变布局。

## 状态与无障碍

- 错误、警告、成功不能只靠颜色表达。
- 可点击元素必须可键盘聚焦，并有可访问名称。
- Modal 管理焦点和关闭行为；表单错误关联对应字段。
- Axe `critical` 问题阻断 UI CI，其他问题进入测试报告。

历史批量样式改造记录保存在
[前端风格重构归档](../archive/plans/frontend-style-refactor.md)，其中的数量是历史快照，
不是当前合规证明。

