---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: Git history
replacement: docs/README.md
---

# 历史文档索引

本目录保留文档重构前的正文、实施计划和外部平台调研。内容按记录发生时的系统状态
保留，不应作为当前启动、权限、接口或部署依据。

## 旧主文档

| 旧路径 | 历史副本 | 当前替代 |
|--------|----------|----------|
| `docs/README.md` | [旧索引](legacy/README.md) | [新索引](../README.md) |
| `docs/context.md` | [旧上下文](legacy/context.md) | [项目概览](../guide/PROJECT_OVERVIEW.md) |
| `docs/PROJECT_OVERVIEW.md` | [旧概览](legacy/PROJECT_OVERVIEW.md) | [项目概览](../guide/PROJECT_OVERVIEW.md) |
| `docs/HANDOVER.md` | [旧交接](legacy/HANDOVER.md) | [开发启动](../guide/DEVELOPMENT_SETUP.md) |
| `docs/RUNBOOK.md` | [旧手册](legacy/RUNBOOK.md) | [运行手册](../operations/RUNBOOK.md) |
| `docs/SYSTEM_MAP.md` | [旧系统图](legacy/SYSTEM_MAP.md) | [系统架构](../architecture/SYSTEM_OVERVIEW.md) |
| `docs/AUTH_AND_PERMISSION.md` | [旧权限](legacy/AUTH_AND_PERMISSION.md) | [认证与权限](../architecture/AUTHORIZATION.md) |
| `docs/MODULE_INDEX.md` | [旧模块索引](legacy/MODULE_INDEX.md) | [项目导览](../guide/PROJECT_TOUR.md) |
| `docs/KNOWN_ISSUES.md` | [旧问题](legacy/KNOWN_ISSUES.md) | [当前状态](../STATUS.md) |
| `docs/JUDGE_MODULE.md` | [旧 Judge](legacy/JUDGE_MODULE.md) | [Judge 与提交](../architecture/JUDGE_AND_SUBMISSIONS.md) |
| `docs/FILE_STORAGE_DESIGN.md` | [旧存储设计](legacy/FILE_STORAGE_DESIGN.md) | [文件存储](../architecture/FILE_STORAGE.md) |
| `docs/TESTING.md` | [旧测试](legacy/TESTING.md) | [测试](../development/TESTING.md) |
| `docs/DESIGN_SYSTEM.md` | [旧设计系统](legacy/DESIGN_SYSTEM.md) | [设计系统](../development/DESIGN_SYSTEM.md) |
| `docs/database/DATABASE_MODELS.md` | [旧模型](legacy/database/DATABASE_MODELS.md) | [Schema 参考](../reference/DATABASE_SCHEMA.md) |
| `docs/components/COMPONENTS.md` | [旧组件](legacy/components/COMPONENTS.md) | [前端架构](../development/FRONTEND.md) |
| `docs/api/API_REFERENCE.md` | [旧 API](legacy/api/API_REFERENCE.md) | [HTTP API](../reference/api/README.md) |
| `docs/api/FIELD_CONTRACT.md` | [旧契约](legacy/api/FIELD_CONTRACT.md) | [字段契约](../reference/FIELD_CONTRACTS.md) |

## 实施计划

| 历史主题 | 文件 | 当前说明 |
|----------|------|----------|
| 个人/校园模式 | [current-task-personal-mode.md](plans/current-task-personal-mode.md) | [认证与权限](../architecture/AUTHORIZATION.md) |
| VJudge 团队导入 | [vjudge-team-import.md](plans/vjudge-team-import.md) | [团队模块](../architecture/modules/TEAMS.md) |
| AI 翻译 | [ai-translation.md](plans/ai-translation.md) | [题目与 OJ](../architecture/modules/PROBLEMS_AND_OJ.md) |
| 前端样式重构 | [frontend-style-refactor.md](plans/frontend-style-refactor.md) | [设计系统](../development/DESIGN_SYSTEM.md) |
| OJ 适配器设计 | [oj-adapter-design.md](plans/oj-adapter-design.md) | [题目与 OJ](../architecture/modules/PROBLEMS_AND_OJ.md) |
| OJ 缺陷修复 | [oj-adapter-fixes.md](plans/oj-adapter-fixes.md) | [题目与 OJ](../architecture/modules/PROBLEMS_AND_OJ.md) |
| 团队测试计划 | [team-test-coverage.md](plans/team-test-coverage.md) | [测试](../development/TESTING.md) |
| 团队测试场景 | [team-test-scenarios.md](plans/team-test-scenarios.md) | [UI E2E](../development/UI_E2E.md) |

## 调研和历史规则

- [外部 OJ 平台调研](research/OJ_PLATFORMS_SURVEY.md)
- [旧 OJ 适配器说明](research/OJ_ADAPTERS.md)
- [平台 URL 映射](research/PLATFORM_URL_MAP.md)
- [OJ 提交调研](research/oj-submit/README.md)
- [旧团队文档](legacy/team/README.md)
- [2026-07 前详细变更日志](LEGACY_CHANGELOG.md)

外部 OJ 的页面、反爬和登录规则会变化。使用调研结论前必须重新验证。

