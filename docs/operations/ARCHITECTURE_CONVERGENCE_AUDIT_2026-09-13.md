---
status: current
audience: development, operations
last_verified: 2026-09-13
source_of_truth: remote main, production runtime, Prisma baselines/current.json, generated architecture inventory, STATUS.md
---

# 架构收口逐项复核（2026-09-13）

本文逐项复核最初架构审计列出的明确问题和十项重构，不把已经解决的历史问题继续算作当前缺陷，也不把缺少外部资源的事项伪装成完成。

## 结论

- Human UX / Productization 十项体验整改已经实现、测试并发布；Assignment、Blog、统一提交编辑器、Rating、比赛向导和题解相似度不再属于功能缺口。
- 仓库内 P0/P1 收口已完成：Health Contract、3000 loopback、组织授权规范化、Contest 规范聚合、Runtime Composition Root、Canonical OJ Registry 和 Database Baseline 都有门禁与生产证据。
- 当前剩余工作分为两类：不影响业务正确性的渐进维护债，以及必须由所有者提供域名/证书、告警接收端和异机存储目标才能完成的外部验收。

## 原始问题逐项状态

| 原始事项 | 当前状态 | 代码与生产证据 | 后续退出条件 |
|---|---|---|---|
| 公网 HTTPS / TLS | 外部资源待完成 | TLS 模板、证书校验、严格 CSRF、nonce CSP 与发布检查已经入库；公网仍为 HTTP 兼容模式 | 提供域名、DNS 控制权和证书签发许可后执行 report-only → enforce、Secure Cookie、HSTS 和浏览器回归 |
| External Uptime Health Contract | 已完成 | `/api/health` 返回版本化 `status=ok/service=api`；Workflow 使用结构化 JSON 校验；生产公网探针正常 | 保持 Contracts、Server、发布探针和外部 Workflow 共用同一 Schema |
| Web 3000 公网入口 | 已完成 | systemd 只监听 `127.0.0.1:3000`，网络暴露审计为 0；公网只经 Nginx | TLS 到位后 80 仅跳转 443 |
| Organization hybrid 权限 | 已完成 | 20,186 条 Membership 已规范化，缺失 0；hybrid 开关已移除；组织成员 HTTP 路由和业务数据范围均只读 RoleAssignment/CapabilityGrant，写路径同步基础角色，静态门禁拒绝 `actor.role` 回退 | `memberRole` 继续仅承担资料类型/岗位展示；新增权限必须定义 Capability，不增加岗位硬编码授权 |
| Account/Membership/Workspace 类型 | 已完成核心契约 | `packages/contracts/src/identity.ts` 分离三类身份，登录输出固定 `accountRole`，Web 工作区保存 `organizationRole` | JWT 和旧客户端的 `role/studentMode/schoolId` 仅按兼容窗口渐退，不作为新 API 设计依据 |
| API Contract 漂移 | 核心契约完成，领域渐进迁移 | Auth、Health、Identity 与 HTTP Envelope 使用 Zod + TS 单一来源；已删除 Shared 中重复的 Login/API Response 和 Server 中无人引用的浏览器 API Client，门禁阻止回退 | 新增/修改 Endpoint 必须先进入 Contracts；既有 619 个 Endpoint 按业务变更渐进迁移，不进行高风险一次性重写 |
| Contest 双事实源 | 已完成规范读写切换 | 767/767 运行比赛、199/199 比赛题映射；查询、命令、生命周期、题目、Rating 与终结均从 Contest 进入，裸 Training 缺映射 fail closed，生产 fallback 0 | `Training(type=contest)` 暂为历史提交/参与者等子表宿主和同事务投影；只有全部外键迁出后才能物理退役，不以删表作为当前正确性条件 |
| Database clean bootstrap | 已完成 | 当前 Epoch `20260913_v2_lf`；Linux 门禁、空库安装/Seed/非空拒绝通过；空库与最新生产备份恢复升级均为 202 张表且 schema SHA-256 同为 `de803187…bb87` | 后续变更只能追加 migration；新 Epoch 必须重新完成双路径结构对账 |
| Route Boundary baseline | 已完成 | 78 个 HTTP adapter 的 Prisma、Transaction、Filesystem、Judge Runtime 直接依赖均为 0；减少债务未更新基线也会失败 | Adapter 可按流量和领域迁移逐步删除，不能重新放入业务逻辑 |
| 25 个 legacy route adapter | 受控兼容 | 当前 route 文件均为薄 HTTP adapter，业务逻辑已迁入 module/application；边界门禁为零 | 使用遥测证明旧 URL 无调用且替代 API 稳定后逐个返回 410/删除；不为减少文件数破坏旧客户端 |
| Runtime Composition Root | 已完成 | 生产与集成测试共用 `createApplication()`；Socket、监听和关闭由 `startServerRuntime()` 管理；架构门禁阻止影子路由图 | 保持入口只做配置与启动 |
| Health / Readiness 分层 | 已完成 | Health 只做 liveness，Readiness 只检查数据库关键依赖；领域一致性由受保护诊断和周期监控承担 | 不把 Problem/Judge 业务样本重新塞回公开 readiness |
| Canonical OJ Registry | 已完成 | Shared 唯一注册表驱动 Server adapter 与 Web 展示/链接，历史别名只在边界规范化 | 新平台先登记 canonical key 和能力，再实现 adapter |
| API Organization Context | 安全边界完成，调用端渐进显式化 | 账号、平台和组织 Client 已分离；Chat/Auth 等账号级请求不会继承组织头；Server 始终重新校验显式 Organization ID | 默认 legacy URL client 仅服务尚未迁移页面，新页面必须显式选用 Client；渐进迁移不改变现有 URL 行为 |
| 前端大型组件 | 产品功能完成，P2 可维护性债 | Human UX 页面与统一组件已发布，静态 UI 债基线为 0；`TrainingSessionDesigner`、`JudgeSettingsTab` 等仍较大 | 只在对应业务继续变更时按 Feature Slice 拆分，不为行数进行无行为收益的全站重写 |
| CSS 迁移痕迹 | 视觉契约完成，语义命名渐进清理 | 静态 inline style、原生控件和第二套 Dialog 基线为 0；引用式 style 漏洞已修复 | 修改相应页面时将 `unified/collision/u*` 渐进换为领域语义名 |
| CI Architecture Ratchet | 已完成 | docs、API auth、route、domain state、domain boundary、UI contract 与 Database Baseline 均是阻断门禁 | 基线只能下降，不能扩大白名单 |
| Object Storage 异机验收 | 外部资源待完成 | BlobStore Port、Local/S3/OSS adapter、内容寻址与远端读回校验流程已具备；生产仍使用本地事实源 | 提供真实 bucket/SSH 异机目标和凭据后完成 copy、hash、删本机 cache、Judge materialize 与新机恢复演练 |
| Judge 主机隔离 | 扩容前工程项 | Judge Runtime/go-judge 已与 API 进程分离，任务具备 lease/fencing/CAS | 在用户规模或威胁模型需要时迁至独立 VM/Host，不重写 Judge 状态机 |
| 外部告警送达 | 外部资源待完成 | 本地回环的 failed/recovered、重试与审计已通过；GitHub Actions 真实执行受 Billing 拒绝 | 提供 Webhook/SMTP 接收端或恢复 Actions Billing 后完成真实故障/恢复送达 |

