// Fim do dia (Vercel Cron): lembra quem não lançou produção hoje.
import { NextResponse } from "next/server";
import { avisosDoFimDoDia } from "@/lib/notificacoes";

export const maxDuration = 60;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, enviados: await avisosDoFimDoDia() });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
