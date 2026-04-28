#!/bin/bash
# PostgreSQL 自动备份脚本
# 每天凌晨3点备份，保留7天

BACKUP_DIR="/home/ecs-user/oi-manager/backups"
DB_NAME="oi_manager"
DB_USER="oi"
CONTAINER="oi-postgres"
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

docker exec $CONTAINER pg_dump -U $DB_USER $DB_NAME | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "[$(date)] 备份成功: $BACKUP_FILE ($(du -h $BACKUP_FILE | cut -f1))"
  # 删除超过保留天数的旧备份
  find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +$KEEP_DAYS -delete
else
  echo "[$(date)] 备份失败!" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi
