# 当前任务

## 状态: 已完成

## 当前任务：UOJ + CSES 适配器修复（2026-04-04）

### 目标
修复 UOJ 适配器 timeLimit/memoryLimit 提取失败问题，排查 CSES 适配器拉取失败原因。

### 已完成 ✅

1. **UOJ `extractLimits()` 修复** — `uoj.ts`
   - 原因：UOJ HTML 中时限格式为 `$1\texttt{s}$`，`\texttt{...}` LaTeX 包裹在数字和单位之间
   - 旧正则：`/(?:时间限制)[^\d]*(\d+)\s*(?:s|ms)/i` — `\s*` 无法跳过 `\texttt{` 部分
   - 新正则：`/(?:时间限制)[^\d]*(\d+(?:\.\d+)?)/i` — 只提取数字，假设单位为秒
   - 同理修复 `空间限制` 的内存限制提取

2. **UOJ `\texttt{}` 清理** — `extractDescription()`
   - 在 Markdown 转换前将 `\texttt{xxx}` 替换为 `xxx` 纯文本

3. **CSES 排查结论** — 网络层面问题
   - `cses.fi` (IP: 162.125.32.10 / 108.160.161.83) 从当前网络环境连接超时
   - HTTP 和 HTTPS 均无法访问，IPv4/IPv6 均超时
   - 适配器代码逻辑正确，非代码问题

### 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/oj-adapters/uoj.ts` | extractLimits 正则简化，extractDescription 添加 \texttt 清理 |
| `docs/change-log.md` | 追加记录 |
| `docs/current-task.md` | 更新为当前任务 |

### 验证方式
```bash
# UOJ 验证
curl -s http://localhost:3002/api/oj-fetcher/uoj/1 | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print('timeLimit:', d.get('timeLimit'))    # 应为 1000
print('memoryLimit:', d.get('memoryLimit')) # 应为 256
"

# CSES 因网络问题暂不可测试
```
