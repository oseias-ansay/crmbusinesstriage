/**
 * Documentos-modelo da base de conhecimento: um roteiro do que preencher.
 * São criados DESATIVADOS — o Copiloto só usa depois que o gestor preenche
 * e ativa cada um (para a IA não tratar o roteiro como informação real).
 */
export const STARTER_DOCS: { title: string; category: string; content: string }[] = [
  {
    title: "Processo de vendas",
    category: "processo",
    content: `Substitua este roteiro pelo processo real da empresa.

Etapas do atendimento e o que fazer em cada uma:
- Primeiro contato: como se apresentar, em quanto tempo responder, o que perguntar.
- Qualificação: quais perguntas confirmam que o cliente tem perfil (porte, necessidade, prazo, quem decide).
- Apresentação da proposta: como apresentar, o que enviar (PDF, vídeo, reunião).
- Fechamento: como pedir o fechamento, formas de pagamento aceitas, documentos necessários.
- Pós-venda: o que acontece depois da assinatura e quem passa a atender.

Tempo máximo de resposta: ...
Quando passar o atendimento para o gestor: ...`,
  },
  {
    title: "Quebra de objeções",
    category: "objecoes",
    content: `Para cada objeção: o que o cliente costuma dizer, o que ela significa de verdade e como responder.

Objeção: "Está caro."
- Significado: ainda não enxergou o valor / comparou com algo mais simples.
- Resposta: ...
- Prova (caso, número, garantia): ...

Objeção: "Vou pensar."
- Resposta: ...

Objeção: "Agora não é o momento."
- Resposta: ...

Objeção: "Já tenho contador / consultor / sistema."
- Resposta: ...

Objeção: "Preciso falar com meu sócio."
- Resposta: ...`,
  },
  {
    title: "Tabela de preços e condições",
    category: "precos",
    content: `Liste cada produto/plano com preço, o que inclui e para quem é indicado.

Plano / produto: ...
- Preço: R$ ...
- Inclui: ...
- Indicado para: (porte, faturamento, situação)

Formas de pagamento: Pix, boleto, cartão em até ... vezes.
Desconto máximo que o vendedor pode dar sem aprovação: ...%
Condições especiais (à vista, contrato anual, indicação): ...
Validade da proposta: ... dias.`,
  },
  {
    title: "Perguntas frequentes",
    category: "faq",
    content: `Pergunta: Quanto tempo leva?
Resposta: ...

Pergunta: Como funciona o atendimento (online/presencial)?
Resposta: ...

Pergunta: Tem contrato de fidelidade? Posso cancelar?
Resposta: ...

Pergunta: Quais resultados posso esperar?
Resposta: ...`,
  },
];
