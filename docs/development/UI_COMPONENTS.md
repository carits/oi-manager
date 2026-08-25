---
status: current
audience: development
last_verified: 2026-08-25
source_of_truth: apps/web/src/components/ui
---

# UI 组件契约

业务页面先选择页面骨架，再选择控件，不在业务目录复制通用样式。

| 场景 | 组件 | 约束 |
|---|---|---|
| 页面 | `PageFrame`、`PageHeader` | Shell 是宽度和页面边距唯一所有者 |
| 区域 | `Section` | 标题、说明、操作和正文顺序固定 |
| 筛选 | `Toolbar`、`TableToolbar` | 筛选在左，主要或批量操作在右 |
| 表单 | `FormField` + `Input/Textarea/Select` | 错误与字段关联，不自行写标签间距 |
| 选择 | `Checkbox/RadioGroup/Switch/Combobox` | 布尔、互斥、开关和可搜索集合分别使用对应组件 |
| 数据 | `DataTable`、`Pagination` | 表格负责加载、错误、空数据、键盘行操作 |
| 状态 | `StatusBadge`、`Empty`、`LoadError` | 状态不能只靠颜色表达 |
| 操作 | `Button/IconButton/Menu/Popover` | 图标按钮必须有 `aria-label` |
| 表单弹窗 | `FormDialog` | 尺寸预设、dirty 关闭确认、提交中禁止关闭 |
| 确认弹窗 | `ConfirmDialog` | 危险操作显示警告区和影响范围 |
| 详情弹窗 | `DetailDialog` | 长内容 page scroll，只有最右侧一个滚动条 |

## Dialog 尺寸

| size | 宽度 | 用途 |
|---|---:|---|
| `sm` | 420px | 确认、小型设置 |
| `md` | 560px | 常规创建和编辑 |
| `lg` | 720px | 多字段表单、重测设置 |
| `xl` | 960px | 提交列表、复杂预览 |
| `wide` | 1200px | 代码与提交详情 |

低于 640px 时统一全屏。不得新增任意 `width`、自定义遮罩、第二套焦点锁或业务滚动容器。

## 遗留迁移

`scripts/ui-legacy-baseline.json` 按文件保存现有违规上限。执行：

```bash
pnpm ui:state-check
```

迁移一个文件后删除或降低其基线数值。禁止为了让新增违规通过而运行基线更新；确需机械重建时，
提交说明必须包含规则总数下降前后对比。
