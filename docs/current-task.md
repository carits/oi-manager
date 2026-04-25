# 当前任务

## 任务：代码质量修复 + Prisma 迁移基线（2026-04-25）

状态: **已完成** ✅

### 背景

处理优先级列表中的多项代码质量改进任务。

### 完成内容

1. **文件 API 权限检查** ✅
   - 上传/删除/by-owner 接口添加权限校验
   - 基于 ownerType/ownerId 检查操作权限

2. **附件删除改为软删除** ✅
   - 使用 `fileService.softDelete(fileId)` 替代物理删除

3. **提交评测改为非阻塞** ✅
   - `dispatchJudgeTask` 使用 `.catch()` 模式，立即返回

4. **评测 worker 并发控制** ✅
   - 引入 `p-queue` 限制并发评测任务数

5. **废弃 API 路由清理** ✅
   - 删除 `/api/class-groups/` 和 `/api/exams/`

6. **Next 14 route handler params 类型** ✅
   - 验证已正确，无需修改

7. **Prisma 迁移基线** ✅
   - 创建并应用空迁移 `20260425_baseline_init`
   - 后续 schema 变更可通过 `prisma migrate dev` 管理

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/src/routes/files.ts` | 添加权限检查函数 |
| `apps/server/src/lib/storage.ts` | 完善权限逻辑 |
| `apps/server/src/modules/problem/problem.routes.ts` | 附件删除改用 softDelete |
| `apps/server/src/routes/submit.ts` | 非阻塞评测 |
| `apps/server/src/modules/training/training.routes.ts` | 非阻塞评测 |
| `apps/judge/src/client.ts` | p-queue 并发控制 |
| `apps/web/src/app/api/class-groups/` | 删除 |
| `apps/web/src/app/api/exams/` | 删除 |
| `apps/server/prisma/migrations/20260425_baseline_init/` | 新增 |

---

## 任务：页面加载状态问题修复（2026-04-25）

状态: **已完成** ✅

### 背景

用户反馈：页面经常显示"加载中"或一直卡在加载中，无法正常访问。

**问题根因**：layout 文件中 `if (loading || !user)` 逻辑错误。当 API 请求失败时，`loading` 变为 `false` 但 `user` 为 `null`，导致页面永久卡在"加载中"状态。

### 解决方案

1. **修复 4 个 layout 文件**：将 `loading || !user` 改为分状态处理
   - `loading=true` → 显示"加载中"
   - `loading=false && user=null` → useEffect 跳转登录页
   - `loading=false && user 存在` → 渲染页面
2. **apiClient 添加 10 秒超时**：使用 AbortController，超时返回错误而非无限等待
3. **AuthProvider 已验证正确**：finally 确保 loading=false
4. **ENV 配置已验证正确**：空字符串走 Next.js API Route 代理

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/app/teacher/layout.tsx` | 修复 auth state judgment（上一轮已完成） |
| `apps/web/src/app/student/layout.tsx` | 修复 auth state judgment |
| `apps/web/src/app/admin/layout.tsx` | 修复 auth state judgment |
| `apps/web/src/app/platform-admin/layout.tsx` | 修复 auth state judgment |
| `apps/web/src/lib/apiClient.ts` | 添加 10 秒 AbortController timeout |

### 验证清单

- [x] 登录后正常访问各角色首页
- [x] API 请求失败 → 自动跳转登录页而非卡住
- [x] 网络慢请求 → 10 秒后显示超时错误
- [x] Token 过期 → 跳转登录页而非卡住

---

## 任务：训练删除按钮（2026-04-25）

状态: **已完成** ✅

### 背景

用户需要在训练详情页的编辑按钮旁边添加删除按钮。后端 DELETE API 已存在，只需前端添加按钮和交互逻辑。

### 解决方案

1. 在编辑按钮旁边添加红色"删除"按钮（仅管理员可见）
2. 使用 ConfirmModal 确认删除，提示会保留评测记录
3. 调用已有的 `DELETE /api/trainings/:id` API
4. 删除成功后跳转回训练列表

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 添加删除按钮 + ConfirmModal + handleDelete |

### 关键约束

- **不删除提交记录**：Submission 模型无 Training 外键，不受级联影响
- **级联删除**：TrainingProblem、TrainingAttachment、TrainingSolution、TrainingParticipant 会被自动删除
- **权限**：创建者、团队 owner、super_admin 可删除（后端已有校验）

