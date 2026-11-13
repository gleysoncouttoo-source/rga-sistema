// Ligação automática com a Shopee Open Platform (API v2).
// Variáveis de ambiente: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_AMBIENTE (producao | teste).
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { aplicarPedidos, chaveAnuncio, type PedidoShopee, type ResultadoImportacao } from "@/lib/shopee";

const HOSTS = { producao: "https://partner.shopeemobile.com", teste: "https://partner.test-stable.shopeemobile.com" };

export function configShopee() {
  const id = process.env.SHOPEE_PARTNER_ID, chave = process.env.SHOPEE_PARTNER_KEY;
  if (!id || !chave) return null;
  const amb = process.env.SHOPEE_AMBIENTE === "teste" ? "teste" : "producao";
  return { partnerId: Number(id), chave, ambiente: amb, host: process.env.SHOPEE_HOST || HOSTS[amb] };
}
function cfg() {
  const c = configShopee();
  if (!c) throw new Error("Faltam SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY nas variáveis de ambiente.");
  return c;
}
const assinar = (chave: string, base: string) => createHmac("sha256", chave).update(base).digest("hex");
const agora = () => Math.floor(Date.now() / 1000);

/** Endereço da tela de autorização da Shopee (o vendedor entra com a conta da loja e autoriza). */
export function urlAutorizacao(retorno: string) {
  const c = cfg(), path = "/api/v2/shop/auth_partner", ts = agora();
  const q = new URLSearchParams({ partner_id: String(c.partnerId), timestamp: String(ts), sign: assinar(c.chave, `${c.partnerId}${path}${ts}`), redirect: retorno });
  return `${c.host}${path}?${q}`;
}

