#!/bin/bash
# stop-dev.sh - 停止开发环境
# 用法: ./scripts/stop-dev.sh

echo "=== OI Manager 开发环境停止 ==="

# 杀所有 pnpm dev 进程树
echo "[1] 停止 pnpm 进程..."
pkill -f "pnpm dev" 2>/dev/null || true
pkill -f "pnpm --parallel" 2>/dev/null || true

# 杀所有 tsx 进程
echo "[2] 停止 tsx 进程..."
pkill -f "tsx watch" 2>/dev/null || true
pkill -f "tsx src/index" 2>/dev/null || true

# 杀所有 next 进程
echo "[3] 停止 next 进程..."
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true

# 等待进程退出
sleep 2

# 强制清理残留端口进程
echo "[4] 清理残留端口进程..."
for port in 3000 3002 5050; do
  pid=$(lsof -t -i :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "  强制终止端口 $port 进程 (PID: $pid)"
    kill -9 $pid 2>/dev/null || true
  fi
done

echo ""
echo "=== 停止完成 ==="

# 显示当前状态
echo ""
echo "当前进程检查:"
if pgrep -f "pnpm dev" >/dev/null 2>&1; then
  echo "  ⚠️ 仍有 pnpm dev 进程"
else
  echo "  ✅ pnpm dev 进程已清理"
fi

if pgrep -f "tsx" >/dev/null 2>&1; then
  echo "  ⚠️ 仍有 tsx 进程"
else
  echo "  ✅ tsx 进程已清理"
fi

for port in 3000 3002; do
  if lsof -i :$port >/dev/null 2>&1; then
    echo "  ⚠️ 端口 $port 仍被占用"
  else
    echo "  ✅ 端口 $port 已释放"
  fi
done