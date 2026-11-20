// Inteligência do bot de WhatsApp (Claude API): conversa de um jeito natural e lê os preços que o fornecedor mandou.
// Sem ANTHROPIC_API_KEY, o sistema usa uma leitura simples (procura o nome do material e o número ao lado).
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const iaLigada = () => !!process.env.ANTHROPIC_API_KEY;
const MODELO = process.env.CLAUDE_MODELO || "claude-opus-5-5";

let _cliente: Anthropic | null = null;
const cliente = () => (_cliente ??= new Anthropic());

export type ItemCotado = { id: number; nome: string; unidade: string; material: string | null; ultimoPreco: number | null };
export type MidiaOpcao = { id: number; tipo: string; nome: string; uso: string; descricao: string | null };
export type Anexo = { tipo: "imagem" | "pdf"; mime: string; base64: string };

const Resultado = z.object({
  precos: z.array(z.object({
    itemId: z.number().int(),
    precoPorUnidade: z.number(),
    comoEscreveu: z.string(),
    prazoEntregaDias: z.number().int().nullable(),
    compraMinima: z.number().nullable(),
    observacao: z.string().nullable(),
  })),
  resposta: z.string(),
  midiaId: z.number().int().nullable(),
  precisaDeGente: z.boolean(),
  resumoParaEquipe: z.string(),
});
export type ResultadoIA = z.infer<typeof Resultado>;

const SISTEMA = `Você cuida do WhatsApp da R.G.A Indústria e Ferramentaria, uma fábrica de fechaduras. Conversa com fornecedores (cotação semanal de matéria-prima) e com colaboradores (recebem comprovantes de pagamento).

Jeito de escrever:
- Como uma pessoa simpática da equipe de compras escreveria no WhatsApp: frases curtas, português do dia a dia do Brasil, sem formalidade de e-mail, sem markdown, sem listas com marcadores.
- Use o primeiro nome da pessoa de vez em quando, não em toda mensagem. No máximo um emoji, e só quando combinar.
- Responda ao que a pessoa disse. Se ela puxou assunto (futebol, família, o tempo), responda com uma frase leve e volte ao assunto.
- Mensagens de 1 a 3 frases. Nunca repita a lista inteira de itens se a pessoa já respondeu parte; pergunte só o que falta.

Regras que não podem ser quebradas:
- Se alguém perguntar a sério se está falando com um robô, uma pessoa ou uma inteligência artificial, diga a verdade com naturalidade: você é o assistente automático da R.G.A e a equipe acompanha as conversas. Nunca diga que é humano nem invente nome de pessoa.
- Nunca invente preço, prazo ou quantidade. Nunca feche pedido, negocie, prometa compra, data de pagamento ou valores. Se pedirem isso, diga que vai passar para a equipe e marque precisaDeGente = true.
- Reclamação, cobrança, problema com pagamento ou qualquer coisa que você não saiba: diga que vai repassar para a equipe e marque precisaDeGente = true.

Leitura dos preços (só para fornecedor com cotação aberta):
- Em "precos" coloque só os itens da lista que o fornecedor deu um valor claro, usando o itemId da lista.
- precoPorUnidade é em reais por unidade do item NO SISTEMA (a unidade está na lista). Converta quando for seguro: tonelada → kg (÷1000), cento → un (÷100), milheiro → un (÷1000), grama → kg. Se não der para saber a unidade, não coloque o preço e pergunte.
- comoEscreveu = o trecho como o fornecedor escreveu ("18,50 o quilo"). Prazo de entrega em dias corridos, se ele disser. Compra mínima na unidade do item, se ele disser.
- Preço que parece muito fora do último preço (mais que o dobro ou menos da metade) pode ser erro de digitação: coloque mesmo assim, mas confirme com ele na resposta.
- Se ele mandou foto ou PDF de tabela de preços, leia os itens da lista que aparecem nela.

Áudios e figurinhas:
- O "uso" de cada item: primeira_resposta = cumprimentar quando o fornecedor responde a cotação pela primeira vez; agradecer = depois que ele mandou os preços; comprovante = quando alguém responde ao comprovante de pagamento; livre = quando combinar.
- Pode escolher no máximo um item da biblioteca (midiaId) quando a situação combinar com o "uso" e a descrição dele. Não mande mídia em toda mensagem; não repita a mesma mídia que já aparece na conversa. Na dúvida, midiaId = null.
- Quando a pessoa manda áudio, você recebe o texto do áudio. Responda normalmente, como quem ouviu.

resumoParaEquipe: uma frase curta do que aconteceu nesta mensagem, para a equipe ler no sistema.`;

