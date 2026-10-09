#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Triage CRM — instalação em Docker atrás do Traefik existente
# ════════════════════════════════════════════════════════════════════
#  Cria o projeto Docker "triage-crm" em /opt/apps/triage-crm, separado dos
#  demais (site, n8n, Supabase, Evolution…). Nada desses projetos é alterado:
#  o CRM apenas se registra no Traefik pela rede traefik-proxy.
#
#  Uso (na pasta do projeto descompactada na VPS):
#     sudo ADMIN_NAME="Oseias" ADMIN_EMAIL="voce@dominio" bash deploy/docker/install.sh
#  Opcionais: DOMAIN (padrão crm.businesstriage.com.br), ADMIN_PASSWORD,
#             EVOLUTION_CONTAINER (padrão "evolution"; "none" para não conectar)
#  Idempotente: pode rodar de novo sem perder dados nem segredos.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
DOMAIN="${DOMAIN:-crm.businesstriage.com.br}"
APP_DIR="/opt/apps/triage-crm"
EVOLUTION_CONTAINER="${EVOLUTION_CONTAINER:-evolution}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
info() { printf '\033[36m• %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
rnd()  { openssl rand -hex "${1:-24}"; }

# ─── 0. Pré-checagens ───
[[ $EUID -eq 0 ]] || die "Execute com sudo."
[[ -f "$SRC_DIR/compose.yml" && -f "$SRC_DIR/Dockerfile" ]] || die "Rode a partir da pasta do projeto."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 não encontrado."
docker network inspect traefik-proxy >/dev/null 2>&1 || die "Rede traefik-proxy não existe (o Traefik está rodando?)."
docker ps --format '{{.Image}}' | grep -q '^traefik' || warn "Container do Traefik não encontrado em execução."

FIRST=0; [[ -f "$APP_DIR/.env" ]] || FIRST=1
[[ $FIRST -eq 1 && -z "${ADMIN_EMAIL:-}" ]] && die "Primeira instalação: informe ADMIN_EMAIL=seu@email"

# DNS (aviso — o Traefik só emite o SSL quando o DNS aponta para cá)
MYIP=$(curl -fsS -4 --max-time 5 ifconfig.me || true)
DNSIP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [[ -z "$DNSIP" ]]; then warn "$DOMAIN ainda não resolve no DNS. Crie A $DOMAIN → $MYIP (o SSL só sai depois disso)."
elif [[ -n "$MYIP" && "$DNSIP" != "$MYIP" ]]; then warn "$DOMAIN aponta para $DNSIP, mas esta VPS é $MYIP."
else ok "DNS de $DOMAIN aponta para esta VPS"; fi

# ─── 1. Código ───
info "Copiando projeto para $APP_DIR…"
command -v rsync >/dev/null || { apt-get update -qq && apt-get install -y -qq rsync; }
install -d -m 700 "$APP_DIR" "$APP_DIR/backups"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude data --exclude docs/screenshots \
  --exclude .env --exclude app.env --exclude compose.routes.yml --exclude compose.evolution.yml --exclude backups \
  "$SRC_DIR/" "$APP_DIR/"
cd "$APP_DIR"

# ─── 2. Segredos (somente na primeira vez) ───
if [[ $FIRST -eq 1 ]]; then
  umask 077
  cat > .env <<ENV
# Variáveis do Docker Compose (Triage CRM) — gerado em $(date -Iseconds)
COMPOSE_PROJECT_NAME=triage-crm
COMPOSE_FILE=compose.yml:compose.routes.yml
DOMAIN=$DOMAIN
PG_SUPERUSER_PASSWORD=$(rnd 24)
APP_DB_PASSWORD=$(rnd 24)
ENV
  cat > app.env <<ENV
# Configuração do app (Triage CRM). Após editar: docker compose up -d app
DEFAULT_TENANT_SLUG=business-triage
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=')
CRON_SECRET=$(rnd 24)
DB_POOL_MAX=10

# E-mail (lembretes de tarefas e automações)
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Business Triage CRM <crm@businesstriage.com.br>

# WhatsApp — Evolution API (container "evolution" na mesma VPS)
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
# IA que move os cards (opcional; pode ser a mesma chave Anthropic da finance-api)
ANTHROPIC_API_KEY=

# Instagram (Meta)
META_VERIFY_TOKEN=$(rnd 16)
ENV
  umask 022
  ok "Segredos gerados em $APP_DIR/.env e app.env (600)"
fi
chmod 600 .env app.env

# ─── 3. Ligação opcional com a Evolution API (só a API, nada mais) ───
if [[ "$EVOLUTION_CONTAINER" != "none" ]] && docker inspect "$EVOLUTION_CONTAINER" >/dev/null 2>&1; then
  EVO_NET=$(docker inspect "$EVOLUTION_CONTAINER" -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | grep -v '^traefik-proxy$' | head -1)
  if [[ -n "$EVO_NET" ]]; then
    cat > compose.evolution.yml <<YML
# GERADO por install.sh — conecta APENAS o app do CRM à rede da Evolution API
services:
  app:
    networks: [internal, traefik-proxy, evolution]
networks:
  evolution:
    name: $EVO_NET
    external: true
YML
    grep -q 'compose.evolution.yml' .env || sed -i 's#^COMPOSE_FILE=.*#&:compose.evolution.yml#' .env
    grep -q '^EVOLUTION_API_URL=$' app.env && sed -i "s#^EVOLUTION_API_URL=\$#EVOLUTION_API_URL=http://$EVOLUTION_CONTAINER:8080#" app.env
    ok "App ligado à Evolution API pela rede '$EVO_NET' (http://$EVOLUTION_CONTAINER:8080)"
  fi
fi

# ─── 4. Rotas iniciais + build ───
bash deploy/docker/sync-domains.sh --no-apply
info "Construindo a imagem (2–5 min)…"
docker compose build --pull app
docker tag triage-crm:latest triage-crm:previous 2>/dev/null || true

# ─── 5. Subir banco e app ───
docker compose up -d db
info "Aguardando o banco…"
for _ in $(seq 1 60); do [[ "$(docker inspect -f '{{.State.Health.Status}}' triage-crm-db)" == healthy ]] && break; sleep 2; done
[[ "$(docker inspect -f '{{.State.Health.Status}}' triage-crm-db)" == healthy ]] || die "Banco não ficou saudável: docker compose logs db"

docker compose up -d app
info "Aguardando o app (migrations + start)…"
for _ in $(seq 1 90); do [[ "$(docker inspect -f '{{.State.Health.Status}}' triage-crm-app)" == healthy ]] && break; sleep 2; done
[[ "$(docker inspect -f '{{.State.Health.Status}}' triage-crm-app)" == healthy ]] || { docker compose logs --tail 60 app; die "App não ficou saudável."; }
ok "App saudável"

# ─── 6. Tenant padrão + Super Admin (primeira vez) ───
if [[ $FIRST -eq 1 ]]; then
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)}"
  docker compose exec -T -e ADMIN_NAME="${ADMIN_NAME:-Administrador}" -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    app node node_modules/.bin/tsx src/db/bootstrap.ts
  umask 077; printf 'URL: https://%s\nE-mail: %s\nSenha: %s\n' "$DOMAIN" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" > /root/triage-crm-admin.txt; umask 022
