# OI Manager V2

信息学竞赛训练管理平台 - 面向信息学竞赛培养场景的三端成长管理平台

## 项目简介

OI Manager V2 是一个专为信息学竞赛培训设计的管理平台，支持学校、团队、教师、学生的全方位管理。系统定位为"信息学竞赛训练管理平台"，不是在线判题 OJ。

### 核心功能

- 🏫 **学校管理**: 学校信息管理、学校负责人体系、学校公告发布
- 👥 **团队管理**: 团队创建、成员管理、团队负责人指定
- 👨‍🏫 **教师管理**: 教师账号管理、权限分配、主教练绑定
- 👨‍🎓 **学生管理**: 学生信息管理、年级计算、Rating 系统
- 🏆 **比赛管理**: 比赛创建、榜单导入、成绩管理
- 📝 **题单管理**: 题单创建、进度追踪、完成状态
- 📊 **数据统计**: 学校统计、年级分布、Rating 排名

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
- **UI**: React + 内联样式
- **Markdown**: react-markdown + remark-gfm
- **LaTeX**: remark-math + rehype-katex

### 后端
- **框架**: Express
- **语言**: TypeScript
- **ORM**: Prisma
- **数据库**: SQLite
- **认证**: JWT + bcrypt

### 开发工具
- **包管理**: pnpm (Monorepo)
- **构建工具**: tsx
- **代码规范**: TypeScript strict mode

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8
- SQLite 3

### 安装依赖

```bash
pnpm install
```

### 数据库初始化

```bash
cd apps/server
pnpm prisma:generate  # 生成 Prisma Client
pnpm prisma:push      # 推送 schema 到数据库
pnpm prisma:seed      # 执行种子数据（可选）
```

### 启动开发环境

```bash
# 同时启动前端和后端
pnpm dev

# 或者分别启动
cd apps/web && pnpm dev      # 前端: http://localhost:3000
cd apps/server && pnpm dev   # 后端: http://localhost:3001
```

### 默认账号

种子数据会创建以下默认账号：

| 角色 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 超级管理员 | admin | admin123 | 系统管理员 |
| 平台管理员 | platform_admin | admin123 | 平台管理 |
| 学校负责人 | teacher | teacher123 | 雅礼中学负责人 |

## 项目结构

```
oi-manager-v2/
├── apps/
│   ├── web/                 # Next.js 前端应用
│   │   ├── src/
│   │   │   ├── app/         # 页面路由
│   │   │   ├── components/  # React 组件
│   │   │   └── lib/         # 工具函数
│   │   └── package.json
│   └── server/              # Express 后端应用
│       ├── src/
│       │   ├── routes/      # API 路由
│       │   ├── middleware/  # 中间件
│       │   └── index.ts     # 入口文件
│       ├── prisma/          # Prisma schema
│       └── package.json
├── packages/
│   └── shared/              # 共享类型定义
├── docs/                    # 项目文档
│   ├── api/                 # API 文档
│   ├── components/          # 组件文档
│   ├── database/            # 数据库文档
│   └── architecture/        # 架构文档
├── test/                    # 测试文件
├── package.json             # 根 package.json
├── pnpm-workspace.yaml      # pnpm workspace 配置
└── README.md                # 项目说明
```

## 核心功能

### 1. 学校管理

- 学校创建和编辑
- 学校负责人指定和转移
- 学校公告发布（支持 Markdown 和 LaTeX）
- 学校统计数据（教师数、学生数、平均 Rating）
- 年级分布可视化（进度条 + 百分比）
- 学制配置（6-3-3 或 5-4-3）

### 2. 教师管理

- 教师创建和编辑
- 联系方式必填验证（邮箱或手机号至少一个）
- 教师启用/禁用
- 学校负责人转移
- 团队负责人指定

### 3. 学生管理

- 学生创建和编辑
- 入学年份和年级动态计算
- 主教练绑定
- Rating 管理（校内唯一）
- 团队关联（多对多）
- 年级筛选（包含/不包含已毕业）

### 4. 团队管理

- 团队创建和编辑
- 团队负责人指定
- 成员管理（教师、学生）
- 团队统计

### 5. 比赛管理

