// Envio do comprovante de pagamento para quem recebeu: e-mail (Resend) e WhatsApp (API oficial do WhatsApp/Meta).
// Sem as chaves configuradas, a tela oferece os botões manuais (abrir o WhatsApp ou o e-mail com a mensagem pronta).
import "server-only";
import { brl, dataDia } from "./formato";

export function configEnvio() {
  return {
    email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_REMETENTE),
    whats: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
  };
}

type ContaTexto = { descricao: string; formaPagamento: string | null; parcela: string | null; notaFiscal: string | null; valor: number; pagoEm: Date | null; pedidoCompra?: { notaFiscal: string | null } | null };

/** "Comprovante de pagamento boleto 3/4 referente à nota 022552 — R$ 1.290,50, pago em 18/11/2026." */
export function textoComprovante(c: ContaTexto) {
  const nota = c.notaFiscal ?? c.pedidoCompra?.notaFiscal;
  const oque = [c.formaPagamento, c.parcela].filter(Boolean).join(" ");
  const ref = nota ? `referente à nota ${nota}` : `referente a ${c.descricao.replace(/^Salário — /, "salário de ")}`;
  return `Comprovante de pagamento${oque ? " " + oque : ""} ${ref} — ${brl(c.valor)}${c.pagoEm ? `, pago em ${dataDia(c.pagoEm)}` : ""}. R.G.A Indústria e Ferramentaria.`;
}

/** Só números, com 55 na frente (celular brasileiro). */
export function numeroWhats(t: string | null | undefined) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") && d.length >= 12 ? d : "55" + d;
}

type Anexo = { nome: string; tipo: string; dados: Uint8Array };

export async function enviarEmail(para: string, assunto: string, texto: string, anexo: Anexo) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_REMETENTE, to: [para], subject: assunto, text: texto,
      attachments: [{ filename: anexo.nome, content: Buffer.from(anexo.dados).toString("base64") }],
    }),
  });
  if (!r.ok) throw new Error(`E-mail não foi: ${(await r.text()).slice(0, 200)}`);
}

/**
 * WhatsApp oficial: sobe o arquivo e manda como documento com a descrição.
 * Mensagem que a empresa começa precisa de um modelo aprovado pela Meta (WHATSAPP_TEMPLATE, com cabeçalho de documento
 * e um campo de texto no corpo); sem modelo, só entrega se a pessoa falou com a empresa nas últimas 24 horas.
 */
export async function enviarWhats(numero: string, texto: string, anexo: Anexo) {
  const base = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}`;
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  const fd = new FormData();
  fd.append("messaging_product", "whatsapp");
  fd.append("type", anexo.tipo);
  fd.append("file", new Blob([Buffer.from(anexo.dados)], { type: anexo.tipo }), anexo.nome);
  const up = await fetch(`${base}/media`, { method: "POST", headers: auth, body: fd });
  const media = (await up.json()) as { id?: string; error?: { message: string } };
  if (!media.id) throw new Error(`WhatsApp não aceitou o arquivo: ${media.error?.message ?? up.status}`);
  const doc = { id: media.id, filename: anexo.nome };
  const modelo = process.env.WHATSAPP_TEMPLATE;
  const msg = modelo
    ? { type: "template", template: { name: modelo, language: { code: "pt_BR" }, components: [
        { type: "header", parameters: [{ type: "document", document: doc }] },
        { type: "body", parameters: [{ type: "text", text: texto }] },
      ] } }
    : { type: "document", document: { ...doc, caption: texto } };
  const r = await fetch(`${base}/messages`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: numero, ...msg }),
  });
  if (!r.ok) throw new Error(`WhatsApp não foi: ${(await r.text()).slice(0, 200)}`);
}