---

## 任务：训练模块增强（2026-04-24）

状态: **已完成** ✅

### 背景

用户需要在团队训练模块的创建和编辑功能中添加以下选项：
1. **题号显示**：控制来源平台题号何时对成员可见（始终显示 / 赛后才显示）
2. **题解显示**：控制题解何时对成员可见（始终显示 / 赛后才显示）
3. **管理员排名**：控制团队管理员是否出现在排名中

### 解决方案

1. **数据库模型**：Training 模型新增 `problemIdVisible`, `solutionVisible`, `includeAdminInRanking` 三个布尔字段
2. **后端 API**：创建/更新训练接收新字段，排名/题目列表/题解 API 根据设置过滤数据
3. **前端表单**：TrainingFormModal 添加三个控件
4. **前端显示**：TrainingDetailPage 实现可见性逻辑

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/server/prisma/schema.prisma` | 添加三个新字段 |
| `apps/server/src/modules/training/training.routes.ts` | 修改创建/更新/排名/题解/题目列表 API |
| `apps/web/src/components/training/TrainingFormModal.tsx` | 添加三个表单字段 |
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 题号/题解显示逻辑 |

### 验证清单

- [x] 创建训练时可设置题号显示、题解显示、管理员排名
- [x] 编辑训练时可修改这三个选项
- [x] 题号"赛后显示"时，训练进行中隐藏原题号
- [x] 题号"始终显示"时，训练进行中可查看原题号
- [x] 题解"赛后显示"时，训练进行中不显示题解
- [x] 题解"始终显示"时，训练进行中可查看题解
- [x] 管理员排名关闭时，owner/admin 不在排名中
- [x] 管理员排名开启时，owner/admin 在排名中
- [x] 更新 docs/current-task.md 和 docs/change-log.md

---

## 任务：训练排名当前用户高亮（2026-04-24）

状态: **已完成** ✅

### 背景

用户反馈："请你对训练 排名做出重新铺垫一下 要求一眼能看出自己的排名 目前完全不能一眼看出当前账号排名"

### 问题分析

训练详情页的排名表格中，所有行的样式相同，用户无法快速定位自己在排名中的位置。

### 解决方案

1. **顶部排名信息卡片**：在排名表格上方显示"您的排名：第 X 名 / 共 N 人"，以及总分/通过数
2. **当前用户行高亮**：当前用户所在行使用浅蓝色背景（`var(--info-light)`）

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/training/TrainingDetailPage.tsx` | 导入 useAuth、添加排名信息卡片、高亮当前用户行 |

### 实现细节

1. 导入 `useAuth` 获取当前用户 `user.userId`
2. 在排名表格上方添加 IIFE 计算并显示排名信息卡片（仅当用户在排名中时显示）
3. 在表格行渲染中判断 `row.userId === user?.userId`，高亮当前用户行

### 验证

- 成员端登录后查看训练排名，能看到自己的排名信息卡片
- 当前用户行有明显浅蓝色高亮背景
- 管理员端查看排名不受影响（管理员不在排名中，不显示排名信息）
- IOI/ICPC 赛制显示正确信息（总分/通过数+罚时）

---

## 任务：MLE 检测修复（2026-04-23）

状态: **已完成** ✅

### 背景

ICPC 赛制大规模测试需要覆盖 8 种评测结果（AC/WA/TLE/MLE/RE/CE/PE/OLE），MLE 无法正确检测。

### 问题分析

**症状**：MLE 代码提交后返回 "Runtime Error" 而非 "Memory Limit Exceeded"

**根本原因**：go-judge 返回 `status: "Nonzero Exit Status"` 且 `memory` 值很低（~688KB），因为内存分配在 `new` 语句时就失败了，实际并未分配大量内存。

**关键发现**：程序抛出 `std::bad_alloc` 异常时会写入 stderr，包含 `terminate called after throwing an instance of 'std::bad_alloc'` 信息。

### 解决方案

添加 stderr-based 内存分配错误检测：

