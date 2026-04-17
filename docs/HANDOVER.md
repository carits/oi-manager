# 项目交接指南 (Handover Guide)

> 最后更新: 2026-03-23

本文档帮助新人快速接手 OI Manager V2 项目。建议按顺序阅读并实践。

---

## 1. 30 分钟快速上手

### 第一步：环境准备 (5分钟)

```bash
# 1. 克隆项目
git clone <repository-url>
cd oi-manager-v2

# 2. 安装依赖
pnpm install

# 3. 初始化数据库
cd apps/server
pnpm prisma:generate
pnpm prisma:push
pnpm prisma:seed

# 4. 启动项目
cd ../..
pnpm dev
```

### 第二步：登录体验 (5分钟)

访问 http://localhost:3000，使用测试账号登录：

| 角色 | 用户名 | 密码 | 体验重点 |
|------|--------|------|----------|
| 超管 | `admin` | `123456` | 学校管理、用户管理 |
| 教师 | `teacher1` | `123456` | 团队管理、学生管理 |
| 学生 | `student1` | `123456` | 查看个人数据 |

### 第三步：阅读核心文档 (20分钟)

按以下顺序阅读：

1. **[SYSTEM_MAP.md](./SYSTEM_MAP.md)** - 了解系统全貌（5分钟）
2. **[AUTH_AND_PERMISSION.md](./AUTH_AND_PERMISSION.md)** - 理解权限体系（5分钟）
3. **[MODULE_INDEX.md](./MODULE_INDEX.md)** - 浏览业务模块（5分钟）
4. **[RUNBOOK.md](./RUNBOOK.md)** - 掌握常用命令（5分钟）

---

## 2. 核心概念速记

### 2.1 角色体系

```
super_admin (超管) → 管理学校、用户
platform_admin (平台管理员) → 管理用户
school_principal (学校负责人) → 管理本校教师 + 教师权限
teacher (教师) → 管理团队、学生、比赛
student (学生) → 查看个人数据
```

### 2.2 数据关系

```
School (学校)
  ├── Teacher (教师)
  ├── Student (学生)
  └── Team (团队)
        ├── Contest (比赛)
        └── ProblemList (题单)
```

### 2.3 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 + React + TypeScript + SWR |
| 后端 | Express + TypeScript |
| 数据库 | PostgreSQL + Prisma ORM |
| 认证 | JWT |
| 包管理 | pnpm + monorepo |
| 部署 | Docker + PM2 + Nginx |

---

## 3. 关键文件定位

### 3.1 需要改一个页面

1. 找到页面文件：`apps/web/src/app/<role>/<feature>/page.tsx`
2. 找到对应的 API：`apps/server/src/routes/<feature>.ts`
3. 如需修改数据结构：`apps/server/prisma/schema.prisma`

### 3.2 需要添加新功能

1. 数据模型：修改 `schema.prisma`
2. 后端路由：在 `routes/` 创建或修改路由文件
3. 前端页面：在 `app/` 对应角色目录创建页面
4. 数据 Hook：在 `hooks/data/` 创建 Hook

### 3.3 需要修改权限

1. 后端中间件：`apps/server/src/middleware/auth.ts`
2. 前端入口：`apps/web/src/components/AuthProvider.tsx`

### 3.4 需要修改导航

- 导航配置：`apps/web/src/components/AppShell.tsx`

---

## 4. 常见任务示例

### 4.1 添加一个新页面

```bash
# 1. 创建页面文件
apps/web/src/app/teacher/my-feature/page.tsx

# 2. 页面模板
```

```tsx
'use client'

import { useAuth } from '@/components/AuthProvider'
import { apiClient } from '@/lib/apiClient'
import { useEffect, useState } from 'react'

export default function MyFeaturePage() {
  const { user } = useAuth()
  const [data, setData] = useState([])

  useEffect(() => {
    apiClient.get('/api/my-feature').then(res => {
      if (res.success) setData(res.data)
    })
  }, [])

  return (
    <div>
      <h1>我的功能</h1>
      {/* 内容 */}
    </div>
  )
}
```

### 4.2 添加一个新 API

```bash
# 1. 创建路由文件
apps/server/src/routes/my-feature.ts
```

