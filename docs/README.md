# OI Manager V2 项目文档

## 文档目录

### 快速上手
- [项目概述](./PROJECT_OVERVIEW.md) - 项目定位和功能概览
- [交接指南](./HANDOVER.md) - 新人 30 分钟上手指南
- [运维手册](./RUNBOOK.md) - 本地开发和运维

### 系统设计
- [系统全景图](./SYSTEM_MAP.md) - 路由、API、模型全貌
- [认证与权限](./AUTH_AND_PERMISSION.md) - 角色和权限详解
- [业务模块索引](./MODULE_INDEX.md) - 模块代码定位
- [项目上下文](./context.md) - 长期上下文记录

### 数据与接口
- [数据库模型](./database/DATABASE_MODELS.md) - 数据表结构和关系
- [API 接口文档](./api/API_REFERENCE.md) - 接口概要（待完善）
- [前端组件库](./components/COMPONENTS.md) - 组件文档

### 运维与问题
- [已知问题](./KNOWN_ISSUES.md) - 技术债务清单
- [当前任务](./current-task.md) - 当前任务和进度
- [变更日志](./change-log.md) - 变更记录

## 快速导航

### 核心功能
- **用户管理**: 超管/平台管理员管理用户账号
- **学校管理**: 创建学校、指定负责人、管理教师
- **教师管理**: 教师信息管理、团队管理
- **学生管理**: 学生信息管理、Rating 追踪
- **团队管理**: 训练团队、成员管理、邀请机制
- **比赛管理**: 创建比赛、导入成绩、资源管理
- **题单管理**: 题目分配、进度追踪

### 技术栈
- **前端**: Next.js 14 + React + TypeScript
- **后端**: Express + TypeScript
- **数据库**: SQLite + Prisma ORM
- **包管理**: pnpm + monorepo

## 文档状态

| 文档 | 状态 | 说明 |
|------|------|------|
| PROJECT_OVERVIEW.md | ✅ 完整 | 项目概述 |
| HANDOVER.md | ✅ 完整 | 交接指南 |
| RUNBOOK.md | ✅ 完整 | 运维手册 |
| SYSTEM_MAP.md | ✅ 完整 | 系统全景图 |
| AUTH_AND_PERMISSION.md | ✅ 完整 | 权限说明 |
| MODULE_INDEX.md | ✅ 完整 | 模块索引 |
| KNOWN_ISSUES.md | ✅ 完整 | 已知问题 |
| DATABASE_MODELS.md | ✅ 完整 | 数据库模型 |
| API_REFERENCE.md | 🔄 待完善 | 接口概要版 |
| COMPONENTS.md | ✅ 完整 | 组件文档 |

## 更新日志

### 2026-03-23
- ✅ 文档一致性检查和修复
- ✅ 更新数据库模型文档（添加 Admin 模型，修正团队模型）
- ✅ 更新组件文档（添加缺失的 17 个组件）
- ✅ 更新 API 文档（补充缺失的接口）
- ✅ 清理不存在的文档引用
- ✅ 后端安全与并发止损重构
- ✅ 遗留直连 API 调用迁移完成

### 2026-03-18
- ✅ 添加教师联系方式必填验证
- ✅ 修复学校负责人教师管理页面操作按钮显示问题
- ✅ 为平台管理员账号管理页面添加分页功能
- ✅ 统一超管和平台管理员使用同一套账号管理代码
- ✅ 支持 Markdown 和 LaTeX 渲染
- ✅ 优化年级分布显示
- ✅ 支持 5-4-3 和 6-3-3 学制动态计算年级
