#!/bin/bash
# Runs in the "backup" container: dumps the database when it starts and then every 24
# hours into /backups (the backups folder next to docker-compose.yml), and deletes
# dumps older than KEEP_DAYS days. Restore one with:
#   gunzip -c backups/binmania-<date>.sql.gz | docker compose exec -T db sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
set -uo pipefail

# On a new server this can start before the app has made the tables; wait for them.
until mysql -h db -u "$DB_USER" -N -e "SELECT 1 FROM schema_migrations LIMIT 1" "$DB_NAME" >/dev/null 2>&1; do
  sleep 10
done

while true; do
  file="/backups/binmania-$(date -u +%Y-%m-%d-%H%M).sql.gz"
  if mysqldump -h db -u "$DB_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF "$DB_NAME" | gzip > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "Backup written: $(basename "$file") ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "Backup FAILED at $(date -u)" >&2
  fi
  find /backups -name 'binmania-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
  sleep 86400
done