## Human UX 计划验收映射

| 交付 | 状态 | 证据摘要 |
|---|---|---|
| Assignment 学生×题目批改矩阵与 MANUAL 完成 | 已发布 | 服务端分页/筛选、人工确认/撤销 CAS 与原因审计，双角色 E2E 已通过 |
| Assignment 四步简单创建与高级设置 | 已发布 | 推荐默认值、已有草稿不覆盖、发布前检查和“发布后立即可见”文案已上线 |
| Blog 公共阅读、引用、系列、互动与知识广场 | 已发布 | 匿名/登录可见性、系列过滤、评论/回复与全局导航回归通过 |
| 五类提交入口统一 CodeMirror 6 | 已发布 | 题库、比赛/训练、Assignment、Training Engine、Hack 共用编辑器，具备本地草稿和 Textarea 降级 |
| Rating 自然语言与排名变化 | 已发布 | GLOBAL/ORGANIZATION/BOTH 均以人类文案展示，最终排名显示前后值和增量 |
| 比赛五步创建向导 | 已发布 | 默认不计 Rating、固定 TestSet Revision、集中校验和可恢复 DRAFT 已上线 |
| 题解相似片段并排审核 | 已发布 | 只允许题目审核者读取 READY 结果，最多 20 组片段且每次访问审计 |

## 当前不能伪造完成的外部输入

1. 域名、DNS 与证书签发许可。
2. 真实 HTTPS Webhook/SMTP 接收端或可用 GitHub Actions Billing。
3. OSS/S3 bucket 或 SSH 异机目标、最小权限凭据、Host Key 与保留期。
4. 若需要正式数据库覆盖恢复，还需指定维护窗口、目标备份及明确覆盖授权；当前已完成的隔离恢复不等于生产覆盖演练。

在这些输入到位前，仓库会保持 fail-closed 的准备能力和诚实状态记录，不生成假证书、假送达回执或假异机恢复结果。

## 持续验证

```bash
pnpm docs:check
pnpm architecture:check
pnpm db:baseline:check
pnpm runtime:audit
pnpm security:audit
pnpm judge:projection:check
pnpm judge:slo
```

生产发布还必须执行服务状态、网络暴露、公网 Health/Readiness 和相关业务闭环探针。上述命令不能替代外部资源的真实验收。
