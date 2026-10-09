/**
 * ════════════════════════════════════════════════════════════════════
 *  Triage CRM — Schema do banco (Drizzle ORM + PostgreSQL)
 * ════════════════════════════════════════════════════════════════════
 *  Estratégia multi-tenant: banco compartilhado + coluna `tenant_id` em
 *  TODAS as tabelas de negócio. O isolamento acontece em duas camadas:
 *
 *   1) Aplicação: toda query passa por `withTenant()` (src/db/index.ts),
 *      que abre uma transação e define `app.tenant_id` na sessão.
 *   2) Banco: Row Level Security (drizzle/rls.sql) — mesmo que um
 *      desenvolvedor esqueça um `where tenantId = ...`, o Postgres
 *      simplesmente não devolve linhas de outro tenant.
 *
 *  Nomes de colunas em camelCase no TS viram snake_case no banco
 *  (opção `casing: "snake_case"`).
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ───────────────────────────── ENUMS ─────────────────────────────

export const tenantStatus = pgEnum("tenant_status", ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELED"]);
export const planTier = pgEnum("plan_tier", ["STARTER", "PRO", "BUSINESS", "ENTERPRISE"]);
export const userRole = pgEnum("user_role", ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER", "AGENT"]);
export const dealStatus = pgEnum("deal_status", ["OPEN", "WON", "LOST"]);
export const channel = pgEnum("channel", ["WHATSAPP", "INSTAGRAM", "EMAIL", "INTERNAL", "WEBCHAT"]);
export const senderType = pgEnum("sender_type", ["CONTACT", "USER", "BOT", "SYSTEM"]);
export const messageStatus = pgEnum("message_status", ["PENDING", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED"]);
export const messageType = pgEnum("message_type", ["TEXT", "IMAGE", "AUDIO", "VIDEO", "DOCUMENT", "TEMPLATE"]);
export const conversationStatus = pgEnum("conversation_status", ["OPEN", "PENDING", "RESOLVED"]);
export const taskType = pgEnum("task_type", ["CALL", "MEETING", "EMAIL", "WHATSAPP", "REMINDER", "OTHER"]);
export const taskStatus = pgEnum("task_status", ["PENDING", "DONE", "CANCELED"]);
export const triggerType = pgEnum("trigger_type", [
  "DEAL_CREATED",
  "DEAL_STAGE_CHANGED",
  "DEAL_WON",
  "DEAL_LOST",
  "TAG_ADDED",
  "FORM_SUBMITTED",
  "MESSAGE_RECEIVED",
  "TASK_OVERDUE",
]);
export const customFieldEntity = pgEnum("custom_field_entity", ["CONTACT", "DEAL", "ORGANIZATION"]);
export const customFieldType = pgEnum("custom_field_type", [
  "TEXT",
  "NUMBER",
  "DATE",
  "SELECT",
  "MULTISELECT",
  "BOOLEAN",
  "CURRENCY",
]);
export const activityType = pgEnum("activity_type", [
  "NOTE",
  "STAGE_CHANGE",
  "DEAL_CREATED",
  "DEAL_WON",
  "DEAL_LOST",
  "TASK_CREATED",
  "TASK_DONE",
  "MESSAGE",
  "FILE",
  "ASSIGNMENT",
  "AUTOMATION",
]);

// Colunas reutilizadas
const id = () => uuid().primaryKey().defaultRandom();
const tenantRef = () =>
  uuid()
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ───────────────────────────── TENANCY ─────────────────────────────

/** Configurações de integração por tenant (guardadas em `tenants.settings`) */
export type TenantSettings = {
  evolution?: { baseUrl?: string; apiKey?: string };
  smtp?: { host: string; port: number; user: string; pass: string; from: string };
  autoAssign?: "ROUND_ROBIN" | "NONE";
  currency?: string; // "BRL"
  businessMetric?: "PIPELINE" | "MRR" | "VGV"; // rótulo do card principal do dashboard
  /** API de Conversões da Meta (envio da jornada dos leads de anúncios) */
  meta?: {
    enabled?: boolean;
    datasetId?: string;
    accessToken?: string;
    testEventCode?: string; // preenchido = eventos de teste (não otimizam campanha)
    onlyAdLeads?: boolean; // true (padrão) = só leads que vieram de anúncio
    wabaId?: string; // só com a API oficial do WhatsApp (habilita ctwa_clid)
  };
  /** IA que lê as conversas e move os cards */
  ai?: {
    apiKey?: string; // Anthropic; vazio = usa ANTHROPIC_API_KEY do servidor
    model?: string;
    dailyLimit?: number; // análises por dia (disjuntor de custo)
    minConfidence?: number; // 0–1
  };
  /** Google Agenda (OAuth da conta da empresa) */
  google?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    email?: string; // conta conectada
    calendarId?: string; // "primary" ou id de um calendário
    calendarName?: string;
    createMeet?: boolean; // cria link do Google Meet (padrão true)
    inviteContact?: boolean; // convida o lead por e-mail (padrão true)
  };
  /** Dados da contratada usados nos contratos */
  company?: {
    razaoSocial?: string;
    cnpj?: string;
    endereco?: string;
    representante?: string;
    cpfRepresentante?: string;
    cidadeForo?: string;
  };
};

