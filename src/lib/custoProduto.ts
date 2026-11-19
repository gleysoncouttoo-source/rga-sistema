// Custo de cada produto/peça, o mesmo em todo o sistema (Custos, Lucros, Lucro por anúncio):
//   material (estrutura do Estoque) + mão de obra (operações ligadas às peças, valor da tela de Custos) + despesas + extra por unidade
// Despesas da fechadura = contas pagas do mês marcadas em Custos → Contas no custo, divididas pelo tempo de produção
// (R$ por hora de produção × horas que a fechadura leva).
// Sem contas marcadas (ou peça/conjunto), usa o % de despesas do Lucros.
import "server-only";
import { db } from "@/lib/db";
import { custoHora, lerConfig } from "@/lib/config";
import { contasDoMes, mesDoCusto } from "@/lib/despesasCusto";

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
  const real = new Map<number, { custo: number; pecas: number; sem: boolean; minutos: number }>();
  for (const a of aps) {
    const r = real.get(a.operacaoId) ?? { custo: 0, pecas: 0, sem: false, minutos: 0 };
    if (a.custoHora == null) r.sem = true; else r.custo += (a.custoHora * a.minutos) / 60;
    r.pecas += a.quantidade; r.minutos += a.minutos; real.set(a.operacaoId, r);
  }
  // tempo por peça de cada operação: medido pelo cronômetro (últimos dias) ou, sem medição, o recorde
  const seg = new Map<number, { seg: number | null; medido: boolean }>();
  for (const o of ops) {
    const r = real.get(o.id);
    if (r && r.pecas > 0 && r.minutos > 0) seg.set(o.id, { seg: (r.minutos * 60) / r.pecas, medido: true });
    else seg.set(o.id, { seg: o.recordeSegPorPeca ?? null, medido: false });
  }
  const m = new Map<number, { valor: number | null; fonte: "real" | "recorde" | "sem"; nome: string; etapa: string }>();
  for (const o of ops) {
    const r = real.get(o.id);
    const ch = chSetor(o.etapa.nome);
    const noRec = ch != null && o.recordeSegPorPeca ? (ch * o.recordeSegPorPeca) / 3600 : null;
    if (r && r.pecas && !r.sem) m.set(o.id, { valor: r.custo / r.pecas, fonte: "real", nome: o.nome, etapa: o.etapa.nome });
    else m.set(o.id, { valor: noRec, fonte: noRec != null ? "recorde" : "sem", nome: o.nome, etapa: o.etapa.nome });
  }
  return { mo: m, seg, temSalario: chFabrica != null };
}

export type CustoUnit = { material: number; mo: number; despesas: number; despesasDe: "contas" | "pct"; extra: number; total: number; pecasSemMo: string[]; seg: number; semTempo: string[] };

