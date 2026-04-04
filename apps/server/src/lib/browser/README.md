# 浏览器自动化基础设施 (Browser Automation Infrastructure)

> Playwright + rebrowser-patches + Stealth + 住宅代理

## 架构概述

```
┌──────────────────────────────────────────────────────┐
│                   OJ Adapter 层                       │
│  (QojAdapter, 未来的 NewAdapter...)                   │
│          │                                            │
│          ▼                                            │
│  ┌──────────────────┐                                │
│  │  BrowserManager  │  ← 浏览器实例池（单例）          │
│  │   (manager.ts)   │                                │
│  └──────┬───────────┘                                │
│         │                                             │
│    ┌────┼────┬────────────┐                          │
│    ▼    ▼    ▼            ▼                          │
│ Stealth Proxy Session  Context/Page                  │
│ (stealth) (proxy) (session)                          │
└──────────────────────────────────────────────────────┘
```

### 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| **types.ts** | 类型定义 | ProxyConfig, BrowserSessionOptions 等公共类型 |
| **proxy.ts** | 代理管理 | 从环境变量加载代理列表，轮询/随机选择，失败标记 |
| **stealth.ts** | 反检测 | rebrowser-patches + 手动 stealth 脚本 |
| **manager.ts** | 浏览器管理 | Chromium 实例池，context/page 生命周期 |
| **session.ts** | 会话管理 | Cookie 持久化（文件系统） |

---

## 快速开始

### 1. 在新 OJ Adapter 中使用

```typescript
import { browserManager } from '../lib/browser/manager'
import { OjAdapter, OjProblem } from './types'

export class MyAdapter implements OjAdapter {
  async fetch(problemId: string): Promise<OjProblem> {
    return browserManager.withPage(
      { stealth: true },  // 自动启用反检测
      async (page) => {
        await page.goto(`https://example.com/problem/${problemId}`)
        const title = await page.locator('h1').first().innerText()
        const html = await page.content()
        return { title, description: html, /* ... */ }
      }
    )
  }
}
```

### 2. 环境变量配置

```bash
# .env 文件

# 代理配置（可选）
BROWSER_PROXY=socks5://user:pass@host:port
# 或多个代理
BROWSER_PROXY_LIST=socks5://u1:p1@h1:p1,http://u2:p2@h2:p2
```

### 3. 安装依赖

```bash
cd apps/server
pnpm install
npx playwright install chromium
```

---

## 配置说明

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `BROWSER_PROXY` | 单个代理 | `socks5://user:pass@host:port` |
| `BROWSER_PROXY_LIST` | 多个代理（逗号分隔） | `socks5://u:p@h:p,http://u:p@h:p` |

### BrowserSessionOptions

```typescript
{
  proxy?: ProxyConfig        // 代理配置
  stealth?: boolean          // 是否启用反检测（默认 true）
  userAgent?: string         // 自定义 UA（默认随机真实 UA）
  viewport?: { width, height } // 视口（默认 1400x1000）
  locale?: string            // 语言（默认 zh-CN）
  timezoneId?: string        // 时区（默认 Asia/Shanghai）
  sessionId?: string         // 会话 ID（用于 Cookie 持久化）
  headless?: boolean         // 是否无头（默认 true）
  timeout?: number           // 超时毫秒（默认 60000）
}
```

---

## Stealth 原理

### rebrowser-patches 做了什么

`rebrowser-playwright-core` 是 `playwright-core` 的 drop-in replacement，在底层修补了：
- **Runtime.enable 泄露**：Playwright 通过 CDP 的 `Runtime.enable` 注入脚本，某些网站通过检测此协议判断自动化。rebrowser-patches 修补了这一泄露。
- **Target 自动化标识**：修补了 CDP Target 的自动化标记。

### 手动 stealth 脚本覆盖了哪些检测