/** Uma resposta do bot: lê preços (se tiver cotação) e escreve a mensagem de volta. */
export async function conversarIA(p: {
  papel: "fornecedor" | "colaborador" | "desconhecido";
  nome: string | null;
  empresa: string | null;
  itens: ItemCotado[]; // vazio = sem cotação aberta
  historico: { direcao: string; texto: string; quando: Date }[];
  mensagem: string;
  anexos?: Anexo[];
  midias: MidiaOpcao[];
  hoje: string;
}): Promise<ResultadoIA> {
  const contexto = [
    `Hoje: ${p.hoje}.`,
    `Quem escreveu: ${p.papel}${p.nome ? `, ${p.nome}` : ""}${p.empresa ? ` (empresa ${p.empresa})` : ""}.`,
    p.itens.length
      ? `Cotação desta semana aberta. Itens que este fornecedor vende (itemId | nome | unidade no sistema | último preço):\n${p.itens.map((i) => `${i.id} | ${i.nome}${i.material ? ` (${i.material})` : ""} | ${i.unidade} | ${i.ultimoPreco != null ? `R$ ${i.ultimoPreco.toFixed(4)}` : "sem preço"}`).join("\n")}`
      : "Não há cotação aberta com esta pessoa. precos deve ficar vazio.",
    p.midias.length
      ? `Biblioteca de áudios e figurinhas (id | tipo | nome | uso | descrição):\n${p.midias.map((m) => `${m.id} | ${m.tipo} | ${m.nome} | ${m.uso} | ${m.descricao ?? ""}`).join("\n")}`
      : "Biblioteca de áudios e figurinhas vazia: midiaId = null.",
    `Conversa recente (mais antiga primeiro):\n${p.historico.length ? p.historico.map((h) => `${h.direcao === "entrada" ? "ELE(A)" : "R.G.A"}: ${h.texto}`).join("\n") : "(primeira mensagem)"}`,
    `Mensagem nova dele(a):\n${p.mensagem}`,
  ].join("\n\n");

  const conteudo: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of p.anexos ?? []) {
    if (a.tipo === "imagem") conteudo.push({ type: "image", source: { type: "base64", media_type: a.mime as "image/jpeg", data: a.base64 } });
    else conteudo.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 } });
  }
  conteudo.push({ type: "text", text: contexto });

  const r = await cliente().beta.messages.parse({
    model: MODELO,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Resultado) },
    system: SISTEMA,
    messages: [{ role: "user", content: conteudo }],
  });
  if (r.stop_reason === "refusal" || !r.parsed_output) throw new Error("a inteligência não respondeu");
  const out = r.parsed_output;
  const ids = new Set(p.itens.map((i) => i.id));
  const midiasOk = new Set(p.midias.map((m) => m.id));
  return {
    ...out,
    precos: out.precos.filter((x) => ids.has(x.itemId) && x.precoPorUnidade > 0),
    midiaId: out.midiaId != null && midiasOk.has(out.midiaId) ? out.midiaId : null,
  };
}

// ───── Leitura simples (sem a chave da inteligência) ─────

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PALAVRAS_FRACAS = new Set(["para", "com", "sem", "chapa", "barra", "peca", "tipo", "cor", "de", "da", "do"]);

/** Procura o nome (ou o material) de cada item no texto e pega o primeiro valor em reais logo depois. */
export function lerPrecosSimples(texto: string, itens: ItemCotado[]): ResultadoIA {
  const t = semAcento(texto);
  const precos: ResultadoIA["precos"] = [];
  const palavras = (it: ItemCotado) => [...new Set([it.material, ...it.nome.split(/[\s/()-]+/)].filter(Boolean).map((w) => semAcento(String(w))).filter((w) => w.length >= 4 && !PALAVRAS_FRACAS.has(w)))];
  const conta = new Map<string, number>();
  for (const it of itens) for (const w of palavras(it)) conta.set(w, (conta.get(w) ?? 0) + 1);
  for (const it of itens) {
    // primeiro o nome inteiro, depois só as palavras que nenhum outro item da lista tem (ex.: "trinco", não "mola")
    const chaves = [semAcento(it.nome), ...palavras(it).filter((w) => conta.get(w) === 1)];
    for (const k of chaves) {
      const pos = t.indexOf(k);
      if (pos < 0) continue;
      const m = t.slice(pos + k.length, pos + k.length + 60).match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{1,4}|\d+(?:[.,]\d{1,4})?)/);
      if (!m) continue;
      const v = Number(m[1].includes(",") ? m[1].replace(/\./g, "").replace(",", ".") : m[1]);
      if (v > 0) { precos.push({ itemId: it.id, precoPorUnidade: v, comoEscreveu: texto.slice(pos, pos + k.length + 30).trim(), prazoEntregaDias: null, compraMinima: null, observacao: null }); break; }
    }
  }
  const perguntaRobo = /\b(robo|bot|maquina|inteligencia artificial|\bia\b|automatic[oa]|e gente|pessoa de verdade)\b/.test(t) && t.includes("?");
  const base = precos.length ? "Anotado, muito obrigado! Qualquer novidade a gente te chama." : "Opa, recebido! Vou passar aqui para a equipe.";
  return {
    precos,
    resposta: perguntaRobo ? `${base} E respondendo: sou o assistente automático da R.G.A, mas a equipe acompanha tudo por aqui.` : base,
    midiaId: null,
    precisaDeGente: precos.length === 0,
    resumoParaEquipe: precos.length ? `Leu ${precos.length} preço(s) pela leitura simples.` : "Mensagem sem preço reconhecido.",
  };
}
