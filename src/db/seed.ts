/**
 * Seed inicial:
 *  - Tenant padrão "Business Triage" (tema default) + Super Admin
 *  - 4 pipelines (Vendas, Triagem Business, Pós-Venda, Onboarding)
 *  - Contatos, negócios, conversas, tarefas e automações de exemplo
 *  - Tenant "Demo Cliente" para provar o isolamento entre empresas
 *
 * Rodar: npm run db:seed   (idempotente por slug: apaga e recria os 2 tenants)
 */
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { withAdmin, type Tx } from "./index";
import * as s from "./schema";

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const ahead = (d: number) => new Date(Date.now() + d * DAY);

const PIPELINES: { name: string; stages: [string, string, number][] }[] = [
  {
    name: "Vendas",
    stages: [
      ["Novo lead", "#94A3B8", 10],
      ["Qualificação", "#38BDF8", 25],
      ["Diagnóstico agendado", "#818CF8", 45],
      ["Proposta enviada", "#F59E0B", 65],
      ["Negociação", "#F97316", 80],
      ["Ganho", "#10B981", 100],
      ["Perdido", "#EF4444", 0],
    ],
  },
  {
    name: "Triagem Business",
    stages: [
      ["Recebido", "#94A3B8", 10],
      ["Coleta de documentos", "#38BDF8", 30],
      ["Em análise", "#818CF8", 60],
      ["Relatório entregue", "#10B981", 100],
    ],
  },
  { name: "Pós-Venda", stages: [["Acompanhamento", "#38BDF8", 50], ["Renovação", "#F59E0B", 70], ["Concluído", "#10B981", 100]] },
  { name: "Onboarding", stages: [["Kickoff", "#38BDF8", 30], ["Implantação", "#818CF8", 60], ["Ativo", "#10B981", 100]] },
];

export async function createTenant(
  tx: Tx,
  t: { name: string; slug: string; primary: string; secondary: string; plan: "PRO" | "ENTERPRISE" | "STARTER" },
) {
  const [tenant] = await tx
    .insert(s.tenants)
    .values({
      name: t.name,
      slug: t.slug,
      primaryColor: t.primary,
      secondaryColor: t.secondary,
      status: "ACTIVE",
      plan: t.plan,
      maxUsers: t.plan === "ENTERPRISE" ? 100 : 10,
      maxContacts: t.plan === "ENTERPRISE" ? 100_000 : 5000,
      enabledModules: ["contacts", "pipeline", "inbox", "tasks", "reports", "automations", "bots"],
      loginHeadline: "Diagnóstico preciso. Decisão certa.",
      settings: { autoAssign: "ROUND_ROBIN", currency: "BRL", businessMetric: "PIPELINE" },
    })
    .returning();
  return tenant;
}

