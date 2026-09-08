---
status: current
audience: development, operations
last_verified: 2026-08-29
source_of_truth: repository structure, deploy/systemd, generated architecture inventory and active documentation
---

# OI Manager 项目文档

本目录是 OI Manager 的唯一正式文档入口。当前公网使用 systemd 管理的 Web 构建产物、稳定
API Router `3002`、蓝绿 API `3302/3303`、Scheduler、Executor 和 Judge；PostgreSQL 与 go-judge
由 Docker 管理。域名/TLS、严格浏览器安全、真实外部告警和异机留存尚未完成，因此
Production v1 外部验收仍保持未完成，不能把“运行拓扑已生产化”误写成“所有投产条件已满足”。

## 阅读路径

### 首次开发

1. [Codex 项目接手指南](guide/CODEX_ONBOARDING.md)
2. [项目概览](guide/PROJECT_OVERVIEW.md)
3. [开发环境启动](guide/DEVELOPMENT_SETUP.md)
4. [项目导览](guide/PROJECT_TOUR.md)
5. [开发工作流](development/WORKFLOW.md)

### 理解系统

1. [系统架构](architecture/SYSTEM_OVERVIEW.md)
2. [认证与权限](architecture/AUTHORIZATION.md)
3. [数据模型](architecture/DATA_MODEL.md)
4. [评测机与提交](architecture/JUDGE_AND_SUBMISSIONS.md)
5. [业务模块](architecture/modules/ORGANIZATION.md)
6. [Carits币与贡献 V1](architecture/CARITS_AND_CONTRIBUTION.md)
7. [比赛 Rating 领域](architecture/RATING_DOMAIN.md)

### 测试

1. [单元与集成测试](development/TESTING.md)
2. [全 UI E2E](development/UI_E2E.md)
3. [前端约定](development/FRONTEND.md)
4. [UI 路由与交互矩阵](development/UX_ROUTE_MATRIX.md)

### 运维

1. [环境边界](operations/ENVIRONMENTS.md)
2. [远端环境区分说明](operations/REMOTE_ENVIRONMENT_MAP.md)
3. [运行手册](operations/RUNBOOK.md)
4. [部署模板](operations/DEPLOYMENT.md)
5. [故障排查](operations/TROUBLESHOOTING.md)
6. [当前未完成事项执行总表](operations/REMAINING_WORK_2026-08-27.md)
7. [Judge 长稳与并发一致性报告](operations/JUDGE_STRESS_2026-08-27.md)
8. [全新空库 Bootstrap](operations/CLEAN_DATABASE_BOOTSTRAP.md)
9. [架构收口逐项完成审计](operations/ARCHITECTURE_CONVERGENCE_AUDIT_2026-08-29.md)
10. [TLS 与严格浏览器安全发布](operations/TLS_ROLLOUT.md)

### 查阅接口

- [页面路由](reference/WEB_ROUTES.md)
- [数据库结构](reference/DATABASE_SCHEMA.md)
- [字段契约](reference/FIELD_CONTRACTS.md)
- [环境变量](reference/ENVIRONMENT_VARIABLES.md)
- [HTTP API](reference/api/README.md)

## 文档分层

| 目录 | 内容 | 是否描述当前行为 |
|------|------|------------------|
| `guide/` | 新人上手和项目概念 | 是 |
| `architecture/` | 系统边界、数据流和业务规则 | 是 |
| `development/` | 开发、测试和前端规范 | 是 |
| `operations/` | 环境、启停、部署和排障 | 是 |
| `reference/` | 路由、模型、接口和变量清单 | 是 |
| `archive/` | 旧设计、调研、任务和历史快照 | 否 |

活动文档均带有 `status`、`audience`、`last_verified` 和
`source_of_truth` 元数据。历史文档中的命令、路径和状态不应直接用于当前环境。

## 事实来源

文档出现冲突时，按以下顺序判断：

1. 当前源码、Prisma Schema 和环境校验代码。
2. 根目录脚本、Docker Compose、Playwright 配置和 CI。
3. 本目录内 `status: current` 或 `status: reference` 的文档。
4. `archive/` 中的历史材料。

运行 `pnpm docs:check` 可以检查链接、页面路由、Prisma 模型、API 目录和已知过时描述。

## 文档维护与任务记录

每个仓库任务都必须在结束前完成文档影响检查，不能只在聊天、提交信息或终端输出中
保留结果：

- `CHANGELOG.md` 按日期记录任务结果、验证范围以及推送或部署状态。
- `STATUS.md` 只维护当前能力、限制、运行状态和最近验证快照。
- 对应的指南、架构、开发、运维或参考文档说明长期有效的行为和操作方法。
- 被修改或重新核对的活动文档同步更新 `last_verified`。
- 最后运行 `pnpm docs:check`。

完整门禁和完成清单见[开发工作流](development/WORKFLOW.md)，项目级执行约束见根目录
`AGENTS.md`。