- 比赛创建和编辑
- 榜单导入
- 成绩管理
- Rating 计算
- 资源上传

### 6. Rating 系统

- 校内唯一 Rating
- Rating 历史记录
- Rating 排名（Top 10）
- 年级筛选

## 文档

详细文档请查看 [docs](./docs/) 目录：

- [项目概述](./docs/PROJECT_OVERVIEW.md)
- [数据库模型](./docs/database/DATABASE_MODELS.md)
- [API 接口文档](./docs/api/API_REFERENCE.md)
- [前端组件库](./docs/components/COMPONENTS.md)
- [架构设计](./ARCHITECTURE.md)

## 开发规范

### 代码规范

- 使用 TypeScript strict mode
- 避免使用 `any` 类型
- 函数保持短小
- 命名清晰，避免过度缩写
- 关键业务逻辑添加注释

### API 规范

- RESTful 风格
- 统一响应格式：`{ success: boolean, data?: any, message?: string }`
- 使用 JWT 认证
- 错误处理统一

### 前端规范

- 使用内联样式
- CSS 变量统一管理
- 组件复用优先
- 避免冗余代码

### 数据库规范

- 使用 Prisma schema
- 外键关联明确
- 索引合理设置
- 数据迁移记录

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
npx prisma studio     # 打开 Prisma Studio

# 构建生产版本
pnpm build

# 启动生产环境
pnpm start
```

## 项目状态

### 当前版本: V1 MVP

**已完成**:
- ✅ 用户认证和权限系统
- ✅ 学校管理基础功能
- ✅ 教师管理完整功能
- ✅ 学生管理基础功能
- ✅ 团队管理基础功能
- ✅ 学校负责人权限体系
- ✅ 分页功能
- ✅ Markdown/LaTeX 支持
- ✅ 年级计算和分布可视化

**进行中**:
- 🔄 比赛管理功能
- 🔄 Rating 系统完善
- 🔄 题单管理

**计划中**:
- 📋 成绩中心
- 📋 资源管理
- 📋 学生成长报告

## 更新日志

### 2026-03-22

#### 团队模块统一化
- ✅ 教师端和学生端团队详情页合并为 TeamDetailPage 公共组件
- ✅ 抽取管理弹窗组件（邀请、转移、编辑）
- ✅ 功能差异通过权限控制，不由 userType 控制

#### 个人信息功能
- ✅ 新增头像上传功能（个人头像、团队头像）
- ✅ 新增密码修改功能
- ✅ 右上角头像下拉菜单（个人信息、账号安全、退出登录）

#### 个人卡片功能
- ✅ 点击成员头像/姓名展示个人信息卡片
- ✅ 全局 ProfileCardProvider

#### 文档更新
- ✅ 新增 SYSTEM_MAP.md、RUNBOOK.md、HANDOVER.md 等文档
- ✅ 修正 CLAUDE.md 中的文档路径引用
- ✅ 更新 DATABASE_MODELS.md、COMPONENTS.md、API_REFERENCE.md

### 2026-03-18

#### 新增功能
- ✅ 添加教师联系方式必填验证（邮箱或手机号至少一个）
- ✅ 为平台管理员账号管理页面添加分页功能
- ✅ 支持 Markdown 和 LaTeX 渲染（学校公告等）
- ✅ 优化年级分布显示（进度条、百分比）
- ✅ 支持 5-4-3 和 6-3-3 学制动态计算年级

#### 修复问题
- ✅ 修复学校负责人教师管理页面操作按钮显示问题
- ✅ 修复 Rating 排名 Top 10 显示空数据问题
- ✅ 修复"不包含已毕业"筛选后显示不足 10 人问题
- ✅ 统一超管和平台管理员使用同一套账号管理代码

#### 优化改进
- ✅ 为所有现有教师添加随机邮箱
- ✅ 后端 API 验证联系方式必填
- ✅ 前端表单验证联系方式必填
- ✅ 年级分布根据学制动态计算

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

[MIT License](./LICENSE)

## 联系方式

- 项目仓库: [GitHub]
- 问题反馈: [Issues]
- 文档更新: 2026-03-18

---

**注意**: 本项目仍在开发中，部分功能可能不完善。如有问题请提交 Issue。
