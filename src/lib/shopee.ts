// Importação da planilha de pedidos da Shopee (Seller Center → Meus pedidos → Exportar).
// Cada linha da planilha é um produto de um pedido; os valores do pedido se repetem em todas as linhas dele.
import "server-only";
import { db } from "@/lib/db";
import { criarPedidoVenda, entregarPedido, cancelarPedido } from "@/lib/planejamento";
import { dia } from "@/lib/datas";

export type LinhaShopee = { chave: string; sku: string; nome: string; variacao: string; quantidade: number; preco: number | null; anuncioId?: string };
export type PedidoShopee = {
  numero: string; status: string; statusTexto: string; criadoEm: string; envioAte: string | null;
  comprador: string; valorPago: number | null; taxas: number | null; itens: LinhaShopee[];
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const CAMPOS: Record<string, string[]> = {
  pedido: ["id do pedido", "order id", "numero do pedido"],
  status: ["status do pedido", "order status"],
  criado: ["data de criacao do pedido", "order creation date", "hora completa do pedido"],
  envio: ["data prevista de envio", "ship by date"],
  sku: ["numero de referencia sku", "sku reference no", "sku da variacao"],
  skuPai: ["n de referencia do sku principal", "no de referencia do sku principal", "numero de referencia do sku principal", "parent sku reference no", "sku principal"],
  produto: ["nome do produto", "product name"],
  variacao: ["nome da variacao", "variation name"],
  preco: ["preco acordado", "deal price"],
  precoOriginal: ["preco original", "original price"],
  quantidade: ["quantidade", "quantity"],
  subtotal: ["subtotal do produto", "product subtotal"],
  total: ["total global", "grand total", "valor total"],
  comissao: ["taxa de comissao", "commission fee"],
  servico: ["taxa de servico", "service fee"],
  transacao: ["taxa de transacao", "transaction fee"],
  comprador: ["nome de usuario comprador", "username buyer", "nome de usuario do comprador"],
  destinatario: ["nome do destinatario", "receiver name"],
};

/** Situação na Shopee → situação usada aqui */
export function statusShopee(s: string) {
  const x = norm(s);
  if (/cancel/.test(x)) return "cancelado";
  if (/nao pago|unpaid|aguardando pagamento/.test(x)) return "nao_pago";
  if (/devol|reembols|return|refund/.test(x)) return "devolvido";
  if (/a enviar|to ship|pronto para envio|processad|preparando/.test(x)) return "a_enviar";
  if (/conclu|complet|entregue|delivered/.test(x)) return "concluido";
  if (/enviado|shipped|a caminho|em transito/.test(x)) return "enviado";
  return "a_enviar";
}
export const STATUS_SHOPEE: Record<string, { nome: string; cls: string }> = {
  a_enviar: { nome: "A enviar", cls: "alerta" }, enviado: { nome: "Enviado", cls: "" }, concluido: { nome: "Concluído", cls: "ok" },
  cancelado: { nome: "Cancelado", cls: "erro" }, devolvido: { nome: "Devolução", cls: "erro" }, nao_pago: { nome: "Não pago", cls: "" },
};

export function numero(v: string | undefined): number | null {
  if (v == null) return null;
  let s = String(v).replace(/R\$|\s/g, "").trim();
  if (!s || s === "-") return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-11-05 14:32", "05/11/2026 14:32" ou nº de série do Excel → "2026-11-05T14:32:00-03:00" */
export function dataHora(v: string | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}:00-03:00`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}:00-03:00`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 30000 && n < 80000) {
    const d = new Date(Math.round((n - 25569) * 86400) * 1000); // série do Excel, já em hora local
    return d.toISOString().slice(0, 19) + "-03:00";
  }
  return null;
}

export function chaveAnuncio(sku: string, nome: string, variacao: string) {
  return sku ? sku.trim().toUpperCase() : `${nome.trim()}${variacao.trim() ? " | " + variacao.trim() : ""}`.slice(0, 300);
}

