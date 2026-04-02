# 本地开发运维手册 (Runbook)

> 最后更新: 2026-03-23

本文档描述如何在本地启动、调试和维护 OI Manager V2 系统。

---

## 1. 环境要求

| 依赖 | 版本要求 | 检查命令 |
|------|----------|----------|
| Node.js | >= 18.0 | `node -v` |
| pnpm | >= 8.0 | `pnpm -v` |
| SQLite | >= 3.0 | `sqlite3 --version` |

---

## 2. 首次启动

### 2.1 安装依赖

```bash
# 在项目根目录
pnpm install
```

### 2.2 初始化数据库

```bash
cd apps/server

# 生成 Prisma Client
pnpm prisma:generate

# 推送 schema 到数据库（创建表结构）
pnpm prisma:push

# 执行种子数据（创建测试账号）
pnpm prisma:seed
```

### 2.3 启动开发环境

```bash
# 在项目根目录，同时启动前端和后端
pnpm dev
```

或者分别启动：

```bash
# 终端 1 - 启动后端 (端口 3001)
cd apps/server
pnpm dev

# 终端 2 - 启动前端 (端口 3000)
cd apps/web
pnpm dev
```

### 2.4 访问应用

- **前端**: http://localhost:3000
- **后端 API**: http://localhost:3001

---

## 3. 测试账号

种子数据创建的默认账号：

| 角色 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 超级管理员 | `admin` | `123456` | 系统最高权限 |
| 平台管理员 | `platform_admin` | `123456` | 平台管理权限 |
| 学校负责人 | `principal` | `123456` | 示例学校负责人 |
| 教师 | `teacher1` | `123456` | 示例教师 |
| 学生 | `student1` | `123456` | 示例学生 |

> ⚠️ 生产环境请务必修改默认密码

---

## 4. 常用命令

### 4.1 根目录命令

```bash
pnpm dev          # 并行启动所有服务
pnpm build        # 构建所有项目
pnpm lint         # 代码检查
```

### 4.2 后端命令 (apps/server)

```bash
pnpm dev              # 开发模式（热重载）
pnpm build            # 编译 TypeScript
pnpm start            # 生产模式运行

# Prisma 相关
pnpm prisma:generate  # 生成 Prisma Client
pnpm prisma:migrate   # 创建并应用迁移
pnpm prisma:push      # 直接推送 schema（开发用）
pnpm prisma:seed      # 执行种子数据
```

### 4.3 前端命令 (apps/web)

```bash
pnpm dev      # 开发模式
pnpm build    # 生产构建
pnpm start    # 生产模式运行
pnpm lint     # ESLint 检查
```

---

## 5. 数据库操作

### 5.1 查看 Prisma Schema

```bash
# 在 apps/server 目录
cat prisma/schema.prisma
```

### 5.2 数据库文件位置

```
apps/server/prisma/dev.db
```

### 5.3 重置数据库

```bash
cd apps/server

# 删除数据库文件
rm prisma/dev.db

# 重新推送 schema
pnpm prisma:push

# 重新执行种子数据
pnpm prisma:seed
```

### 5.4 使用 Prisma Studio

```bash
cd apps/server
npx prisma studio
```

浏览器访问 http://localhost:5555 可视化管理数据库。

---

## 6. 环境变量

### 6.1 前端环境变量

文件位置: `apps/web/.env.local`

```bash
# API 服务地址
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 6.2 后端环境变量

文件位置: `apps/server/.env`

```bash
# 数据库
DATABASE_URL="file:./prisma/dev.db"

# JWT
JWT_SECRET="your-secret-key"

# 服务端口
PORT=3001
```

---

## 7. 常见问题

### 7.1 端口被占用

**症状**: 启动时报错 `EADDRINUSE: address already in use :::3000`

**解决**:
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :3000
kill -9 <PID>
```

### 7.2 Prisma Client 未生成

**症状**: `Cannot find module '@prisma/client'`

**解决**:
```bash
cd apps/server
pnpm prisma:generate
```

### 7.3 数据库 Schema 变更后报错

**症状**: 数据库结构与 schema 不匹配

**解决**:
```bash
cd apps/server
pnpm prisma:push
```

### 7.4 前端无法连接后端

**症状**: 前端请求报 `Network Error` 或 `CORS Error`

**排查步骤**:
1. 确认后端已启动: 访问 http://localhost:3001/api/health
2. 检查 `NEXT_PUBLIC_API_URL` 环境变量
3. 检查后端 CORS 配置

### 7.5 登录后立即退出

**症状**: 登录成功但马上被踢出

**排查步骤**:
1. 清除浏览器 localStorage
2. 检查 JWT_SECRET 是否正确
3. 检查后端日志是否有认证错误

---

## 8. 调试技巧

### 8.1 后端日志

后端使用 `console.log` 输出日志，直接查看终端输出即可。

### 8.2 前端调试

1. **React DevTools**: 浏览器扩展
2. **Network Tab**: 查看 API 请求
3. **Console**: 查看 JavaScript 错误

### 8.3 数据库查询

```bash
# 使用 Prisma Studio
npx prisma studio

# 或直接使用 sqlite3
sqlite3 apps/server/prisma/dev.db
```

---

## 9. 目录结构速查

```
oi-manager-v2/
├── apps/
│   ├── web/                    # 前端
│   │   ├── src/
│   │   │   ├── app/            # 页面
│   │   │   ├── components/     # 组件
│   │   │   ├── hooks/          # Hooks
│   │   │   ├── lib/            # 工具
│   │   │   └── config/         # 配置
│   │   └── .env.local          # 前端环境变量
│   │
│   └── server/                 # 后端
│       ├── src/
│       │   ├── routes/         # API 路由
│       │   ├── middleware/     # 中间件
│       │   └── index.ts        # 入口
│       ├── prisma/
│       │   ├── schema.prisma   # 数据库模型
│       │   ├── seed.ts         # 种子数据
│       │   └── dev.db          # 数据库文件
│       └── .env                # 后端环境变量
│
└── docs/                       # 文档
```

---

## 10. 健康检查

### 10.1 后端健康检查

```bash
curl http://localhost:3001/api/health
```

### 10.2 前端健康检查

访问 http://localhost:3000 应看到登录页面。

### 10.3 数据库健康检查

```bash
cd apps/server
npx prisma db pull
# 无报错则正常
```

---

## 11. 生产部署提示

> 本项目当前为 MVP 版本，生产部署需要额外配置：

1. **环境变量**: 修改所有默认密码和密钥
2. **数据库**: 考虑迁移到 PostgreSQL/MySQL
3. **反向代理**: 使用 Nginx
4. **HTTPS**: 配置 SSL 证书
5. **进程管理**: 使用 PM2 或 Docker
