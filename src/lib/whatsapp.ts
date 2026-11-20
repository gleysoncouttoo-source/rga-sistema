// WhatsApp oficial (API do WhatsApp da Meta): mandar texto, mandar modelo aprovado e guardar cada mensagem.
// Sem WHATSAPP_TOKEN + WHATSAPP_PHONE_ID na Vercel, nada sai: as telas funcionam e guardam tudo como "não enviado".
import "server-only";
import { db } from "./db";

const VERSAO = "v21.0";

export function whatsLigado() {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
}

/** O que falta para o bot funcionar de verdade (mostrado na tela de Cotação). */
export function statusWhats() {
  const e = process.env;
  return [
    { nome: "Número do WhatsApp ligado (WHATSAPP_TOKEN e WHATSAPP_PHONE_ID)", ok: whatsLigado() },
    { nome: "Respostas chegando no sistema (WHATSAPP_VERIFY_TOKEN e WHATSAPP_APP_SECRET)", ok: !!(e.WHATSAPP_VERIFY_TOKEN && e.WHATSAPP_APP_SECRET) },
    { nome: "Modelo de mensagem da cotação aprovado pela Meta (WHATSAPP_MODELO_COTACAO)", ok: !!e.WHATSAPP_MODELO_COTACAO },
    { nome: "Modelo de mensagem do comprovante aprovado pela Meta (WHATSAPP_TEMPLATE)", ok: !!e.WHATSAPP_TEMPLATE },
    { nome: "Inteligência para conversar e ler os preços (ANTHROPIC_API_KEY)", ok: !!e.ANTHROPIC_API_KEY },
    { nome: "Entender áudios que chegam (TRANSCRICAO_API_KEY)", ok: !!e.TRANSCRICAO_API_KEY },
  ];
}

/** Só números, com 55 na frente (celular brasileiro). */
export function numeroWhats(t: string | null | undefined) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") && d.length >= 12 ? d : "55" + d;
}

/** DDD + 8 últimos dígitos: o WhatsApp às vezes manda o número sem o 9 da frente. */
export function chaveTelefone(t: string | null | undefined) {
  const n = numeroWhats(t);
  if (!n) return null;
  const local = n.slice(2);
  return local.slice(0, 2) + local.slice(-8);
}

type Quem = { fornecedorId?: number | null; funcionarioId?: number | null; nome?: string | null };

export async function guardarMensagem(m: Quem & { telefone: string; direcao: "entrada" | "saida"; texto: string; tipo?: string; waId?: string | null; status?: string }) {
  return db.whatsMensagem.create({
    data: {
      telefone: m.telefone, direcao: m.direcao, texto: m.texto.slice(0, 4000), tipo: m.tipo ?? "texto", waId: m.waId ?? null, status: m.status ?? null,
      nome: m.nome ?? null, fornecedorId: m.fornecedorId ?? null, funcionarioId: m.funcionarioId ?? null,
    },
  });
}

async function postar(corpo: object) {
  const r = await fetch(`https://graph.facebook.com/${VERSAO}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
  });
  const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
  if (!r.ok) throw new Error(`WhatsApp não foi: ${j.error?.message ?? r.status}`);
  return j.messages?.[0]?.id ?? null;
}

/** Texto livre: só chega se a pessoa falou com a R.G.A nas últimas 24 horas (regra do WhatsApp). */
export async function enviarTexto(numero: string, texto: string, quem: Quem = {}) {
  if (!whatsLigado()) {
    await guardarMensagem({ ...quem, telefone: numero, direcao: "saida", texto, status: "não enviada" });
    return false;
  }
  const waId = await postar({ to: numero, type: "text", text: { body: texto, preview_url: false } });
  await guardarMensagem({ ...quem, telefone: numero, direcao: "saida", texto, waId, status: "enviada" });
  return true;
}

/** Modelo aprovado pela Meta (para começar conversa). Parâmetros de texto não podem ter quebra de linha. */
export async function enviarModelo(numero: string, modelo: string, parametros: string[], textoParaHistorico: string, quem: Quem = {}) {
  const waId = await postar({
    to: numero, type: "template",
    template: { name: modelo, language: { code: "pt_BR" }, components: [{ type: "body", parameters: parametros.map((p) => ({ type: "text", text: p.replace(/\s*\n+\s*/g, " ").slice(0, 1000) })) }] },
  });
  await guardarMensagem({ ...quem, telefone: numero, direcao: "saida", tipo: "modelo", texto: textoParaHistorico, waId, status: "enviada" });
  return waId;
}

/** Acha quem é o número: fornecedor (WhatsApp ou telefone do cadastro) ou colaborador. */
export async function quemE(telefone: string) {
  const k = chaveTelefone(telefone);
  if (!k) return null;
  const [forns, funcs] = await Promise.all([
    db.fornecedor.findMany({ where: { ativo: true, OR: [{ whatsapp: { not: null } }, { telefone: { not: null } }] }, select: { id: true, nome: true, contato: true, whatsapp: true, telefone: true } }),
    db.funcionario.findMany({ where: { ativo: true, telefone: { not: null } }, select: { id: true, nome: true, telefone: true } }),
  ]);
  const f = forns.find((x) => chaveTelefone(x.whatsapp) === k || chaveTelefone(x.telefone) === k);
  if (f) return { tipo: "fornecedor" as const, fornecedorId: f.id, nome: f.contato || f.nome, empresa: f.nome };
  const c = funcs.find((x) => chaveTelefone(x.telefone) === k);
  if (c) return { tipo: "colaborador" as const, funcionarioId: c.id, nome: c.nome, empresa: null };
  return null;
}

export { primeiro as primeiroNome } from "./ia";

// ───── Mídia: áudios, figurinhas, fotos e PDFs ─────

const auth = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` });