```typescript
// apps/judge/src/sandbox/client.ts 第 300-312 行
const isMemoryAllocationError = (stderr && (
  stderr.includes('bad_alloc') ||
  stderr.includes('std::bad_alloc') ||
  stderr.includes('memory allocation failed') ||
  stderr.includes('Cannot allocate memory') ||
  stderr.includes('Out of memory')
)) || false

// 在 Nonzero Exit Status 处理中：
if (memory >= memoryLimit * 0.9 || isMemoryAllocationError) {
  status = 'Memory Limit Exceeded'
  memory = memoryLimit
}
```

### 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/judge/src/sandbox/client.ts` | 添加 stderr-based 内存分配错误检测 |

### 验证

- Submission ID=2073 正确返回 `result: 'mle'`
- `memoryUsed: 262144` (设置为内存限制值)
- go-judge 日志显示 `isMemoryAllocationError: true`

### 结论

MLE 检测通过 stderr 信号成功实现，无需 cgroup 支持。

---

## 任务：OLE/PE 检测研究（2026-04-23）

状态: **已完成** ✅

### OLE 检测

go-judge 的 `outputLimit` 参数在 `copyOut` 模式下不自动触发 OLE。已添加手动检测：

```typescript
if (status === 'Accepted' && stdout && stdout.length > outputLimit) {
  status = 'Output Limit Exceeded'
}
```

### PE 检测

默认 checker（字符串比较）不检测格式错误（多余空格/换行）。需要 testlib checker：
- Hydro 使用 testlib checker
- 当前 oi-manager 使用 default/strict checker，不区分 PE 和 WA
- PE 检测超出当前 scope，暂不支持

---

## 任务：Carits 训练提交 ojRemoteId 缺失修复（2026-04-23）

状态: **已完成** ✅

### 问题

通过训练提交 API 提交的 Carits 题目，提交详情弹窗不显示远程 ID（ojRemoteId 为 null）。

### 修改

- `apps/server/src/modules/training/training.routes.ts` — Carits 训练提交后设置 ojRemoteId
- `apps/server/scripts/fix-carits-oj-remote-id.ts` — 数据修复脚本

### 验证

- 15 条历史记录已修复 ojRemoteId
- 后续新提交自动设置 ojRemoteId

---

## 任务：ICPC 排名全零修复（2026-04-23）

状态: **已完成** ✅

### 问题

ICPC 排名 API 返回所有学生的 solved 和 penalty 均为 0。

### 修改

- 排名代码用 `p.Problem.problemId` 匹配 Submission
- Admin 过滤通过 Teacher/Student 表转换 ID

### 验证

- Training ID=4 ICPC 模拟赛排名正确，11 名学生按解题数/罚时排序

---

## 任务：ICPC 大规模 API 测试验证（2026-04-23）

状态: **已完成** ✅

### 测试目标

通过 API 提交验证 ICPC 赛制排名功能，覆盖所有评测结果类型。

### 结果类型覆盖

数据库统计（共 1324 条提交）：

| 结果类型 | 数量 | 状态 |
|---------|------|------|
| AC (accepted) | 571 | ✅ |
| WA | 446 | ✅ |
| CE | 164 | ✅ |
| RE | 75 | ✅ |
| TLE | 66 | ✅ |
| OLE | 1 | ✅ |
| MLE | 1 | ✅ |
| PE | 0 | ⚠️ 暂不支持（需 testlib checker） |

### 排名验证

Training 4 排名正确，11 名学生按解题数降序排列：

| 排名 | 学生 | 解题数 | 罚时 |
|------|------|--------|------|
| 1 | 李同学 | 10 | 19060 |
| 2 | 王同学 | 10 | 19379 (高罚时) |
| 3 | 测试同学 | 8 | 15334 |
| 4 | 赵同学 | 7 | 13396 |
| 5 | 陈同学 | 7 | 13408 |
| 6 | 刘同学 | 6 | 11454 |
| 7 | 周同学 | 5 | 9551 |
| 8 | 吴同学 | 4 | 7663 |
| 9 | 郑同学 | 2 | 3770 |
| 10 | 钱同学 | 1 | 1837 |
| 11 | 孙同学 | 1 | 1839 |

### 测试脚本

`apps/server/scripts/icpc-full-test.ts` — 通过 API 提交覆盖各结果类型

### 结论

- 7/8 种结果类型验证成功（PE 暂不支持）
- 排名功能正确：AC 数降序 → 罚时升序
- 教师过滤正确：owner/admin 不在排名中