---
status: current
audience: operations, development
last_verified: 2026-07-30
source_of_truth: scripts, docker-compose.yml, runtime health endpoints
---

# 运行手册

当前服务器项目目录为 `/data/oi-manager`，运行的是开发环境。

## 状态检查

```bash
cd /data/oi-manager
git status --short
docker-compose ps
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3002 -sTCP:LISTEN
lsof -nP -iTCP:5050 -sTCP:LISTEN
curl -fsS http://127.0.0.1:3002/api/health
curl -I http://127.0.0.1:3000/login
```

只应有一组 Web/Server 开发进程监听 `3000/3002`。多个父级 `pnpm` 进程不一定代表
冲突，以监听 PID 和进程树为准。

## 启动与重启

```bash
cd /data/oi-manager
pnpm restart
tail -f /tmp/oi-dev.log
```

`restart` 会：

1. 停止旧 pnpm、tsx 和 Next 开发进程。
2. 确保 PostgreSQL 与 go-judge Docker 服务启动。
3. 等待 PostgreSQL 健康。
4. 后台执行 `pnpm dev`，日志写入 `/tmp/oi-dev.log`。

首次启动或依赖变化前执行：

```bash
pnpm install --frozen-lockfile
docker-compose up -d db judge
pnpm --filter server prisma:generate
```

## 停止

```bash
pnpm stop
docker-compose stop db judge
```

`pnpm stop` 停止应用开发进程；Docker 基础设施需要单独停止。不要在仍有数据库写入时
停止 PostgreSQL。当前服务器使用 `/usr/bin/docker-compose`；安装 Compose Plugin
的环境可使用 `docker compose`。不要执行 `docker-compose down -v` 或
`docker compose down -v`，这两个命令都会删除数据库卷。

## 端口冲突

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3002 -sTCP:LISTEN
ps -fp <PID>
pstree -ap <PID>
pnpm kill-ports
```

不要重复运行多个 `nohup pnpm dev`。统一使用 `pnpm restart`，并在启动后同时检查
监听 PID、健康接口和 `/tmp/oi-dev.log`。

## 日志

| 对象 | 命令或位置 |
|------|------------|
| 开发应用 | `tail -f /tmp/oi-dev.log` |
| PostgreSQL | `docker logs -f oi-postgres` |
| go-judge | `docker logs -f oi-judge` |
| PM2 模板 | `pm2 logs` |

日志可记录请求 ID、用户 ID、资源 ID 和 Judge ID，不应打印 Cookie、JWT、Judge
Token、账号密码或完整源码。

## 数据库

```bash
# 连接与健康
docker exec oi-postgres pg_isready -U oi -d oi_manager
docker exec -it oi-postgres psql -U oi -d oi_manager

# Schema 状态
pnpm --filter server exec prisma validate
pnpm --filter server exec prisma studio
```

任何 `prisma push`、迁移、恢复或维护接口调用前先核对 `DATABASE_URL`。当前开发数据在
`public` schema；测试只能使用 `test/e2e`。

## 备份

```bash
mkdir -p /data/backups/oi-manager
docker exec oi-postgres pg_dump -U oi -Fc oi_manager \
  > /data/backups/oi-manager/oi_manager_$(date +%Y%m%d_%H%M%S).dump
tar -C /data -czf /data/backups/oi-manager/storage_$(date +%Y%m%d_%H%M%S).tar.gz \
  oi-manager-data
```

存储目录以实际 `STORAGE_ROOT` 为准；上例目录必须先核对。恢复属于破坏性操作，应先
停写、创建二次备份并在独立数据库演练。

## 磁盘

```bash
df -h
du -xhd1 /data | sort -h
du -xhd1 /data/oi-manager | sort -h
docker system df
```

清理前确认路径和归属。不要删除数据库卷、当前 `STORAGE_ROOT`、测试数据或未知的
未跟踪文件。
