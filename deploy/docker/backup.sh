#!/usr/bin/env bash
# Backup do Triage CRM: banco + uploads + segredos.
#  - cópia local em $APP_DIR/backups (14 dias)
#  - cópia CRIPTOGRAFADA no Google Drive, se configurado (offsite-setup.sh) — 30 dias
# Diário via /etc/cron.d/triage-crm
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/apps/triage-crm}"
DEST="$APP_DIR/backups"
REMOTE="triagecrm-gdrive"
KEYFILE="$APP_DIR/.backup-key"
STAMP=$(date +%F_%H%M)
umask 077; mkdir -p "$DEST"; cd "$APP_DIR"

docker compose exec -T db pg_dump -U postgres -Fc triage_crm > "$DEST/db_$STAMP.dump"
docker run --rm -v triage-crm-uploads:/u:ro -v "$DEST":/b busybox:1.36 tar czf "/b/uploads_$STAMP.tar.gz" -C /u .
tar czf "$DEST/secrets_$STAMP.tar.gz" .env app.env
find "$DEST" -type f -mtime +14 -delete
echo "✔ Backup local: $DEST/*_$STAMP*"

# ── Cópia externa (Google Drive) ──
if command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -qx "$REMOTE:" && [[ -f "$KEYFILE" ]]; then
  PKG="$DEST/triage-crm_$STAMP.tar.enc"
  tar cf - -C "$DEST" "db_$STAMP.dump" "uploads_$STAMP.tar.gz" "secrets_$STAMP.tar.gz" \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEYFILE" -out "$PKG"
  if rclone copy "$PKG" "$REMOTE:TriageCRM-backups" --retries 3 --low-level-retries 5; then
    echo "✔ Enviado ao Google Drive: TriageCRM-backups/$(basename "$PKG")"
    rclone delete "$REMOTE:TriageCRM-backups" --min-age 30d >/dev/null 2>&1 || true
  else
    echo "✖ Falha ao enviar ao Google Drive (o backup local está ok)" >&2
  fi
  rm -f "$PKG"
fi