export function lerPedidosShopee(linhas: string[][]): { pedidos: PedidoShopee[]; avisos: string[] } {
  const iCab = linhas.slice(0, 10).findIndex((l) => l.some((c) => CAMPOS.pedido.includes(norm(c))));
  if (iCab < 0) throw new Error("Não achei a coluna \"ID do pedido\". Envie a planilha exportada em Meus pedidos → Exportar, sem mudar as colunas.");
  const cab = linhas[iCab].map(norm);
  const col: Record<string, number> = {};
  for (const [k, nomes] of Object.entries(CAMPOS)) {
    let i = cab.findIndex((c) => nomes.includes(c));
    if (i < 0) i = cab.findIndex((c) => nomes.some((n) => c.startsWith(n)));
    col[k] = i;
  }
  const avisos: string[] = [];
  for (const k of ["status", "quantidade"]) if (col[k] < 0) throw new Error(`A planilha não tem a coluna de ${k}.`);
  if (col.sku < 0 && col.produto < 0) throw new Error("A planilha não tem SKU nem nome do produto.");
  if (col.preco < 0 && col.subtotal < 0) avisos.push("Sem coluna de preço: vou usar o valor de venda do cadastro.");
  const g = (l: string[], k: string) => (col[k] >= 0 ? String(l[col[k]] ?? "").trim() : "");
  const mapa = new Map<string, PedidoShopee>();
  for (const l of linhas.slice(iCab + 1)) {
    const nPed = g(l, "pedido");
    if (!nPed) continue;
    let p = mapa.get(nPed);
    if (!p) {
      const taxas = ["comissao", "servico", "transacao"].map((k) => numero(g(l, k)));
      p = {
        numero: nPed, statusTexto: g(l, "status"), status: statusShopee(g(l, "status")),
        criadoEm: dataHora(g(l, "criado")) ?? new Date().toISOString(), envioAte: dataHora(g(l, "envio")),
        comprador: g(l, "comprador") || g(l, "destinatario") || "Cliente Shopee",
        valorPago: numero(g(l, "total")), taxas: taxas.some((t) => t != null) ? taxas.reduce<number>((a, b) => a + Math.abs(b ?? 0), 0) : null,
        itens: [],
      };
      mapa.set(nPed, p);
    }
    const qtd = numero(g(l, "quantidade")) ?? 0;
    if (qtd <= 0) continue;
    const sku = g(l, "sku") || g(l, "skuPai"), nome = g(l, "produto"), variacao = g(l, "variacao");
    const sub = numero(g(l, "subtotal"));
    const preco = numero(g(l, "preco")) ?? (sub != null ? sub / qtd : null) ?? numero(g(l, "precoOriginal"));
    p.itens.push({ chave: chaveAnuncio(sku, nome, variacao), sku, nome, variacao, quantidade: qtd, preco });
  }
  return { pedidos: [...mapa.values()].filter((p) => p.itens.length), avisos };
}

/** Liga cada anúncio da planilha a um produto: pelo código igual ao SKU ou pelo vínculo salvo. */
export async function vinculos(chaves: string[]) {
  const [anuncios, itens] = await Promise.all([
    db.anuncioCanal.findMany({ where: { canal: "shopee", chave: { in: chaves } }, include: { item: true } }),
    db.item.findMany({ where: { tipo: "produto", codigo: { not: null } } }),
  ]);
  const porCodigo = new Map(itens.map((i) => [i.codigo!.toUpperCase(), i]));
  const r = new Map<string, { itemId: number; codigo: string | null; fator: number; auto: boolean }>();
  for (const c of chaves) {
    const a = anuncios.find((x) => x.chave === c);
    if (a) r.set(c, { itemId: a.itemId, codigo: a.item.codigo, fator: a.fator, auto: false });
    else if (porCodigo.has(c)) { const i = porCodigo.get(c)!; r.set(c, { itemId: i.id, codigo: i.codigo, fator: 1, auto: true }); }
  }
  return r;
}

export type ResultadoImportacao = { novos: number; abertos: number; atualizados: number; cancelados: number; ignorados: number; semVinculo: number; baixas: number };

export async function importarShopee(importacaoId: number, usuario: string, opcoes: { baixarEnviados: boolean }): Promise<ResultadoImportacao> {
  const imp = await db.importacaoVenda.findUniqueOrThrow({ where: { id: importacaoId } });
  const pedidos = (imp.dados as unknown as { pedidos: PedidoShopee[] }).pedidos;
  const { r } = await aplicarPedidos(pedidos, usuario, opcoes);
  await db.importacaoVenda.update({
    where: { id: importacaoId },
    data: { status: "importada", importadoEm: new Date(), resumo: JSON.stringify(r) },
  });
  await db.auditoria.create({ data: { usuario, acao: "importou pedidos da Shopee", detalhe: `${imp.arquivo}: ${JSON.stringify(r)}` } });
  return r;
}