fi

# ─── 7. Rotas dos clientes, cron e backup ───
bash deploy/docker/sync-domains.sh
docker compose up -d routes
cat > /etc/cron.d/triage-crm <<CRON
# Triage CRM — rotas dos clientes (2 min) e backup diário
*/2 * * * * root APP_DIR=$APP_DIR bash $APP_DIR/deploy/docker/sync-domains.sh >/dev/null 2>&1
17 3 * * *  root APP_DIR=$APP_DIR bash $APP_DIR/deploy/docker/backup.sh >/dev/null 2>&1
CRON
ok "Cron instalado (/etc/cron.d/triage-crm)"

# ─── 8. Teste pelo Traefik ───
sleep 3
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" || true)
if [[ "$CODE" == 200 ]]; then ok "https://$DOMAIN respondendo pelo Traefik com SSL válido"
else warn "Ainda sem SSL válido (código $CODE). Normal se o DNS acabou de ser criado: o Traefik tenta de novo sozinho."
fi

echo
ok "Triage CRM instalado (projeto Docker isolado: triage-crm)"
[[ $FIRST -eq 1 ]] && info "Credenciais do Super Admin: /root/triage-crm-admin.txt (apague após o primeiro login)"
echo "   Status:    cd $APP_DIR && docker compose ps"
echo "   Logs:      docker compose logs -f app"
echo "   Config:    $APP_DIR/app.env  → depois: docker compose up -d app"
echo "   Atualizar: sudo bash deploy/docker/update.sh  (na pasta da nova versão)"
