// Custo de cada produto/peça, o mesmo em todo o sistema (Custos, Lucros, Lucro por anúncio):
//   material (estrutura do Estoque) + mão de obra (operações ligadas às peças, valor da tela de Custos) + despesas + extra por unidade
// Despesas da fechadura = contas pagas do mês marcadas em Custos → Contas no custo ÷ fechaduras produzidas no mês.
// Sem contas marcadas (ou peça/conjunto), usa o % de despesas do Lucros.
import "server-only";
import { db } from "@/lib/db";
import { custoHora, lerConfig } from "@/lib/config";
import { despesaPorUnidade } from "@/lib/despesasCusto";

export type CfgLucro = { impostoVendaPct: number; custoExtraPct: number; custoExtraUnidade: number };
export async function lerCfgLucro(): Promise<CfgLucro> {
  const rows = await db.configuracao.findMany({ where: { chave: { in: ["impostoVendaPct", "custoExtraPct", "custoExtraUnidade"] } } });
  const m = Object.fromEntries(rows.map((r) => [r.chave, Number(r.valor)]));
  return { impostoVendaPct: m.impostoVendaPct ?? 0, custoExtraPct: m.custoExtraPct ?? 0, custoExtraUnidade: m.custoExtraUnidade ?? 0 };
}

/** Mão de obra por peça de cada operação: real dos últimos 30 dias quando tem apontamento, senão no recorde. Mesma conta da tela de Custos. */
export async function moPorOperacao(dias = 30) {
  const cfg = await lerConfig();
  const desde = new Date(Date.now() - dias * 86_400_000);
  const [ops, funcs, aps] = await Promise.all([
    db.operacao.findMany({ where: { ativo: true }, include: { etapa: true } }),
    db.funcionario.findMany({ where: { ativo: true, salario: { not: null } } }),
    db.apontamento.findMany({ where: { data: { gte: desde } } }),
  ]);
  const horas = funcs.map((f) => ({ setor: f.setor, ch: custoHora(f.salario, cfg, f)! }));
  const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
  const chFabrica = media(horas.map((h) => h.ch));
  const chSetor = (s: string) => media(horas.filter((h) => h.setor === s).map((h) => h.ch)) ?? chFabrica;
  const real = new Map<number, { custo: number; pecas: number; sem: boolean }>();
  for (const a of aps) {
    const r = real.get(a.operacaoId) ?? { custo: 0, pecas: 0, sem: false };
    if (a.custoHora == null) r.sem = true; else r.custo += (a.custoHora * a.minutos) / 60;
    r.pecas += a.quantidade; real.set(a.operacaoId, r);
  }
  const m = new Map<number, { valor: number | null; fonte: "real" | "recorde" | "sem"; nome: string; etapa: string }>();
  for (const o of ops) {
    const r = real.get(o.id);
    const ch = chSetor(o.etapa.nome);
    const noRec = ch != null && o.recordeSegPorPeca ? (ch * o.recordeSegPorPeca) / 3600 : null;
    if (r && r.pecas && !r.sem) m.set(o.id, { valor: r.custo / r.pecas, fonte: "real", nome: o.nome, etapa: o.etapa.nome });
    else m.set(o.id, { valor: noRec, fonte: noRec != null ? "recorde" : "sem", nome: o.nome, etapa: o.etapa.nome });
  }
  return { mo: m, temSalario: chFabrica != null };
}

export type CustoUnit = { material: number; mo: number; despesas: number; despesasDe: "contas" | "pct"; extra: number; total: number; pecasSemMo: string[] };