export async function seedTenantData(tx: Tx, tenantId: string, users: s.User[], withSamples: boolean) {
  const stageMap: Record<string, s.Stage[]> = {};
  for (const [i, p] of PIPELINES.entries()) {
    const [pipeline] = await tx
      .insert(s.pipelines)
      .values({ tenantId, name: p.name, order: i, isDefault: i === 0 })
      .returning();
    stageMap[p.name] = await tx
      .insert(s.stages)
      .values(
        p.stages.map(([name, color, probability], order) => ({
          tenantId,
          pipelineId: pipeline.id,
          name,
          color,
          probability,
          order,
          rottingDays: 7,
          isWon: name === "Ganho",
          isLost: name === "Perdido",
        })),
      )
      .returning();
  }

  const reasons = await tx
    .insert(s.lossReasons)
    .values(["Preço", "Sem timing", "Escolheu concorrente", "Sem resposta", "Fora do perfil"].map((name) => ({ tenantId, name })))
    .returning();

  const tagRows = await tx
    .insert(s.tags)
    .values([
      { tenantId, name: "Meta Ads", color: "#3B82F6" },
      { tenantId, name: "Indicação", color: "#10B981" },
      { tenantId, name: "Quente", color: "#EF4444" },
      { tenantId, name: "Diagnóstico gratuito", color: "#8B5CF6" },
    ])
    .returning();

  await tx.insert(s.customFieldDefinitions).values([
    { tenantId, entity: "CONTACT", key: "segmento", label: "Segmento", type: "SELECT", options: ["Comércio", "Serviços", "Indústria"] },
    { tenantId, entity: "CONTACT", key: "faturamento_mensal", label: "Faturamento mensal", type: "CURRENCY" },
    { tenantId, entity: "DEAL", key: "num_funcionarios", label: "Nº de funcionários", type: "NUMBER" },
  ]);

  await tx.insert(s.quickReplies).values([
    { tenantId, shortcut: "/ola", title: "Boas-vindas", content: "Olá, {{contact.name}}! Aqui é da equipe. Como posso ajudar?" },
    { tenantId, shortcut: "/agenda", title: "Agendar diagnóstico", content: "Podemos agendar seu diagnóstico. Prefere manhã ou tarde?" },
    { tenantId, shortcut: "/docs", title: "Pedir documentos", content: "Para a análise, envie balanço e DRE dos últimos 2 anos, por favor." },
  ]);

  await tx.insert(s.automations).values([
    {
      tenantId,
      name: "Boas-vindas a novo lead",
      triggerType: "DEAL_CREATED",
      actionsJson: [
        { type: "ASSIGN_USER", params: { strategy: "ROUND_ROBIN" } },
        { type: "SEND_WHATSAPP", params: { text: "Olá {{contact.name}}! Recebemos seu contato e já vamos te atender." } },
        { type: "CREATE_TASK", params: { title: "Primeiro contato com {{contact.name}}", taskType: "CALL", dueInHours: 2 } },
      ],
    },
    {
      tenantId,
      name: "Proposta enviada → follow-up em 2 dias",
      triggerType: "DEAL_STAGE_CHANGED",
      conditions: { stageId: stageMap["Vendas"][3].id },
      actionsJson: [{ type: "CREATE_TASK", params: { title: "Follow-up da proposta", taskType: "WHATSAPP", dueInHours: 48 } }],
    },
  ]);

  await tx.insert(s.botFlows).values({
    tenantId,
    name: "Triagem de diagnóstico",
    channel: "WHATSAPP",
    isActive: false,
    flow: {
      startNodeId: "n1",
      nodes: [
        { id: "n1", type: "message", data: { text: "Olá! Sou o assistente virtual. Vou fazer 3 perguntas rápidas." }, next: "n2" },
        { id: "n2", type: "question", data: { text: "Qual o nome da sua empresa?", variable: "empresa" }, next: "n3" },
        {
          id: "n3",
          type: "choice",
          data: { text: "Faturamento mensal aproximado?", variable: "faturamento", options: ["Até 50 mil", "50 a 200 mil", "Acima de 200 mil"] },
          next: "n4",
        },
        { id: "n4", type: "condition", data: { variable: "faturamento", equals: "Até 50 mil" }, next: "n5", else: "n6" },
        { id: "n5", type: "action", data: { action: "ADD_TAG", value: "Treinamento" }, next: "n7" },
        { id: "n6", type: "action", data: { action: "ADD_TAG", value: "Quente" }, next: "n7" },
        { id: "n7", type: "handoff", data: { text: "Obrigado! Um especialista vai continuar com você em instantes." } },
      ],
    },
  });

  if (!withSamples) return;

  // ── Contatos e negócios de exemplo ──
  const names = [
    ["Mariana Costa", "Padaria Pão Dourado"],
    ["Ricardo Alves", "Alves Autopeças"],
    ["Fernanda Lima", "Clínica Bem Viver"],
    ["João Pereira", "Distribuidora JP"],
    ["Patrícia Souza", "Studio Bela"],
    ["Carlos Mendes", "Mendes Construções"],
    ["Aline Rocha", "Rocha Contabilidade"],
    ["Bruno Martins", "Martins Pet Shop"],
    ["Juliana Ferreira", "Café da Praça"],
    ["Eduardo Santos", "Santos Metalúrgica"],
    ["Camila Ribeiro", "Ribeiro Moda"],
    ["Diego Oliveira", "Oliveira Transportes"],
  ];
  const vendas = stageMap["Vendas"];
  const pipelineId = vendas[0].pipelineId;

  for (const [i, [name, company]] of names.entries()) {
    const [org] = await tx.insert(s.organizations).values({ tenantId, name: company, segment: "Serviços" }).returning();
    const [contact] = await tx
      .insert(s.contacts)
      .values({
        tenantId,
        organizationId: org.id,
        ownerId: users[i % users.length].id,
        name,
        email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@email.com",
        phone: `55419${String(90000000 + i * 7919).slice(0, 8)}`,
        source: i % 2 ? "meta_ads" : "indicação",
        customFields: { segmento: "Serviços", faturamento_mensal: 40000 + i * 15000 },
        createdAt: ago(40 - i * 3),
      })
      .returning();
    await tx.insert(s.contactTags).values({ tenantId, contactId: contact.id, tagId: tagRows[i % tagRows.length].id });

    const stage = vendas[i % vendas.length];
    const status = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";
    const [deal] = await tx
      .insert(s.deals)
      .values({
        tenantId,
        pipelineId,
        stageId: stage.id,
        contactId: contact.id,
        organizationId: org.id,
        userId: users[i % users.length].id,
        title: `Diagnóstico — ${company}`,
        value: String(2500 + i * 1750),
        status,
        position: i * 1000,
        stageEnteredAt: ago(i % 9),
        closedAt: status !== "OPEN" ? ago(i % 5) : null,
        lossReasonId: status === "LOST" ? reasons[i % reasons.length].id : null,
        createdAt: ago(35 - i * 2),
        source: contact.source,
      })
      .returning();
    await tx.insert(s.dealTags).values({ tenantId, dealId: deal.id, tagId: tagRows[i % tagRows.length].id });
    await tx.insert(s.stageHistory).values({ tenantId, dealId: deal.id, toStageId: stage.id, createdAt: ago(i % 9), durationSec: 86400 * (1 + (i % 6)) });
    await tx.insert(s.activities).values({ tenantId, dealId: deal.id, contactId: contact.id, type: "DEAL_CREATED", summary: "Negócio criado", createdAt: deal.createdAt });
    await tx.insert(s.notes).values({ tenantId, dealId: deal.id, contactId: contact.id, userId: users[0].id, content: "Cliente relatou dificuldade com fluxo de caixa." });
    await tx.insert(s.tasks).values({
      tenantId,
      dealId: deal.id,
      contactId: contact.id,
      userId: users[i % users.length].id,
      title: i % 3 === 0 ? "Ligar para alinhar proposta" : i % 3 === 1 ? "Reunião de diagnóstico" : "Enviar e-mail com documentos",
      type: i % 3 === 0 ? "CALL" : i % 3 === 1 ? "MEETING" : "EMAIL",
      dueDate: i % 4 === 0 ? ago(1) : ahead(i % 7),
    });

    if (i < 6) {
      const ch = (["WHATSAPP", "INSTAGRAM", "EMAIL"] as const)[i % 3];
      const [conv] = await tx
        .insert(s.conversations)
        .values({
          tenantId,
          contactId: contact.id,
          dealId: deal.id,
          channel: ch,
          assignedToId: users[i % users.length].id,
          unreadCount: i % 2,
          lastMessageAt: ago(i * 0.1),
          lastMessagePreview: "Pode me mandar a proposta?",
        })
        .returning();
      await tx.insert(s.messages).values([
        { tenantId, conversationId: conv.id, dealId: deal.id, channel: ch, senderType: "CONTACT", content: `Olá! Vi o anúncio e quero saber do diagnóstico para a ${company}.`, status: "RECEIVED", timestamp: ago(i * 0.1 + 0.02) },
        { tenantId, conversationId: conv.id, dealId: deal.id, channel: ch, senderType: "USER", userId: users[0].id, content: `Oi, ${name.split(" ")[0]}! Claro. Qual o faturamento médio mensal?`, status: "READ", timestamp: ago(i * 0.1 + 0.01) },
        { tenantId, conversationId: conv.id, dealId: deal.id, channel: ch, senderType: "CONTACT", content: "Pode me mandar a proposta?", status: "RECEIVED", timestamp: ago(i * 0.1) },
      ]);
    }
  }
}

