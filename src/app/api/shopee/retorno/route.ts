// Volta da tela de autorização da Shopee: ?code=...&shop_id=...
import { NextResponse, after } from "next/server";
import { usuarioAtual } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { conectarLoja, sincronizar } from "@/lib/shopeeApi";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const volta = (q: string) => NextResponse.redirect(new URL(`/vendas/shopee?${q}`, url));
  const u = await usuarioAtual();
  if (!u) return NextResponse.redirect(new URL("/login", url));
  if (!pode(u.permissoes, "vendas", "editar")) return volta("erro=" + encodeURIComponent("Seu perfil não pode conectar a Shopee."));
  const code = url.searchParams.get("code"), shopId = url.searchParams.get("shop_id");
  if (!code || !shopId) return volta("erro=" + encodeURIComponent("A Shopee não devolveu a loja. Tente conectar de novo."));
  try {
    await conectarLoja(code, shopId, u.nome);
  } catch (e) {
    return volta("erro=" + encodeURIComponent(`Não consegui conectar: ${e instanceof Error ? e.message : e}`));
  }
  after(() => sincronizar().catch(() => undefined));
  return volta("conectado=1");
}