/** Grava os pedidos (da planilha ou da API). Devolve o resumo e os pedidos que ficaram de fora por anúncio sem produto. */
export async function aplicarPedidos(pedidos: PedidoShopee[], usuario: string, opcoes: { baixarEnviados: boolean }) {
  const semProduto: PedidoShopee[] = [];
  const vinc = await vinculos([...new Set(pedidos.flatMap((p) => p.itens.map((i) => i.chave)))]);
  const r: ResultadoImportacao = { novos: 0, abertos: 0, atualizados: 0, cancelados: 0, ignorados: 0, semVinculo: 0, baixas: 0 };
  const quem = `${usuario} (Shopee)`;

  for (const p of pedidos) {
    const ja = await db.pedidoVenda.findFirst({ where: { origem: "shopee", numero: p.numero } });
    const extra = { canalStatus: p.status, comprador: p.comprador, valorPago: p.valorPago, taxas: p.taxas };
    if (ja) {
      await preencherAnuncio(ja.id, p, vinc);
      if (ja.canalStatus === p.status) { r.ignorados++; continue; }
      await db.pedidoVenda.update({ where: { id: ja.id }, data: extra });
      if (ja.status === "aberto" && (p.status === "enviado" || p.status === "concluido")) await entregarPedido(ja.id, quem);
      else if (p.status === "cancelado" || p.status === "devolvido" || p.status === "nao_pago") {
        if (ja.status === "aberto") await cancelarPedido(ja.id, quem);
        else await db.pedidoVenda.update({ where: { id: ja.id }, data: { status: "cancelado" } });
        r.cancelados++;
        continue;
      }
      r.atualizados++;
      continue;
    }
    if (p.status === "nao_pago") { r.ignorados++; continue; }
    if (p.itens.some((i) => !vinc.has(i.chave))) { r.semVinculo++; semProduto.push(p); continue; }
    const itens = p.itens.map((i) => {
      const v = vinc.get(i.chave)!;
      return { itemId: v.itemId, quantidade: i.quantidade * v.fator, precoUnitario: i.preco != null ? i.preco / v.fator : null, anuncio: i.nome || null, anuncioId: i.anuncioId ?? null };
    });
    const dataPedido = new Date(p.criadoEm);
    const diaPedido = dia(dataPedido);
    if (p.status === "a_enviar") {
      // pedido ainda vai sair da fábrica: entra no fluxo normal (separa estoque, produção e compras)
      const id = await criarPedidoVenda({
        cliente: `Shopee · ${p.comprador}`, numero: p.numero, origem: "shopee",
        dataEntrega: p.envioAte ? dia(new Date(p.envioAte)) : undefined, itens,
      }, quem);
      await db.pedidoVenda.update({ where: { id }, data: { ...extra, dataPedido } });
      await preencherAnuncio(id, p, vinc);
      r.abertos++;
    } else {
      const cancelado = p.status === "cancelado" || p.status === "devolvido";
      await db.$transaction(async (tx) => {
        const pv = await tx.pedidoVenda.create({
          data: {
            cliente: `Shopee · ${p.comprador}`, numero: p.numero, origem: "shopee", dataPedido, dataEntrega: diaPedido,
            status: cancelado ? "cancelado" : "entregue", ...extra,
            itens: { create: itens },
          },
        });
        if (!cancelado && opcoes.baixarEnviados) {
          for (const i of itens) {
            const it = await tx.item.findUniqueOrThrow({ where: { id: i.itemId } });
            const q = Math.min(i.quantidade, Math.max(0, it.estoque));
            if (q <= 0) continue;
            await tx.item.update({ where: { id: i.itemId }, data: { estoque: { decrement: q } } });
            await tx.movimentoEstoque.create({ data: { itemId: i.itemId, quantidade: -q, motivo: `Venda Shopee ${p.numero} (pedido #${pv.id})`, usuario: quem } });
            r.baixas++;
          }
        }
      });
      if (cancelado) r.cancelados++; else r.novos++;
    }
  }
  return { r, semProduto };
}

/** Guarda em cada item da venda de qual anúncio da Shopee ele veio (também completa pedidos antigos). */
async function preencherAnuncio(pedidoId: number, p: PedidoShopee, vinc: Map<string, { itemId: number }>) {
  const itens = await db.pedidoVendaItem.findMany({ where: { pedidoVendaId: pedidoId }, orderBy: { id: "asc" } });
  const usados = new Set<number>();
  for (const l of p.itens) {
    const v = vinc.get(l.chave);
    const it = itens.find((x) => !usados.has(x.id) && x.itemId === v?.itemId);
    if (!it) continue;
    usados.add(it.id);
    if (it.anuncio === (l.nome || null) && it.anuncioId === (l.anuncioId ?? null)) continue;
    await db.pedidoVendaItem.update({ where: { id: it.id }, data: { anuncio: l.nome || it.anuncio, anuncioId: l.anuncioId ?? it.anuncioId } });
  }
}