export const tenants = pgTable("tenants", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(), // <slug>.crm.businesstriage.com.br
  domain: text().unique(), // domínio próprio: crm.cliente.com.br
  status: tenantStatus().notNull().default("TRIAL"),

  // White-label
  logoUrl: text(),
  faviconUrl: text(),
  primaryColor: text().notNull().default("#0F2A44"),
  secondaryColor: text().notNull().default("#14B8A6"),
  loginHeadline: text(),

  // Plano / limites
  plan: planTier().notNull().default("STARTER"),
  maxUsers: integer().notNull().default(3),
  maxContacts: integer().notNull().default(2000),
  enabledModules: text()
    .array()
    .notNull()
    .default(sql`ARRAY['contacts','pipeline','inbox','tasks','reports']::text[]`),
  trialEndsAt: timestamp({ withTimezone: true }),

  settings: jsonb().$type<TenantSettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull().default("AGENT"),
    avatarUrl: text(),
    phone: text(),
    isActive: boolean().notNull().default(true),
    receivesLeads: boolean().notNull().default(true), // entra no round-robin
    lastAssignedAt: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.email), index().on(t.tenantId, t.role)],
);

// ───────────────────────────── CONTATOS ─────────────────────────────

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    document: text(), // CNPJ
    segment: text(),
    website: text(),
    phone: text(),
    address: text(),
    customFields: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.tenantId, t.name)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    tenantId: tenantRef(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "set null" }),
    ownerId: uuid().references(() => users.id, { onDelete: "set null" }),
    name: text().notNull(),
    email: text(),
    phone: text(), // só dígitos, com DDI: 5541999999999
    instagram: text(),
    jobTitle: text(),
    source: text(), // meta_ads, site, indicação...
    customFields: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    attribution: jsonb().$type<Attribution>().notNull().default({}), // de qual anúncio veio
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.tenantId, t.createdAt),
    index().on(t.tenantId, t.phone),
    index().on(t.tenantId, t.email),
  ],
);

/** Origem do lead em anúncio (Clique para WhatsApp, site com fbclid…) */
export type Attribution = {
  channel?: "meta_ctwa" | "meta_site" | "google" | "other";
  adId?: string; // sourceId do anúncio
  ctwaClid?: string; // id do clique (Clique para WhatsApp)
  fbclid?: string;
  fbc?: string;
  sourceUrl?: string;
  headline?: string; // título do anúncio
  body?: string;
  mediaType?: string;
  utm?: Record<string, string>;
  firstAt?: string; // ISO
  lastAt?: string;
};

export const tags = pgTable(
  "tags",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    color: text().notNull().default("#64748B"),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.name)],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    tenantId: tenantRef(),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] })],
);

export const dealTags = pgTable(
  "deal_tags",
  {
    tenantId: tenantRef(),
    dealId: uuid()
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.tagId] })],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: id(),
    tenantId: tenantRef(),
    entity: customFieldEntity().notNull(),
    key: text().notNull(), // chave dentro do JSON custom_fields
    label: text().notNull(),
    type: customFieldType().notNull().default("TEXT"),
    options: text().array().notNull().default(sql`ARRAY[]::text[]`),
    required: boolean().notNull().default(false),
    order: integer().notNull().default(0),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.entity, t.key)],
);

// ───────────────────────────── FUNIL ─────────────────────────────

export const pipelines = pgTable(
  "pipelines",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    order: integer().notNull().default(0),
    isDefault: boolean().notNull().default(false),
    aiAutoMove: boolean().notNull().default(false), // IA lê as conversas e avança os cards
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.order)],
);

