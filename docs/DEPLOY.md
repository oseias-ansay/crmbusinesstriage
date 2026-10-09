# Deploy na VPS — Docker + Traefik (instalação isolada)

A VPS já roda tudo em Docker atrás de um **Traefik v3** (rede `traefik-proxy`, resolver
`letsencrypt`, desafio TLS-ALPN). O CRM entra como **mais um projeto Docker**, separado dos
outros. O site, a consultoria, o n8n, o Supabase, a Evolution, o Qdrant e o finance-api
**não são alterados**, e o Traefik também não.

## 1. O que fica isolado

| Recurso | No CRM | Isolamento |
|---|---|---|
| Projeto | `/opt/apps/triage-crm` (Compose `triage-crm`) | pasta e projeto próprios (`700` + segredos `600`) |
| Banco | container `triage-crm-db` (Postgres 16) | **exclusivo**; rede `triage-crm-internal` *interna* (sem internet, sem porta publicada); não usa Supabase nem os Postgres do n8n e da Evolution |
| Usuário do banco | `triage_crm` | **sem** superusuário e **sem** BYPASSRLS → Row Level Security sempre ativo |
| App | container `triage-crm-app` | usuário sem privilégios, sistema de arquivos somente leitura, `cap_drop: ALL`, `no-new-privileges`, 1 GB de RAM / 1,5 CPU |
| Entrada | Traefik → `triage-crm-app:3100` | nenhuma porta do CRM é publicada no host |
| Rotas dos clientes | container `triage-crm-routes` (busybox, 16 MB) | só carrega labels do Traefik; atualizar não reinicia o app |
| Volumes | `triage-crm-pgdata`, `triage-crm-uploads` | nomes próprios |
| Evolution API | o app entra **só** na rede da Evolution, para chamar a API dela | opcional (`EVOLUTION_CONTAINER=none` desliga) |
| Backups | `/opt/apps/triage-crm/backups` + Google Drive (criptografado) | diário às 03:17 · 14 dias local · 30 dias no Drive |

## 2. Antes de instalar: DNS

No DNS de `businesstriage.com.br` (Hostinger):

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `crm` | `187.77.232.125` | 300 |
| A | `*.crm` | `187.77.232.125` | 300 |

Confira na VPS (deve mostrar o IP):

```bash
getent hosts crm.businesstriage.com.br teste.crm.businesstriage.com.br
```

> O Traefik só consegue emitir o SSL depois que o DNS aponta para a VPS. Se instalar antes,
> funciona do mesmo jeito: o certificado sai assim que o DNS propagar.

## 3. Instalação

Do seu computador:

```bash
scp triage-crm.zip root@187.77.232.125:/root/
```

Na VPS:

```bash
cd /root && apt-get install -y unzip rsync && unzip -o triage-crm.zip && cd bt-crm
sudo ADMIN_NAME="Oseias" ADMIN_EMAIL="seu@email.com.br" bash deploy/docker/install.sh
```

O instalador faz, em ordem:

1. Verifica Docker, Compose, a rede `traefik-proxy` e o DNS.
2. Copia o projeto para `/opt/apps/triage-crm` e gera os segredos (`.env` e `app.env`, `600`).
3. Detecta o container `evolution` e liga **apenas o app** à rede dele (`EVOLUTION_API_URL=http://evolution:8080`).
4. Constrói a imagem (2 a 5 min) e sobe o banco e o app. As migrations e o RLS rodam a cada start.
5. Cria o tenant Business Triage e o Super Admin. A senha fica em `/root/triage-crm-admin.txt`.
6. Gera as rotas dos clientes e instala o cron (`/etc/cron.d/triage-crm`).
7. Testa `https://crm.businesstriage.com.br/api/health` pelo Traefik.

Depois:

- Acesse `https://crm.businesstriage.com.br` com o e-mail e a senha de `/root/triage-crm-admin.txt`. **Apague esse arquivo depois do primeiro login.**
- Preencha `EVOLUTION_API_KEY` (e SMTP, se quiser lembretes por e-mail) em `/opt/apps/triage-crm/app.env` e rode `docker compose up -d app`.

## 4. Clientes white-label e SSL

O Traefik usa o desafio TLS-ALPN, que **não emite certificado wildcard**. Por isso cada cliente
recebe um certificado próprio, de forma automática:

1. Admin Global → **Novo cliente** (slug `acme`).
2. Em até 2 minutos, o `sync-domains.sh` (cron) publica `acme.crm.businesstriage.com.br` no Traefik.
3. No primeiro acesso, o Traefik emite o SSL desse subdomínio, em poucos segundos.

**Domínio próprio do cliente** (`crm.acme.com.br`): o cliente cria
`CNAME crm.acme.com.br → acme.crm.businesstriage.com.br`, e você cadastra o domínio no tenant.
O cron publica a rota e o Traefik emite o SSL. Não precisa rodar nada no servidor.

Para forçar na hora: `sudo bash /opt/apps/triage-crm/deploy/docker/sync-domains.sh`.

## 5. Operação

```bash
cd /opt/apps/triage-crm
docker compose ps                        # status dos 3 containers
docker compose logs -f app               # logs do CRM
nano app.env && docker compose up -d app # mudar SMTP, Evolution etc.
bash deploy/docker/backup.sh             # backup manual
docker compose exec db psql -U postgres triage_crm   # console do banco
```

**Atualizar** (nova versão descompactada em `/root/bt-crm`):

```bash
cd /root/bt-crm && sudo bash deploy/docker/update.sh
```

O script faz backup, constrói a nova imagem e sobe. Se ela não ficar saudável, **volta sozinho
para a imagem anterior**.

**Restaurar o banco:**

```bash
cd /opt/apps/triage-crm
docker compose exec -T db pg_restore -U postgres -d triage_crm --clean < backups/db_AAAA-MM-DD_HHMM.dump
```

### Backup fora da VPS (Google Drive)

Configuração única:

