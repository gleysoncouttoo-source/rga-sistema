// Lucro das vendas: vendas − taxas do canal − imposto − custo do produto (lib/custoProduto) − gasto com Anúncios Shopee (Ads).
// A mesma base (linhasVenda) alimenta o lucro por anúncio e o lucro por produto.
import "server-only";
import { db } from "@/lib/db";
import { custosUnitarios, lerCfgLucro, type CfgLucro, type CustoUnit } from "@/lib/custoProduto";
import { numero } from "@/lib/shopee";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const DIA = 86_400_000;

// ───────── Relatório de Anúncios Shopee (Marketing → Anúncios Shopee → Exportar dados) ─────────
const COLS: Record<string, string[]> = {
  anuncio: ["nome do anuncio", "nome do produto", "anuncio", "ad name", "product name", "nome"],
  produtoId: ["id do produto", "product id", "item id", "id do item"],
  impressoes: ["impressoes", "impression", "impressions"],
  cliques: ["cliques", "clicks"],
  itens: ["itens vendidos", "items sold", "unidades vendidas"],
  vendas: ["gmv", "vendas", "receita", "sales", "gmv total"],
  gasto: ["despesas", "gasto", "gastos", "custo", "expense", "spend", "investimento"],
};

export type LinhaAds = { anuncio: string; produtoId: string | null; impressoes: number; cliques: number; itens: number; vendas: number; gasto: number };

function dataBR(s: string) { const [d, m, a] = s.split("/"); return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; }

export function lerAdsPlanilha(linhas: string[][]): { de: string | null; ate: string | null; linhas: LinhaAds[] } {
  const iCab = linhas.slice(0, 30).findIndex((l) => {
    const n = l.map(norm);
    return n.some((c) => COLS.anuncio.includes(c)) && n.some((c) => COLS.gasto.some((g) => c === g || c.startsWith(g)));
  });
  if (iCab < 0) throw new Error("Não achei as colunas \"Nome do Anúncio\" e \"Despesas\". Envie o relatório exportado em Anúncios Shopee → Exportar dados.");
  // período: procura "dd/mm/aaaa - dd/mm/aaaa" (ou aaaa-mm-dd) nas linhas de cima
  let de: string | null = null, ate: string | null = null;
  for (const l of linhas.slice(0, iCab)) {
    const t = l.join(" ");
    const m = t.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–a~]+\s*(\d{1,2}\/\d{1,2}\/\d{4})/) ?? t.match(/(\d{4}-\d{2}-\d{2})\s*[-–a~]+\s*(\d{4}-\d{2}-\d{2})/);
    if (m) { de = m[1].includes("/") ? dataBR(m[1]) : m[1]; ate = m[2].includes("/") ? dataBR(m[2]) : m[2]; break; }
  }
  const cab = linhas[iCab].map(norm);
  const col: Record<string, number> = {};
  for (const [k, nomes] of Object.entries(COLS)) {
    let i = cab.findIndex((c) => nomes.includes(c));
    if (i < 0) i = cab.findIndex((c) => nomes.some((n) => c.startsWith(n) && !c.includes("diret")));
    col[k] = i;
  }
  const g = (l: string[], k: string) => (col[k] >= 0 ? String(l[col[k]] ?? "").trim() : "");
  const mapa = new Map<string, LinhaAds>();
  for (const l of linhas.slice(iCab + 1)) {
    const anuncio = g(l, "anuncio");
    if (!anuncio || /^(total|todos|resumo)/i.test(anuncio)) continue;
    const pid = g(l, "produtoId").replace(/\D/g, "") || null;
    const k = pid ?? norm(anuncio);
    const x = mapa.get(k) ?? { anuncio, produtoId: pid, impressoes: 0, cliques: 0, itens: 0, vendas: 0, gasto: 0 };
    for (const c of ["impressoes", "cliques", "itens", "vendas", "gasto"] as const) x[c] += numero(g(l, c)) ?? 0;
    mapa.set(k, x);
  }
  return { de, ate, linhas: [...mapa.values()].filter((x) => x.gasto || x.vendas || x.cliques) };
}

export { lerCfgLucro, type CfgLucro };

export type LinhaVenda = {
  pedidoId: number; origem: string; itemId: number; codigo: string; nome: string; anuncioChave: string | null; anuncio: string | null;
  quantidade: number; valor: number; taxas: number; imposto: number; custo: number; ads: number; unit: CustoUnit;
};
export type AdsAnuncio = { chave: string; anuncio: string; gasto: number; vendas: number; itens: number; cliques: number; impressoes: number };