export const stages = pgTable(
  "stages",
  {
    id: id(),
    tenantId: tenantRef(),
    pipelineId: uuid()
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text().notNull(),
    order: integer().notNull(),
    color: text().notNull().default("#94A3B8"),
    probability: integer().notNull().default(0), // % para forecast ponderado
    rottingDays: integer(), // alerta de "lead parado"
    isWon: boolean().notNull().default(false),
    isLost: boolean().notNull().default(false),
    // Jornada automática
    autoMessage: text(), // WhatsApp enviado ao entrar na etapa ({{contact.name}}…)
    autoMessageDelayMin: integer().notNull().default(0),
    aiCriteria: text(), // quando a IA deve colocar o card aqui
    metaEvent: text(), // evento enviado à Meta ao entrar na etapa
  },
  (t) => [index().on(t.tenantId, t.pipelineId, t.order)],
);

export const lossReasons = pgTable(
  "loss_reasons",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.name)],
);

export const deals = pgTable(
  "deals",
  {
    id: id(),
    tenantId: tenantRef(),
    pipelineId: uuid()
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    stageId: uuid()
      .notNull()
      .references(() => stages.id),
    contactId: uuid().references(() => contacts.id, { onDelete: "set null" }),
    organizationId: uuid().references(() => organizations.id, { onDelete: "set null" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }), // responsável
    title: text().notNull(),
    value: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    recurring: boolean().notNull().default(false), // true = valor mensal (MRR)
    status: dealStatus().notNull().default("OPEN"),
    position: doublePrecision().notNull().default(0), // ordenação na coluna (fractional index)
    expectedCloseAt: timestamp({ withTimezone: true }),
    stageEnteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
    lossReasonId: uuid().references(() => lossReasons.id, { onDelete: "set null" }),
    lossNote: text(),
    source: text(),
    customFields: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.tenantId, t.pipelineId, t.stageId, t.position),
    index().on(t.tenantId, t.status, t.closedAt),
    index().on(t.tenantId, t.userId),
  ],
);

export const stageHistory = pgTable(
  "stage_history",
  {
    id: id(),
    tenantId: tenantRef(),
    dealId: uuid()
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    fromStageId: uuid().references(() => stages.id, { onDelete: "set null" }),
    toStageId: uuid()
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    durationSec: integer(), // tempo na etapa anterior → relatório de ciclo
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.createdAt), index().on(t.tenantId, t.dealId)],
);

// ───────────────────────────── OMNICHANNEL ─────────────────────────────

export const channelConnections = pgTable(
  "channel_connections",
  {
    id: id(),
    tenantId: tenantRef(),
    channel: channel().notNull(),
    name: text().notNull(), // "WhatsApp Comercial"
    externalId: text().notNull(), // instância Evolution / page id Meta / e-mail
    config: jsonb().$type<Record<string, string>>().notNull().default({}),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.channel, t.externalId), index().on(t.tenantId)],
);

