// Aviso instantâneo da Shopee (Push Mechanism). Configure no app da Shopee Open Platform:
//   https://SEU-ENDERECO/api/shopee/aviso  com o aviso "Order Status Update" (código 3) ligado.
import { after } from "next/server";
import { avisoValido, sincronizarPedido } from "@/lib/shopeeApi";

export async function POST(req: Request) {
  const corpo = await req.text();
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const endereco = process.env.SHOPEE_AVISO_URL || `${proto}://${host}${u.pathname}`;
  if (!avisoValido(endereco, corpo, req.headers.get("authorization"))) return new Response("assinatura inválida", { status: 401 });
  let j: { code?: number; data?: { ordersn?: string; order_sn?: string } } = {};
  try { j = JSON.parse(corpo || "{}"); } catch { /* teste de endereço da Shopee vem vazio */ }
  const sn = j.data?.ordersn ?? j.data?.order_sn;
  if (j.code === 3 && sn) after(() => sincronizarPedido(sn).catch(() => undefined));
  // a Shopee só quer um 200 rápido, sem corpo
  return new Response(null, { status: 200 });
}