/** Itens vendidos no período (todos os canais ou um), cada um com sua parte de taxas, imposto, custo e Ads. de/ate: AAAA-MM-DD, horário de Brasília. */
export async function linhasVenda(de: string, ate: string, canal?: string) {
  const ini = new Date(`${de}T00:00:00-03:00`), fim = new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + DIA);
  const cfg = await lerCfgLucro();
  const custo = await custosUnitarios(cfg);
  const pedidos = await db.pedidoVenda.findMany({
    where: { status: { not: "cancelado" }, dataPedido: { gte: ini, lt: fim }, ...(canal ? { origem: canal } : {}) },
    include: { itens: { include: { item: { select: { codigo: true, nome: true, precoVenda: true } } } } },
  });
  const linhas: LinhaVenda[] = [];
  const porId = new Map<string, string>(); // ID do produto Shopee → chave do anúncio
  for (const p of pedidos) {
    const valores = p.itens.map((i) => i.quantidade * (i.precoUnitario ?? i.item.precoVenda ?? 0));
    const tot = valores.reduce((a, b) => a + b, 0);
    p.itens.forEach((i, n) => {
      const anuncio = p.origem === "shopee" ? (i.anuncio ?? `(sem anúncio) ${i.item.codigo}`) : null;
      const anuncioChave = anuncio ? norm(anuncio) : null;
      if (i.anuncioId && anuncioChave) porId.set(i.anuncioId, anuncioChave);
      const unit = custo(i.itemId);
      linhas.push({
        pedidoId: p.id, origem: p.origem, itemId: i.itemId, codigo: i.item.codigo ?? i.item.nome, nome: i.item.nome, anuncioChave, anuncio,
        quantidade: i.quantidade, valor: valores[n],
        taxas: tot ? (p.taxas ?? 0) * (valores[n] / tot) : 0, // taxa do pedido dividida pelo valor de cada item
        imposto: valores[n] * cfg.impostoVendaPct / 100, custo: i.quantidade * unit.total, ads: 0, unit,
      });
    });
  }
  // Ads (só Shopee): relatórios que cruzam o período entram na proporção dos dias em comum
  const ads = new Map<string, AdsAnuncio>();
  let adsProporcional = false;
  if (!canal || canal === "shopee") {
    const rels = await db.adsRelatorio.findMany({ where: { de: { lt: fim }, ate: { gte: new Date(ini.getTime() - DIA) } }, include: { linhas: true } });
    for (const r of rels) {
      const rIni = new Date(r.de.toISOString().slice(0, 10) + "T00:00:00-03:00"), rFim = new Date(new Date(r.ate.toISOString().slice(0, 10) + "T00:00:00-03:00").getTime() + DIA);
      const comum = Math.max(0, Math.min(fim.getTime(), rFim.getTime()) - Math.max(ini.getTime(), rIni.getTime()));
      const f = comum / (rFim.getTime() - rIni.getTime());
      if (f <= 0) continue;
      if (f < 0.999) adsProporcional = true;
      for (const a of r.linhas) {
        const chave = (a.produtoId && porId.get(a.produtoId)) ?? norm(a.anuncio);
        const x = ads.get(chave) ?? { chave, anuncio: a.anuncio, gasto: 0, vendas: 0, itens: 0, cliques: 0, impressoes: 0 };
        x.gasto += a.gasto * f; x.vendas += a.vendas * f; x.itens += a.itens * f; x.cliques += a.cliques * f; x.impressoes += a.impressoes * f;
        ads.set(chave, x);
      }
    }
    // gasto do anúncio dividido entre os produtos vendidos nele, pelo valor
    for (const [chave, a] of ads) {
      const ls = linhas.filter((l) => l.anuncioChave === chave);
      const v = ls.reduce((t, l) => t + l.valor, 0);
      for (const l of ls) l.ads = v ? a.gasto * (l.valor / v) : a.gasto / ls.length;
    }
  }
  const semTaxa = pedidos.filter((p) => p.origem === "shopee" && p.taxas == null).length;
  return { linhas, ads, cfg, adsProporcional, semTaxa, pedidos: pedidos.length, temSalario: custo.temSalario };
}

// ───────── Lucro por anúncio ─────────
export type LinhaLucro = {
  chave: string; anuncio: string; produtos: string[];
  pedidos: number; unidades: number; faturamento: number; taxas: number; imposto: number; custo: number;
  ads: { gasto: number; vendas: number; itens: number; cliques: number; impressoes: number };
  sobra: number; // faturamento − taxas − imposto − custo − gasto Ads
  roasMinimo: number | null; // ROAS a partir do qual o Ads se paga (faturamento ÷ margem antes do Ads)
};

export async function lucroPorAnuncio(de: string, ate: string) {
  const base = await linhasVenda(de, ate, "shopee");
  const m = new Map<string, LinhaLucro & { _ped: Set<number>; _prod: Set<string> }>();
  const vazio = { gasto: 0, vendas: 0, itens: 0, cliques: 0, impressoes: 0 };
  for (const l of base.linhas) {
    const x = m.get(l.anuncioChave!) ?? { chave: l.anuncioChave!, anuncio: l.anuncio!, produtos: [], pedidos: 0, unidades: 0, faturamento: 0, taxas: 0, imposto: 0, custo: 0, ads: { ...vazio }, sobra: 0, roasMinimo: null, _ped: new Set<number>(), _prod: new Set<string>() };
    x._ped.add(l.pedidoId); x._prod.add(l.codigo);
    x.unidades += l.quantidade; x.faturamento += l.valor; x.taxas += l.taxas; x.imposto += l.imposto; x.custo += l.custo;
    m.set(x.chave, x);
  }
  for (const [chave, a] of base.ads) {
    const x = m.get(chave) ?? { chave, anuncio: a.anuncio, produtos: [], pedidos: 0, unidades: 0, faturamento: 0, taxas: 0, imposto: 0, custo: 0, ads: { ...vazio }, sobra: 0, roasMinimo: null, _ped: new Set<number>(), _prod: new Set<string>() };
    x.ads = { gasto: a.gasto, vendas: a.vendas, itens: a.itens, cliques: a.cliques, impressoes: a.impressoes };
    m.set(chave, x);
  }
  const lista: LinhaLucro[] = [...m.values()].map(({ _ped, _prod, ...l }) => {
    l.pedidos = _ped.size; l.produtos = [..._prod];
    const antesAds = l.faturamento - l.taxas - l.imposto - l.custo;
    l.sobra = antesAds - l.ads.gasto;
    l.roasMinimo = antesAds > 0 ? l.faturamento / antesAds : null;
    return l;
  }).sort((a, b) => b.faturamento - a.faturamento || b.ads.gasto - a.ads.gasto);
  return { lista, cfg: base.cfg, adsProporcional: base.adsProporcional, semTaxa: base.semTaxa, pedidos: base.pedidos, semCusto: base.linhas.filter((l) => !l.unit.total).length };
}