export type BotState = { flowId: string; nodeId: string; vars: Record<string, string>; done?: boolean };

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    tenantId: tenantRef(),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    dealId: uuid().references(() => deals.id, { onDelete: "set null" }),
    connectionId: uuid().references(() => channelConnections.id, { onDelete: "set null" }),
    assignedToId: uuid().references(() => users.id, { onDelete: "set null" }),
    channel: channel().notNull(),
    status: conversationStatus().notNull().default("OPEN"),
    unreadCount: integer().notNull().default(0),
    lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text(),
    botState: jsonb().$type<BotState | null>(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.tenantId, t.status, t.lastMessageAt),
    index().on(t.tenantId, t.assignedToId),
    index().on(t.tenantId, t.contactId, t.channel),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    tenantId: tenantRef(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    dealId: uuid().references(() => deals.id, { onDelete: "set null" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    channel: channel().notNull(),
    senderType: senderType().notNull(),
    type: messageType().notNull().default("TEXT"),
    content: text().notNull().default(""),
    mediaUrl: text(),
    mediaMime: text(),
    externalId: text(), // id no provedor → dedupe de webhook
    status: messageStatus().notNull().default("PENDING"),
    isInternalNote: boolean().notNull().default(false),
    // clock_timestamp() (e não now()) para ordenar corretamente várias mensagens na mesma transação
    timestamp: timestamp({ withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    uniqueIndex().on(t.tenantId, t.externalId),
    index().on(t.tenantId, t.conversationId, t.timestamp),
  ],
);

export const quickReplies = pgTable(
  "quick_replies",
  {
    id: id(),
    tenantId: tenantRef(),
    shortcut: text().notNull(), // "/boasvindas"
    title: text().notNull(),
    content: text().notNull(), // aceita {{contact.name}}
    channel: channel(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.shortcut)],
);

// ───────────────────────────── TAREFAS ─────────────────────────────

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    tenantId: tenantRef(),
    dealId: uuid().references(() => deals.id, { onDelete: "cascade" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text(),
    type: taskType().notNull().default("OTHER"),
    status: taskStatus().notNull().default("PENDING"),
    dueDate: timestamp({ withTimezone: true }).notNull(),
    durationMin: integer(),
    completedAt: timestamp({ withTimezone: true }),
    remindedAt: timestamp({ withTimezone: true }), // evita lembrete duplicado
    externalRef: text(), // id do evento no Google Agenda
    meetLink: text(), // link da videochamada (Google Meet)
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.userId, t.status, t.dueDate), index().on(t.tenantId, t.dealId)],
);

// ───────────────────────────── AUTOMAÇÃO ─────────────────────────────

export type AutomationAction =
  | { type: "SEND_WHATSAPP"; params: { text: string }; delayMinutes?: number }
  | { type: "SEND_EMAIL"; params: { subject: string; body: string }; delayMinutes?: number }
  | { type: "CREATE_TASK"; params: { title: string; taskType?: string; dueInHours?: number }; delayMinutes?: number }
  | { type: "ASSIGN_USER"; params: { userId?: string; strategy?: "ROUND_ROBIN" }; delayMinutes?: number }
  | { type: "ADD_TAG"; params: { tag: string }; delayMinutes?: number }
  | { type: "MOVE_STAGE"; params: { stageId: string }; delayMinutes?: number }
  | { type: "WEBHOOK"; params: { url: string }; delayMinutes?: number };

export type AutomationConditions = {
  pipelineId?: string;
  stageId?: string; // etapa de destino (DEAL_STAGE_CHANGED) ou atual
  tagName?: string;
  formId?: string;
  minValue?: number;
};

export const automations = pgTable(
  "automations",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    triggerType: triggerType().notNull(),
    conditions: jsonb().$type<AutomationConditions>().notNull().default({}),
    actionsJson: jsonb().$type<AutomationAction[]>().notNull().default([]),
    isActive: boolean().notNull().default(true),
    runCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.tenantId, t.triggerType, t.isActive)],
);

export const automationLogs = pgTable(
  "automation_logs",
  {
    id: id(),
    tenantId: tenantRef(),
    automationId: uuid()
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    dealId: uuid(),
    status: text().notNull(), // SUCCESS | ERROR | SKIPPED
    detail: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.automationId, t.createdAt)],
);

/** Fila simples de ações agendadas (delayMinutes) — processada pelo worker em server.ts */
export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: id(),
    tenantId: tenantRef(),
    kind: text().notNull(), // "AUTOMATION_ACTION"
    payload: jsonb().notNull(),
    runAt: timestamp({ withTimezone: true }).notNull(),
    attempts: integer().notNull().default(0),
    doneAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.runAt, t.doneAt)],
);

/** Robô de triagem (grafo de nós — tipos em src/lib/bot/types.ts) */
export const botFlows = pgTable(
  "bot_flows",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    channel: channel().notNull().default("WHATSAPP"),
    isActive: boolean().notNull().default(false),
    flow: jsonb().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.tenantId, t.channel, t.isActive)],
);

// ───────────────────────────── HISTÓRICO 360° ─────────────────────────────

export const notes = pgTable(
  "notes",
  {
    id: id(),
    tenantId: tenantRef(),
    dealId: uuid().references(() => deals.id, { onDelete: "cascade" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    content: text().notNull(),
    pinned: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.dealId), index().on(t.tenantId, t.contactId)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    tenantId: tenantRef(),
    dealId: uuid().references(() => deals.id, { onDelete: "cascade" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "cascade" }),
    fileName: text().notNull(),
    url: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.dealId), index().on(t.tenantId, t.contactId)],
);

