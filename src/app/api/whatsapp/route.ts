// Aviso da Meta quando chega mensagem no WhatsApp da R.G.A. Endereço para colocar no app da Meta:
//   https://rga-sistema.vercel.app/api/whatsapp   (token de verificação = WHATSAPP_VERIFY_TOKEN)
import { NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { receberMensagem } from "@/lib/cotacao";
import { baixarArquivo, marcarLidaDigitando, transcrever } from "@/lib/whatsapp";
import type { Anexo } from "@/lib/ia";

export const maxDuration = 60;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token)
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return NextResponse.json({ erro: "não autorizado" }, { status: 403 });
}

type MsgWa = {
  id: string; from: string; type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; caption?: string; filename?: string };
  sticker?: { id: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  location?: { name?: string; address?: string };
};

async function lerMensagem(m: MsgWa): Promise<{ texto: string; anexos: Anexo[]; tipo: string }> {
  switch (m.type) {
    case "text": return { texto: m.text?.body ?? "", anexos: [], tipo: "texto" };
    case "button": return { texto: m.button?.text ?? "", anexos: [], tipo: "texto" };
    case "interactive": return { texto: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "", anexos: [], tipo: "texto" };
    case "audio": {
      try {
        const a = await baixarArquivo(m.audio!.id);
        const t = await transcrever(a.dados, a.mime);
        return { texto: t ? `🎤 (áudio) ${t}` : "[mandou um áudio que não deu para ouvir: peça com jeito para escrever]", anexos: [], tipo: "audio" };
      } catch { return { texto: "[mandou um áudio que não deu para ouvir: peça com jeito para escrever]", anexos: [], tipo: "audio" }; }
    }
    case "image": {
      try {
        const a = await baixarArquivo(m.image!.id);
        const mime = /^image\/(jpeg|png|gif|webp)$/.test(a.mime) ? a.mime : "image/jpeg";
        return { texto: `[mandou uma foto]${m.image?.caption ? ` ${m.image.caption}` : ""}`, anexos: [{ tipo: "imagem", mime, base64: Buffer.from(a.dados).toString("base64") }], tipo: "imagem" };
      } catch { return { texto: `[mandou uma foto]${m.image?.caption ? ` ${m.image.caption}` : ""}`, anexos: [], tipo: "imagem" }; }
    }
    case "document": {
      const rot = `[mandou o arquivo ${m.document?.filename ?? ""}]${m.document?.caption ? ` ${m.document.caption}` : ""}`;
      if (m.document?.mime_type !== "application/pdf") return { texto: rot, anexos: [], tipo: "documento" };
      try {
        const a = await baixarArquivo(m.document.id);
        return { texto: rot, anexos: a.dados.length < 20 * 1024 * 1024 ? [{ tipo: "pdf", mime: "application/pdf", base64: Buffer.from(a.dados).toString("base64") }] : [], tipo: "documento" };
      } catch { return { texto: rot, anexos: [], tipo: "documento" }; }
    }
    case "sticker": return { texto: "[mandou uma figurinha]", anexos: [], tipo: "figurinha" };
    case "location": return { texto: `[mandou uma localização] ${m.location?.name ?? ""} ${m.location?.address ?? ""}`.trim(), anexos: [], tipo: "texto" };
    default: return { texto: `[mandou uma mensagem do tipo ${m.type}]`, anexos: [], tipo: m.type };
  }
}

export async function POST(req: Request) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) return NextResponse.json({ erro: "WHATSAPP_APP_SECRET não configurado" }, { status: 503 });
  const bruto = await req.text();
  const assinatura = req.headers.get("x-hub-signature-256") ?? "";
  const esperado = "sha256=" + createHmac("sha256", segredo).update(bruto).digest("hex");
  if (assinatura.length !== esperado.length || !timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado)))
    return NextResponse.json({ erro: "assinatura inválida" }, { status: 401 });

  const corpo = JSON.parse(bruto) as { entry?: { changes?: { value?: { messages?: MsgWa[]; contacts?: { wa_id: string; profile?: { name?: string } }[] } }[] }[] };
  const fila: { m: MsgWa; nome: string | null }[] = [];
  for (const e of corpo.entry ?? []) for (const c of e.changes ?? []) {
    const nomes = new Map((c.value?.contacts ?? []).map((x) => [x.wa_id, x.profile?.name ?? null]));
    for (const m of c.value?.messages ?? []) fila.push({ m, nome: nomes.get(m.from) ?? null });
  }
  // responde 200 na hora (a Meta repete o aviso se demorar) e conversa depois
  after(async () => {
    for (const { m, nome } of fila) {
      try {
        await marcarLidaDigitando(m.id);
        const l = await lerMensagem(m);
        await receberMensagem({ telefone: m.from, nomePerfil: nome, texto: l.texto, waId: m.id, anexos: l.anexos, tipo: l.tipo });
      } catch (e) { console.error("mensagem do WhatsApp falhou", e); }
    }
  });
  return NextResponse.json({ ok: true });
}