```typescript
import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth'
import { prisma } from '../prisma'

export const myFeatureRouter = Router()

myFeatureRouter.get('/', authenticate, async (req, res) => {
  const data = await prisma.myModel.findMany()
  res.json({ success: true, data })
})

myFeatureRouter.post('/', authenticate, authorize('teacher'), async (req, res) => {
  const { name } = req.body
  const item = await prisma.myModel.create({ data: { name } })
  res.json({ success: true, data: item })
})
```

```bash
# 2. 在 index.ts 注册路由
import { myFeatureRouter } from './routes/my-feature'
app.use('/api/my-feature', myFeatureRouter)
```

### 4.3 修改数据库结构

```bash
# 1. 修改 schema.prisma
model MyModel {
  id String @id @default(cuid())
  name String
  createdAt DateTime @default(now())
}

# 2. 推送到数据库
cd apps/server
pnpm prisma:push

# 3. 重新生成 Prisma Client
pnpm prisma:generate
```

---

## 5. 调试技巧

### 5.1 后端调试

```typescript
// 在路由中添加日志
console.log('Debug:', req.body, req.user)

// 查看数据库
cd apps/server
npx prisma studio
```

### 5.2 前端调试

```typescript
// 使用 React DevTools
// 使用浏览器 Network Tab 查看 API 请求
// 使用 Console 查看 JavaScript 错误
```

### 5.3 常见问题

| 问题 | 解决方案 |
|------|----------|
| 端口被占用 | `netstat -ano \| findstr :3000` 然后 kill |
| Prisma 报错 | `pnpm prisma:generate` |
| 数据库不一致 | `pnpm prisma:push` |
| 前端白屏 | 检查 Console 错误，可能是 API 报错 |

---

## 6. 开发规范

### 6.1 代码规范

- 使用 TypeScript strict mode
- 函数保持短小
- 命名清晰，避免过度缩写
- 关键业务逻辑添加注释

### 6.2 API 规范

- RESTful 风格
- 统一响应格式：`{ success: boolean, data?: any, message?: string }`
- 使用 JWT 认证
- 错误处理统一

### 6.3 前端规范

- 使用内联样式
- CSS 变量统一管理
- 组件复用优先
- 使用 `apiClient` 调用 API

### 6.4 Git 规范

- feat: 新功能
- fix: 修复 bug
- docs: 文档更新
- refactor: 重构
- style: 代码格式调整

---

## 7. 技术债务清单

详见 [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)

**高优先级**:
- 遗留直连 API 调用需要迁移到 apiClient
- Token 存储安全性需要增强
- 测试用例缺失

---

## 8. 项目状态

### 8.1 已完成功能

- ✅ 用户认证和权限系统
- ✅ 学校管理基础功能
- ✅ 教师管理完整功能
- ✅ 学生管理基础功能
- ✅ 团队管理基础功能
- ✅ 学校负责人权限体系
- ✅ 分页功能
- ✅ Markdown/LaTeX 支持

### 8.2 进行中功能

- 🔄 比赛管理功能
- 🔄 Rating 系统完善
- ✅ 题单管理（飞书文档式权限）

### 8.3 计划中功能

- 📋 成绩中心
- 📋 资源管理
- 📋 学生成长报告
- 📋 家长端

---

## 9. 联系方式

- 项目仓库: [GitHub]
- 问题反馈: [Issues]
- 文档位置: `docs/`

---

## 10. 快速参考卡

```
# 启动开发环境
pnpm dev

# 数据库操作
cd apps/server
pnpm prisma:generate  # 生成 Client
pnpm prisma:push      # 推送 schema
pnpm prisma:seed      # 种子数据
npx prisma studio     # 可视化管理

# 测试账号
admin / 123456      # 超管
teacher1 / 123456   # 教师
student1 / 123456   # 学生

# 关键目录
apps/web/src/app/     # 前端页面
apps/server/src/routes/  # 后端 API
apps/server/prisma/   # 数据库
docs/                 # 文档
```

---

## 11. 下一步建议

接手项目后，建议按以下顺序深入了解：

1. **阅读代码**: 从一个完整的业务流程开始（如学生管理）
2. **跟踪请求**: 使用 Network Tab 跟踪一个 API 请求的完整流程
3. **修改实践**: 尝试添加一个小功能或修复一个小问题
4. **阅读测试**: 了解种子数据，理解数据之间的关系
5. **关注文档**: 更新本文档和 KNOWN_ISSUES.md

祝开发顺利！