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
import { KnowledgePanel } from "./knowledge-panel";
import { ChannelsPanel } from "./channels-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Conn = { id: string; channel: string; name: string; externalId: string; isActive: boolean; config: { webhookToken?: string } };

export function SettingsView() {
  const [tabValue, setTabValue] = useState("brand");
  // volta do Google (OAuth) → abre direto em Integrações
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("google")) setTabValue("integrations");
    else if (q.get("tab")) setTabValue(q.get("tab")!);
  }, []);
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
            <Tabs.Trigger value="knowledge" className={tab}>Base de conhecimento</Tabs.Trigger>
          </Tabs.List>
        </div>
        <Tabs.Content value="brand" className="mt-4"><BrandingForm /></Tabs.Content>
        <Tabs.Content value="team" className="mt-4"><TeamPanel /></Tabs.Content>
        <Tabs.Content value="pipelines" className="mt-4"><PipelinesPanel /></Tabs.Content>
        <Tabs.Content value="channels" className="mt-4"><ChannelsPanel /></Tabs.Content>
        <Tabs.Content value="integrations" className="mt-4"><IntegrationsPanel /></Tabs.Content>
        <Tabs.Content value="tracking" className="mt-4"><TrackingPanel /></Tabs.Content>
        <Tabs.Content value="knowledge" className="mt-4"><KnowledgePanel /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