async function main() {
  await withAdmin(async (tx) => {
    const slugs = ["business-triage", "demo-cliente"];
    const old = await tx.select({ id: s.tenants.id }).from(s.tenants).where(inArray(s.tenants.slug, slugs));
    for (const o of old) await tx.delete(s.tenants).where(eq(s.tenants.id, o.id));

    const hash = await bcrypt.hash("Triage@2026", 10);

    // ── Tenant padrão (tema Business Triage) ──
    const bt = await createTenant(tx, { name: "Business Triage", slug: "business-triage", primary: "#0F2A44", secondary: "#14B8A6", plan: "ENTERPRISE" });
    const btUsers = await tx
      .insert(s.users)
      .values([
        { tenantId: bt.id, name: "Oseias", email: "admin@businesstriage.com.br", passwordHash: hash, role: "SUPER_ADMIN" },
        { tenantId: bt.id, name: "Ana Comercial", email: "ana@businesstriage.com.br", passwordHash: hash, role: "AGENT" },
        { tenantId: bt.id, name: "Lucas Vendas", email: "lucas@businesstriage.com.br", passwordHash: hash, role: "MANAGER" },
      ])
      .returning();
    await seedTenantData(tx, bt.id, btUsers, true);

    // ── Tenant de demonstração (white-label) ──
    const demo = await createTenant(tx, { name: "Demo Cliente", slug: "demo-cliente", primary: "#7C3AED", secondary: "#F59E0B", plan: "STARTER" });
    const demoUsers = await tx
      .insert(s.users)
      .values([{ tenantId: demo.id, name: "Dono Demo", email: "dono@demo.com.br", passwordHash: hash, role: "OWNER" }])
      .returning();
    await seedTenantData(tx, demo.id, demoUsers, false);
  });

  console.log("✔ Seed concluído");
  console.log("  Super Admin: admin@businesstriage.com.br / Triage@2026");
  console.log("  Tenant demo: dono@demo.com.br / Triage@2026  (host demo-cliente.<ROOT_DOMAIN>)");
  process.exit(0);
}

// Só executa quando chamado diretamente (permite importar as funções no bootstrap)
if (process.argv[1]?.includes("seed")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
