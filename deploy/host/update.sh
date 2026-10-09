#!/usr/bin/env bash
# Atualiza o Triage CRM com a versão desta pasta (backup antes, rollback do build se falhar)
#   sudo bash deploy/host/update.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Execute com sudo."; exit 1; }
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR=/opt/triage-crm/app
NODE_DIR=/opt/triage-crm/runtime/node
PORT=$(sed -n 's/^PORT=//p' /etc/triage-crm/env); PORT=${PORT:-3100}
as_app() {
  sudo -u triagecrm -H env -i PATH="$NODE_DIR/bin:/usr/bin:/bin" HOME=/opt/triage-crm \
    bash -c "set -a; . /etc/triage-crm/env; set +a; cd '$APP_DIR'; $*"
}

echo "• Backup preventivo…";            /usr/local/sbin/triage-crm-backup
echo "• Guardando build atual…";        rm -rf /opt/triage-crm/.next.prev; cp -a "$APP_DIR/.next" /opt/triage-crm/.next.prev
echo "• Copiando código…"
rsync -a --delete --exclude node_modules --exclude .next --exclude .env --exclude '.env.*' \
  --exclude public/uploads --exclude docs/screenshots --exclude .git "$SRC_DIR/" "$APP_DIR/"
chown -R triagecrm:triagecrm "$APP_DIR"; chmod -R o-rwx "$APP_DIR"
echo "• Dependências…";                 as_app "npm ci --no-audit --no-fund --loglevel=error"
echo "• Migrations…";                   as_app "npm run -s db:migrate"
echo "• Build…"
if ! as_app "NEXT_TELEMETRY_DISABLED=1 npm run -s build"; then
  echo "✖ Build falhou — restaurando a versão anterior (o banco já migrado é compatível para trás?)"
  rm -rf "$APP_DIR/.next"; cp -a /opt/triage-crm/.next.prev "$APP_DIR/.next"; chown -R triagecrm:triagecrm "$APP_DIR/.next"
  exit 1
fi
install -d -m 750 -o triagecrm -g triagecrm "$APP_DIR/.next/cache"

# Unidade systemd e snippets do Nginx podem ter mudado nesta versão
PG_UNIT=$(sed -n 's/^Requires=//p' /etc/systemd/system/triage-crm.service)
sed -e "s#__PG_UNIT__#$PG_UNIT#g" "$SRC_DIR/deploy/host/triage-crm.service" > /etc/systemd/system/triage-crm.service
systemctl daemon-reload
cp /etc/nginx/snippets/triage-crm-locations.conf /tmp/triage-locations.bak
install -m 644 "$SRC_DIR/deploy/host/nginx/triage-crm-proxy.conf" /etc/nginx/snippets/triage-crm-proxy.conf
sed -e "s#__PORT__#$PORT#g" "$SRC_DIR/deploy/host/nginx/triage-crm-locations.conf.template" > /etc/nginx/snippets/triage-crm-locations.conf
[[ -f /proc/net/if_inet6 ]] || sed -i '/listen \[::\]/d' /etc/nginx/snippets/triage-crm-locations.conf
if nginx -t -q 2>/dev/null; then systemctl reload nginx; else cp /tmp/triage-locations.bak /etc/nginx/snippets/triage-crm-locations.conf; echo "⚠ snippet do Nginx revertido (nginx -t falhou)"; fi

systemctl restart triage-crm
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && { echo "✔ Atualizado e no ar"; exit 0; }; sleep 1; done
journalctl -u triage-crm -n 40 --no-pager; echo "✖ O serviço não respondeu após a atualização"; exit 1
