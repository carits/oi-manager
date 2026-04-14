#!/bin/bash
# kill-ports.sh - 杀掉占用指定端口的旧进程
# 用法: ./scripts/kill-ports.sh [端口...]
# 默认杀掉 3000 3002

PORTS="${*:-3000 3002}"

for port in $PORTS; do
  pid=$(lsof -t -i :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "端口 $port 被占用 (PID: $pid)，正在终止..."
    kill -9 $pid 2>/dev/null
    # 等待最多 3 秒
    for i in 1 2 3; do
      if ! lsof -t -i :$port >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    pid=$(lsof -t -i :$port 2>/dev/null)
    if [ -n "$pid" ]; then
      echo "警告: 端口 $port 仍被占用 (PID: $pid)"
    else
      echo "端口 $port 已释放"
    fi
  fi
done
