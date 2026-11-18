// Contas a pagar do dia a dia: compras aprovadas, salários, contas fixas mensais e contas avulsas.
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { chave, dia, diaUtil, proximoDiaUtil, somaDias } from "./datas";

export const CATEGORIAS = ["Fornecedor", "Colaboradores", "Condomínio", "Aluguel", "Energia", "Água", "Internet/telefone", "Impostos", "Contador", "Frete", "Manutenção", "Tarifas bancárias", "Outras"];
export const BANCOS = ["Santander", "Bradesco"];

/** N-ésimo dia útil do mês (1 = primeiro dia útil). */
export function enesimoDiaUtil(ano: number, mes0: number, n: number) {
  let d = proximoDiaUtil(new Date(Date.UTC(ano, mes0, 1, 12)));
  for (let i = 1; i < n; i++) d = proximoDiaUtil(somaDias(d, 1));
  return d;
}
/** Dia fixo do mês; se o mês for mais curto, usa o último dia. */
export function diaDoMes(ano: number, mes0: number, dia: number) {
  const ultimo = new Date(Date.UTC(ano, mes0 + 1, 0, 12)).getUTCDate();
  return new Date(Date.UTC(ano, mes0, Math.min(dia, ultimo), 12));
}

export async function diaPagamentoSalario() {
  const c = await db.configuracao.findUnique({ where: { chave: "salarioDiaUtil" } });
  return Number(c?.valor) || 5;
}

/**
 * Lança as contas do mês atual e do próximo: contas fixas e salários dos colaboradores ativos.
 * Não repete (cada conta fixa/colaborador tem uma por mês) e não cria conta com vencimento que já passou.
 */
export async function gerarContasMensais() {
  const hoje = dia();
  const [fixas, funcs, nSal] = await Promise.all([
    db.contaRecorrente.findMany({ where: { ativo: true } }),
    db.funcionario.findMany({ where: { ativo: true, salario: { gt: 0 } } }),
    diaPagamentoSalario(),
  ]);
  const novas: Prisma.ContaPagarCreateManyInput[] = [];
  for (let k = 0; k < 2; k++) {
    const ano = hoje.getUTCFullYear() + Math.floor((hoje.getUTCMonth() + k) / 12), mes0 = (hoje.getUTCMonth() + k) % 12;
    const competencia = `${ano}-${String(mes0 + 1).padStart(2, "0")}`;
    for (const f of fixas) {
      const v = f.diaUtil ? enesimoDiaUtil(ano, mes0, f.dia) : diaDoMes(ano, mes0, f.dia);
      if (v < hoje || v < dia(f.criadoEm)) continue;
      novas.push({ descricao: f.descricao, categoria: f.categoria, valor: f.valor, vencimento: v, banco: f.banco, recorrenteId: f.id, competencia, status: "aberto" });
    }
    // salário do mês anterior, pago no N-ésimo dia útil deste mês
    const venc = enesimoDiaUtil(ano, mes0, nSal);
    if (venc >= hoje) {
      for (const f of funcs) {
        if (f.admissao && f.admissao > venc) continue;
        novas.push({ descricao: `Salário — ${f.nome}`, categoria: "Colaboradores", valor: f.salario!, vencimento: venc, funcionarioId: f.id, competencia, status: "aberto", formaPagamento: f.chavePix ? "pix" : null, chavePix: f.chavePix, favorecido: f.nome });
      }
    }
  }
  if (novas.length) await db.contaPagar.createMany({ data: novas, skipDuplicates: true });
  // salário alterado no cadastro: atualiza as contas ainda não pagas
  for (const f of funcs) {
    await db.contaPagar.updateMany({ where: { funcionarioId: f.id, status: "aberto", vencimento: { gte: hoje }, NOT: { valor: f.salario! } }, data: { valor: f.salario! } });
  }
  // chave Pix cadastrada depois: completa as contas em aberto
  for (const f of funcs) if (f.chavePix) await db.contaPagar.updateMany({ where: { funcionarioId: f.id, status: "aberto", chavePix: null }, data: { chavePix: f.chavePix, formaPagamento: "pix" } });
  // conta fixa com valor alterado: atualiza as futuras não pagas
  for (const f of fixas) {
    await db.contaPagar.updateMany({ where: { recorrenteId: f.id, status: "aberto", vencimento: { gte: hoje }, NOT: { valor: f.valor } }, data: { valor: f.valor } });
  }
}

