#!/bin/bash
# kill-ports.sh - 杀掉占用指定端口的旧进程
# 用法: ./scripts/kill-ports.sh [端口...]
# 默认杀掉 3000 3001 3002

PORTS="${*:-3000 3001 3002}"

for port in $PORTS; do
  pid=$(lsof -t -i :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "端口 $port 被占用 (PID: $pid)，正在终止..."
    kill $pid 2>/dev/null
    # 等待最多 2 秒让进程退出
    for i in 1 2; do
      if ! lsof -t -i :$port 2>/dev/null | grep -q .; then
        break
      fi
      sleep 1
    done
    # 如果还没退出，强制杀
    pid=$(lsof -t -i :$port 2>/dev/null)
    if [ -n "$pid" ]; then
      echo "强制终止端口 $port (PID: $pid)"
      kill -9 $pid 2>/dev/null
    fi
    echo "端口 $port 已释放"
  fi
done
