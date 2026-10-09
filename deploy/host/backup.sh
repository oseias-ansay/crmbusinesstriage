#!/usr/bin/env bash
# /usr/local/sbin/triage-crm-backup — backup do Triage CRM (banco + uploads)
# Instalado por deploy/host/install.sh; roda diariamente via /etc/cron.d/triage-crm-backup
set -euo pipefail
DEST=/var/backups/triage-crm
STAMP=$(date +%F_%H%M)
umask 077
sudo -u postgres pg_dump -p __PG_PORT__ -Fc __DB_NAME__ > "$DEST/db_$STAMP.dump"
tar -czf "$DEST/uploads_$STAMP.tar.gz" -C /var/lib/triage-crm uploads
cp /etc/triage-crm/env "$DEST/env_$STAMP"
find "$DEST" -type f -mtime +14 -delete
echo "Backup ok: $DEST/*_$STAMP*"
