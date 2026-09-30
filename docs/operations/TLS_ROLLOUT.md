---
status: current
audience: operations
last_verified: 2026-10-01
source_of_truth: deploy/nginx/oi-manager-https.conf.template, scripts/render-tls-config.sh, apps/web/src/middleware.ts
---

# TLS 与严格浏览器安全发布

当前公网域名 `carits.top` / `www.carits.top` 已由 Nginx 提供 HTTPS，HTTP 请求统一 308 跳转到 HTTPS。证书由
Let’s Encrypt 通过 `/var/www/letsencrypt` webroot 签发，Certbot systemd timer 负责周期检查，
`/etc/letsencrypt/renewal-hooks/deploy/oi-manager-nginx-reload.sh` 在证书更新后执行
`nginx -t` 并 reload。本文保留受控切换、验证和回滚流程，供后续域名或证书变更复用。

## 证书续期闭环

在当前服务器上安装或恢复续期机制：

```bash
cd /data/oi-manager-response-refactor
sudo bash scripts/install-tls-renewal.sh
sudo certbot certificates
sudo certbot renew --dry-run
```

脚本只安装 webroot 目录、Certbot deploy hook 和 `certbot.timer`，不会自动签发新域名证书，
也不会把账号、密钥或 webhook 写入仓库。证书实际签发仍须使用受控的 `certbot certonly
--webroot` 流程；更新成功后 deploy hook 会先执行 `nginx -t`，再 reload Nginx。若校验失败，
Nginx 不会被 reload，旧证书继续服务。

## 已有工具

```bash
pnpm tls:verify
```

该命令使用临时自签名证书检查证书 SAN、证书/私钥匹配、至少 30 天剩余有效期、真实 Nginx 语法和错误私钥拒绝。

模板生成命令不会安装配置或 reload Nginx：

```bash
scripts/render-tls-config.sh \
  --domain oj.example.edu.cn \
  --certificate /etc/letsencrypt/live/oj.example.edu.cn/fullchain.pem \
  --private-key /etc/letsencrypt/live/oj.example.edu.cn/privkey.pem \
  --output /tmp/oi-manager-https.conf
```

生成配置包含 HTTP 308 跳转、TLS 1.2/1.3、HSTS、25 MiB 上传上限、Web/API 代理头和 WebSocket upgrade。CSP 由 Web middleware 生成，Nginx 不重复添加 CSP，避免同一响应出现冲突策略。

## CSP 发布阶段

`CSP_MODE` 只有三个有效值：

| 值 | 行为 |
|---|---|
| `off` | 当前默认，不发送 CSP。 |
| `report-only` | 发送 nonce + `strict-dynamic` 的 `Content-Security-Policy-Report-Only`。 |
| `enforce` | 发送同一 nonce 策略的强制 `Content-Security-Policy`。 |

策略的 `script-src` 不包含 `unsafe-inline` 或 `unsafe-eval`。Next.js framework script 必须携带同一个响应 nonce。隔离验证：

```bash
CSP_MODE=report-only pnpm preview:build
# 启动候选后：
CSP_VERIFY_URL=https://oj.example.edu.cn/login pnpm csp:verify
```

只有 report-only 浏览器验收覆盖登录、工作区、题目、比赛、提交、代码高亮、公式、PDF 和下载流程且无阻断项后，才允许重新构建为 `CSP_MODE=enforce`。模式是构建输入，不能仅修改 systemd 环境后复用旧构建。

## 正式切换前置条件

- 域名 A/AAAA 记录已指向当前 ECS，并完成所有权确认。
- 证书与私钥已安装为 root 可读、非公开写入文件。
- 80/443 安全组、主机监听和续期机制已确认。
- 已备份 Nginx 站点和 Server/Web 环境文件。
- Server 候选环境至少设置：

```text
APP_ENV=production
COOKIE_SECURE=true
CSRF_REQUIRE_ORIGIN=true
CORS_ORIGINS=https://oj.example.edu.cn
CSRF_TRUSTED_ORIGINS=https://oj.example.edu.cn
FRONTEND_URL=https://oj.example.edu.cn
```

## 切换顺序

1. 生成到 `/tmp`，人工核对域名、证书路径和 upstream。
2. 将候选复制到 Nginx `sites-available` 的临时文件，执行 `sudo nginx -t`。
3. 先部署 CSP report-only Web 构建和 production Server 候选。
4. 原子替换 Nginx 站点配置并 reload；失败立即恢复备份后再次 `nginx -t`/reload。
5. 验证 HTTP→HTTPS、证书链、Secure Cookie、CORS、CSRF、HSTS、Web/API/WebSocket、上传和下载。
6. 完成浏览器矩阵与 `pnpm csp:verify` 后，单独发布 CSP enforce 构建。
7. 记录证书续期、到期告警、构建 ID、API slot 和回滚结果。

## 验收

```bash
curl -I http://oj.example.edu.cn/login
curl -I https://oj.example.edu.cn/login
CSP_VERIFY_URL=https://oj.example.edu.cn/login pnpm csp:verify
pnpm security:audit
pnpm runtime:audit
```

浏览器还必须确认登录 Cookie 具有 `Secure`、状态修改请求的 Origin 校验生效、页面无 CSP error、HTTP 入口无法继续建立明文会话。真实完成证据写回 `STATUS.md`、`CHANGELOG.md` 和外部依赖清单。
