"use client";
/** Renderiza inputs dos campos personalizados conforme o tipo definido no tenant. */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { Input, Label, Select } from "@/components/ui/input";

export type FieldDef = {
  id: string;
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTISELECT" | "BOOLEAN" | "CURRENCY";
  options: string[];
  required: boolean;
};

export function useFieldDefs(entity: "CONTACT" | "DEAL") {
  return useQuery({ queryKey: ["custom-fields", entity], queryFn: () => api<FieldDef[]>(`/api/custom-fields?entity=${entity}`) });
}

export function CustomFieldsInputs({ defs, values, onChange }: { defs: FieldDef[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  if (!defs.length) return null;
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
      <legend className="px-1 text-xs font-medium text-slate-500">Campos personalizados</legend>
      {defs.map((d) => {
        const v = values[d.key];
        return (
          <div key={d.id}>
            <Label>
              {d.label}
              {d.required && " *"}
            </Label>
            {d.type === "SELECT" ? (
              <Select className="w-full" value={String(v ?? "")} onChange={(e) => set(d.key, e.target.value || null)}>
                <option value="">—</option>
                {d.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            ) : d.type === "MULTISELECT" ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {d.options.map((o) => {
                  const arr = Array.isArray(v) ? (v as string[]) : [];
                  return (
                    <label key={o} className="flex items-center gap-1 text-sm">
                      <input type="checkbox" checked={arr.includes(o)} onChange={(e) => set(d.key, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} /> {o}
                    </label>
                  );
                })}
              </div>
            ) : d.type === "BOOLEAN" ? (
              <label className="flex items-center gap-2 pt-2 text-sm">
                <input type="checkbox" checked={!!v} onChange={(e) => set(d.key, e.target.checked)} /> Sim
              </label>
            ) : (
              <Input
                type={d.type === "NUMBER" || d.type === "CURRENCY" ? "number" : d.type === "DATE" ? "date" : "text"}
                step={d.type === "CURRENCY" ? "0.01" : undefined}
                required={d.required}
                value={v == null ? "" : String(v)}
                onChange={(e) =>
                  set(d.key, e.target.value === "" ? null : d.type === "NUMBER" || d.type === "CURRENCY" ? Number(e.target.value) : e.target.value)
                }
              />
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
