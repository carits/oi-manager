# 当前任务

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