# Triage CRM — CRM SaaS Multi-Tenant / White-Label

CRM completo da **Business Triage**, independente do site institucional, pronto para ser
replicado como white-label para clientes. Cada empresa (tenant) tem dados isolados, marca
própria (logo, cores, favicon, domínio) e plano com limites e módulos.

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · Tailwind · Radix UI · Lucide · TanStack Query · dnd-kit · Recharts |
| Backend | Route Handlers do Next + servidor customizado Node (`server.ts`) |
| Banco | PostgreSQL 16 + **Drizzle ORM** + **Row Level Security** |
| Tempo real | Socket.io (mesmo processo, autenticado pelo cookie de sessão) |
| Canais | WhatsApp (Evolution API), Instagram Direct (Meta Graph), E-mail (SMTP), Interno |

> **Por que Drizzle e não Prisma?** Drizzle não depende de binários nativos, roda no Edge e,
> principalmente, combina bem com RLS via `set_config` por transação — o isolamento entre
> tenants fica garantido pelo próprio Postgres, não só pelo código.

---

## Funcionalidades

- **Admin Global (Super Admin):** provisiona tenants com pipeline padrão + usuário dono; plano, limites de usuários/contatos, módulos ativos, status (trial/ativo/suspenso).
- **White-label:** logo, favicon, cor primária/secundária, frase do login e domínio próprio com pré-visualização ao vivo. Tema aplicado por variáveis CSS a partir do host acessado.
- **Contatos & Organizações:** busca, filtros (tag, origem, responsável, *campo personalizado JSONB*), paginação, importação e exportação CSV (com BOM para Excel), deduplicação por e-mail/telefone, limite do plano.
- **Visão 360°:** dados + custom fields, negócios, tarefas, notas internas, anexos, histórico de etapas e linha do tempo unificada (atividades + mensagens de todos os canais).
- **Funil (Kanban):** múltiplos pipelines, drag & drop com posição fracionária, atualização otimista, sincronização em tempo real, indicadores no card (valor, MRR, dias na etapa, “lead parado”, tarefas em atraso, responsável, tags), filtros, ganhar/perder com motivo.
- **Inbox Omnichannel:** fila/minhas/todas, por canal e status, atribuição manual e automática (round-robin), texto, imagem, vídeo, documento, **áudio gravado no navegador**, respostas rápidas com `/atalho` e variáveis, notas internas, “digitando…”.
- **Automações (Digital Pipeline):** gatilhos `DEAL_CREATED`, `DEAL_STAGE_CHANGED`, `DEAL_WON/LOST`, `TAG_ADDED`, `FORM_SUBMITTED`, `MESSAGE_RECEIVED`, `TASK_OVERDUE` → ações WhatsApp, e-mail, tarefa, reatribuir, tag, mover etapa, webhook (n8n/Make), com atraso opcional, log por execução e proteção contra loop.
- **Bot Builder:** robô de triagem por blocos (mensagem, pergunta, múltipla escolha, condição SIM/NÃO, ação no CRM, transferir para humano) + **simulador**. Respostas são gravadas no contato.
- **Tarefas & Calendário:** lista agrupada (atrasadas/hoje/amanhã…), calendário mensal e semanal, lembretes no sistema e por e-mail 30 min antes e no vencimento.
- **Dashboards:** pipeline aberto, forecast ponderado, vendido, taxa de conversão, tempo médio de fechamento, MRR/ARR, funil com conversão etapa a etapa e tempo médio por etapa, evolução semanal, motivos de perda, origem dos leads e produtividade da equipe.
- **Captura pública de leads:** `POST /api/forms/<slug>` (CORS + honeypot) para site, landing pages e n8n.

---

## Estrutura de pastas

