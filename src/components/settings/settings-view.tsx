"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { api } from "@/lib/fetcher";
import { BrandingForm } from "./branding-form";
import { TeamPanel } from "./team-panel";
import { PipelinesPanel } from "./pipelines-panel";
import { IntegrationsPanel } from "./integrations-panel";
import { TrackingPanel } from "./tracking-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Conn = { id: string; channel: string; name: string; externalId: string; isActive: boolean; config: { webhookToken?: string } };

export function SettingsView() {
  const [tabValue, setTabValue] = useState("brand");
  // volta do Google (OAuth) → abre direto em Integrações
  useEffect(() => { if (new URLSearchParams(window.location.search).get("google")) setTabValue("integrations"); }, []);
  const tab = "rounded-md px-4 py-1.5 text-sm data-[state=active]:bg-white data-[state=active]:font-medium data-[state=active]:shadow-sm";
  return (
    <div className="space-y-4 p-6">
      <Tabs.Root value={tabValue} onValueChange={setTabValue}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Configurações</h1>
          <Tabs.List className="flex flex-wrap rounded-lg bg-slate-100 p-1">
            <Tabs.Trigger value="brand" className={tab}>Marca (White-Label)</Tabs.Trigger>
            <Tabs.Trigger value="team" className={tab}>Equipe</Tabs.Trigger>
            <Tabs.Trigger value="pipelines" className={tab}>Funis</Tabs.Trigger>
            <Tabs.Trigger value="channels" className={tab}>Canais</Tabs.Trigger>
            <Tabs.Trigger value="integrations" className={tab}>Integrações</Tabs.Trigger>
            <Tabs.Trigger value="tracking" className={tab}>Rastreamento</Tabs.Trigger>
          </Tabs.List>
        </div>
        <Tabs.Content value="brand" className="mt-4"><BrandingForm /></Tabs.Content>
        <Tabs.Content value="team" className="mt-4"><TeamPanel /></Tabs.Content>
        <Tabs.Content value="pipelines" className="mt-4"><PipelinesPanel /></Tabs.Content>
        <Tabs.Content value="channels" className="mt-4"><Channels /></Tabs.Content>
        <Tabs.Content value="integrations" className="mt-4"><IntegrationsPanel /></Tabs.Content>
        <Tabs.Content value="tracking" className="mt-4"><TrackingPanel /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function Channels() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["channels"], queryFn: () => api<Conn[]>("/api/channels") });
  const add = useMutation({ mutationFn: (b: unknown) => api("/api/channels", { method: "POST", json: b }), onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }) });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(Object.fromEntries(new FormData(e.currentTarget))); e.currentTarget.reset(); }}>
          <Select name="channel"><option value="WHATSAPP">WhatsApp (Evolution API)</option><option value="INSTAGRAM">Instagram Direct</option></Select>
          <Input name="name" placeholder="Nome (ex.: Comercial)" required className="w-48" />
          <Input name="externalId" placeholder="Nome da instância / ID da página" required className="w-60" />
          <Input name="pageAccessToken" placeholder="Page token (Instagram)" className="w-56" />
          <Button type="submit">Conectar</Button>
        </form>
      </Card>
      {data.map((c) => (
        <Card key={c.id} className="space-y-1 p-4 text-sm">
          <p className="font-medium">{c.name} <Badge>{c.channel}</Badge></p>
          <p className="text-slate-500">ID: {c.externalId}</p>
          <p className="text-xs">Webhook: <code className="rounded bg-slate-100 px-1">{origin}/api/webhooks/{c.channel === "WHATSAPP" ? "whatsapp" : "instagram"}?token={c.config.webhookToken}</code></p>
        </Card>
      ))}
    </div>
  );
}
