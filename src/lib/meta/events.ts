/** Eventos oferecidos no editor de etapas (compartilhado entre tela e servidor). */
export const META_EVENTS = [
  { value: "Lead", label: "Lead — novo lead" },
  { value: "Contact", label: "Contact — conversa iniciada" },
  { value: "QualifiedLead", label: "QualifiedLead — lead qualificado" },
  { value: "Schedule", label: "Schedule — reunião agendada" },
  { value: "SubmitApplication", label: "SubmitApplication — diagnóstico/cadastro" },
  { value: "CompleteRegistration", label: "CompleteRegistration — inscrição em live" },
  { value: "InitiateCheckout", label: "InitiateCheckout — proposta enviada" },
  { value: "Purchase", label: "Purchase — venda (usa o valor do negócio)" },
] as const;
