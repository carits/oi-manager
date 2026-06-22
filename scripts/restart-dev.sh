#!/bin/bash
# restart-dev.sh - 完整重启开发环境
# 用法: ./scripts/restart-dev.sh

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== OI Manager 开发环境重启 ==="
echo "项目目录: $PROJECT_DIR"
echo ""

# 1. 清理所有旧进程
echo "[1/4] 清理旧进程..."

# 杀所有 pnpm dev 进程树（包括子进程）
pkill -f "pnpm dev" 2>/dev/null || true
pkill -f "pnpm --parallel" 2>/dev/null || true

# 杀所有 tsx watch 进程（judge/server）
pkill -f "tsx watch" 2>/dev/null || true

# 杀所有 next dev 进程
pkill -f "next dev" 2>/dev/null || true

# 杀所有 tsx src/index 进程
pkill -f "tsx src/index" 2>/dev/null || true

# 等待进程退出
sleep 2

# 强制清理残留端口进程
for port in 3000 3002; do
  pid=$(lsof -t -i :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "  强制终止端口 $port 进程 (PID: $pid)"
    kill -9 $pid 2>/dev/null || true
  fi
done

echo "  清理完成"

# 2. 启动 Docker 服务
echo "[2/4] 启动 Docker 服务..."

# PostgreSQL
if ! docker ps | grep -q oi-postgres; then
  echo "  启动 PostgreSQL..."
  docker-compose up -d db
fi

# go-judge 评测沙箱
if ! docker ps | grep -q oi-judge; then
  echo "  启动 go-judge 评测沙箱..."
  docker-compose up -d judge
fi

echo "  Docker 服务就绪"

# 3. 等待 PostgreSQL 健康
echo "[3/4] 等待 PostgreSQL..."
for i in {1..10}; do
  if docker exec oi-postgres pg_isready -U oi -d oi_manager >/dev/null 2>&1; then
    echo "  PostgreSQL 已就绪"
    break
  fi
  sleep 1
done

# 4. 启动开发环境
echo "[4/4] 启动开发环境..."

# 使用 nohup 在后台运行，避免脚本退出时进程被杀
nohup pnpm dev > /tmp/oi-dev.log 2>&1 &

echo "  开发环境启动中..."
sleep 5

# 检查启动状态
echo ""
echo "=== 启动状态检查 ==="
for port in 3000 3002; do
  if lsof -i :$port >/dev/null 2>&1; then
    echo "  ✅ 端口 $port: 已监听"
  else
    echo "  ⏳ 端口 $port: 启动中..."
  fi
done

if docker ps | grep -q oi-judge; then
  echo "  ✅ go-judge: 运行中"
else
  echo "  ❌ go-judge: 未运行"
fi

echo ""
echo "=== 重启完成 ==="
echo "日志: /tmp/oi-dev.log"
echo "访问: http://localhost:3000"