async function chamar<T>(metodo: "GET" | "POST", path: string, params: Record<string, string | number>, loja?: { shopId: string; token: string }, corpo?: unknown): Promise<T> {
  const c = cfg(), ts = agora();
  const base = `${c.partnerId}${path}${ts}${loja ? loja.token + loja.shopId : ""}`;
  const q = new URLSearchParams({ partner_id: String(c.partnerId), timestamp: String(ts), sign: assinar(c.chave, base) });
  if (loja) { q.set("access_token", loja.token); q.set("shop_id", loja.shopId); }
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  const res = await fetch(`${c.host}${path}?${q}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined, cache: "no-store",
  });
  const j = await res.json().catch(() => ({})) as { error?: string; message?: string; response?: unknown } & Record<string, unknown>;
  if (!res.ok || j.error) throw new Error(`Shopee ${path}: ${j.error || res.status} ${j.message ?? ""}`.trim());
  return j as T;
}

type Tokens = { access_token: string; refresh_token: string; expire_in: number };

/** Troca o código recebido na volta da autorização pelos tokens e guarda a ligação. */
export async function conectarLoja(code: string, shopId: string, usuario: string) {
  const c = cfg();
  const t = await chamar<Tokens>("POST", "/api/v2/auth/token/get", {}, undefined, { code, shop_id: Number(shopId), partner_id: c.partnerId });
  const dados = { shopId, accessToken: t.access_token, refreshToken: t.refresh_token, expiraEm: new Date(Date.now() + (t.expire_in - 300) * 1000), conectadoPor: usuario, conectadoEm: new Date(), erro: null };
  await db.shopeeConexao.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
  try {
    const info = await chamar<{ shop_name?: string; response?: { shop_name?: string } }>("GET", "/api/v2/shop/get_shop_info", {}, { shopId, token: t.access_token });
    const nome = info.shop_name ?? info.response?.shop_name;
    if (nome) await db.shopeeConexao.update({ where: { id: 1 }, data: { nomeLoja: nome } });
  } catch { /* nome da loja é só enfeite */ }
  await db.auditoria.create({ data: { usuario, acao: "conectou a loja da Shopee", detalhe: `shop_id ${shopId}` } });
}

/** Token válido (renova sozinho quando faltam menos de 5 minutos). */
async function loja() {
  const con = await db.shopeeConexao.findUnique({ where: { id: 1 } });
  if (!con) throw new Error("Loja da Shopee não conectada.");
  if (con.expiraEm.getTime() > Date.now()) return { shopId: con.shopId, token: con.accessToken, con };
  const c = cfg();
  const t = await chamar<Tokens>("POST", "/api/v2/auth/access_token/get", {}, undefined, { refresh_token: con.refreshToken, shop_id: Number(con.shopId), partner_id: c.partnerId });
  const novo = await db.shopeeConexao.update({
    where: { id: 1 }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, expiraEm: new Date(Date.now() + (t.expire_in - 300) * 1000) },
  });
  return { shopId: novo.shopId, token: novo.accessToken, con: novo };
}

/** Situação da Shopee → situação usada aqui */
export function statusApi(s: string) {
  switch (s) {
    case "UNPAID": return "nao_pago";
    case "SHIPPED": case "TO_CONFIRM_RECEIVE": return "enviado";
    case "COMPLETED": return "concluido";
    case "CANCELLED": case "CANCELED": return "cancelado";
    case "TO_RETURN": return "devolvido";
    default: return "a_enviar"; // READY_TO_SHIP, PROCESSED, RETRY_SHIP, IN_CANCEL, INVOICE_PENDING
  }
}

type DetalheApi = {
  order_sn: string; order_status: string; create_time: number; ship_by_date?: number; buyer_username?: string; total_amount?: number;
  item_list?: { item_id?: number; item_name: string; item_sku?: string; model_name?: string; model_sku?: string; model_quantity_purchased: number; model_discounted_price?: number; model_original_price?: number }[];
};
const iso = (seg: number) => new Date(seg * 1000).toISOString();

export function converter(o: DetalheApi): PedidoShopee {
  return {
    numero: o.order_sn, status: statusApi(o.order_status), statusTexto: o.order_status,
    criadoEm: iso(o.create_time), envioAte: o.ship_by_date ? iso(o.ship_by_date) : null,
    comprador: o.buyer_username || "Cliente Shopee", valorPago: o.total_amount ?? null, taxas: null,
    itens: (o.item_list ?? []).map((i) => {
      const sku = (i.model_sku || i.item_sku || "").trim();
      return { chave: chaveAnuncio(sku, i.item_name, i.model_name ?? ""), sku, nome: i.item_name, variacao: i.model_name ?? "", quantidade: i.model_quantity_purchased, preco: i.model_discounted_price ?? i.model_original_price ?? null, anuncioId: i.item_id ? String(i.item_id) : undefined };
    }).filter((i) => i.quantidade > 0),
  };
}

async function detalhes(l: { shopId: string; token: string }, sns: string[]) {
  const out: DetalheApi[] = [];
  for (let i = 0; i < sns.length; i += 50) {
    const j = await chamar<{ response: { order_list: DetalheApi[] } }>("GET", "/api/v2/order/get_order_detail", {
      order_sn_list: sns.slice(i, i + 50).join(","),
      response_optional_fields: "buyer_username,item_list,total_amount,ship_by_date",
    }, l);
    out.push(...(j.response?.order_list ?? []));
  }
  return out;
}

/** Taxas (comissão + serviço + transação) dos pedidos que ainda não têm, pelo extrato do pedido. */
async function buscarTaxas(l: { shopId: string; token: string }, sns: string[]) {
  const sem = await db.pedidoVenda.findMany({ where: { origem: "shopee", numero: { in: sns }, taxas: null, status: { not: "cancelado" } }, select: { id: true, numero: true } });
  for (const p of sem.slice(0, 100)) {
    try {
      const j = await chamar<{ response: { order_income?: Record<string, number> } }>("GET", "/api/v2/payment/get_escrow_detail", { order_sn: p.numero! }, l);
      const inc = j.response?.order_income;
      if (!inc) continue;
      const taxas = ["commission_fee", "service_fee", "seller_transaction_fee"].reduce((t, k) => t + Math.abs(inc[k] ?? 0), 0);
      await db.pedidoVenda.update({ where: { id: p.id }, data: { taxas } });
    } catch { /* extrato ainda não disponível: tenta na próxima */ }
  }
}

/** Pedidos com anúncio sem produto vão para uma "planilha" automática, para ligar na tela da Shopee. */
async function guardarSemProduto(ps: PedidoShopee[]) {
  if (!ps.length) return;
  const aberta = await db.importacaoVenda.findFirst({ where: { canal: "shopee", status: "lida", arquivo: { startsWith: "Automático" } } });
  if (aberta) {
    const antes = (aberta.dados as unknown as { pedidos: PedidoShopee[] }).pedidos;
    const mapa = new Map(antes.map((p) => [p.numero, p]));
    for (const p of ps) mapa.set(p.numero, p);
    await db.importacaoVenda.update({ where: { id: aberta.id }, data: { dados: { pedidos: [...mapa.values()], avisos: [] } } });
  } else {
    await db.importacaoVenda.create({ data: { canal: "shopee", arquivo: "Automático — anúncios sem produto", dados: { pedidos: ps, avisos: [] }, usuario: "Shopee" } });
  }
}

async function aplicar(l: { shopId: string; token: string }, sns: string[], baixar: boolean) {
  const ds = await detalhes(l, sns);
  const { r, semProduto } = await aplicarPedidos(ds.map(converter), "Shopee", { baixarEnviados: baixar });
  await guardarSemProduto(semProduto);
  await buscarTaxas(l, sns);
  return r;
}

let rodando: Promise<ResultadoImportacao> | null = null;

/** Confere os pedidos alterados desde a última vez (na 1ª vez, os últimos 15 dias). Pode ser chamada a qualquer hora. */
export function sincronizar(): Promise<ResultadoImportacao> {
  rodando ??= (async () => {
    const l = await loja();
    const ate = agora();
    let de = l.con.ultimaSync ? Math.floor(l.con.ultimaSync.getTime() / 1000) - 600 : ate - 15 * 86400;
    const total: ResultadoImportacao = { novos: 0, abertos: 0, atualizados: 0, cancelados: 0, ignorados: 0, semVinculo: 0, baixas: 0 };
    try {
      while (de < ate) {
        const fim = Math.min(ate, de + 15 * 86400 - 60); // a Shopee aceita no máximo 15 dias por consulta
        const sns: string[] = [];
        let cursor = "";
        for (;;) {
          const j = await chamar<{ response: { order_list: { order_sn: string }[]; more: boolean; next_cursor: string } }>("GET", "/api/v2/order/get_order_list", {
            time_range_field: "update_time", time_from: de, time_to: fim, page_size: 100, cursor,
          }, l);
          sns.push(...(j.response?.order_list ?? []).map((o) => o.order_sn));
          if (!j.response?.more) break;
          cursor = j.response.next_cursor;
        }
        if (sns.length) {
          const r = await aplicar(l, [...new Set(sns)], l.con.baixarEnviados);
          for (const k of Object.keys(total) as (keyof ResultadoImportacao)[]) total[k] += r[k];
        }
        de = fim;
      }
      await db.shopeeConexao.update({ where: { id: 1 }, data: { ultimaSync: new Date(ate * 1000), ultimoResultado: JSON.stringify(total), erro: null } });
      return total;
    } catch (e) {
      await db.shopeeConexao.update({ where: { id: 1 }, data: { erro: e instanceof Error ? e.message : String(e) } });
      throw e;
    }
  })().finally(() => { rodando = null; });
  return rodando;
}

/** Atualiza um pedido só (aviso instantâneo da Shopee). */
export async function sincronizarPedido(orderSn: string) {
  const l = await loja();
  return aplicar(l, [orderSn], l.con.baixarEnviados);
}

/** Confere a assinatura do aviso da Shopee: HMAC-SHA256(endereço + "|" + corpo) com a chave do app. */
export function avisoValido(url: string, corpo: string, assinatura: string | null) {
  const c = configShopee();
  if (!c || !assinatura) return false;
  const esperado = assinar(c.chave, `${url}|${corpo}`);
  return esperado.length === assinatura.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(assinatura));
}
