---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/architecture/modules/PROBLEMS_AND_OJ.md
---

> 历史文档：本文件保留原始研究记录，不代表当前系统行为。当前说明见 [PROBLEMS_AND_OJ.md](../../../architecture/modules/PROBLEMS_AND_OJ.md)。

# OJ 提交代理 (VJudge Submit)

> 最后更新: 2026-04-10

本目录记录各 OJ 平台的代码提交（VJudge 代理提交）实现文档。

## 目录

- [HDU 提交](./hdu.md) — acm.hdu.edu.cn

---

## 通用流程

```
用户在前端点击"提交" → 选择提交方式 → 后端代理提交到目标 OJ → 轮询结果 → 返回评测状态
```

### 提交方式

| 方式 | 说明 | 账号来源 |
|------|------|----------|
| 机器人账号 | 使用平台公共账号池（OjAccount）自动提交 | `oj_accounts` 表，`platform` 匹配 |
| 我的账号 | 用户自己在目标 OJ 的账号 | 用户自行绑定（暂未实现） |
| 归档 | 提交后仅记录，不实际发送到 OJ | 无需账号 |

---

## 账号池管理设计

### 数据模型

`OjAccount` 模型包含以下字段组：

#### 1. 基础字段

| 字段 | 说明 |
|------|------|
| `platform` | OJ 平台标识（hdu, codeforces, luogu 等） |
| `username` | 平台用户名 |
| `password` | 平台密码（AES-256-CBC 加密） |
| `passwordIV` | AES IV |
| `cookie` | 当前有效 Cookie（系统维护） |
| `cookieRaw` | 用户手动粘贴的原始 Cookie |
| `status` | 账号状态：active / expired / error / unverified |

#### 2. 状态跟踪字段（运行时状态）

| 字段 | 说明 |
|------|------|
| `lastLoginAt` | 最后成功登录时间 |
| `lastLoginFailureAt` | 最后登录失败时间 |
| `lastSubmitAt` | 最后提交时间 |
| `lastRateLimitAt` | 最后触发限流时间（403/429） |
| `consecutiveFailures` | 连续失败次数 |
| `rateLimitCount` | 当前限流计数 |

#### 3. 累计统计（只增不减）

| 字段 | 说明 |
|------|------|
| `totalSubmissions` | 累计提交次数（含重试） |
| `totalSubmissionErrors` | 累计提交失败次数（含重试） |

> ⚠️ 累计统计字段**永不重置**，只能递增。用于分析账号健康度和平台稳定性。

#### 4. 提交控制配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 是否启用 |
| `priority` | `0` | 优先级，越大越优先 |
| `maxConsecutiveFailures` | `3` | 最大连续失败次数 |
| `freezeDurationMinutes` | `30` | 异常后冻结时间（分钟） |
| `submitMaxRetries` | `1` | 提交失败最大重试次数 |
| `retryIntervalSeconds` | `10` | 重试间隔（秒） |
| `minSubmitIntervalSeconds` | `30` | 最小提交间隔（秒） |
| `minRequestIntervalSeconds` | `3` | 最小请求间隔（秒） |
| `maxConcurrentSubmissions` | `1` | 单账号最大并发提交数 |
| `maxConcurrentRequests` | `2` | 单账号最大并发请求数 |

#### 5. 登录控制配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `loginFailureCooldownMinutes` | `15` | 登录失败冷却时间（分钟） |
| `cookieValidMinutes` | `3600` | Cookie 预期有效期（分钟） |
| `renewLoginThresholdMinutes` | `10` | 提前续登阈值（分钟） |
| `reverifyIntervalMinutes` | `30` | 重新验证时间间隔（分钟） |
| `autoVerifyIntervalMinutes` | `1440` | 自动验证时间（分钟，默认 1 天） |

#### 6. 轮询配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `firstPollDelaySeconds` | `5` | 首次查询延迟（秒） |
| `pollIntervalSeconds` | `5` | 轮询间隔（秒） |
| `maxWaitDurationMinutes` | `10` | 最长等待时长（分钟） |

#### 7. 限流控制配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `rateLimitThreshold` | `2` | 403/429 连续阈值 |
| `banSuspicionCooldownHours` | `6` | 封禁怀疑冷却时间（小时） |

---

## 登录控制逻辑（通用）

### Cookie 复用策略

**核心原则**：优先复用现有 Cookie，避免频繁登录。

```
提交请求
    │
    ▼
检查账号可用性 ──────→ 不可用 ──→ 返回错误
    │
    ▼ 可用
检查提交间隔 ──────→ 间隔不足 ──→ 返回等待时间
    │
    ▼ 可提交
判断是否需要重新登录
    │
    ├─ 有 Cookie 且未快过期 ──→ 使用现有 Cookie 提交
    │
    └─ 无 Cookie 或快过期 ──→ 重新登录 ──→ 保存新 Cookie ──→ 提交
```

### 续登阈值计算

```
需要续登 = 距上次登录时间 >= (Cookie有效期 - 提前续登阈值)

例如：
- Cookie 有效期：3600 分钟（60 小时）
- 提前续登阈值：10 分钟
- 则登录后 3590 分钟（约 59.8 小时）才需要续登
```

### 失败冷却机制

```
登录失败 ──→ 记录 lastLoginFailureAt
              │
              ▼
          冷却期内拒绝使用该账号
              │
              ▼ 冷却结束
          允许再次尝试登录
```

### 账号冻结机制

```
连续失败次数 >= maxConsecutiveFailures
    │
    ▼
账号状态 → error（冻结）
    │
    ▼ 需要人工介入或自动恢复
重置 consecutiveFailures → 恢复 active
```

---

## 新增平台提交流程

为每个新平台创建文档，记录：

1. **提交接口** — URL、Method、参数格式
2. **认证方式** — Cookie / Token / Session
3. **登录控制** — Cookie 有效期、是否需要每次重新登录
4. **语言代码映射** — 平台语言 ID → 系统语言标识
5. **提交结果轮询** — 如何获取评测结果
6. **注意事项** — 特殊处理、已知问题

### 实现检查清单

- [ ] 实现登录函数（返回 Cookie）
- [ ] 实现提交函数（携带 Cookie，处理重定向）
- [ ] 实现轮询函数（解析评测结果）
- [ ] 添加语言映射
- [ ] 处理平台特定错误（验证码、限流等）
- [ ] 登录成功后保存 Cookie 到数据库
- [ ] 更新提交统计（totalSubmissions, totalSubmissionErrors）
