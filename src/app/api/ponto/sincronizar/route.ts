// Busca (chamada à parte, com o CRON_SECRET; a busca diária automática vai junto com /api/shopee/sincronizar às 6h): no Secullum as batidas dos últimos 7 dias e os totais do mês.
import { NextResponse } from "next/server";
import { secullumLigado, sincronizarPonto } from "@/lib/secullum";

export const maxDuration = 300;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  if (!secullumLigado()) return NextResponse.json({ ok: true, pulou: "Secullum não ligado" });
  const r = await sincronizarPonto(7);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