/** Linha do tempo unificada (tudo que acontece com um lead) */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    tenantId: tenantRef(),
    type: activityType().notNull(),
    dealId: uuid().references(() => deals.id, { onDelete: "cascade" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    summary: text().notNull(),
    meta: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.dealId, t.createdAt), index().on(t.tenantId, t.contactId, t.createdAt)],
);

/** Tokens de redefinição de senha ("esqueci minha senha") — guardamos só o hash */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: id(),
    tenantId: tenantRef(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

// ───────────────────────────── RASTREAMENTO (Meta) ─────────────────────────────

/** Eventos da jornada enviados à API de Conversões da Meta (1 por negócio+evento). */
export const conversionEvents = pgTable(
  "conversion_events",
  {
    id: id(),
    tenantId: tenantRef(),
    dealId: uuid().references(() => deals.id, { onDelete: "set null" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "set null" }),
    eventName: text().notNull(),
    eventTime: timestamp({ withTimezone: true }).notNull().defaultNow(),
    value: numeric({ precision: 14, scale: 2 }),
    status: text().notNull().default("PENDING"), // PENDING | SENT | FAILED | SKIPPED
    attempts: integer().notNull().default(0),
    payload: jsonb().$type<Record<string, unknown>>(),
    response: jsonb().$type<Record<string, unknown>>(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.dealId, t.eventName), index().on(t.tenantId, t.status, t.createdAt)],
);

/** Uso diário da IA (disjuntor de custo). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    tenantId: tenantRef(),
    day: text().notNull(), // AAAA-MM-DD
    calls: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day] })],
);

// ───────────────────────────── CLIENTES E CONTRATOS ─────────────────────────────

export type Address = { cep?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string };
export type LegalRep = {
  nome?: string; cpf?: string; rg?: string; cargo?: string; estadoCivil?: string;
  nacionalidade?: string; profissao?: string; email?: string; telefone?: string;
};

/** Clientes que contrataram: ficha com tudo o que entra no contrato. */
export const clients = pgTable(
  "clients",
  {
    id: id(),
    tenantId: tenantRef(),
    contactId: uuid().references(() => contacts.id, { onDelete: "set null" }),
    dealId: uuid().references(() => deals.id, { onDelete: "set null" }),
    status: text().notNull().default("ONBOARDING"), // ONBOARDING | ACTIVE | PAUSED | ENDED
    razaoSocial: text().notNull(),
    nomeFantasia: text(),
    cnpj: text(), // só dígitos (CNPJ ou CPF)
    inscricaoEstadual: text(),
    endereco: jsonb().$type<Address>().notNull().default({}),
    representante: jsonb().$type<LegalRep>().notNull().default({}),
    emailFinanceiro: text(),
    telefone: text(),
    servico: text(), // objeto do contrato
    valor: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    recorrente: boolean().notNull().default(true),
    formaPagamento: text(), // PIX, boleto, cartão…
    diaVencimento: integer(),
    inicioEm: timestamp({ withTimezone: true }),
    vigenciaMeses: integer(),
    indiceReajuste: text(), // IPCA, IGP-M…
    observacoes: text(),
    extras: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    responsavelId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.tenantId, t.status), uniqueIndex().on(t.dealId)],
);

/** Modelos de contrato (texto com {{variáveis}}). */
export const contractTemplates = pgTable(
  "contract_templates",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    body: text().notNull(),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.tenantId)],
);

/** Contratos gerados (o texto fica congelado no momento da geração). */
export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    tenantId: tenantRef(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    templateId: uuid().references(() => contractTemplates.id, { onDelete: "set null" }),
    number: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    filePath: text(),
    status: text().notNull().default("DRAFT"), // DRAFT | SENT | SIGNED | CANCELED
    createdById: uuid().references(() => users.id, { onDelete: "set null" }),
    signedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.clientId)],
);

// ───────────────────────────── LIVES ─────────────────────────────

/** Lives cadastradas (o robô oferece as próximas aos leads). */
export const liveEvents = pgTable(
  "live_events",
  {
    id: id(),
    tenantId: tenantRef(),
    title: text().notNull(),
    description: text(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    durationMin: integer().notNull().default(60),
    link: text(), // YouTube, Meet, Zoom…
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.startsAt)],
);

