# HDU 提交代理

> 最后更新: 2026-04-10

## 平台信息

- **地址**: `https://acm.hdu.edu.cn`
- **编码**: GB2312
- **认证方式**: Cookie（PHPSESSID）
- **Cookie 有效期**: 约 60 小时（默认配置 `cookieValidMinutes: 3600`）

## 登录控制

### Cookie 复用策略

HDU 的 PHPSESSID 有效期较长（约 60 小时），**不需要每次提交前重新登录**。

**判断是否需要重新登录**：
```typescript
function needRelogin(account): boolean {
  // 没有 cookie，需要登录
  if (!account.cookie) return true

  // 没有登录时间记录，需要登录
  if (!account.lastLoginAt) return true

  // 计算续登时间点：cookie 有效期 - 提前续登阈值
  // 例如：3600分钟 - 10分钟 = 3590分钟后需要续登
  const renewBeforeMinutes = account.cookieValidMinutes - account.renewLoginThresholdMinutes
  const elapsed = Date.now() - account.lastLoginAt.getTime()

  return elapsed >= renewBeforeMinutes * 60 * 1000
}
```

**默认配置**：
- `cookieValidMinutes`: 3600（60 小时）
- `renewLoginThresholdMinutes`: 10 分钟
- 实际续登时机：登录后约 59.8 小时

### 失败冷却

- `loginFailureCooldownMinutes`: 15 分钟
- 登录失败后，账号进入 15 分钟冷却期，期间不接受提交

### 账号冻结

- `maxConsecutiveFailures`: 3 次
- 连续失败 3 次后，账号状态变为 `error`，需要人工介入或自动恢复

---

## 提交接口

### 1. 登录获取 Cookie

```
POST https://acm.hdu.edu.cn/userloginex.php?action=login
Content-Type: application/x-www-form-urlencoded

username={用户名}&userpass={密码}&login=Sign+In
```

**响应**:
- 成功: `302` 重定向，`Set-Cookie` 包含 `PHPSESSID`
- 失败: `200` 返回登录页面

**提取 Cookie**:
```typescript
const setCookies = resp.headers.getSetCookie?.() || []
const cookies = setCookies
  .map(sc => sc.match(/^([^;]+)/)?.[1])
  .filter(Boolean)
const cookie = cookies.join('; ')
```

### 2. 提交代码

```
POST https://acm.hdu.edu.cn/submit.php?action=submit
Content-Type: application/x-www-form-urlencoded
Cookie: {phpsessid}
Referer: https://acm.hdu.edu.cn/submit.php?pid={题号}

problemid={题号}&language={语言代码}&usercode={源代码}
```

**响应**:
- 成功: `302` 重定向到 `status.php`
- 未登录: `302` 重定向到 `userloginex.php`（需重新登录）

### 3. 查询评测结果

```
GET https://acm.hdu.edu.cn/status.php?user={用户名}
Cookie: {phpsessid}
```

**解析**: HTML 页面中匹配评测结果关键词：
- `Accepted` — 通过
- `Wrong Answer` — 答案错误
- `Runtime Error` — 运行错误
- `Time Limit Exceeded` — 超时
- `Memory Limit Exceeded` — 超内存
- `Compilation Error` — 编译错误
- `Presentation Error` — 格式错误
- `Output Limit Exceeded` — 输出超限

## 语言代码映射

| language 值 | 语言 |
|-------------|------|
| `0` | G++ **(默认，推荐用于 C++)** |
| `1` | GCC (C 编译器) |
| `2` | C++ |
| `3` | C |
| `4` | Pascal |
| `5` | Java |
| `6` | C# |

**系统语言 → HDU 映射**:

| 系统标识 | HDU language |
|----------|-------------|
| `c` | `1` (GCC) 或 `3` (C) |
| `cpp` / `c++` | `0` (G++, 推荐) 或 `2` (C++) |
| `java` | `5` |
| `csharp` | `6` |
| `pascal` | `4` |

## 可提交语言

HDU 所有题目共享相同的语言列表（无题目级限制）：

```
['c', 'cpp', 'java', 'csharp', 'pascal']
```

已在 HDU 适配器 (`apps/server/src/lib/hdu-submit.ts`) 中实现语言映射：
- `c` → `1` (GCC)
- `cpp` / `c++` → `0` (G++, 推荐)
- `java` → `5`
- `csharp` / `c#` → `6`
- `pascal` → `4`

## 完整提交流程代码

