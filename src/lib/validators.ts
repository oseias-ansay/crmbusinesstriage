/** Schemas Zod compartilhados entre API e formulários. */
import { z } from "zod";

export const dealCreateSchema = z.object({
  title: z.string().min(2).max(200),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  value: z.coerce.number().min(0).default(0),
  recurring: z.boolean().optional(),
  userId: z.string().uuid().nullish(),
  expectedCloseAt: z.coerce.date().nullish(),
  source: z.string().max(80).nullish(),
  customFields: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  // contato existente OU dados para criar um novo
  contactId: z.string().uuid().nullish(),
  contact: z
    .object({ name: z.string().min(2), email: z.string().email().nullish(), phone: z.string().nullish() })
    .optional(),
});

export const dealUpdateSchema = dealCreateSchema
  .omit({ contact: true, pipelineId: true, stageId: true })
  .partial()
  .extend({
    status: z.enum(["OPEN", "WON", "LOST"]).optional(),
    lossReasonId: z.string().uuid().nullish(),
    lossNote: z.string().max(1000).nullish(),
  });

export const dealMoveSchema = z.object({
  stageId: z.string().uuid(),
  // id do card que ficará imediatamente antes/depois (para calcular a posição)
  beforeId: z.string().uuid().nullish(),
  afterId: z.string().uuid().nullish(),
});

export const contactSchema = z.object({
  name: z.string().min(2).max(160),
  email: z.string().email().nullish().or(z.literal("")),
  phone: z.string().max(30).nullish(),
  instagram: z.string().max(80).nullish(),
  jobTitle: z.string().max(120).nullish(),
  source: z.string().max(80).nullish(),
  organizationId: z.string().uuid().nullish(),
  ownerId: z.string().uuid().nullish(),
  customFields: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export const taskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(4000).nullish(),
  type: z.enum(["CALL", "MEETING", "EMAIL", "WHATSAPP", "REMINDER", "OTHER"]).default("OTHER"),
  dueDate: z.coerce.date(),
  durationMin: z.coerce.number().int().positive().nullish(),
  userId: z.string().uuid().optional(),
  dealId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
});

export const messageSendSchema = z.object({
  content: z.string().max(4096).default(""),
  type: z.enum(["TEXT", "IMAGE", "AUDIO", "VIDEO", "DOCUMENT"]).default("TEXT"),
  mediaUrl: z.string().url().or(z.string().startsWith("/")).nullish(),
  mediaMime: z.string().nullish(),
  isInternalNote: z.boolean().default(false),
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (use #RRGGBB)");

export const brandingSchema = z.object({
  name: z.string().min(2).max(120),
  logoUrl: z.string().nullish(),
  faviconUrl: z.string().nullish(),
  primaryColor: hex,
  secondaryColor: hex,
  loginHeadline: z.string().max(160).nullish(),
  domain: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Domínio inválido")
    .nullish()
    .or(z.literal("")),
});

export const automationActionSchema = z.object({
  type: z.enum(["SEND_WHATSAPP", "SEND_EMAIL", "CREATE_TASK", "ASSIGN_USER", "ADD_TAG", "MOVE_STAGE", "WEBHOOK"]),
  params: z.record(z.any()),
  delayMinutes: z.coerce.number().int().min(0).optional(),
});

export const automationSchema = z.object({
  name: z.string().min(2).max(120),
  triggerType: z.enum([
    "DEAL_CREATED",
    "DEAL_STAGE_CHANGED",
    "DEAL_WON",
    "DEAL_LOST",
    "TAG_ADDED",
    "FORM_SUBMITTED",
    "MESSAGE_RECEIVED",
    "TASK_OVERDUE",
  ]),
  conditions: z.record(z.any()).default({}),
  actionsJson: z.array(automationActionSchema).min(1),
  isActive: z.boolean().default(true),
});

export const tenantAdminSchema = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/, "Use letras minúsculas, números e hífen"),
  domain: z.string().nullish(),
  plan: z.enum(["STARTER", "PRO", "BUSINESS", "ENTERPRISE"]).default("STARTER"),
  status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED", "CANCELED"]).default("TRIAL"),
  maxUsers: z.coerce.number().int().min(1).default(3),
  maxContacts: z.coerce.number().int().min(100).default(2000),
  enabledModules: z.array(z.string()).default(["contacts", "pipeline", "inbox", "tasks", "reports"]),
  primaryColor: hex.default("#0F2A44"),
  secondaryColor: hex.default("#14B8A6"),
  owner: z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8) }).optional(),
});