```
bt-crm/
├── server.ts                    # Next + Socket.io + worker (automações agendadas/lembretes)
├── drizzle.config.ts
├── drizzle/
│   ├── 0000_init.sql            # migration gerada do schema
│   ├── 0001_password_resets.sql # tokens de “esqueci minha senha”
│   └── rls.sql                  # políticas de Row Level Security (todas as tabelas com tenant_id)
├── Dockerfile · .dockerignore
├── compose.yml                  # produção: db interno + app + routes (Traefik)
├── docker-compose.dev.yml       # Postgres local para desenvolvimento
├── deploy/
│   ├── docker/                  # ★ VPS atual (Docker + Traefik)
│   │   ├── install.sh           # instalação isolada em /opt/apps/triage-crm
│   │   ├── update.sh            # atualização com backup e rollback da imagem
│   │   ├── sync-domains.sh      # publica subdomínios/domínios dos clientes no Traefik
│   │   ├── backup.sh            # banco + uploads + segredos (+ cópia criptografada no Google Drive)
│   │   ├── offsite-setup.sh     # configura o rclone/Google Drive e a chave do backup
│   │   └── initdb/              # cria o usuário do banco sem superusuário/BYPASSRLS
│   └── host/                    # variante sem Docker (Nginx + systemd)
├── docs/DEPLOY.md               # guia de publicação e multi-tenancy
├── docker-compose.yml           # Postgres local
└── src/
    ├── middleware.ts            # proteção de rotas / Super Admin / ?tenant= em dev
    ├── db/
    │   ├── schema.ts            # TODAS as entidades e relações
    │   ├── index.ts             # withTenant() / withAdmin()
    │   ├── migrate.ts           # migrations + RLS
    │   ├── bootstrap.ts         # produção: tenant Business Triage + Super Admin, sem dados demo
    │   └── seed.ts              # desenvolvimento: tenant Business Triage + tenant demo
    ├── lib/
    │   ├── tenant.ts            # resolve tenant pelo host (domínio próprio → subdomínio → padrão)
    │   ├── auth.ts · session.ts # JWT httpOnly, papéis, amarração cookie↔tenant
    │   ├── api.ts               # route() wrapper: auth, papéis, Zod, erros
    │   ├── validators.ts        # schemas Zod
    │   ├── realtime.ts          # emitToTenant / emitToUser
    │   ├── services/            # deals.ts (criar/mover), messages.ts (envio/recebimento)
    │   ├── automation/          # engine.ts (gatilhos→ações), worker.ts (fila + lembretes)
    │   ├── bot/                 # types.ts, engine.ts (robô de triagem)
    │   └── channels/            # whatsapp.ts, instagram.ts, email.ts, index.ts (roteador)
    ├── hooks/useSocket.tsx
    ├── components/
    │   ├── kanban/              # kanban-board, deal-card, deal-drawer (360°), new-deal-dialog, edit-deal-form
    │   ├── inbox/inbox-view.tsx
    │   ├── dashboard/metrics-dashboard.tsx
    │   ├── settings/            # branding-form, settings-view, team-panel (equipe), pipelines-panel (funis)
    │   ├── automations/         # automations-view, bot-builder (+ simulador)
    │   ├── contacts/ · tasks/ · admin/ · layout/ · ui/
    └── app/
        ├── login/ · forgot-password/ · reset-password/
        ├── (crm)/               # dashboard, pipeline, inbox, contacts, contacts/[id], tasks,
        │                        # automations, settings, admin/tenants
        └── api/                 # ~40 rotas REST (deals, contacts, conversations, tasks,
                                 # automations, bots, dashboard, tenant/branding, admin,
                                 # webhooks/whatsapp, webhooks/instagram, forms, upload, cron…)
```

---

## Rodando localmente

```bash
cp .env.example .env            # ajuste DATABASE_URL e AUTH_SECRET
docker compose -f docker-compose.dev.yml up -d   # Postgres local
npm install
npm run db:migrate              # cria tabelas + RLS
npm run db:seed                 # dados de exemplo
npm run dev                     # http://localhost:3100
```

Acessos do seed (senha `Triage@2026`):

| Tenant | Usuário | Como acessar em dev |
|---|---|---|
| Business Triage (padrão) | `admin@businesstriage.com.br` (Super Admin) | `http://localhost:3100` |
| Demo Cliente (roxo) | `dono@demo.com.br` (Owner) | `http://localhost:3100/login?tenant=demo-cliente` |

Em dev, `?tenant=<slug>` simula o subdomínio (grava cookie). Em produção o tenant vem **só** do host.

---

## Principais rotas da API

| Método | Rota | Função |
|---|---|---|
| GET/POST | `/api/deals?pipelineId=&userId=&tag=&minValue=&from=&q=` | listar (Kanban) / criar lead |
| GET/PATCH/DELETE | `/api/deals/:id` | visão 360° / editar, ganhar, perder / excluir |
| POST | `/api/deals/:id/move` `{stageId, beforeId, afterId}` | mutação do Kanban + automações |
| GET/POST/PATCH | `/api/contacts` · `/api/contacts/:id` | contatos, visão 360° e edição |
| GET/POST · PATCH/DELETE | `/api/pipelines` · `/api/pipelines/:id` | funis |
| POST/PUT · PATCH/DELETE | `/api/pipelines/:id/stages` · `/api/stages/:id?moveTo=` | etapas (criar, reordenar, editar, excluir com migração) |
| GET/POST · PATCH | `/api/users` · `/api/users/:id` | equipe (papel, ativo, recebe leads, senha) |
| POST | `/api/auth/password` · `/api/auth/forgot` · `/api/auth/reset` | trocar senha / esqueci / redefinir |
| GET | `/api/custom-fields?entity=CONTACT\|DEAL` | definições dos campos personalizados |
| POST / GET | `/api/contacts/import` · `/api/contacts/export` | CSV |
| GET / PATCH | `/api/conversations` · `/api/conversations/:id` | inbox, atribuição, status |
| GET/POST | `/api/conversations/:id/messages` | histórico / enviar (texto, mídia, nota) |
| GET/POST/PATCH | `/api/tasks` · `/api/tasks/:id` | tarefas e calendário |
| GET/POST/PATCH | `/api/automations` · `/api/bots` | regras e robôs |
| GET | `/api/dashboard?pipelineId=&from=&to=` | todas as métricas |
| GET/PATCH | `/api/tenant/branding` | white-label do tenant |
| GET/POST/PATCH | `/api/admin/tenants` | Admin Global |
| POST | `/api/webhooks/whatsapp?token=` · `/api/webhooks/instagram` | entrada dos canais |
| POST | `/api/forms/:tenantSlug` | captura pública de leads |

Publicação na VPS (Docker + Traefik, isolada dos demais projetos): `sudo ADMIN_EMAIL=… bash deploy/docker/install.sh` — guia completo em **[docs/DEPLOY.md](docs/DEPLOY.md)**.
