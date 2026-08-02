---
status: current
audience: development, operations
last_verified: 2026-08-02
source_of_truth: package.json, docker-compose.yml, Prisma schema, Playwright configuration
---

# 当前状态

## 阶段

OI Manager 仍处于开发阶段。公网 `3000` 使用 Next.js 优化构建作为开发预览，内部
`3001` 保留 HMR，`3002` 使用 `tsx watch` 后端。优化构建使用 `NODE_ENV=production`
只为启用 Next 优化，业务环境仍是 `APP_ENV=development`，不代表已经正式上线。

| 服务 | 开发端口 | E2E 端口 | 说明 |
|------|----------|----------|------|
| Web preview / HMR | `3000` / `127.0.0.1:3001` | `3100` | Next.js App Router |
| Server/API | `3002` | `3102` | Express + Prisma |
| PostgreSQL | `5432` | 同实例 `e2e` schema | Docker Compose 基础设施 |
| go-judge | `5050` | `5050` | 评测沙箱 |

## 已实现能力

- 五类角色：超级管理员、平台管理员、学校负责人、教师、学生。
- 学校、用户、教师、学生、团队、邀请、申请和成员管理。
- 平台题库与学校私有题库；学校题按学校隔离并仅向教师和负责人开放。
- 题单、学校/团队题单、作业、比赛、训练、补题和排名。
- 五种角色均可在岗位工作区与统一个人工作区间切换；个人团队、题单、训练、提交、排名
  和缓存按作用域隔离，个人身份只显示用户名。
- 外部 OJ 题目抓取、平台绑定、账号池、提交同步和 AI 翻译。
- Carits 本地提交、评测队列、Judge WebSocket、详情和重新评测。
- 隔离的 PostgreSQL 单元测试与 Playwright 全 UI 测试。

## 最近验证

以下数字是最近一次相关验证快照，不作为永久常量：

- 根构建按 `shared → Prisma Client → server → web → judge` 顺序通过。
- 2026-08-01 本轮通过 SSH 隧道连接隔离 `test` schema。Server Vitest 完整主跑 460/464；
  4 项失败中 2 项为 30 秒远程数据库超时及其事务级联，另 2 项为提交权限与团队训练归属
  契约回归。修复后相关提交/训练测试 46/46、回归测试 11/11 均通过；鉴权 36/36、团队
  19/19、权限 35/35 也通过。
- Prisma Schema 校验、`test` schema 同步及 `e2e` schema 重建/fixture 写入通过。
- 全角色工作区 Chromium 测试 18/18、旧学生模式隔离 11/11、Firefox 工作区与隔离冒烟
  21/21 通过。
- 109 条页面路由在 Chromium `1440×900` 全部通过；`1280×720` 紧凑桌面项目 115/115
  通过。桌面主跑中 2 项旧测试辅助契约失败已单独复跑通过，不属于页面路由失败。
- 根构建、Server/Web TypeScript 检查、Web Vitest 23/23、Judge Vitest 2/2、UI 状态守卫与
  文档检查均通过。
- Codex 内置浏览器使用教师账号实测校园 → 个人 → 校园切换、个人首页、团队和排名；
  `1440×900` 与 `1280×720` 均无横向溢出，个人身份只显示用户名，浏览器无 warning/error。
- 教师与管理员顶栏已增加明确的“工作区切换”标签；管理员管理 → 个人、退出和恢复上次
  工作区均已实测通过，Hook 顺序修复后没有新增浏览器错误。
- 2026-08-01 线上接口隔离矩阵：24/24 断言通过，临时验证数据清理完成。
- UI 套件覆盖 Chromium `1440×900`、Chromium `1280×720`、Firefox 冒烟及
  `1 Mbps`、`5 Mbps` 网络节流。
- 页面清单：109 个 App Router 页面，其中 16 个全角色个人工作区页、3 个共享账号页。
- Prisma Schema：51 个模型。
- HTTP 接口清单：258 个端点；文档检查随本轮新增路由、模型与端点同步。

## 2026-08-02 远端部署快照

- 开发服务器当前运行提交 `6fd4482`，公网优化预览为 `http://47.99.222.76:3000`，API 为 `3002`；
  项目仍处开发阶段，不代表正式投产。
- 数据库迁移 7/7，部署前备份为
  `/data/backups/oi-manager/oi_manager_pre_workspace_20260801_232227.dump`。
- `3200` 候选检查、`3000` 提升后检查、Server/Judge/Web 构建均通过；Judge 已完成令牌认证并注册。
- 本机浏览器通过 SSH 隧道访问远端部署，教师与平台管理员均完成工作区双向切换；个人团队、排名、提交页面完成
  数据/空状态收敛，身份只显示用户名，浏览器控制台无错误。
- 公网 IP 经本机 VPN/系统代理可能出现 `502`；相同请求在服务器本机经 `3000` 与 `3002` 均正常。排障时应先
  关闭代理或使用 SSH 隧道复核，再判断服务端故障。

## 安全边界

- OJ Cookie 配置只允许 `super_admin` 读写，读取结果不返回 Cookie 原文。
- OJ 全局任务允许 `super_admin` 和 `platform_admin` 管理。
- 平台管理员和超级管理员只管理平台题库，不能读取学校题内容。
- 学生不能进入校内题库；学校题及文件只能通过已授权教学活动上下文读取。
- 维护迁移接口只允许 `super_admin`，且 `ENABLE_MAINTENANCE_API` 默认关闭。
- Judge 必须使用与 Server 一致的 `JUDGE_TOKEN`；无令牌模式只允许显式本机测试。
- 正式环境必须设置严格 CORS、独立 JWT/Judge/加密密钥。

## 当前限制

- 当前服务器没有启用正式部署配置。
- 外部 OJ 受登录状态、反爬策略和页面结构变化影响，真实连通性不作为 PR 门禁。
- 浏览器会话使用同域 HttpOnly Cookie；Bearer Token 仅作脚本和旧会话迁移兼容。
- 旧 `studentMode`、`POST /api/auth/switch-mode` 与学生个人 URL 仅保留一个开发周期。
- 跨工作区资源详情返回 `404`；同一校园工作区内已确认存在但权限不足的操作继续返回
  `403`，避免混淆作用域隔离与岗位权限。
- 历史设计和调研仅供追溯，参见 [归档索引](archive/README.md)。