export const liveRegistrations = pgTable(
  "live_registrations",
  {
    id: id(),
    tenantId: tenantRef(),
    liveId: uuid()
      .notNull()
      .references(() => liveEvents.id, { onDelete: "cascade" }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    dealId: uuid().references(() => deals.id, { onDelete: "set null" }),
    source: text().notNull().default("whatsapp"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.liveId, t.contactId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    tenantId: tenantRef(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull(),
    body: text(),
    link: text(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.userId, t.readAt)],
);

// ───────────────────────────── RELAÇÕES (db.query.*) ─────────────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  pipelines: many(pipelines),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  contacts: many(contacts),
  deals: many(deals),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  organization: one(organizations, { fields: [contacts.organizationId], references: [organizations.id] }),
  owner: one(users, { fields: [contacts.ownerId], references: [users.id] }),
  tags: many(contactTags),
  deals: many(deals),
  conversations: many(conversations),
  tasks: many(tasks),
  notes: many(notes),
  attachments: many(attachments),
  activities: many(activities),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  contacts: many(contactTags),
  deals: many(dealTags),
}));

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, { fields: [contactTags.contactId], references: [contacts.id] }),
  tag: one(tags, { fields: [contactTags.tagId], references: [tags.id] }),
}));

export const dealTagsRelations = relations(dealTags, ({ one }) => ({
  deal: one(deals, { fields: [dealTags.dealId], references: [deals.id] }),
  tag: one(tags, { fields: [dealTags.tagId], references: [tags.id] }),
}));

export const pipelinesRelations = relations(pipelines, ({ many }) => ({
  stages: many(stages),
  deals: many(deals),
}));

export const stagesRelations = relations(stages, ({ one, many }) => ({
  pipeline: one(pipelines, { fields: [stages.pipelineId], references: [pipelines.id] }),
  deals: many(deals),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  pipeline: one(pipelines, { fields: [deals.pipelineId], references: [pipelines.id] }),
  stage: one(stages, { fields: [deals.stageId], references: [stages.id] }),
  contact: one(contacts, { fields: [deals.contactId], references: [contacts.id] }),
  organization: one(organizations, { fields: [deals.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [deals.userId], references: [users.id] }),
  lossReason: one(lossReasons, { fields: [deals.lossReasonId], references: [lossReasons.id] }),
  tags: many(dealTags),
  tasks: many(tasks),
  notes: many(notes),
  attachments: many(attachments),
  activities: many(activities),
  stageHistory: many(stageHistory),
}));

export const stageHistoryRelations = relations(stageHistory, ({ one }) => ({
  deal: one(deals, { fields: [stageHistory.dealId], references: [deals.id] }),
  fromStage: one(stages, { fields: [stageHistory.fromStageId], references: [stages.id], relationName: "from" }),
  toStage: one(stages, { fields: [stageHistory.toStageId], references: [stages.id], relationName: "to" }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  contact: one(contacts, { fields: [conversations.contactId], references: [contacts.id] }),
  deal: one(deals, { fields: [conversations.dealId], references: [deals.id] }),
  connection: one(channelConnections, { fields: [conversations.connectionId], references: [channelConnections.id] }),
  assignedTo: one(users, { fields: [conversations.assignedToId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  user: one(users, { fields: [messages.userId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  deal: one(deals, { fields: [tasks.dealId], references: [deals.id] }),
  contact: one(contacts, { fields: [tasks.contactId], references: [contacts.id] }),
  user: one(users, { fields: [tasks.userId], references: [users.id] }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  deal: one(deals, { fields: [notes.dealId], references: [deals.id] }),
  contact: one(contacts, { fields: [notes.contactId], references: [contacts.id] }),
  user: one(users, { fields: [notes.userId], references: [users.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  deal: one(deals, { fields: [attachments.dealId], references: [deals.id] }),
  contact: one(contacts, { fields: [attachments.contactId], references: [contacts.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  deal: one(deals, { fields: [activities.dealId], references: [deals.id] }),
  contact: one(contacts, { fields: [activities.contactId], references: [contacts.id] }),
  user: one(users, { fields: [activities.userId], references: [users.id] }),
}));

export const automationsRelations = relations(automations, ({ many }) => ({
  logs: many(automationLogs),
}));

export const automationLogsRelations = relations(automationLogs, ({ one }) => ({
  automation: one(automations, { fields: [automationLogs.automationId], references: [automations.id] }),
}));

// Tipos inferidos úteis no app
export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type ContractTemplate = typeof contractTemplates.$inferSelect;