```typescript
import { decrypt } from '../lib/crypto'
import { prisma } from '../prisma'

/**
 * 提交代码到 HDU（带智能登录控制）
 *
 * 登录策略：
 * 1. 检查账号是否可用（冷却期、冻结）
 * 2. 检查提交间隔
 * 3. 优先使用现有 cookie（如果在续登阈值内）
 * 4. 必要时重新登录
 */
async function submitToHdu(
  account: {
    id: string
    username: string
    password: string
    passwordIV: string
    cookie?: string | null
    lastLoginAt?: Date | null
    lastLoginFailureAt?: Date | null
    lastSubmitAt?: Date | null
    consecutiveFailures?: number
    // 配置参数
    cookieValidMinutes?: number       // 默认 3600
    renewLoginThresholdMinutes?: number  // 默认 10
    loginFailureCooldownMinutes?: number // 默认 15
    minSubmitIntervalSeconds?: number    // 默认 30
    maxConsecutiveFailures?: number      // 默认 3
    submitMaxRetries?: number            // 默认 1
  },
  problemId: string,
  language: string,
  code: string
): Promise<{ success: boolean; ojRemoteId?: string; cookie?: string; message: string }> {

  // Step 1: 检查账号是否可用（冷却期、冻结）
  if (account.lastLoginFailureAt) {
    const cooldownMs = (account.loginFailureCooldownMinutes ?? 15) * 60 * 1000
    const elapsed = Date.now() - new Date(account.lastLoginFailureAt).getTime()
    if (elapsed < cooldownMs) {
      return { success: false, message: `登录冷却中，剩余 ${Math.ceil((cooldownMs - elapsed) / 60000)} 分钟` }
    }
  }

  // Step 2: 检查提交间隔
  if (account.lastSubmitAt) {
    const intervalMs = (account.minSubmitIntervalSeconds ?? 30) * 1000
    const elapsed = Date.now() - new Date(account.lastSubmitAt).getTime()
    if (elapsed < intervalMs) {
      return { success: false, message: `提交间隔不足，请等待 ${Math.ceil((intervalMs - elapsed) / 1000)} 秒` }
    }
  }

  let cookieToUse = account.cookie

  // Step 3: 判断是否需要重新登录
  const shouldRelogin = !account.cookie || !account.lastLoginAt || (
    Date.now() - new Date(account.lastLoginAt).getTime() >=
    ((account.cookieValidMinutes ?? 3600) - (account.renewLoginThresholdMinutes ?? 10)) * 60 * 1000
  )

  if (shouldRelogin) {
    // Step 4: 重新登录
    const plainPassword = decrypt(account.password, account.passwordIV)
    const loginResp = await fetch('https://acm.hdu.edu.cn/userloginex.php?action=login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://acm.hdu.edu.cn/',
      },
      body: `username=${encodeURIComponent(account.username)}&userpass=${encodeURIComponent(plainPassword)}&login=Sign+In`,
      redirect: 'manual',
    })

    const setCookies = loginResp.headers.getSetCookie?.() || []
    const cookies = setCookies.map(sc => sc.match(/^([^;]+)/)?.[1]).filter(Boolean)
    if (cookies.length === 0) {
      return { success: false, message: '登录失败' }
    }

    cookieToUse = cookies.join('; ')

    // Step 5: 保存新 Cookie 到数据库（关键！）
    await prisma.ojAccount.update({
      where: { id: account.id },
      data: {
        cookie: cookieToUse,
        cookieRaw: cookieToUse,
        lastLoginAt: new Date(),
        status: 'active'
      }
    })
  }

  // Step 6: 提交代码
  const params = new URLSearchParams()
  params.append('problemid', problemId)
  params.append('language', language)
  params.append('usercode', code)

  const submitResp = await fetch('https://acm.hdu.edu.cn/submit.php?action=submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieToUse!,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': `https://acm.hdu.edu.cn/submit.php?pid=${problemId}`,
    },
    body: params.toString(),
    redirect: 'manual',
  })

  if (submitResp.status === 302 && submitResp.headers.get('location')?.includes('status')) {
    // 获取远程提交 ID
    const ojRemoteId = await getLatestSubmitId(cookieToUse!, account.username)
    return { success: true, ojRemoteId, cookie: cookieToUse, message: '提交成功' }
  }

  return { success: false, message: `提交失败: HTTP ${submitResp.status}` }
}
```

## 注意事项

1. **Cookie 有效期长** — HDU 的 PHPSESSID 有效期约 60 小时，不需要每次提交前重新登录
2. **登录后保存 Cookie** — 登录成功后必须保存 `cookie` 和 `cookieRaw` 到数据库，否则下次提交会失败
3. **编码 GB2312** — 提交页面和状态页面都使用 GB2312 编码，无需特殊处理（POST 请求体为 UTF-8 可正常提交）
4. **无需 CSRF Token** — HDU 提交表单无 CSRF 保护
5. **限流** — HDU 对高频提交有频率限制，建议配置 `minSubmitIntervalSeconds: 30`
6. **代码长度** — HDU 要求代码长度 > 50 字节，否则提交失败
7. **代码编码** — 代码需要 `encodeURIComponent` + `base64` 编码后放到 `_usercode` 字段
8. **WAF 封禁** — HDU 使用 WAF 保护，短时间大量请求可能导致 IP 被临时封禁（返回 403）

## 常见错误

### HTTP 403 Forbidden

**原因**：IP 被 HDU 的 WAF 临时封禁，通常是因为：
- 短时间内发送了大量请求
- 触发了频率限制

**解决方案**：
1. 等待 10-30 分钟让 IP 自动解封
2. 配置住宅代理绕过 IP 封禁：
   ```
   # .env
   BROWSER_PROXY=socks5://user:pass@host:port
   ```

### 提交后返回登录页

**原因**：Cookie 已过期或无效

**解决方案**：系统会自动重新登录，确保账号密码正确

## 已验证记录

| 日期 | 账号 | 题目 | 结果 | Run ID |
|------|------|------|------|--------|
| 2026-04-10 | carits | HDU 1002 | Accepted | 40832742 |
| 2026-04-10 | carits | HDU 1000 | Accepted | 40832719 |

---

## 代码编码要求

**重要**：HDU 的提交表单使用 JavaScript 对代码进行编码：

```javascript
form._usercode.value = btoa(encodeURIComponent(form.usercode.value));
```

后端需要：
1. 将代码进行 `encodeURIComponent` 编码
2. 再进行 Base64 编码
3. 将编码后的值放到 `_usercode` 字段（不是 `usercode`）

```typescript
const encodedCode = Buffer.from(encodeURIComponent(code)).toString('base64')
params.append('_usercode', encodedCode)
```

**注意**：确保代码中的转义序列（如 C 的 `\n`）在 JavaScript 中正确处理。使用 `String.raw` 模板字符串或确保反斜杠正确转义。