| 检测项 | 处理方式 |
|--------|---------|
| `navigator.webdriver` | 覆盖为 `false` |
| `chrome.runtime` | 注入空对象（headless 默认不存在） |
| Permissions API | 覆盖 notifications 权限查询 |
| `navigator.plugins` | 伪造 Chrome PDF 等插件 |
| WebGL vendor/renderer | 伪造 NVIDIA 指纹 |
| `navigator.languages` | 强制返回 `['zh-CN', 'zh', 'en-US', 'en']` |
| Function.toString | 对覆盖函数打 `native code` 补丁 |

---

## 代理最佳实践

### 住宅代理 vs 数据中心代理

| 类型 | 适用场景 | 成本 |
|------|---------|------|
| 住宅代理 | 需要绕过 IP 封锁、地理限制 | 高 |
| 数据中心代理 | 只需换 IP、低频请求 | 低 |
| SOCKS5 | 通用场景 | 中 |

### 轮换策略

- **轮询（默认）**：`proxyManager.getNext()` — 按顺序使用
- **随机**：`proxyManager.getRandom()` — 随机选择
- **失败剔除**：连续失败 > 3 次自动跳过，全部失败时重置

### 推荐

高频拉取建议使用住宅代理轮换 + 合理限流（每请求 2-3 秒间隔）。

---

## 调试指南

### 1. 有头模式调试

```typescript
await browserManager.withPage(
  { stealth: true, headless: false },  // 显示浏览器窗口
  async (page) => {
    await page.goto('https://example.com')
    // 在浏览器中可以看到实际渲染效果
  }
)
```

### 2. 截图

```typescript
await page.screenshot({ path: 'debug.png', fullPage: true })
```

### 3. 录制 Trace

```typescript
await context.tracing.start({ screenshots: true, snapshots: true })
// ... 操作 ...
await context.tracing.stop({ path: 'trace.zip' })
// 然后用 npx playwright show-trace trace.zip 查看
```

### 4. 检测效果验证

访问以下测试网站验证 stealth 效果：
- https://bot.sannysoft.com/ — 综合检测
- https://abrahamjuliot.github.io/creepjs/ — 深度指纹检测
- https://pixelscan.net/ — 指纹一致性检测

---

## 会话管理

### Cookie 持久化

适用于需要登录态的平台（如洛谷、Codeforces 提交）：

```typescript
// 第一次：登录并保存 session
await browserManager.withPage(
  { sessionId: 'luogu-session', stealth: true },
  async (page) => {
    await page.goto('https://www.luogu.com.cn/login')
    await page.fill('#username', 'user')
    await page.fill('#password', 'pass')
    await page.click('button[type=submit]')
    await page.waitForNavigation()
    // cookies 自动保存到 data/sessions/luogu-session.json
  }
)

// 后续：自动加载 cookies
await browserManager.withPage(
  { sessionId: 'luogu-session', stealth: true },
  async (page) => {
    await page.goto('https://www.luogu.com.cn/problem/P1001')
    // 已登录状态
  }
)
```

### 过期清理

会话文件超过 7 天自动过期（调用 `sessionManager.clearExpired()`）。

---

## 已知限制

1. **reCAPTCHA/hCaptcha**：stealth 无法自动解决验证码，需要手动处理或使用打码服务
2. **深层指纹检测**：CreepJS 等深度检测仍可能发现部分不一致
3. **浏览器指纹一致性**：WebGL、Canvas 指纹每次启动可能不同
4. **内存占用**：Chromium 实例约 100-200MB，长时间运行需关注内存
5. **Headless vs Headful**：某些检测（如 `navigator.plugins` 在 headless 模式下可能不同）

---

## 文件清单

```
apps/server/src/lib/browser/
├── types.ts      # 公共类型定义
├── proxy.ts      # 代理管理器（ProxyManager）
├── stealth.ts    # Stealth 反检测配置
├── manager.ts    # 浏览器管理器（BrowserManager）
├── session.ts    # 会话管理器（SessionManager）
└── README.md     # 本文档
```

---

## 后续扩展方向

- [ ] Canvas/Audio 指纹随机化
- [ ] 代理健康检查（定期 ping）
- [ ] 浏览器指纹一致性（固定 seed）
- [ ] 分布式浏览器池（多机器部署）
- [ ] 验证码自动处理集成
- [ ] 洛谷/CF 提交功能
