# 当前任务

## 状态: 已完成

## 当前任务：QOJ PDF 下载方案实现（2026-04-03）

### 问题
QOJ `download.php` 端点受 Cloudflare JS Challenge 保护，之前四级下载策略全部失败。

### 解决方案
使用 **headed 模式** 浏览器 + 独立浏览器实例 + `download.php?type=statement&id={题目编号}` 直接下载 PDF。

### 关键发现
- `download.php?type=statement&id={题目编号}` 中的 id 就是题目编号，不需要额外映射
- CF challenge 在 headed 模式下约 3 秒自动通过
- headless 模式被 CF 严格检测，无法通过 challenge
- 不能经过 browserManager 的 stealth 注入（会被 CF 检测），需要独立裸浏览器实例
- 需要配置 `QOJ_SESSION`（UOJSESSID cookie 值）

### 修改文件
| 文件 | 说明 |
|------|------|
| `apps/server/src/oj-adapters/qoj.ts` | headed 模式 + 独立浏览器实例下载 PDF + CF 等待 + `QOJ_SESSION` 配置 |
| `apps/server/src/lib/browser/manager.ts` | 支持 headed/headless 双浏览器实例管理 |
| `apps/server/.env` | 新增 `QOJ_SESSION` 环境变量 |

### 测试结果
| 题目 | 类型 | 结果 |
|------|------|------|
| QOJ 76 | PDF | ✅ 98818 bytes → 本地存储 |
| QOJ 60 | HTML | ✅ Markdown 题面正常 |
| QOJ 9741 | PDF | ✅ 97363 bytes → 本地存储 |

### 已知限制
- 需要 headed 模式（服务器需有显示器或 Xvfb 虚拟显示器）
- 需要配置 `QOJ_SESSION` 环境变量
- 每次 PDF 下载启动独立浏览器实例（资源消耗稍大）
