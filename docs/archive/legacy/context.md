---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/guide/PROJECT_OVERVIEW.md
---

> 历史文档：本文件保留当时的设计、调查或实现记录，不代表当前系统行为。请以 `docs/guide/PROJECT_OVERVIEW.md` 为准。

# 项目上下文

## 项目基本信息

- **项目名称**: OI Manager V2
- **项目定位**: 信息学竞赛训练管理平台
- **当前版本**: V1 MVP

## 技术栈

- **前端**: Next.js 14 + React + TypeScript + SWR
- **后端**: Express + TypeScript
- **数据库**: PostgreSQL + Prisma ORM（开发用 Docker，测试用 SQLite 隔离）
- **包管理**: pnpm (Monorepo)
- **测试**: Vitest + supertest（230+ 测试）

## 端口配置

- 前端: http://localhost:3000
- 后端: http://localhost:3002

## 常用命令

```bash
# 安装依赖
pnpm install

# 启动开发环境
pnpm dev

# 数据库操作
cd apps/server
pnpm prisma:generate  # 生成 Prisma Client
pnpm prisma:push      # 推送 schema 到数据库
pnpm prisma:seed      # 执行种子数据
```

## 核心角色

| 角色 | 权限范围 |
|------|---------|
| super_admin | 系统最高权限 |
| platform_admin | 平台级管理 |
| school_principal | 学校级管理 |
| teacher | 团队级管理 |
| student | 个人数据查看 |

## 组织结构

```
学校 (School)
  ├── 学校负责人 (School Principal)
  ├── 团队 (Team)
  │     ├── 团队负责人 (Team Leader)
  │     ├── 教师 (Teacher)
  │     └── 学生 (Student)
  ├── 教师 (Teacher)
  └── 学生 (Student)
```

## 开发规范

- 使用 TypeScript strict mode
- 避免使用 any 类型
- 函数保持短小
- 命名清晰，避免过度缩写
- 关键业务逻辑添加注释

## API 规范

- RESTful 风格
- 统一响应格式：`{ success: boolean, data?: any, message?: string }`
- 使用 JWT 认证

## 前端规范

- 使用内联样式 + CSS 变量设计 token 系统
- 设计 token 详见 `docs/DESIGN_SYSTEM.md`
- 通用组件在 `components/ui/`，使用 `lib/tokens.ts` 和 `lib/styles.ts`
- 组件复用优先，避免冗余代码
- 颜色使用 `var(--xxx)` 语义变量，禁止硬编码 hex 值
