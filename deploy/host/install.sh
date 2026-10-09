#!/usr/bin/env bash
# Variante SEM Docker (Nginx + systemd no host). Para a VPS atual, que usa Docker + Traefik, use deploy/docker/install.sh
# ════════════════════════════════════════════════════════════════════
#  Triage CRM — instalação ISOLADA na VPS (Ubuntu 24.04)
# ════════════════════════════════════════════════════════════════════
#  Tudo do CRM fica separado dos outros projetos do servidor:
#
#   Item               Onde fica / como é isolado
#   ─────────────────  ─────────────────────────────────────────────────
#   Usuário Linux      triagecrm (sem login, sem sudo)
#   Código             /opt/triage-crm/app            (dono: triagecrm)
#   Node.js            /opt/triage-crm/runtime/node   (privado, não mexe no Node global)
#   Segredos           /etc/triage-crm/env            (640 root:triagecrm)
#   Uploads            /var/lib/triage-crm/uploads
#   Banco              cluster PostgreSQL PRÓPRIO na porta 5433 (não toca no Postgres existente)
#   Processo           systemd triage-crm.service com sandbox (não usa o PM2 dos outros apps)
#   Rede               escuta só em 127.0.0.1:3100; acesso externo só pelo Nginx
#   Nginx              site próprio, logs próprios, rate limit próprio
#   Backups            /var/backups/triage-crm (diário, 14 dias)
#
#  Uso (na pasta do projeto já copiada para a VPS):
#     sudo ADMIN_EMAIL=voce@businesstriage.com.br bash deploy/host/install.sh
#
#  Variáveis opcionais: DOMAIN, PORT, PG_PORT, NODE_MAJOR, ADMIN_NAME, ADMIN_PASSWORD
#  O script é idempotente: pode ser executado de novo sem perder dados nem segredos.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="${DOMAIN:-crm.businesstriage.com.br}"
PORT="${PORT:-3100}"
PG_PORT="${PG_PORT:-5433}"
NODE_MAJOR="${NODE_MAJOR:-22}"
APP_USER="triagecrm"
DB_NAME="triage_crm"
DB_ROLE="triage_crm"
PG_CLUSTER="triagecrm"

BASE="/opt/triage-crm"
APP_DIR="$BASE/app"
NODE_DIR="$BASE/runtime/node"
ETC_DIR="/etc/triage-crm"
ENV_FILE="$ETC_DIR/env"
DATA_DIR="/var/lib/triage-crm"
BACKUP_DIR="/var/backups/triage-crm"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