/** Sobe um arquivo para o WhatsApp e devolve o id (o id vale 30 dias). */
export async function subirArquivo(dados: Uint8Array, mime: string, nome: string) {
  const fd = new FormData();
  fd.append("messaging_product", "whatsapp");
  fd.append("type", mime);
  fd.append("file", new Blob([Buffer.from(dados)], { type: mime }), nome);
  const r = await fetch(`https://graph.facebook.com/${VERSAO}/${process.env.WHATSAPP_PHONE_ID}/media`, { method: "POST", headers: auth(), body: fd });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { message: string } };
  if (!j.id) throw new Error(`WhatsApp não aceitou o arquivo: ${j.error?.message ?? r.status}`);
  return j.id;
}

/** Manda um áudio gravado ou uma figurinha da biblioteca (só dentro das 24 horas da conversa). */
export async function enviarMidiaDaBiblioteca(numero: string, midiaId: number, quem: Quem = {}) {
  const m = await db.whatsMidia.findUnique({ where: { id: midiaId } });
  if (!m || !m.ativo) return false;
  const rotulo = m.tipo === "audio" ? `🎤 Áudio: ${m.nome}` : `Figurinha: ${m.nome}`;
  if (!whatsLigado()) {
    await guardarMensagem({ ...quem, telefone: numero, direcao: "saida", tipo: m.tipo, texto: rotulo, status: "não enviada" });
    return false;
  }
  let mediaId = m.waMediaId && m.waMediaEm && Date.now() - m.waMediaEm.getTime() < 25 * 86_400_000 ? m.waMediaId : null;
  if (!mediaId) {
    mediaId = await subirArquivo(m.dados, m.mime, m.nome);
    await db.whatsMidia.update({ where: { id: m.id }, data: { waMediaId: mediaId, waMediaEm: new Date() } });
  }
  const tipo = m.tipo === "audio" ? "audio" : "sticker";
  const waId = await postar({ to: numero, type: tipo, [tipo]: { id: mediaId } });
  await db.whatsMidia.update({ where: { id: m.id }, data: { vezes: { increment: 1 } } });
  await guardarMensagem({ ...quem, telefone: numero, direcao: "saida", tipo: m.tipo, texto: rotulo, waId, status: "enviada" });
  return true;
}

/** Baixa um arquivo que chegou (áudio, foto, PDF). */
export async function baixarArquivo(mediaId: string) {
  const r = await fetch(`https://graph.facebook.com/${VERSAO}/${mediaId}`, { headers: auth() });
  const j = (await r.json()) as { url?: string; mime_type?: string };
  if (!j.url) throw new Error("arquivo não encontrado no WhatsApp");
  const a = await fetch(j.url, { headers: auth() });
  if (!a.ok) throw new Error(`não baixou o arquivo (${a.status})`);
  return { dados: new Uint8Array(await a.arrayBuffer()), mime: (j.mime_type || a.headers.get("content-type") || "application/octet-stream").split(";")[0] };
}

/** Marca como lida e mostra "digitando..." (some sozinho quando a resposta chega ou em 25 s). */
export async function marcarLidaDigitando(waId: string) {
  if (!whatsLigado()) return;
  try { await postar({ status: "read", message_id: waId, typing_indicator: { type: "text" } }); } catch { /* não atrapalha a resposta */ }
}

/**
 * Áudio que chegou vira texto. Usa um serviço de transcrição no padrão "audio/transcriptions"
 * (OpenAI Whisper ou Groq). TRANSCRICAO_API_KEY obrigatória; TRANSCRICAO_URL e TRANSCRICAO_MODELO opcionais.
 */
export function transcricaoLigada() {
  return !!process.env.TRANSCRICAO_API_KEY;
}
export async function transcrever(dados: Uint8Array, mime: string) {
  if (!transcricaoLigada()) return null;
  const base = (process.env.TRANSCRICAO_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const fd = new FormData();
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : mime.includes("mp4") || mime.includes("aac") ? "m4a" : mime.includes("amr") ? "amr" : "ogg";
  fd.append("file", new Blob([Buffer.from(dados)], { type: mime }), `audio.${ext}`);
  fd.append("model", process.env.TRANSCRICAO_MODELO || "whisper-1");
  fd.append("language", "pt");
  const r = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${process.env.TRANSCRICAO_API_KEY}` }, body: fd });
  const j = (await r.json().catch(() => ({}))) as { text?: string };
  return r.ok && j.text ? j.text.trim() : null;
}

/** Nome com que o Sambot se apresenta nas mensagens (Sambot → Cotação). Padrão: Gleyson Couto. */
export async function nomeRemetente() {
  const c = await db.configuracao.findUnique({ where: { chave: "sambotNome" } });
  return c?.valor?.trim() || "Gleyson Couto";
}
