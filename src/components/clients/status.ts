export const STATUS: Record<string, { label: string; color: string }> = {
  ONBOARDING: { label: "Em implantação", color: "#F59E0B" },
  ACTIVE: { label: "Ativo", color: "#10B981" },
  PAUSED: { label: "Pausado", color: "#94A3B8" },
  ENDED: { label: "Encerrado", color: "#EF4444" },
};
export const CONTRACT_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Rascunho", color: "#94A3B8" },
  SENT: { label: "Enviado", color: "#38BDF8" },
  SIGNED: { label: "Assinado", color: "#10B981" },
  CANCELED: { label: "Cancelado", color: "#EF4444" },
};
export function fmtDocument(d?: string | null) {
  const s = (d ?? "").replace(/\D/g, "");
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d ?? "";
}
