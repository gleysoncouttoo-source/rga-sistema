// Extrato do banco (Santander e Bradesco): lê o arquivo (OFX, CSV ou Excel) e cruza cada lançamento
// com as contas a pagar e a receber em aberto, para dar baixa sem digitar nada.
import "server-only";
import { db } from "./db";
import { decodificar, lerPlanilha } from "./planilha";
import { chave, dia, diasEntre, somaDias } from "./datas";
import { diaDoPagamento } from "./financeiro";

export type Mov = { data: string; valor: number; descricao: string; doc: string | null; chave: string };
export type Extrato = { banco: string | null; movs: Mov[]; de: string | null; ate: string | null; saldo: number | null; saldoEm: string | null };

const BANCO_POR_CODIGO: Record<string, string> = { "33": "Santander", "237": "Bradesco" };

/** Tira acento, deixa minúsculo e só letras/números. */
export const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "1.234,56", "-1234.56", "1234,5 D" → número. */
export function numeroBR(s: string): number {
  let t = String(s ?? "").trim();
  if (!t) return NaN;
  let neg = /^-|-$|\(.*\)|\bD$/i.test(t);
  t = t.replace(/[^0-9.,]/g, "");
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\.(?=.*\.)/g, "");
  const v = Number(t);
  if (/^\s*\+/.test(s)) neg = false;
  return neg ? -v : v;
}

/** dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd, aaaammdd → aaaa-mm-dd */
function dataTexto(s: string): string | null {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // data como número do Excel
  if (/^\d{5}(\.\d+)?$/.test(t)) return chave(new Date(Date.UTC(1899, 11, 30 + Math.floor(Number(t)), 12)));
  return null;
}

