# OI Manager V2

面向 OI 教学与竞赛训练的一体化管理与评测平台

## 项目简介

OI Manager V2 同时包含教育管理域与本地评测域。教育管理域负责学校、团队、教师、学生、训练和题单；评测域负责题目、不可变 TestSet Revision、Submission、JudgeRun/JudgeAttempt、ACM/OI 判定、Hack 和重测。系统保持模块化单体 Server 与独立 Judge Runtime，不拆分微服务。

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
- **框架**: Next.js 15 (App Router)
- **语言**: TypeScript
- **UI**: React + CSS Modules + 统一组件/设计 Token
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
docker-compose up -d db judge
```

### 数据库初始化

```bash
cd apps/server
pnpm prisma:generate  # 生成 Prisma Client
pnpm exec prisma migrate deploy # 应用版本化数据库迁移
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
│   ├── guide/               # 入门与项目导览
│   ├── architecture/        # 架构与业务模块
│   ├── development/         # 开发与测试
│   ├── operations/          # 环境、运行与部署
│   ├── reference/           # 路由、模型和 API 参考
│   └── archive/             # 历史文档
├── docker-compose.yml       # Docker 配置
├── package.json             # 根 package.json
├── pnpm-workspace.yaml      # pnpm workspace 配置
└── README.md                # 项目说明
```

## 文档

文档统一从 [docs/README.md](./docs/README.md) 进入：

- [项目状态](./docs/STATUS.md) - 开发阶段、验证结果和已知限制
- [开发环境](./docs/guide/DEVELOPMENT_SETUP.md) - 从干净检出到可登录
- [系统架构](./docs/architecture/SYSTEM_OVERVIEW.md) - 组件、数据和请求链路
- [认证与授权](./docs/architecture/AUTHORIZATION.md) - 角色、学生模式和权限边界
- [测试体系](./docs/development/TESTING.md) - Vitest、数据库隔离和验收
- [UI E2E](./docs/development/UI_E2E.md) - 90 路由与角色流程
- [运维手册](./docs/operations/RUNBOOK.md) - 启停、端口、日志和备份
- [API 目录](./docs/reference/api/README.md) - 当前 Express 接口清单

## 开发规范

- TypeScript strict mode
- 统一 UI 组件 + CSS Modules + CSS 变量设计 Token
- RESTful API，统一响应格式 `{ success, data?, message? }`
- JWT 认证，所有 API 走 `apiClient`
- Prisma 关联字段名大写 (`Teacher`, `Student`, `Team`)
- 颜色使用 `var(--xxx)` 语义变量，禁止硬编码 hex

## 常用命令

```bash
pnpm install           # 安装依赖
pnpm dev               # 启动开发环境
pnpm build             # 构建生产版本
pnpm docs:check        # 校验文档、路由、模型和 API 清单

cd apps/server
pnpm prisma:generate   # 生成 Prisma Client
pnpm prisma:push       # 推送 schema 到数据库
pnpm prisma:seed       # 执行种子数据
npx prisma studio      # 打开 Prisma Studio
```

## 项目状态

项目已运行正式 systemd/蓝绿部署拓扑：Nginx/Next.js 使用 `80/3000`，稳定 API Router 使用 `3002`，API 蓝绿实例使用 `3302/3303`，Judge 通过稳定 Router 自动重连。当前正式入口仍为 HTTP，TLS、外部告警和异机日志等未闭环事项以 [docs/STATUS.md](./docs/STATUS.md) 与剩余工作表为准。
