export const TIPOS: Record<string, string> = {
  produto: "Produto", conjunto: "Conjunto", peca: "Peça", materia_prima: "Matéria-prima", insumo: "Insumo",
};
export const SITUACAO: Record<string, { nome: string; cls: string }> = {
  pronto: { nome: "Tudo em estoque", cls: "ok" },
  produzir: { nome: "Produzir/montar", cls: "" },
  comprar: { nome: "Precisa comprar", cls: "alerta" },
  urgente: { nome: "Compra urgente", cls: "erro" },
};
export const STATUS_VENDA: Record<string, { nome: string; cls: string }> = {
  aberto: { nome: "Aberto", cls: "" }, entregue: { nome: "Entregue", cls: "ok" }, cancelado: { nome: "Cancelado", cls: "" },
};
export const STATUS_COMPRA: Record<string, { nome: string; cls: string }> = {
  sugerido: { nome: "Sugerido pelo sistema", cls: "alerta" }, aprovado: { nome: "Aprovado — aguardando chegada", cls: "" },
  recebido: { nome: "Recebido", cls: "ok" }, cancelado: { nome: "Cancelado", cls: "" },
};
