// Conferência diária (Vercel Cron, 6h de Brasília) — pega qualquer pedido cujo aviso tenha se perdido.
// Aproveita a mesma chamada para buscar as batidas do relógio de ponto (o plano da Vercel limita o número de crons).
import { NextResponse } from "next/server";
import { configShopee, sincronizar } from "@/lib/shopeeApi";
import { db } from "@/lib/db";
import { secullumLigado, sincronizarPonto } from "@/lib/secullum";

export const maxDuration = 300;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const ponto = secullumLigado() ? await sincronizarPonto(7) : null;
  if (!configShopee() || !(await db.shopeeConexao.findUnique({ where: { id: 1 } }))) return NextResponse.json({ ok: true, conectado: false, ponto });
  try {
    return NextResponse.json({ ok: true, ...(await sincronizar()), ponto });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e), ponto }, { status: 500 });
  }
}
