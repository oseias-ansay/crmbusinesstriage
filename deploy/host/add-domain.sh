#!/usr/bin/env bash
# Publica o domínio próprio de um cliente white-label (ex.: crm.cliente.com.br)
#   1) o cliente cria:  CNAME crm.cliente.com.br → <slug>.crm.businesstriage.com.br
#   2) você cadastra o domínio no tenant (Admin Global ou Configurações → Marca)
#   3) sudo bash deploy/host/add-domain.sh crm.cliente.com.br
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Execute com sudo."; exit 1; }
CLIENT="${1:?Informe o domínio: sudo bash deploy/host/add-domain.sh crm.cliente.com.br}"
[[ "$CLIENT" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Domínio inválido"; exit 1; }
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT=$(sed -n 's/^PORT=//p' /etc/triage-crm/env); PORT=${PORT:-3100}
SITE="/etc/nginx/sites-available/triage-crm-$CLIENT"

# O domínio precisa estar cadastrado em algum tenant
curl -fsS "http://127.0.0.1:$PORT/api/tls/allow?domain=$CLIENT" >/dev/null \
  || { echo "✖ $CLIENT não está cadastrado em nenhum tenant do CRM."; exit 1; }

if [[ ! -f "/etc/letsencrypt/live/$CLIENT/fullchain.pem" ]]; then
  printf 'server {\n  listen 80;\n  server_name %s;\n  location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }\n}\n' "$CLIENT" > "$SITE"
  ln -sf "$SITE" "/etc/nginx/sites-enabled/triage-crm-$CLIENT"
  nginx -t -q && systemctl reload nginx
  certbot certonly --webroot -w /var/www/letsencrypt -d "$CLIENT" --non-interactive --agree-tos --register-unsafely-without-email \
    --deploy-hook "systemctl reload nginx"
fi
sed -e "s#__CLIENT__#$CLIENT#g" "$SRC_DIR/deploy/host/nginx/client-domain.conf.template" > "$SITE"
ln -sf "$SITE" "/etc/nginx/sites-enabled/triage-crm-$CLIENT"
if nginx -t -q; then systemctl reload nginx; echo "✔ https://$CLIENT publicado (renovação automática do SSL)"
else rm -f "/etc/nginx/sites-enabled/triage-crm-$CLIENT"; echo "✖ nginx -t falhou; domínio removido"; exit 1; fi
