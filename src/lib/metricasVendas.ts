// Métricas e recordes de vendas (todos os canais: manual, site, Shopee).
import "server-only";
import { db } from "@/lib/db";

export type Venda = { pedidoId: number; origem: string; data: Date; itemId: number; codigo: string; nome: string; quantidade: number; valor: number };

const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
export const diaBR = (d: Date) => fmtDia.format(d); // AAAA-MM-DD no horário de Brasília
export function semanaDe(k: string) { // domingo da semana
  const d = new Date(k + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
export const mesDe = (k: string) => k.slice(0, 7);
export const periodoDe = (tipo: string, k: string) => (tipo === "dia" ? k : tipo === "semana" ? semanaDe(k) : mesDe(k));

export const CANAIS: Record<string, string> = { shopee: "Shopee", site: "Site", manual: "Direto (manual)" };

/** Itens vendidos (pedidos não cancelados) desde a data, com valor = quantidade × preço */
export async function vendas(desde?: Date): Promise<Venda[]> {
  const ps = await db.pedidoVenda.findMany({
    where: { status: { not: "cancelado" }, ...(desde ? { dataPedido: { gte: desde } } : {}) },
    select: { id: true, origem: true, dataPedido: true, itens: { select: { itemId: true, quantidade: true, precoUnitario: true, item: { select: { codigo: true, nome: true, precoVenda: true } } } } },
  });
  return ps.flatMap((p) => p.itens.map((i) => ({
    pedidoId: p.id, origem: p.origem, data: p.dataPedido, itemId: i.itemId, codigo: i.item.codigo ?? i.item.nome, nome: i.item.nome,
    quantidade: i.quantidade, valor: i.quantidade * (i.precoUnitario ?? i.item.precoVenda ?? 0),
  })));
}

export function resumo(vs: Venda[]) {
  const pedidos = new Set(vs.map((v) => v.pedidoId)).size;
  const faturamento = vs.reduce((t, v) => t + v.valor, 0);
  const unidades = vs.reduce((t, v) => t + v.quantidade, 0);
  return { pedidos, faturamento, unidades, ticket: pedidos ? faturamento / pedidos : 0 };
}

export function porPeriodo(vs: Venda[], tipo: string) {
  const m = new Map<string, { faturamento: number; unidades: number }>();
  for (const v of vs) {
    const k = periodoDe(tipo, diaBR(v.data));
    const x = m.get(k) ?? { faturamento: 0, unidades: 0 };
    x.faturamento += v.valor; x.unidades += v.quantidade;
    m.set(k, x);
  }
  return m;
}

export const TIPOS_REC = [["dia", "Melhor dia"], ["semana", "Melhor semana"], ["mes", "Melhor mês"]] as const;
export const METRICAS = [["faturamento", "Faturamento"], ["unidades", "Fechaduras vendidas"]] as const;

export type Recorde = {
  tipo: string; metrica: string; escopo: string; nomeEscopo: string;
  confirmado: { periodo: string; valor: number; decididoPor: string | null } | null;
  candidato: { periodo: string; valor: number } | null; // período fechado que bateu o confirmado (aguardando gestor/diretor)
  atual: { periodo: string; valor: number }; // período em andamento
};

/** Recordes: só períodos já fechados viram candidato; o período atual aparece como progresso. */
export async function recordes(vs: Venda[], hoje = diaBR(new Date())): Promise<Recorde[]> {
  const salvos = await db.recordeVenda.findMany({ orderBy: { valor: "desc" } });
  const escopos: [string, string, Venda[]][] = [["total", "Todos os canais", vs]];
  for (const [c, nome] of Object.entries(CANAIS)) {
    const x = vs.filter((v) => v.origem === c);
    if (x.length) escopos.push([`canal:${c}`, nome, x]);
  }
  const porItem = new Map<number, Venda[]>();
  for (const v of vs) porItem.set(v.itemId, [...(porItem.get(v.itemId) ?? []), v]);
  const lista: Recorde[] = [];
  const montar = (tipo: string, metrica: string, escopo: string, nome: string, dados: Venda[]) => {
    const m = porPeriodo(dados, tipo);
    const atualK = periodoDe(tipo, hoje);
    const val = (k: string) => (m.get(k)?.[metrica as "faturamento"] ?? 0);
    const meus = salvos.filter((s) => s.tipo === tipo && s.metrica === metrica && s.escopo === escopo);
    const conf = meus.find((s) => s.status === "confirmado") ?? null;
    const recusados = new Set(meus.filter((s) => s.status === "recusado").map((s) => `${s.periodo}|${s.valor}`));
    const fechados = [...m.keys()].filter((k) => k < atualK && !recusados.has(`${k}|${val(k)}`)).sort((a, b) => val(b) - val(a));
    const melhor = fechados[0];
    const candidato = melhor && val(melhor) > (conf?.valor ?? 0) + 1e-9 ? { periodo: melhor, valor: val(melhor) } : null;
    lista.push({
      tipo, metrica, escopo, nomeEscopo: nome, candidato,
      confirmado: conf && { periodo: conf.periodo, valor: conf.valor, decididoPor: conf.decididoPor },
      atual: { periodo: atualK, valor: val(atualK) },
    });
  };
  for (const [esc, nome, dados] of escopos) for (const [t] of TIPOS_REC) for (const [mt] of METRICAS) montar(t, mt, esc, nome, dados);
  for (const [id, dados] of porItem) montar("mes", "unidades", `item:${id}`, dados[0].codigo, dados);
  return lista;
}

export function nomePeriodo(tipo: string, k: string) {
  const [a, m, d] = k.split("-");
  if (tipo === "mes") return new Date(Date.UTC(+a, +m - 1, 15)).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
  if (tipo === "semana") {
    const fim = new Date(k + "T12:00:00Z"); fim.setUTCDate(fim.getUTCDate() + 6);
    return `${d}/${m} a ${fim.toISOString().slice(8, 10)}/${fim.toISOString().slice(5, 7)}/${a}`;
  }
  return `${d}/${m}/${a}`;
}
