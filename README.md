# OI Manager V2

信息学竞赛训练管理平台 - 面向信息学竞赛培养场景的三端成长管理平台

## 项目简介

OI Manager V2 是一个专为信息学竞赛培训设计的管理平台，支持学校、团队、教师、学生的全方位管理。系统定位为"信息学竞赛训练管理平台"，不是在线判题 OJ，但内置 Carits 本地评测引擎支持训练提交。

### 核心功能

- 学校管理: 学校信息管理、负责人体系、公告发布
- 团队管理: 团队创建、成员管理、角色权限
- 教师管理: 教师账号管理、权限分配、主教练绑定
- 学生管理: 学生信息管理、年级计算、Rating 系统
- 比赛管理: 比赛创建、榜单导入、成绩管理
- 题单管理: 飞书文档式权限题单（题单→章节→题目）
- 团队训练: IOI/ICPC 赛制训练、实时评测、排名
- 本地评测: Carits 评测引擎、go-judge 沙箱、多语言支持
- 评测记录: 提交列表、详情查看、结果筛选

### 角色体系

- **超级管理员 (super_admin)**: 系统最高权限，管理所有学校和用户
- **平台管理员 (platform_admin)**: 平台级管理权限，管理用户账号
- **学校负责人 (school_principal)**: 学校级管理权限，管理本校教师
- **教师 (teacher)**: 团队级管理权限，管理团队和学生
- **学生 (student)**: 个人数据查看权限

## 技术栈

### 前端
- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **UI**: React + 内联样式 + CSS 变量设计 token 系统
- **数据**: SWR 请求缓存
- **Markdown**: react-markdown + remark-gfm
- **LaTeX**: remark-math + rehype-katex

### 后端
- **框架**: Express
- **语言**: TypeScript
- **ORM**: Prisma
- **数据库**: PostgreSQL (Docker)
- **认证**: JWT + bcrypt
- **评测**: go-judge 沙箱

### 开发工具
- **包管理**: pnpm (Monorepo)
- **构建工具**: tsx
- **代码规范**: TypeScript strict mode

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8
- Docker >= 20 (用于 PostgreSQL)

### 安装依赖

```bash
pnpm install
```

### 启动数据库

```bash
docker compose up -d db
```

### 数据库初始化

```bash
cd apps/server
pnpm prisma:generate  # 生成 Prisma Client
pnpm prisma:push      # 推送 schema 到数据库
pnpm prisma:seed      # 执行种子数据
```

### 启动开发环境

```bash
# 同时启动前端和后端
pnpm dev

# 或者分别启动
cd apps/web && pnpm dev      # 前端: http://localhost:3000
cd apps/server && pnpm dev   # 后端: http://localhost:3002
```

### 默认账号

| 角色 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 超级管理员 | admin | 123456 | 系统管理员 |
| 平台管理员 | platform_admin | 123456 | 平台管理 |
| 学校负责人 | principal | 123456 | 示例学校负责人 |
| 教师 | teacher1 | 123456 | 示例教师 |
| 学生 | student1 | 123456 | 示例学生 |

## 项目结构

```
oi-manager-v2/
├── apps/
│   ├── web/                 # Next.js 前端应用
│   │   ├── src/
│   │   │   ├── app/         # 页面路由 (App Router)
│   │   │   ├── components/  # React 组件 (ui/ business/ team/ training/ problem/ submission/)
│   │   │   ├── hooks/       # 自定义 Hooks
│   │   │   └── lib/         # 工具函数、设计 token、样式预设
│   │   └── package.json
│   ├── server/              # Express 后端应用
│   │   ├── src/
│   │   │   ├── routes/      # API 路由
│   │   │   ├── middleware/  # 中间件
│   │   │   ├── modules/     # 业务模块 (分层架构)
│   │   │   ├── oj-adapters/ # OJ 平台适配器
│   │   │   └── index.ts     # 入口文件
│   │   ├── prisma/          # Prisma schema + 种子数据
│   │   └── package.json
│   └── judge/               # 评测服务 (go-judge 沙箱)
├── packages/
│   └── shared/              # 共享类型定义
├── docs/                    # 项目文档
│   ├── api/                 # API 文档
│   ├── components/          # 组件文档
│   ├── database/            # 数据库文档
│   └── ...
├── docker-compose.yml       # Docker 配置
├── package.json             # 根 package.json
├── pnpm-workspace.yaml      # pnpm workspace 配置
└── README.md                # 项目说明
```

## 文档

详细文档请查看 [docs](./docs/) 目录：

- [项目概述](./docs/PROJECT_OVERVIEW.md) - 项目目标、技术栈、功能模块
- [系统全景图](./docs/SYSTEM_MAP.md) - 系统结构和路由
- [运维手册](./docs/RUNBOOK.md) - 本地开发、调试、部署
- [交接指南](./docs/HANDOVER.md) - 新人上手指南
- [认证与权限](./docs/AUTH_AND_PERMISSION.md) - 权限体系详解
- [业务模块索引](./docs/MODULE_INDEX.md) - 模块代码定位
- [数据库模型](./docs/database/DATABASE_MODELS.md) - 数据库模型定义
- [API 接口文档](./docs/api/API_REFERENCE.md) - API 接口参考
- [前端组件库](./docs/components/COMPONENTS.md) - 组件使用文档
- [设计系统](./docs/DESIGN_SYSTEM.md) - 设计 token、样式规范
- [评测模块](./docs/JUDGE_MODULE.md) - 评测引擎架构与配置
- [已知问题](./docs/KNOWN_ISSUES.md) - 技术债务清单

## 开发规范

- TypeScript strict mode
- 内联样式 + CSS 变量设计 token 系统
- RESTful API，统一响应格式 `{ success, data?, message? }`
- JWT 认证，所有 API 走 `apiClient`
- Prisma 关联字段名大写 (`Teacher`, `Student`, `Team`)
- 颜色使用 `var(--xxx)` 语义变量，禁止硬编码 hex

## 常用命令

```bash
pnpm install           # 安装依赖
pnpm dev               # 启动开发环境
pnpm build             # 构建生产版本

cd apps/server
pnpm prisma:generate   # 生成 Prisma Client
pnpm prisma:push       # 推送 schema 到数据库
pnpm prisma:seed       # 执行种子数据
npx prisma studio      # 打开 Prisma Studio
```

## 项目状态

### 已完成
- 用户认证和权限系统
- 学校管理、教师管理、学生管理
- 团队管理（含邀请/申请/角色管理）
- 题单管理（飞书文档式权限）
- 学校题单 & 团队题单
- 团队训练模块（IOI/ICPC 赛制）
- Carits 本地评测系统
- 评测记录列表 + 详情页
- 前端设计 token 系统 + 风格统一
- SWR 请求缓存
- PostgreSQL 迁移 + Docker 部署

### 进行中
- Rating 系统完善
- 比赛管理功能增强

### 计划中
- 成绩中心
- 学生成长报告
- 家长端
- CI/CD 配置

## 许可证

[MIT License](./LICENSE)
