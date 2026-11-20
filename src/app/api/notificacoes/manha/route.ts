// Resumo da manhã no celular (Vercel Cron): contas do dia, matéria-prima e estoque final abaixo do mínimo.
import { NextResponse } from "next/server";
import { avisosDaManha } from "@/lib/notificacoes";

export const maxDuration = 60;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, enviados: await avisosDaManha() });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
