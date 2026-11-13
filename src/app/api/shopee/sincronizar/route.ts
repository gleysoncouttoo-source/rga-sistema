// Conferência periódica (Vercel Cron) — pega qualquer pedido cujo aviso tenha se perdido.
import { NextResponse } from "next/server";
import { configShopee, sincronizar } from "@/lib/shopeeApi";
import { db } from "@/lib/db";

export const maxDuration = 300;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  if (!configShopee() || !(await db.shopeeConexao.findUnique({ where: { id: 1 } }))) return NextResponse.json({ ok: true, conectado: false });
  try {
    return NextResponse.json({ ok: true, ...(await sincronizar()) });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