/** Função que devolve o custo de 1 unidade de qualquer item (desce a estrutura). */
export async function custosUnitarios(cfgL?: CfgLucro, dias = 30) {
  const cfg = cfgL ?? (await lerCfgLucro());
  const [itens, ligs, { mo, temSalario }, rateio] = await Promise.all([
    db.item.findMany({ select: { id: true, codigo: true, nome: true, tipo: true, origem: true, precoCompra: true, componentes: { select: { filhoId: true, quantidade: true } } } }),
    db.itemOperacao.findMany(),
    moPorOperacao(dias),
    despesaPorUnidade(),
  ]);
  const mapa = new Map(itens.map((i) => [i.id, i]));
  const opsDe = new Map<number, typeof ligs>();
  for (const l of ligs) opsDe.set(l.itemId, [...(opsDe.get(l.itemId) ?? []), l]);
  const cache = new Map<number, { material: number; mo: number; semMo: Set<string> }>();
  const base = (id: number, prof = 0): { material: number; mo: number; semMo: Set<string> } => {
    const c = cache.get(id); if (c) return c;
    const it = mapa.get(id);
    const r = { material: 0, mo: 0, semMo: new Set<string>() };
    if (!it || prof > 12) return r;
    if (!it.componentes.length) r.material = it.precoCompra ?? 0;
    for (const k of it.componentes) {
      const f = base(k.filhoId, prof + 1);
      r.material += k.quantidade * f.material; r.mo += k.quantidade * f.mo;
      f.semMo.forEach((x) => r.semMo.add(x));
    }
    const ops = opsDe.get(id) ?? [];
    for (const l of ops) r.mo += (mo.get(l.operacaoId)?.valor ?? 0) * l.porUnidade;
    // peça fabricada aqui sem operação ligada: a mão de obra dela fica de fora
    if (it.origem === "fabricado" && it.tipo === "peca" && !ops.length) r.semMo.add(it.codigo ?? it.nome);
    cache.set(id, r);
    return r;
  };
  const fn = (id: number): CustoUnit => {
    const b = base(id);
    const porContas = mapa.get(id)?.tipo === "produto" && rateio.porUnidade != null;
    const despesas = porContas ? rateio.porUnidade! : (b.material + b.mo) * cfg.custoExtraPct / 100;
    return { material: b.material, mo: b.mo, despesas, despesasDe: porContas ? "contas" : "pct", extra: cfg.custoExtraUnidade, total: b.material + b.mo + despesas + cfg.custoExtraUnidade, pecasSemMo: [...b.semMo] };
  };
  return Object.assign(fn, { temSalario, cfg, rateio });
}

// Sugestão de ligação peça ↔ operação pelo nome (o usuário confere depois)
const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export async function sugerirLigacoes() {
  const [itens, ops] = await Promise.all([
    db.item.findMany({ where: { tipo: { in: ["peca", "conjunto"] }, origem: "fabricado" } }),
    db.operacao.findMany({ where: { ativo: true }, include: { etapa: true } }),
  ]);
  const regras: [RegExp, (o: { nome: string; etapa: string }) => boolean][] = [
    [/^caixa$/, (o) => o.etapa === "estamparia" && /caixa/.test(o.nome)],
    [/^contra testa$/, (o) => /contra.testa/.test(o.nome)],
    [/^testa$/, (o) => /testa/.test(o.nome) && !/contra/.test(o.nome)],
    [/^tampa$/, (o) => o.etapa === "estamparia" && /\btampa\b/.test(o.nome)],
    [/^cilindro$/, (o) => /cilindro/.test(o.nome)],
    [/^lingueta$/, (o) => /lingueta/.test(o.nome)],
    [/^trinco$/, (o) => /^trinco/.test(o.nome)],
    [/^tambor$/, (o) => /tambor/.test(o.nome)],
    [/^espelho (400|403)/, (o) => /polimento espelho|banho de zinco . espelho/.test(o.nome)],
  ];
  let novas = 0;
  for (const it of itens) {
    const nome = n(it.nome);
    const escolhidas = ops.filter((o) => {
      const x = { nome: n(o.nome), etapa: n(o.etapa.nome) };
      const mac = nome.match(/^macaneta (\d{3})/);
      if (mac) return x.nome.startsWith(`macaneta ${mac[1]}`) || (mac[1] === "905" && x.nome === "tampa 905");
      return regras.some(([re, f]) => re.test(nome) && f(x));
    });
    for (const o of escolhidas) {
      const r = await db.itemOperacao.upsert({ where: { itemId_operacaoId: { itemId: it.id, operacaoId: o.id } }, create: { itemId: it.id, operacaoId: o.id, sugerida: true }, update: {} });
      if (r.sugerida) novas++;
    }
  }
  return novas;
}
