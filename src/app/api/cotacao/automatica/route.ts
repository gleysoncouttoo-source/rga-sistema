// Todo dia 8h (Vercel Cron): se hoje é dia de cotação (Compras → Cotação → quantas vezes por mês e dia da semana), manda.
// Dois dias depois, lembra quem ainda não respondeu.
import { NextResponse } from "next/server";
import { abrirCotacao, configAuto, deveAbrirHoje, lembrarQuemNaoRespondeu } from "@/lib/cotacao";
import { whatsLigado } from "@/lib/whatsapp";

export const maxDuration = 60;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const cfg = await configAuto();
  if (!cfg.vezes || !whatsLigado()) return NextResponse.json({ ok: true, pulou: "cotação automática desligada ou WhatsApp não ligado" });
  try {
    const abriu = deveAbrirHoje(cfg) ? await abrirCotacao("Automático") : null;
    const lembrados = await lembrarQuemNaoRespondeu();
    return NextResponse.json({ ok: true, abriu, lembrados });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