/** Dia em que o dinheiro sai de fato (fim de semana/feriado → próximo dia útil). */
export const diaDoPagamento = (d: Date) => proximoDiaUtil(dia(d.toISOString()));
export { chave, diaUtil };

// ───────── Fluxo de caixa ─────────
export type LinhaFluxo = {
  tipo: "receber" | "pagar"; id: number; data: Date; vencimento: Date; nome: string; categoria: string; valor: number; status: string;
  parcela: string | null; banco: string | null; forma: string | null; codigoBarras: string | null; chavePix: string | null; link: string | null;
};

/** Semana de domingo a sábado (igual à planilha) ou mês inteiro, a partir de uma data de referência. */
export function periodoFluxo(modo: string, ref: Date) {
  if (modo === "mes") {
    const de = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 12));
    const ate = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0, 12));
    const ant = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1, 12));
    const prox = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1, 12));
    return { de, ate, ant, prox };
  }
  const de = somaDias(ref, -ref.getUTCDay());
  return { de, ate: somaDias(de, 6), ant: somaDias(de, -7), prox: somaDias(de, 7) };
}

export async function linhasFluxo(de: Date, ate: Date, previstos = false): Promise<LinhaFluxo[]> {
  const [pagar, receber] = await Promise.all([
    db.contaPagar.findMany({
      where: { status: { in: ["aberto", "pago", ...(previstos ? ["previsto"] : [])] }, vencimento: { gte: somaDias(de, -3), lte: somaDias(ate, 1) } },
      include: { fornecedor: true },
    }),
    db.contaReceber.findMany({ where: { status: { in: ["aberto", "recebido"] }, vencimento: { gte: somaDias(de, -3), lte: somaDias(ate, 1) } } }),
  ]);
  const linhas: LinhaFluxo[] = [];
  for (const c of pagar) {
    // conta paga aparece no dia em que foi paga; em aberto, no dia útil do vencimento
    const d = c.status === "pago" && c.pagoEm ? dia(c.pagoEm) : diaDoPagamento(c.vencimento);
    if (d < de || d > ate) continue;
    linhas.push({
      tipo: "pagar", id: c.id, data: d, vencimento: c.vencimento, nome: c.favorecido && !c.pedidoCompraId ? c.favorecido : c.fornecedor?.nome ?? c.descricao,
      categoria: c.categoria, valor: c.valor, status: c.status, parcela: c.parcela, banco: c.banco, forma: c.formaPagamento,
      codigoBarras: c.codigoBarras, chavePix: c.chavePix, link: c.pedidoCompraId ? `/compras?ver=todos#c${c.pedidoCompraId}` : null,
    });
    if (c.categoria !== "Fornecedor" || !c.pedidoCompraId) linhas[linhas.length - 1].nome = c.descricao.replace(/^Salário — /, "");
  }
  for (const r of receber) {
    const d = r.status === "recebido" && r.recebidoEm ? dia(r.recebidoEm) : diaDoPagamento(r.vencimento);
    if (d < de || d > ate) continue;
    linhas.push({
      tipo: "receber", id: r.id, data: d, vencimento: r.vencimento, nome: r.descricao, categoria: r.categoria, valor: r.valor, status: r.status,
      parcela: r.parcela, banco: r.banco, forma: null, codigoBarras: null, chavePix: null, link: r.pedidoVendaId ? `/vendas/${r.pedidoVendaId}` : null,
    });
  }
  // por dia; no mesmo dia, recebimentos primeiro (como na planilha)
  return linhas.sort((a, b) => a.data.getTime() - b.data.getTime() || (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : a.tipo === "receber" ? -1 : 1));
}

export async function vencidosFluxo() {
  const hoje = dia();
  const [p, r] = await Promise.all([
    db.contaPagar.findMany({ where: { status: "aberto", vencimento: { lt: hoje } }, include: { fornecedor: true }, orderBy: { vencimento: "asc" } }),
    db.contaReceber.findMany({ where: { status: "aberto", vencimento: { lt: hoje } }, orderBy: { vencimento: "asc" } }),
  ]);
  return { pagar: p.filter((c) => diaDoPagamento(c.vencimento) < hoje), receber: r.filter((c) => diaDoPagamento(c.vencimento) < hoje) };
}