1. No Windows, baixe o rclone (https://rclone.org/downloads/ → Windows, Intel/AMD 64 bit), descompacte e,
   no PowerShell dentro da pasta, rode:
   `.\rclone.exe authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ=="`
   O navegador abre; entre na conta Google e autorize. Copie o bloco `{"access_token":...}` exibido.
2. Na VPS: `sudo bash /opt/apps/triage-crm/deploy/docker/offsite-setup.sh` e cole o bloco quando pedir.
3. O script mostra **uma única vez** a chave de criptografia. Guarde-a no gerenciador de senhas:
   sem ela, os backups do Drive não podem ser abertos.

A partir daí, o backup diário também envia `triage-crm_AAAA-MM-DD_HHMM.tar.enc` para a pasta
`TriageCRM-backups` do Drive (o rclone só enxerga os arquivos que ele mesmo criou) e apaga os
de mais de 30 dias.

**Restaurar a partir do Drive** (VPS nova ou perda total):

```bash
rclone copy triagecrm-gdrive:TriageCRM-backups/<arquivo>.tar.enc .     # ou baixe pelo navegador
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:.backup-key \
  -in <arquivo>.tar.enc | tar -x                                        # .backup-key = a chave guardada
# sai: db_*.dump (pg_restore acima), uploads_*.tar.gz e secrets_*.tar.gz (.env e app.env)
```

**Remover o CRM por completo** (não afeta nada mais):

```bash
cd /opt/apps/triage-crm && docker compose down -v && rm -f /etc/cron.d/triage-crm
```

## 6. Equipe, senhas e funis

- **Minha conta** (clique no seu nome, no topo): trocar a própria senha. Regra: 10+ caracteres com letras e números.
- **Esqueci minha senha** (tela de login): envia um link válido por 1 hora. **Exige SMTP configurado** no `app.env`;
  sem SMTP, um administrador redefine a senha em Configurações → Equipe.
- **Configurações → Equipe:** adicionar pessoas, mudar papel, ligar/desligar “Recebe leads” (rodízio),
  desativar (a pessoa não entra mais, mas o histórico fica) e redefinir senha. Travas: ninguém se desativa
  nem muda o próprio papel, sempre sobra ao menos 1 administrador ativo e só o Owner cria outro Owner.
- **Configurações → Funis:** criar, renomear, definir o funil padrão (onde entram leads do WhatsApp e do site)
  e excluir funis vazios; criar, editar (nome, cor, probabilidade, alerta de dias, ganho/perdido), reordenar
  e excluir etapas. Ao excluir uma etapa com negócios, você escolhe para onde eles vão.
- **Editar negócio e contato:** botão “Editar” no painel do negócio e “Editar contato” na visão 360°,
  incluindo os campos personalizados.

## 7. Jornada automática, Meta Ads e Clientes

### Mensagens por etapa e IA que move os cards
- **Configurações → Funis → Jornada** (em cada etapa): mensagem de WhatsApp enviada ao entrar na etapa
  (com atraso opcional; cancelada se o card sair antes), evento da Meta e o critério para a IA.
- **IA move os cards deste funil** (caixa no topo do funil): ~90 s depois da última mensagem do cliente, a IA
  lê as últimas 30 mensagens e avança o card. Nunca volta etapas; Ganho/Perdido ela só sugere ao responsável.
  Precisa de `ANTHROPIC_API_KEY` no `app.env` (pode ser a mesma chave que a finance-api usa) **ou** a chave em
  Configurações → Integrações. Limite diário de análises e confiança mínima ficam na mesma tela.
- Atenção: se a etapa inicial tiver mensagem automática, **desative o envio de WhatsApp da automação
  "Boas-vindas"** (Automações) para o lead não receber duas mensagens.

### Robô de qualificação (4 perguntas)
- Automações → Bot Builder → **Robô de qualificação (modelo)**: cria o robô (empresa em funcionamento, faturamento,
  principal dor, prazo), o funil **Nutrição** e ativa no WhatsApp. Opcionalmente tira o WhatsApp da automação de
  boas-vindas (o robô já cumprimenta).
- Bloco **Qualificar lead**: qualificado se TODAS as regras passam (faturamento não exclui, só define Porte 1–4).
  Qualificado → tags Qualificado + Porte, card em "Qualificação", evento QualifiedLead, transferência para atendente
  (Portes 3 e 4 → responsável fixo). Não qualificado → tag, funil Nutrição, sem atendente, tarefa de retomada em 90 dias.
- A abertura do robô **substitui** a mensagem de boas-vindas anterior (o modelo tira o WhatsApp da automação de
  novo lead; tarefas e atribuição continuam).
- **Transferir para humano** respeita o expediente (segunda a sexta, 9h–17h, Brasília, sem feriados nacionais, Carnaval, Sexta-feira Santa e Corpus Christi; feriados locais configuráveis). Fora dele envia a
  mensagem "fora do horário", com {{atendimento.quando}} = próximo dia útil ("hoje", "amanhã" ou "na segunda-feira (13/10)").
- Qualificado escolhe **agendar atendimento (30 min, online)** ou **live**. Agendar: o robô oferece os 4 próximos
  horários livres (seg–sex, 9h–17h, sem feriados, pulando reuniões já marcadas de quem atende), cria a reunião em
  Tarefas, move o card para "Diagnóstico agendado", envia o evento Schedule e lembra o contato 1 h antes.
  Live: lista as próximas lives de **Automações → Lives**, inscreve, lembra na véspera e 30 min antes com o link.
  Não qualificado recebe o convite da live. Link fixo da videochamada: bloco "Agendar atendimento".
- Leads dos diagnósticos do site já entram como **Qualificado** e não passam pelo robô.
- Não coloque mensagem automática na etapa inicial do funil enquanto o robô estiver ativo (as mensagens se misturam).

### Google Agenda (agendamentos do robô)
- Configurações → Integrações → **Google Agenda**: Client ID/Secret do Google Cloud + **Conectar Google Agenda**.
- Com a conta conectada: horários oferecidos descontam o que está ocupado no calendário; cada agendamento vira
  evento com **link do Google Meet próprio** (e convite ao lead, se tiver e-mail); cancelar a reunião em Tarefas
  remove o evento; mudar o horário atualiza o evento. Falha no Google não desfaz o agendamento no CRM.
- Google Cloud: ative a *Google Calendar API*; tela de consentimento *Interno* (Workspace) ou *Externo* publicado;
  cliente OAuth "Aplicativo da Web" com o URI `https://crm.businesstriage.com.br/api/integrations/google/callback`.

### Rastreamento Meta Ads (Clique para WhatsApp)
- O CRM reconhece a 1ª mensagem vinda de anúncio (id do anúncio, título, ctwa_clid) e marca o contato.
  Leads do site com `fbclid`/UTM da Meta também são marcados.
- Eventos enviados à API de Conversões: **Lead** (lead criado), os eventos escolhidos nas etapas e
  **Purchase** com o valor (negócio ganho). Dados pessoais vão em SHA-256. Acompanhe em Configurações → Rastreamento.
- Configuração (uma vez): Gerenciador de Eventos → conjunto de dados (Pixel) → Configurações → API de Conversões
  → **Gerar token de acesso**. Cole o ID do conjunto e o token em Configurações → Integrações, preencha o código
  da aba **Eventos de teste**, clique em **Enviar evento de teste** e, validado, apague o código de teste.
- Limitação: com o WhatsApp na Evolution (não na API oficial), a Meta casa o evento pelo telefone/e-mail do lead.
  A atribuição exata ao clique (`business_messaging` + ctwa_clid) exige a API oficial do WhatsApp; quando migrar,
  basta preencher o *WhatsApp Business Account ID*.
- LGPD: a política de privacidade do site deve informar o compartilhamento (criptografado) com plataformas de anúncio.

### Clientes e contratos
- Negócio **ganho** cria a ficha em **Clientes** já preenchida com o que o CRM sabe (empresa, CNPJ, contato, valor).
- Na ficha: busca na Receita pelo CNPJ, representante legal, condições (valor, vencimento, início, vigência, reajuste).
- **Gerar** cria o contrato a partir do modelo, com número `AAAA-0001`, texto congelado e PDF. Rascunho pode ser
  ajustado; depois marque Enviado/Assinado. Modelos editáveis em **Modelos** (variáveis `{{cliente.razaoSocial}}` etc.).
- Dados da contratada (sua empresa) em Configurações → Integrações. **Revise o modelo padrão com seu advogado.**

## 8. Canais

- **WhatsApp — número exclusivo do CRM:** em Configurações → Canais, conecte o nome da instância e
  aponte o webhook da instância para `http://triage-crm-app:3100/api/webhooks/whatsapp?token=<token>`
  (evento `MESSAGES_UPSERT`).
- **WhatsApp — número compartilhado com o n8n (caso da Business Triage):** a Evolution continua
  enviando para o n8n. No fluxo do n8n, ligue o nó de `deploy/n8n/espelhar-no-crm.json` direto na
  saída do *Webhook* que recebe a Evolution, e troque `COLE_AQUI_O_TOKEN` pelo token do canal. O CRM
  passa a receber uma cópia de tudo: mensagens do cliente (cria contato, lead e conversa) e as que saem
  do número pelo n8n ou pelo celular (aparecem no Inbox como "↗ Enviado pelo WhatsApp"). Nesse modo,
  deixe **desligados** o robô de triagem do CRM e o envio de WhatsApp da automação "Boas-vindas", para
  o cliente não receber mensagens em dobro.
- **Instagram:** webhook `https://crm.businesstriage.com.br/api/webhooks/instagram` + `META_VERIFY_TOKEN` do `app.env`.
- **Formulários / n8n:** `POST https://crm.businesstriage.com.br/api/forms/business-triage`.
- **Site sem mexer no código:** cole antes do `</body>` do `index.html` do site
  `<script src="https://crm.businesstriage.com.br/embed/form-bridge.js" data-tenant="business-triage" data-form="site-contato" defer></script>`.
  O script copia para o CRM todo formulário que tenha nome + e-mail ou telefone (o envio original,
  ex. Formspree, continua igual), guarda as UTMs da visita e reaproveita o contato se o e-mail/telefone
  já existir. `<form data-crm-ignore>` ignora um formulário; `data-selector="form.x"` limita a alguns.

## 9. Como a multi-tenancy funciona

```
Traefik (Host: acme.crm.businesstriage.com.br) ──► triage-crm-app
   ├─ src/lib/tenant.ts: domínio próprio → subdomínio <slug> → (host desconhecido = "Endereço não encontrado")
   ├─ layout aplica cores/logo/favicon do tenant
   ├─ login aceita só usuários daquele tenant; o JWT carrega tenantId e não vale em outro host
   └─ withTenant() → SET app.tenant_id → Postgres RLS devolve só linhas do tenant
```

---

*Servidor sem Docker?* Existe uma variante com Nginx e systemd no host em `deploy/host/`
(veja os comentários de `deploy/host/install.sh`). Ela **não** é a indicada para esta VPS.
