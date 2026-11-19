// Contas pagas que entram no custo dos produtos (Custos → Contas no custo).
// Soma as contas pagas no mês que estão marcadas e divide pelas fechaduras produzidas no mês:
//   despesa por fechadura = total das contas marcadas ÷ fechaduras produzidas (último passo do processo).
// Se o mês ainda não tem produção lançada, divide pelas fechaduras vendidas no mês.
import "server-only";
import { db } from "@/lib/db";

/** Grupo à parte: boleto de compra de matéria-prima/peça já entra no custo como material da estrutura. */
export const GRUPO_COMPRAS = "Compras de material (pedido de compra)";

/** Por que cada grupo começa fora do custo (para não contar duas vezes). */
export const MOTIVO_FORA: Record<string, string> = {
  [GRUPO_COMPRAS]: "já entra no custo como material",
  Colaboradores: "já entra no custo como mão de obra",
};

export const mesAtual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
export const mesValido = (m?: string | null) => (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : null);
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;

/** Início e fim do mês no horário de Brasília (03:00 UTC do dia 1). */
function faixa(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return { de: new Date(Date.UTC(a, m - 1, 1, 3)), ate: new Date(Date.UTC(a, m, 1, 3)) };
}

export const grupoDa = (c: { categoria: string; pedidoCompraId: number | null }) => (c.pedidoCompraId ? GRUPO_COMPRAS : c.categoria);

/** Regra de cada grupo: entra (true) ou fica fora (false). Grupo sem regra salva usa o padrão. */
export async function regrasGrupos(): Promise<Record<string, boolean>> {
  const [r, imp] = await Promise.all([
    db.configuracao.findUnique({ where: { chave: "custoGrupos" } }),
    db.configuracao.findUnique({ where: { chave: "impostoVendaPct" } }),
  ]);
  // imposto: se o Lucros já desconta imposto sobre a venda, a guia de imposto começa fora para não contar duas vezes
  const padrao: Record<string, boolean> = { [GRUPO_COMPRAS]: false, Colaboradores: false };
  if (Number(imp?.valor) > 0) padrao.Impostos = false;
  try { return { ...padrao, ...JSON.parse(r?.valor || "{}") }; } catch { return padrao; }
}
export const entraGrupo = (regras: Record<string, boolean>, g: string) => regras[g] ?? true;

/** Mês cujas contas entram no custo dos produtos em todo o sistema (padrão: mês atual). */
export async function mesDoCusto() {
  const r = await db.configuracao.findUnique({ where: { chave: "custoMesDespesas" } });
  return mesValido(r?.valor) ?? mesAtual();
}

/** Fechaduras terminadas no mês (último passo do processo de cada produto) e vendidas no mês. */
async function unidadesDoMes(mes: string) {
  const { de, ate } = faixa(mes);
  const produtos = await db.item.findMany({ where: { tipo: "produto" }, select: { passos: { select: { id: true }, orderBy: { ordem: "desc" }, take: 1 } } });
  const ultimos = produtos.map((p) => p.passos[0]?.id).filter((x): x is number => !!x);
  const [feitos, vendidos] = await Promise.all([
    ultimos.length ? db.apontamento.aggregate({ where: { data: { gte: de, lt: ate }, passoId: { in: ultimos } }, _sum: { quantidade: true } }) : null,
    db.pedidoVendaItem.aggregate({ where: { item: { tipo: "produto" }, pedidoVenda: { status: { not: "cancelado" }, dataPedido: { gte: de, lt: ate } } }, _sum: { quantidade: true } }),
  ]);
  return { produzidas: feitos?._sum.quantidade ?? 0, vendidas: vendidos._sum.quantidade ?? 0 };
}

/** Todas as contas pagas no mês, com o que entra e o que sai do custo. */
export async function contasDoMes(mes: string) {
  const { de, ate } = faixa(mes);
  const [contas, regras, un] = await Promise.all([
    db.contaPagar.findMany({
      where: { status: "pago", pagoEm: { gte: de, lt: ate } },
      include: { fornecedor: { select: { nome: true } }, funcionario: { select: { nome: true } } },
      orderBy: [{ pagoEm: "asc" }, { id: "asc" }],
    }),
    regrasGrupos(),
    unidadesDoMes(mes),
  ]);
  const linhas = contas.map((c) => {
    const grupo = grupoDa(c);
    const entra = c.noCusto ?? entraGrupo(regras, grupo);
    return { ...c, grupo, entra, aMao: c.noCusto != null };
  });
  const grupos = new Map<string, { nome: string; regra: boolean; total: number; noCusto: number; contas: typeof linhas }>();
  for (const l of linhas) {
    const g = grupos.get(l.grupo) ?? { nome: l.grupo, regra: entraGrupo(regras, l.grupo), total: 0, noCusto: 0, contas: [] };
    g.total += l.valor; if (l.entra) g.noCusto += l.valor; g.contas.push(l);
    grupos.set(l.grupo, g);
  }
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  const noCusto = linhas.reduce((s, l) => s + (l.entra ? l.valor : 0), 0);
  const base = un.produzidas > 0 ? { un: un.produzidas, por: "produzidas" as const } : un.vendidas > 0 ? { un: un.vendidas, por: "vendidas" as const } : { un: 0, por: "nenhuma" as const };
  return {
    mes, total, noCusto, ...un, base,
    porUnidade: base.un > 0 ? noCusto / base.un : null,
    grupos: [...grupos.values()].sort((a, b) => b.total - a.total),
  };
}

/** Despesa por fechadura do mês usado no custo (null = sem contas marcadas ou sem produção/venda). */
export async function despesaPorUnidade() {
  const mes = await mesDoCusto();
  const r = await contasDoMes(mes);
  return { mes, porUnidade: r.noCusto > 0 ? r.porUnidade : null, base: r.base, noCusto: r.noCusto };
}