/** Monta a chave de cada lançamento (repetidos no mesmo dia/valor/descrição ganham 1, 2, 3...). */
function comChaves(lista: Omit<Mov, "chave">[]): Mov[] {
  const vistos = new Map<string, number>();
  return lista.map((m) => {
    const base = `${m.data}|${Math.round(m.valor * 100)}|${normal(m.descricao).slice(0, 60)}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return { ...m, chave: `${base}|${n}` };
  });
}

function lerOfx(txt: string): Extrato {
  const tag = (bloco: string, nome: string) => bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
  const codigo = String(Number(tag(txt, "BANKID") || NaN));
  const lista: Omit<Mov, "chave">[] = [];
  for (const b of txt.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)) {
    const bloco = b[1];
    const data = dataTexto(tag(bloco, "DTPOSTED"));
    const valor = numeroBR(tag(bloco, "TRNAMT"));
    if (!data || !Number.isFinite(valor) || Math.abs(valor) < 0.005) continue;
    const nome = tag(bloco, "NAME"), memo = tag(bloco, "MEMO");
    const descricao = [memo, nome].filter((x, i, a) => x && a.indexOf(x) === i && !(i === 1 && memo.includes(nome))).join(" — ") || tag(bloco, "TRNTYPE");
    lista.push({ data, valor: Math.round(valor * 100) / 100, descricao, doc: tag(bloco, "CHECKNUM") || tag(bloco, "REFNUM") || null });
  }
  const bal = txt.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i)?.[1] ?? "";
  const saldo = bal ? numeroBR(tag(bal, "BALAMT")) : NaN;
  return {
    banco: BANCO_POR_CODIGO[codigo] ?? (/santander/i.test(txt) ? "Santander" : /bradesco/i.test(txt) ? "Bradesco" : null),
    movs: comChaves(lista), de: dataTexto(tag(txt, "DTSTART")), ate: dataTexto(tag(txt, "DTEND")),
    saldo: Number.isFinite(saldo) ? saldo : null, saldoEm: bal ? dataTexto(tag(bal, "DTASOF")) : null,
  };
}

/** Planilha do internet banking: acha a linha de cabeçalho (Data, Histórico, Crédito/Débito ou Valor). */
function lerTabela(linhas: string[][], texto: string): Extrato {
  const n = (s: string) => normal(s ?? "");
  const ih = linhas.findIndex((l) => l.some((c) => /^data\b/.test(n(c))) && l.some((c) => /^(valor|credito|debito|entrada|saida)/.test(n(c))));
  if (ih < 0) throw new Error("Não achei as colunas do extrato (Data, Histórico e Valor). Prefira o arquivo OFX.");
  const cab = linhas[ih].map(n);
  const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
  const cData = col(/^data\b/), cDesc = col(/^(historico|descricao|lancamento|historic)/), cDoc = col(/^(docto|documento|doc\b|n documento)/);
  const cValor = col(/^valor/), cCred = col(/^(credito|entrada)/), cDeb = col(/^(debito|saida)/), cSaldo = col(/^saldo/);
  const lista: Omit<Mov, "chave">[] = [];
  let saldo: number | null = null, saldoEm: string | null = null;
  for (const l of linhas.slice(ih + 1)) {
    const data = dataTexto(l[cData] ?? "");
    const desc = String(l[cDesc >= 0 ? cDesc : cData + 1] ?? "").trim();
    if (!data) {
      // continuação do histórico na linha de baixo (Bradesco faz isso)
      if (desc && lista.length && !l.some((c, i) => i !== cDesc && String(c).trim())) lista[lista.length - 1].descricao += " " + desc;
      continue;
    }
    if (cSaldo >= 0 && Number.isFinite(numeroBR(l[cSaldo]))) { saldo = numeroBR(l[cSaldo]); saldoEm = data; }
    if (/^saldo|saldo anterior|saldo do dia|^total/i.test(normal(desc))) continue;
    let valor = NaN;
    if (cValor >= 0) valor = numeroBR(l[cValor]);
    else {
      const c = numeroBR(l[cCred] ?? ""), d = numeroBR(l[cDeb] ?? "");
      valor = (Number.isFinite(c) ? Math.abs(c) : 0) - (Number.isFinite(d) ? Math.abs(d) : 0);
    }
    if (!Number.isFinite(valor) || Math.abs(valor) < 0.005) continue;
    lista.push({ data, valor: Math.round(valor * 100) / 100, descricao: desc || "(sem histórico)", doc: cDoc >= 0 ? String(l[cDoc] ?? "").trim() || null : null });
  }
  const datas = lista.map((m) => m.data).sort();
  const topo = texto.slice(0, 3000);
  return {
    banco: /santander/i.test(topo) ? "Santander" : /bradesco/i.test(topo) ? "Bradesco" : null,
    movs: comChaves(lista), de: datas[0] ?? null, ate: datas[datas.length - 1] ?? null, saldo, saldoEm,
  };
}

export function lerExtrato(nome: string, buf: Uint8Array): Extrato {
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
    throw new Error("PDF não dá para ler com segurança. No internet banking, baixe o mesmo extrato no formato OFX (às vezes aparece como \"Money\").");
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const linhas = lerPlanilha(nome, buf);
    return lerTabela(linhas, linhas.slice(0, 15).map((l) => l.join(" ")).join("\n"));
  }
  const txt = decodificar(buf);
  if (/<OFX>|OFXHEADER/i.test(txt)) return lerOfx(txt);
  if (/\.xls$/i.test(nome)) throw new Error("Arquivo .xls antigo: abra no Excel e salve como .xlsx, ou baixe em OFX.");
  return lerTabela(lerPlanilha(nome.replace(/\.\w+$/, ".csv"), buf), txt);
}

// ───────── Conferência ─────────

export type Conta = { tipo: "pagar" | "receber"; id: number; nome: string; valor: number; vencimento: Date; dia: Date; banco: string | null; categoria: string };
export type Linha = Mov & { i: number; tipo: "pagar" | "receber"; ja: { acao: string; contaNome: string | null } | null; par: Conta | null; perto: Conta[] };

const palavras = (s: string) => normal(s).split(" ").filter((w) => w.length >= 4 && !/^(ltda|pagamento|salario|fornecedor|conta|boleto|transf|pix)$/.test(w));

export async function conferir(banco: string, movs: Mov[]) {
  const datas = movs.map((m) => m.data).sort();
  const de = datas.length ? dia(datas[0]) : dia(), ate = datas.length ? dia(datas[datas.length - 1]) : dia();
  const janela = { gte: somaDias(de, -40), lte: somaDias(ate, 25) };
  const [pagar, receber, feitos] = await Promise.all([
    db.contaPagar.findMany({ where: { status: "aberto", vencimento: janela }, include: { fornecedor: true } }),
    db.contaReceber.findMany({ where: { status: "aberto", vencimento: janela } }),
    db.movimentoBanco.findMany({ where: { banco, chave: { in: movs.map((m) => m.chave) } } }),
  ]);
  const contas: Conta[] = [
    ...pagar.map((c) => ({ tipo: "pagar" as const, id: c.id, nome: c.categoria === "Fornecedor" && c.fornecedor ? `${c.fornecedor.nome}${c.parcela ? ` (${c.parcela})` : ""}` : c.descricao, valor: c.valor, vencimento: c.vencimento, dia: diaDoPagamento(c.vencimento), banco: c.banco, categoria: c.categoria, extra: [c.favorecido, c.fornecedor?.nome, c.descricao].join(" ") })),
    ...receber.map((c) => ({ tipo: "receber" as const, id: c.id, nome: c.descricao, valor: c.valor, vencimento: c.vencimento, dia: diaDoPagamento(c.vencimento), banco: c.banco, categoria: c.categoria, extra: c.descricao })),
  ];
  const feito = new Map(feitos.map((f) => [f.chave, f]));
  const linhas: Linha[] = movs.map((m, i) => {
    const f = feito.get(m.chave);
    return { ...m, i, tipo: m.valor < 0 ? "pagar" : "receber", ja: f ? { acao: f.acao, contaNome: null } : null, par: null, perto: [] };
  });
  // nome da conta dos lançamentos já conferidos
  const idsP = feitos.map((f) => f.contaPagarId).filter((x): x is number => !!x), idsR = feitos.map((f) => f.contaReceberId).filter((x): x is number => !!x);
  if (idsP.length || idsR.length) {
    const [cp, cr] = await Promise.all([db.contaPagar.findMany({ where: { id: { in: idsP } } }), db.contaReceber.findMany({ where: { id: { in: idsR } } })]);
    for (const l of linhas) {
      const f = feito.get(l.chave);
      if (!f || !l.ja) continue;
      l.ja.contaNome = cp.find((c) => c.id === f.contaPagarId)?.descricao ?? cr.find((c) => c.id === f.contaReceberId)?.descricao ?? null;
    }
  }

  // pares: mesmo valor, data perto do vencimento (pago até 20 dias antes ou 30 depois); quanto mais perto e se o nome aparece, melhor
  const pares: { l: Linha; c: Conta; nota: number }[] = [];
  for (const l of linhas) {
    if (l.ja) continue;
    const d = dia(l.data), texto = ` ${normal(l.descricao)} `;
    for (const c of contas) {
      if (c.tipo !== l.tipo || Math.abs(c.valor - Math.abs(l.valor)) >= 0.01) continue;
      const delta = diasEntre(c.dia, d);
      if (delta < -20 || delta > 30) continue;
      const nomeBate = palavras((c as Conta & { extra: string }).extra).some((w) => texto.includes(` ${w}`));
      pares.push({ l, c, nota: Math.abs(delta) + (c.banco && c.banco !== banco ? 6 : 0) - (nomeBate ? 12 : 0) });
    }
  }
  pares.sort((a, b) => a.nota - b.nota);
  const usadas = new Set<string>();
  for (const p of pares) {
    const k = `${p.c.tipo}${p.c.id}`;
    if (p.l.par || usadas.has(k)) continue;
    p.l.par = p.c;
    usadas.add(k);
  }
  // para os que não bateram: contas do mesmo tipo com valor parecido (juros, desconto, parcial)
  for (const l of linhas) {
    if (l.ja || l.par) continue;
    const d = dia(l.data), v = Math.abs(l.valor);
    l.perto = contas
      .filter((c) => c.tipo === l.tipo && !usadas.has(`${c.tipo}${c.id}`) && Math.abs(diasEntre(c.dia, d)) <= 40)
      .map((c) => ({ c, dif: Math.abs(c.valor - v) / Math.max(v, 1) + Math.abs(diasEntre(c.dia, d)) / 200 }))
      .sort((a, b) => a.dif - b.dif).slice(0, 8).map((x) => x.c);
  }
  // contas deste banco que venciam no período do extrato e não apareceram nele
  const faltando = contas.filter((c) => !usadas.has(`${c.tipo}${c.id}`) && c.dia >= de && c.dia <= ate && (!c.banco || c.banco === banco))
    .sort((a, b) => a.dia.getTime() - b.dia.getTime());
  return { linhas, faltando };
}

/** Categoria sugerida para um lançamento que vira conta nova. */
export function categoriaSugerida(descricao: string, entrada: boolean) {
  const t = normal(descricao);
  if (entrada) return /shopee|mercado ?livre|magalu|amazon/.test(t) ? "Site / Shopee" : "Vendas";
  if (/tarifa|tar |cesta|anuidade|iof|juros|encargo|taxa/.test(t)) return "Tarifas bancárias";
  if (/energia|enel|cemig|light|copel|celesc|elektro|cpfl|neoenergia|equatorial/.test(t)) return "Energia";
  if (/sabesp|agua|saneamento/.test(t)) return "Água";
  if (/das |simples|darf|gps|inss|fgts|imposto|receita federal/.test(t)) return "Impostos";
  if (/vivo|claro|tim |oi |internet|telefon/.test(t)) return "Internet/telefone";
  return "Outras";
}