c_ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
c_info() { printf '\033[36m• %s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
die()    { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# Executa um comando como o usuário do CRM, com o Node privado e o .env carregado
as_app() {
  sudo -u "$APP_USER" -H env -i PATH="$NODE_DIR/bin:/usr/bin:/bin" HOME="$BASE" \
    bash -c "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR'; $*"
}

# ─────────────────────────── 0. Pré-checagens ───────────────────────────
[[ $EUID -eq 0 ]] || die "Execute com sudo."
[[ -f "$SRC_DIR/package.json" && -f "$SRC_DIR/server.ts" ]] || die "Rode a partir da pasta do projeto (deploy/host/install.sh)."
grep -q 'VERSION_ID="24' /etc/os-release || c_warn "Testado para Ubuntu 24.04; continue por sua conta."

if ss -ltnp 2>/dev/null | grep -q ":$PORT " && ! systemctl is-active --quiet triage-crm; then
  die "A porta $PORT já está em uso por outro serviço. Use PORT=xxxx sudo bash deploy/host/install.sh"
fi
if ss -ltnp 2>/dev/null | grep -q ":$PG_PORT " && ! pg_lsclusters 2>/dev/null | grep -q " $PG_CLUSTER "; then
  die "A porta $PG_PORT já está em uso. Use PG_PORT=xxxx"
fi

FIRST_INSTALL=0
[[ -f "$ENV_FILE" ]] || FIRST_INSTALL=1
if [[ $FIRST_INSTALL -eq 1 && -z "${ADMIN_EMAIL:-}" ]]; then
  die "Primeira instalação: informe ADMIN_EMAIL=seu@email (será o Super Admin)."
fi

# ─────────────────────────── 1. Pacotes do sistema ───────────────────────────
c_info "Verificando pacotes (curl, rsync, xz, nginx, certbot, postgresql)…"
NEED=()
for pkg in curl rsync xz-utils nginx certbot postgresql postgresql-common; do
  dpkg -s "$pkg" >/dev/null 2>&1 || NEED+=("$pkg")
done
if ((${#NEED[@]})); then
  # Não cria o cluster "main" padrão (porta 5432 pode já estar em uso, ex.: Postgres em Docker).
  # O CRM usa apenas o cluster dedicado criado mais abaixo.
  install -d /etc/postgresql-common/createcluster.d
  echo "create_main_cluster = false" > /etc/postgresql-common/createcluster.d/00-triagecrm-no-main.conf
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${NEED[@]}"
fi
c_ok "Pacotes ok"

# ─────────────────────────── 2. Usuário e pastas ───────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin --user-group "$APP_USER"
  c_ok "Usuário $APP_USER criado"
fi
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$BASE" "$BASE/runtime" "$APP_DIR"
install -d -m 750 -o root -g "$APP_USER" "$ETC_DIR"
# dados: só o CRM escreve; o Nginx (www-data) apenas atravessa e lê os uploads
install -d -m 710 -o "$APP_USER" -g www-data "$DATA_DIR"
install -d -m 2750 -o "$APP_USER" -g www-data "$DATA_DIR/uploads"   # setgid: arquivos novos herdam o grupo www-data
install -d -m 700 -o root -g root "$BACKUP_DIR"
c_ok "Pastas isoladas criadas"

# ─────────────────────────── 3. Node.js privado ───────────────────────────
if [[ ! -x "$NODE_DIR/bin/node" ]] || [[ "$("$NODE_DIR/bin/node" -v | cut -d. -f1)" != "v$NODE_MAJOR" ]]; then
  c_info "Baixando Node.js $NODE_MAJOR (privado do CRM)…"
  TMP=$(mktemp -d)
  BASEURL="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  TARBALL=$(curl -fsSL "$BASEURL/SHASUMS256.txt" | awk '/linux-x64.tar.xz$/ {print $2}')
  curl -fsSL "$BASEURL/$TARBALL" -o "$TMP/$TARBALL"
  (cd "$TMP" && curl -fsSL "$BASEURL/SHASUMS256.txt" | grep " $TARBALL\$" | sha256sum -c --quiet -)
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$TMP/$TARBALL" -C "$NODE_DIR" --strip-components=1
  chown -R root:"$APP_USER" "$NODE_DIR" && chmod -R o-rwx "$NODE_DIR"
  rm -rf "$TMP"
fi
c_ok "Node $("$NODE_DIR/bin/node" -v) em $NODE_DIR"

# ─────────────────────────── 4. PostgreSQL dedicado ───────────────────────────
PG_VER=$(ls /usr/lib/postgresql | sort -V | tail -1)
if ! pg_lsclusters --no-header | awk '{print $1" "$2}' | grep -qx "$PG_VER $PG_CLUSTER"; then
  c_info "Criando cluster PostgreSQL $PG_VER/$PG_CLUSTER na porta $PG_PORT…"
  pg_createcluster "$PG_VER" "$PG_CLUSTER" --port "$PG_PORT" -- --auth-local=peer --auth-host=scram-sha-256 >/dev/null
fi
cat > "/etc/postgresql/$PG_VER/$PG_CLUSTER/conf.d/10-triagecrm.conf" <<CONF
# Gerado por deploy/host/install.sh — cluster exclusivo do Triage CRM
listen_addresses = '127.0.0.1'
port = $PG_PORT
max_connections = 40
shared_buffers = 128MB
password_encryption = scram-sha-256
log_min_duration_statement = 1000
CONF
PG_UNIT="postgresql@$PG_VER-$PG_CLUSTER.service"
systemctl enable --now "$PG_UNIT" >/dev/null
systemctl restart "$PG_UNIT"

# Segredos: gerados apenas na primeira instalação
if [[ $FIRST_INSTALL -eq 1 ]]; then
  DB_PASS=$(openssl rand -hex 24)
  umask 027
  cat > "$ENV_FILE" <<ENV
# Triage CRM — gerado por deploy/host/install.sh em $(date -Iseconds)
DATABASE_URL="postgresql://$DB_ROLE:$DB_PASS@127.0.0.1:$PG_PORT/$DB_NAME"
DB_POOL_MAX=10
PORT=$PORT
ROOT_DOMAIN="$DOMAIN"
NEXT_PUBLIC_ROOT_DOMAIN="$DOMAIN"
PUBLIC_URL="https://$DOMAIN"
DEFAULT_TENANT_SLUG="business-triage"
AUTH_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
CRON_SECRET="$(openssl rand -hex 24)"
UPLOAD_DIR="$DATA_DIR/uploads"

# E-mail (preencha para lembretes e automações de e-mail)
SMTP_HOST=""
SMTP_PORT=465
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="Business Triage CRM <crm@businesstriage.com.br>"

# WhatsApp (Evolution API)
EVOLUTION_API_URL=""
EVOLUTION_API_KEY=""

# Instagram (Meta)
META_VERIFY_TOKEN="$(openssl rand -hex 16)"
ENV
  umask 022
  chown root:"$APP_USER" "$ENV_FILE" && chmod 640 "$ENV_FILE"
  c_ok "Segredos gerados em $ENV_FILE"
fi
DB_PASS=$(sed -n 's#^DATABASE_URL="postgresql://[^:]*:\([^@]*\)@.*#\1#p' "$ENV_FILE")

sudo -u postgres psql -q -p "$PG_PORT" -v ON_ERROR_STOP=1 -v pw="$DB_PASS" <<SQL
SELECT 'CREATE ROLE $DB_ROLE LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_ROLE')\gexec
-- Sem superusuário e sem BYPASSRLS: o Row Level Security vale sempre para o app
ALTER ROLE $DB_ROLE WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'pw';
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_ROLE ENCODING ''UTF8'' TEMPLATE template0' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE $DB_NAME TO $DB_ROLE;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
\c $DB_NAME
ALTER SCHEMA public OWNER TO $DB_ROLE;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
c_ok "PostgreSQL dedicado: $PG_UNIT (127.0.0.1:$PG_PORT, banco $DB_NAME)"

# ─────────────────────────── 5. Código ───────────────────────────
c_info "Copiando código para $APP_DIR…"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude .env --exclude '.env.*' \
  --exclude public/uploads --exclude docs/screenshots --exclude .git \
  "$SRC_DIR/" "$APP_DIR/"
cp "$SRC_DIR/.env.example" "$APP_DIR/.env.example" 2>/dev/null || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod -R o-rwx "$APP_DIR"

c_info "Instalando dependências (npm ci)…"
as_app "npm ci --no-audit --no-fund --loglevel=error"
c_info "Aplicando migrations + Row Level Security…"
as_app "npm run -s db:migrate"

if [[ $FIRST_INSTALL -eq 1 ]]; then
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)}"
  as_app "ADMIN_NAME='${ADMIN_NAME:-Administrador}' ADMIN_EMAIL='$ADMIN_EMAIL' ADMIN_PASSWORD='$ADMIN_PASSWORD' npm run -s db:bootstrap"
  umask 077
  printf 'URL: https://%s\nE-mail: %s\nSenha: %s\n' "$DOMAIN" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" > /root/triage-crm-admin.txt
  umask 022
fi

c_info "Gerando build de produção…"
as_app "NEXT_TELEMETRY_DISABLED=1 npm run -s build"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/.next/cache"
c_ok "Aplicação compilada"

# ─────────────────────────── 6. Serviço systemd ───────────────────────────
sed -e "s#__PG_UNIT__#$PG_UNIT#g" "$SRC_DIR/deploy/host/triage-crm.service" > /etc/systemd/system/triage-crm.service
systemctl daemon-reload
systemctl enable triage-crm >/dev/null
systemctl restart triage-crm
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
  [[ $i -eq 30 ]] && { journalctl -u triage-crm -n 40 --no-pager; die "O CRM não respondeu em 127.0.0.1:$PORT"; }
done
c_ok "Serviço triage-crm ativo (systemctl status triage-crm)"

# ─────────────────────────── 7. Nginx ───────────────────────────
install -m 644 "$SRC_DIR/deploy/host/nginx/triage-crm-proxy.conf" /etc/nginx/snippets/triage-crm-proxy.conf
sed -e "s#__PORT__#$PORT#g" "$SRC_DIR/deploy/host/nginx/triage-crm-locations.conf.template" > /etc/nginx/snippets/triage-crm-locations.conf
install -d -m 755 /var/www/letsencrypt
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
SITE="/etc/nginx/sites-available/triage-crm"
[[ -f "$SITE" ]] && cp "$SITE" "$SITE.bak"
if [[ -f "$CERT" ]]; then
  sed -e "s#__DOMAIN__#$DOMAIN#g" "$SRC_DIR/deploy/host/nginx/triage-crm.conf.template" > "$SITE"
else
  # Ainda sem certificado: publica só HTTP com o desafio ACME e um aviso
  cat > "$SITE" <<NGX
# Temporário (sem SSL). Gere o certificado e execute install.sh de novo.
map \$http_upgrade \$triagecrm_conn_upgrade { default upgrade; '' close; }
limit_req_zone \$binary_remote_addr zone=triagecrm_login:10m rate=10r/m;
limit_req_zone \$binary_remote_addr zone=triagecrm_api:10m  rate=20r/s;
server {
  listen 80;
  server_name $DOMAIN *.$DOMAIN;
  location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
  location / { return 503 "Triage CRM: certificado SSL pendente\n"; }
}
NGX
fi
# Servidor sem IPv6? remove as diretivas "listen [::]" para não quebrar o nginx
if [[ ! -f /proc/net/if_inet6 ]]; then
  sed -i '/listen \[::\]/d' "$SITE" /etc/nginx/snippets/triage-crm-locations.conf
fi
ln -sf "$SITE" /etc/nginx/sites-enabled/triage-crm
if ! nginx -t -q 2>/tmp/triage-nginx.err; then
  # Nunca deixa uma configuração quebrada derrubar os outros sites
  if [[ -f "$SITE.bak" ]]; then mv "$SITE.bak" "$SITE"; else rm -f /etc/nginx/sites-enabled/triage-crm; fi
  cat /tmp/triage-nginx.err
  die "nginx -t falhou — configuração do CRM revertida; os demais sites seguem intactos."
fi
rm -f "$SITE.bak"
systemctl reload nginx
c_ok "Nginx: site triage-crm ($DOMAIN e *.$DOMAIN)"

# ─────────────────────────── 8. Backups ───────────────────────────
sed -e "s#__PG_PORT__#$PG_PORT#g" -e "s#__DB_NAME__#$DB_NAME#g" "$SRC_DIR/deploy/host/backup.sh" > /usr/local/sbin/triage-crm-backup
chmod 700 /usr/local/sbin/triage-crm-backup
echo "17 3 * * * root /usr/local/sbin/triage-crm-backup >/dev/null 2>&1" > /etc/cron.d/triage-crm-backup
c_ok "Backup diário às 03:17 em $BACKUP_DIR"

# ─────────────────────────── Resumo ───────────────────────────
echo
c_ok "Triage CRM instalado de forma isolada."
if [[ ! -f "$CERT" ]]; then
  c_warn "Falta o certificado SSL wildcard. Crie no DNS:  A  ${DOMAIN%%.*}  e  A  *.${DOMAIN%%.*}  → IP desta VPS"
  echo "   Depois rode:"
  echo "   sudo certbot certonly --manual --preferred-challenges dns -d $DOMAIN -d '*.$DOMAIN'"
  echo "   e então:  sudo bash deploy/host/install.sh   (de novo, para ativar o HTTPS)"
fi
[[ $FIRST_INSTALL -eq 1 ]] && c_info "Credenciais do Super Admin salvas em /root/triage-crm-admin.txt (apague após o primeiro login)."
echo "   Logs:      journalctl -u triage-crm -f"
echo "   Segredos:  $ENV_FILE  (após editar: systemctl restart triage-crm)"
echo "   Atualizar: sudo bash deploy/host/update.sh"
