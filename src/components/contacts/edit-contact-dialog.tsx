"use client";
/** Edição completa do contato (dados, responsável, tags e campos personalizados). */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { CustomFieldsInputs, useFieldDefs } from "@/components/forms/custom-fields";

export type EditableContact = {
  id: string; name: string; email: string | null; phone: string | null; instagram?: string | null; jobTitle: string | null; source: string | null;
  owner: { id: string; name: string } | null; customFields: Record<string, unknown>; tags: { tag: { name: string } }[];
};

export function EditContactDialog({ contact, open, onOpenChange, onSaved }: { contact: EditableContact; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { data: team = [] } = useQuery({ queryKey: ["users"], queryFn: () => api<{ id: string; name: string; isActive: boolean }[]>("/api/users") });
  const { data: defs = [] } = useFieldDefs("CONTACT");
  const [cf, setCf] = useState<Record<string, unknown>>(contact.customFields ?? {});
  const save = useMutation({
    mutationFn: (b: unknown) => api(`/api/contacts/${contact.id}`, { method: "PATCH", json: b }),
    onSuccess: () => { onSaved(); onOpenChange(false); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Editar contato — ${contact.name}`}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          save.mutate({
            name: f.name, email: f.email || "", phone: f.phone || null, instagram: f.instagram || null, jobTitle: f.jobTitle || null, source: f.source || null,
            ownerId: f.ownerId || null, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), customFields: cf,
          });
        }}
      >
        <div><Label>Nome *</Label><Input name="name" defaultValue={contact.name} required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>WhatsApp / telefone</Label><Input name="phone" defaultValue={contact.phone ?? ""} placeholder="(41) 99999-9999" /></div>
          <div><Label>E-mail</Label><Input name="email" type="email" defaultValue={contact.email ?? ""} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Cargo</Label><Input name="jobTitle" defaultValue={contact.jobTitle ?? ""} /></div>
          <div><Label>Instagram</Label><Input name="instagram" defaultValue={contact.instagram ?? ""} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Responsável</Label>
            <Select name="ownerId" className="w-full" defaultValue={contact.owner?.id ?? ""}>
              <option value="">— sem responsável —</option>
              {team.filter((u) => u.isActive || u.id === contact.owner?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
          <div><Label>Origem</Label><Input name="source" defaultValue={contact.source ?? ""} /></div>
        </div>
        <div><Label>Tags (separadas por vírgula)</Label><Input name="tags" defaultValue={contact.tags.map((t) => t.tag.name).join(", ")} /></div>
        <CustomFieldsInputs defs={defs} values={cf} onChange={setCf} />
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
      </form>
    </Dialog>
  );
}
