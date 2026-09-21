---
status: current
audience: development, ai-agents
last_verified: 2026-09-21
source_of_truth: AGENTS.md, docs/architecture-progress.json, docs/ai-context/modules.json, docs/ai-context/GAPS.md
---

# AI 上下文预算协议

## 目的

本协议用于降低 Codex、ChatGPT 和其他代码代理在 OI Manager 上重复读取历史对话、全仓源码和过期实现所产生的上下文消耗，同时提高结论的时效性。

核心原则：

> 先读稳定规范，再读机器事实，再读“上次已审 commit → 当前 commit”的模块 diff；只有出现明确依赖证据时才扩大读取范围。

本协议不是为了减少必要分析，而是为了避免三类浪费：

1. 已经冻结的产品规则被每次重新讨论；
2. “看看最新的”触发全仓重新扫描；
3. 历史兼容路径已经删除后，代理仍反复读取旧实现和旧对话。

## 上下文四层

### L0：仓库宪章

每个任务始终以 `AGENTS.md` 为最高仓库工作约束。

不要把聊天中的旧结论覆盖到当前仓库事实上。

### L1：领域稳定规范

按任务模块只读取 `docs/ai-context/modules.json` 指定的稳定文档。

例如 Training Engine 默认只需要：

- `docs/architecture/modules/TRAININGS.md`
- 必要时再读取 Schema / Contract / Runtime 相关文档

稳定规范负责回答：

- 这个领域应该是什么；
- 哪些不变量不能破坏；
- 哪些兼容已经明确退役；
- 哪个文档拥有最终解释权。

### L2：当前机器事实

只有任务涉及“当前进度、迁移状态、是否完成、部署状态”时才读取：

- `docs/architecture-progress.json`
- `docs/STATUS.md` 中与当前任务直接相关的最近 rollout
- 当前分支和最新提交

不要为了普通局部 bug 默认读取完整 STATUS、CHANGELOG 或历史归档。

### L3：增量代码事实

默认基于：

```text
last-reviewed commit
        ↓
current HEAD
```

只分析这一段 diff。

命令：

```bash
pnpm ai:context -- --module <module> --base <last-reviewed-sha> --head HEAD
```

如果没有明确的 last-reviewed commit，特性分支默认使用其与 `origin/main` 的 merge-base。

只有以下情况才扩大到完整文件或相邻领域：

- diff 修改了公共 Contract；
- diff 修改 Prisma Schema / migration；
- diff 修改 Auth / Authorization；
- diff 修改跨领域 Application Service；
- diff 修改公共 UI primitive / router；
- 当前 bug 的调用链明确跨出模块；
- diff 无法解释用户看到的行为。

## 默认工作流

### A. 新功能 / 修复

1. 确定模块。
2. 运行 `pnpm ai:context`。
3. 阅读 context pack 列出的稳定规范。
4. 只阅读 changed files 和直接调用链。
5. 实现。
6. 跑风险等级对应的测试。
7. 如果发现新的长期事实，更新领域文档或 Gap List。
8. 在 PR 中记录本次 context base。

### B. “看看最新进度”

禁止默认全仓扫描。

先执行：

```bash
pnpm ai:context -- --module <module> --base <上次审查SHA> --head HEAD
```

回答只需要区分：

- 本次新增完成；
- 本次退化；
- 之前已知且仍存在；
- 没有证据变化。

如果 diff 没触及某项，不重新证明它。

### C. UI 截图反馈

优先读取：

1. 截图对应页面入口；
2. 实际渲染组件；
3. 组件 CSS；
4. 数据 Contract。

不要先读整个 design system、全部路由或历史 UI 讨论。

### D. 架构 / 迁移

先读：

- `AGENTS.md`
- `docs/architecture-progress.json`
- 对应 architecture 文档
- 目标 migration / schema diff

不要从文件数量或旧 STATUS 文字推导架构完成度。

## Context Pack

`scripts/ai-context-pack.mjs` 生成一个面向代理的最小上下文包。

示例：

```bash
pnpm ai:context -- --module training-engine --base aebe16cb --head HEAD
```

输出包含：

- base/head commit；
- 命中的模块；
- 必读稳定规范；
- 当前模块 Gap；
- base→head commit 列表；
- 模块相关 changed files；
- 是否触发 schema/contract/auth 等升级读取；
- 受预算限制的模块 diff；
- 被排除但发生变化的文件数量。

### 自动模块识别

```bash
pnpm ai:context -- --module auto --base origin/main --head HEAD
```

根据 changed paths 从 `docs/ai-context/modules.json` 识别模块。

如果没有命中模块，仍输出 changed files，但不擅自加载所有领域文档。

## 上下文预算

预算不是硬性 token 数，而是“默认读取上限”。

默认规则：

- 稳定规范：每个模块 1–3 个；
- 首轮源码：最多 8 个高相关文件；
- 首轮测试：最多 3 个；
- Diff：只包含命中模块的 changed files，默认最多 1200 行；
- 历史：默认不读 archive；
- STATUS：只在状态问题时读；
- CHANGELOG：只在需要定位 rollout/行为变化时读。

超过预算必须有一个具体理由，例如：

> Contract 的修改导致调用方跨越 training-engine → submission，需要扩大读取。

不能因为“不确定”就退回全仓扫描。

## Gap List

`docs/ai-context/GAPS.md` 是“当前已验证但尚未完成的问题列表”，不是产品 backlog，也不是项目历史。

规则：

- 只记录经过当前代码验证的 Gap；
- 每项标注最后验证 commit；
- 已修复后直接移到该模块的 Recently closed；
- 不复制 STATUS / CHANGELOG；
- 不记录纯聊天想法；
- 不把未经验证的猜测写进去。

它的作用是避免每次重新证明：

```text
这个 bug 上次还存在吗？
这个设计是不是已经做了？
```

## PR 中的上下文记录

PR 必须尽量记录：

```text
Context module:
Context base:
Stable specs read:
Gap IDs closed/added:
Escalation:
```

这样下一次继续开发时，可以直接从上次 base/head 接续，而不是恢复整段对话。

## 何时必须重新全量审查

只有以下情况建议进行完整模块审查：

- 领域模型发生大重构；
- Schema cutover；
- 大规模兼容退役；
- 用户明确要求“完整审计”；
- Gap List 与真实代码明显不一致；
- 长期未审且模块经历大量跨领域提交；
- 发生生产事故，需要重建事实链。

完整审查结束后，应把结论写回稳定规范或 Gap List，以便下一次恢复增量模式。

## 反模式

禁止把以下做法当成默认流程：

```text
每次问“最新怎么样”
→ 重新读 schema
→ 重新读整个 service
→ 重新读所有 UI
→ 重新读全部 tests
→ 重新复述历史方案
```

也禁止：

```text
聊天记忆
→ 当成当前代码事实
```

正确流程是：

```text
稳定规范
+
last-reviewed SHA
+
module diff
+
current Gap List
=
本轮最小充分上下文
```

## 与现有仓库规则的关系

本协议不替代：

- `AGENTS.md` 风险分级；
- `docs/development/WORKFLOW.md`；
- `pnpm architecture:progress`；
- `pnpm architecture:check`；
- `pnpm docs:check`；
- 领域测试与 E2E。

它只规定：

> 在执行这些既有工程流程之前，AI 应怎样选择最小且最新的上下文。
