/** Planos e módulos disponíveis por tenant. */
export const MODULES = [
  { key: "contacts", label: "Contatos & Organizações" },
  { key: "pipeline", label: "Funil de Vendas (Kanban)" },
  { key: "inbox", label: "Inbox Omnichannel" },
  { key: "tasks", label: "Tarefas & Calendário" },
  { key: "reports", label: "Relatórios & Dashboards" },
  { key: "automations", label: "Automações" },
  { key: "bots", label: "Bot Builder" },
] as const;

export const PLAN_PRESETS = {
  STARTER: { maxUsers: 3, maxContacts: 2000, modules: ["contacts", "pipeline", "inbox", "tasks", "reports"] },
  PRO: { maxUsers: 10, maxContacts: 10000, modules: ["contacts", "pipeline", "inbox", "tasks", "reports", "automations"] },
  BUSINESS: { maxUsers: 30, maxContacts: 50000, modules: MODULES.map((m) => m.key) },
  ENTERPRISE: { maxUsers: 500, maxContacts: 1_000_000, modules: MODULES.map((m) => m.key) },
} as const;