/** Tempo em texto curto: "12 min 30 s", "1 h 05 min". */
export function tempoTxt(seg: number | null | undefined) {
  if (seg == null || !(seg > 0)) return "—";
  seg = Math.round(seg);
  if (seg < 60) return `${Math.round(seg)} s`;
  const min = Math.floor(seg / 60), s = Math.round(seg % 60);
  if (min < 60) return s ? `${min} min ${String(s).padStart(2, "0")} s` : `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** Função que devolve o custo de 1 unidade de qualquer item (desce a estrutura). */
/** mes = mês das contas a dividir (padrão: o mês escolhido em Contas no custo). */
export async function custosUnitarios(cfgL?: CfgLucro, dias = 30, mes?: string) {
  const cfg = cfgL ?? (await lerCfgLucro());
  const [itens, ligs, { mo, seg, temSalario }, contas] = await Promise.all([
    db.item.findMany({ select: { id: true, codigo: true, nome: true, tipo: true, origem: true, precoCompra: true, componentes: { select: { filhoId: true, quantidade: true } } } }),
    db.itemOperacao.findMany(),
    moPorOperacao(dias),
    (mes ? Promise.resolve(mes) : mesDoCusto()).then(contasDoMes),
  ]);
  const mapa = new Map(itens.map((i) => [i.id, i]));
  const opsDe = new Map<number, typeof ligs>();
  for (const l of ligs) opsDe.set(l.itemId, [...(opsDe.get(l.itemId) ?? []), l]);
  type Base = { material: number; mo: number; seg: number; semMo: Set<string>; semTempo: Set<string> };
  const cache = new Map<number, Base>();
  const base = (id: number, prof = 0): Base => {
    const c = cache.get(id); if (c) return c;
    const it = mapa.get(id);
    const r: Base = { material: 0, mo: 0, seg: 0, semMo: new Set<string>(), semTempo: new Set<string>() };
    if (!it || prof > 12) return r;
    if (!it.componentes.length) r.material = it.precoCompra ?? 0;
    for (const k of it.componentes) {
      const f = base(k.filhoId, prof + 1);
      r.material += k.quantidade * f.material; r.mo += k.quantidade * f.mo; r.seg += k.quantidade * f.seg;
      f.semMo.forEach((x) => r.semMo.add(x)); f.semTempo.forEach((x) => r.semTempo.add(x));
    }
    const ops = opsDe.get(id) ?? [];
    for (const l of ops) {
      r.mo += (mo.get(l.operacaoId)?.valor ?? 0) * l.porUnidade;
      const t = seg.get(l.operacaoId)?.seg;
      if (t != null) r.seg += t * l.porUnidade; else r.semTempo.add(mo.get(l.operacaoId)?.nome ?? `operação ${l.operacaoId}`);
    }
    // peça fabricada aqui sem operação ligada: a mão de obra dela fica de fora
    if (it.origem === "fabricado" && it.tipo === "peca" && !ops.length) r.semMo.add(it.codigo ?? it.nome);
    cache.set(id, r);
    return r;
  };
  // Rateio das contas marcadas: pelo tempo de produção de cada fechadura (quem leva mais tempo leva mais despesa).
  // Se alguma fechadura feita no mês não tem tempo (sem cronômetro nem recorde), divide igual por fechadura.
  const feitas = [...contas.unidades.entries()].filter(([, q]) => q > 0);
  const un = feitas.reduce((s, [, q]) => s + q, 0);
  const segTotal = feitas.reduce((s, [id, q]) => s + q * base(id).seg, 0);
  const todasComTempo = feitas.every(([id]) => base(id).seg > 0);
  const modo: "tempo" | "igual" | "pct" = !(contas.noCusto > 0) || un === 0 ? "pct" : todasComTempo && segTotal > 0 ? "tempo" : "igual";
  const rateio = {
    mes: contas.mes, modo, noCusto: contas.noCusto, un, por: contas.base.por, horas: segTotal / 3600,
    porHora: modo === "tempo" ? contas.noCusto / (segTotal / 3600) : null,
    porUnidade: modo === "igual" ? contas.noCusto / un : null,
    semTempo: feitas.filter(([id]) => !(base(id).seg > 0)).map(([id]) => mapa.get(id)?.codigo ?? mapa.get(id)?.nome ?? String(id)),
  };
  const fn = (id: number): CustoUnit => {
    const b = base(id);
    const porContas = mapa.get(id)?.tipo === "produto" && modo !== "pct";
    const despesas = !porContas ? (b.material + b.mo) * cfg.custoExtraPct / 100 : modo === "tempo" ? (b.seg / 3600) * rateio.porHora! : rateio.porUnidade!;
    return { material: b.material, mo: b.mo, despesas, despesasDe: porContas ? "contas" : "pct", extra: cfg.custoExtraUnidade, total: b.material + b.mo + despesas + cfg.custoExtraUnidade, pecasSemMo: [...b.semMo], seg: b.seg, semTempo: [...b.semTempo] };
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
