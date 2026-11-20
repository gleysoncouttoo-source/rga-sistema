// Cotação semanal pelo WhatsApp: abre a cotação da semana, pergunta a cada fornecedor, recebe a resposta,
// a inteligência lê os preços e eles ficam "a conferir" até alguém confirmar. Confirmado, entra no sistema.
import "server-only";
import { db } from "./db";
import { dia, somaDias } from "./datas";
import { dataDia } from "./formato";
import { registrarPreco } from "./precos";
import { avisarDepois } from "./notificacoes";
import { conversarIA, iaLigada, lerPrecosSimples, type Anexo, type ItemCotado, type ResultadoIA } from "./ia";
import { enviarMidiaDaBiblioteca, enviarModelo, enviarTexto, guardarMensagem, numeroWhats, primeiroNome, quemE, whatsLigado } from "./whatsapp";

/** Segunda-feira da semana (data de calendário). */
export function segundaDaSemana(d = dia()) {
  return somaDias(d, -((d.getUTCDay() + 6) % 7));
}

/** O que o fornecedor vende: matérias-primas da aba do fornecedor + itens em que ele é o principal. */
export async function itensDoFornecedor(fornecedorId: number): Promise<ItemCotado[]> {
  const f = await db.fornecedor.findUnique({ where: { id: fornecedorId }, include: { ofertas: { include: { item: true } }, itens: true } });
  if (!f) return [];
  const m = new Map<number, ItemCotado>();
  for (const o of f.ofertas) if (o.item.ativo) m.set(o.itemId, { id: o.itemId, nome: o.item.nome, unidade: o.item.unidade, material: o.item.material, ultimoPreco: o.preco ?? o.item.precoCompra });
  for (const it of f.itens) if (it.ativo && it.origem === "comprado" && !m.has(it.id)) m.set(it.id, { id: it.id, nome: it.nome, unidade: it.unidade, material: it.material, ultimoPreco: it.precoCompra });
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

const UNID: Record<string, string> = { kg: "kg", un: "unidade", m: "metro", L: "litro" };
export const listaItens = (itens: ItemCotado[]) => itens.map((i) => `${i.nome} (por ${UNID[i.unidade] ?? i.unidade})`).join(", ");

// ───── Quantas vezes por mês (Compras → Cotação) ─────
export const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export type ConfigAuto = { vezes: 0 | 1 | 2 | 4; diaSemana: number };

export async function configAuto(): Promise<ConfigAuto> {
  const rows = await db.configuracao.findMany({ where: { chave: { in: ["cotacaoVezesMes", "cotacaoDiaSemana", "cotacaoAutomatica"] } } });
  const m = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  const v = Number(m.cotacaoVezesMes ?? (m.cotacaoAutomatica === "1" ? 4 : 0));
  const d = Number(m.cotacaoDiaSemana ?? 1);
  return { vezes: ([0, 1, 2, 4] as const).find((x) => x === v) ?? 0, diaSemana: d >= 1 && d <= 5 ? d : 1 };
}

/** 4x = toda semana; 2x = 1ª e 3ª semana do mês; 1x = 1ª semana do mês. Sempre no dia da semana escolhido. */
export function ehDiaDeCotacao(d: Date, c: ConfigAuto) {
  if (!c.vezes || d.getUTCDay() !== c.diaSemana) return false;
  const n = Math.ceil(d.getUTCDate() / 7); // 1ª, 2ª, 3ª... ocorrência desse dia da semana no mês
  return c.vezes === 4 ? true : c.vezes === 2 ? n === 1 || n === 3 : n === 1;
}
export const deveAbrirHoje = (c: ConfigAuto) => ehDiaDeCotacao(dia(), c);

/** Próximas datas de cotação (para mostrar na tela). */
export function proximasCotacoes(c: ConfigAuto, quantas = 3) {
  const out: Date[] = [];
  for (let d = dia(), i = 0; i < 120 && out.length < quantas; i++, d = somaDias(d, 1)) if (ehDiaDeCotacao(d, c)) out.push(d);
  return out;
}

export const textoPedidoCotacao = (nome: string, itens: ItemCotado[]) =>
  `Oi${nome ? `, ${nome}` : ""}! Tudo bem? Aqui é o Sambot, da R.G.A. Estamos fechando as compras da semana. Pode me passar o preço atual de: ${listaItens(itens)}? Se puder, manda também o prazo de entrega. Obrigado!`;

/** Abre (ou reabre) a cotação da semana e manda o pedido para quem ainda não recebeu. */
export async function abrirCotacao(usuario: string) {
  const semana = segundaDaSemana();
  const cot = await db.cotacao.upsert({ where: { semana }, create: { semana, criadaPor: usuario }, update: {} });
  const forns = await db.fornecedor.findMany({ where: { ativo: true }, select: { id: true } });
  for (const f of forns) {
    if (!(await itensDoFornecedor(f.id)).length) continue;
    await db.cotacaoFornecedor.upsert({ where: { cotacaoId_fornecedorId: { cotacaoId: cot.id, fornecedorId: f.id } }, create: { cotacaoId: cot.id, fornecedorId: f.id }, update: {} });
  }
  const pendentes = await db.cotacaoFornecedor.findMany({ where: { cotacaoId: cot.id, status: { in: ["pronto", "erro", "sem_whats"] } } });
  let enviados = 0;
  for (const cf of pendentes) if (await enviarPedido(cf.id)) enviados++;
  return { cotacaoId: cot.id, enviados };
}

/** Manda o pedido de cotação para um fornecedor (modelo aprovado pela Meta, porque é a R.G.A que começa a conversa). */
export async function enviarPedido(cfId: number, lembrete = false) {
  const cf = await db.cotacaoFornecedor.findUniqueOrThrow({ where: { id: cfId }, include: { fornecedor: true } });
  const f = cf.fornecedor;
  const numero = numeroWhats(f.whatsapp || f.telefone);
  if (!numero) { await db.cotacaoFornecedor.update({ where: { id: cfId }, data: { status: "sem_whats", erro: "Sem WhatsApp no cadastro" } }); return false; }
  const modelo = process.env.WHATSAPP_MODELO_COTACAO;
  if (!whatsLigado() || !modelo) { await db.cotacaoFornecedor.update({ where: { id: cfId }, data: { status: "pronto", erro: null } }); return false; }
  const itens = await itensDoFornecedor(f.id);
  const nome = primeiroNome(f.contato) || f.nome;
  try {
    await enviarModelo(numero, modelo, [nome, listaItens(itens)], textoPedidoCotacao(nome, itens), { fornecedorId: f.id, nome: f.contato || f.nome });
    await db.cotacaoFornecedor.update({ where: { id: cfId }, data: lembrete ? { lembradoEm: new Date(), erro: null } : { status: "enviado", enviadoEm: new Date(), erro: null } });
    return true;
  } catch (e) {
    await db.cotacaoFornecedor.update({ where: { id: cfId }, data: { status: lembrete ? cf.status : "erro", erro: e instanceof Error ? e.message.slice(0, 300) : "falhou" } });
    return false;
  }
}

/** Dois dias depois do envio: lembra uma vez quem recebeu e ainda não respondeu. */
export async function lembrarQuemNaoRespondeu() {
  const cfs = await db.cotacaoFornecedor.findMany({ where: { status: "enviado", lembradoEm: null, enviadoEm: { lte: new Date(Date.now() - 2 * 86_400_000), gte: new Date(Date.now() - 6 * 86_400_000) } } });
  let n = 0;
  for (const cf of cfs) if (await enviarPedido(cf.id, true)) n++;
  return n;
}

type Entrada = { telefone: string; nomePerfil?: string | null; texto: string; waId?: string | null; anexos?: Anexo[]; tipo?: string };

/**
 * Mensagem que chegou no WhatsApp (ou que alguém digitou na tela, quando o fornecedor respondeu por outro lugar).
 * responder = false: só lê os preços e guarda a resposta que o Sambot daria, sem mandar.
 */
export async function receberMensagem(m: Entrada, opcoes: { responder: boolean; fornecedorId?: number } = { responder: true }) {
  if (m.waId && (await db.whatsMensagem.findUnique({ where: { waId: m.waId } }))) return null; // já processada
  const quem = opcoes.fornecedorId
    ? await db.fornecedor.findUnique({ where: { id: opcoes.fornecedorId } }).then((f) => (f ? { tipo: "fornecedor" as const, fornecedorId: f.id, nome: f.contato || f.nome, empresa: f.nome } : null))
    : await quemE(m.telefone);
  const ids = { fornecedorId: quem?.tipo === "fornecedor" ? quem.fornecedorId : null, funcionarioId: quem?.tipo === "colaborador" ? quem.funcionarioId : null, nome: quem?.nome ?? m.nomePerfil ?? null };
  await guardarMensagem({ ...ids, telefone: m.telefone, direcao: "entrada", texto: m.texto, tipo: m.tipo ?? "texto", waId: m.waId, status: opcoes.responder ? "recebida" : "digitada" });

  // cotação aberta com este fornecedor nas últimas 3 semanas
  const cf = ids.fornecedorId
    ? await db.cotacaoFornecedor.findFirst({ where: { fornecedorId: ids.fornecedorId, cotacao: { semana: { gte: somaDias(dia(), -21) } } }, orderBy: { id: "desc" } })
    : null;
  const itens = cf && ids.fornecedorId ? await itensDoFornecedor(ids.fornecedorId) : [];

  const desde = somaDias(new Date(), -14);
  const historico = (await db.whatsMensagem.findMany({ where: { telefone: m.telefone, criadoEm: { gte: desde } }, orderBy: { id: "desc" }, take: 21 })).reverse().slice(0, -1);
  const midias = await db.whatsMidia.findMany({ where: { ativo: true }, select: { id: true, tipo: true, nome: true, uso: true, descricao: true }, orderBy: { id: "asc" } });

  let r: ResultadoIA;
  try {
    r = iaLigada()
      ? await conversarIA({ papel: quem?.tipo ?? "desconhecido", nome: quem?.nome ?? m.nomePerfil ?? null, empresa: quem?.empresa ?? null, itens, historico: historico.map((h) => ({ direcao: h.direcao, texto: h.texto, quando: h.criadoEm })), mensagem: m.texto, anexos: m.anexos, midias, hoje: dataDia(dia()) })
      : lerPrecosSimples(m.texto, itens);
  } catch (e) {
    console.error("IA do WhatsApp falhou", e);
    r = lerPrecosSimples(m.texto, itens);
  }

  // preços lidos → a conferir
  if (cf && r.precos.length) {
    await db.$transaction(async (tx) => {
      for (const p of r.precos) {
        await tx.cotacaoPreco.updateMany({ where: { cotacaoFornecedorId: cf.id, itemId: p.itemId, status: "a_conferir" }, data: { status: "descartado", decididoPor: "substituído por resposta nova", decididoEm: new Date() } });
        await tx.cotacaoPreco.create({ data: { cotacaoFornecedorId: cf.id, itemId: p.itemId, preco: p.precoPorUnidade, precoInformado: p.comoEscreveu, prazoEntregaDias: p.prazoEntregaDias, compraMinima: p.compraMinima, observacao: p.observacao, textoOriginal: m.texto.slice(0, 2000) } });
      }
      const respondidos = new Set((await tx.cotacaoPreco.findMany({ where: { cotacaoFornecedorId: cf.id, status: { not: "descartado" } }, select: { itemId: true } })).map((x) => x.itemId));
      await tx.cotacaoFornecedor.update({ where: { id: cf.id }, data: { status: itens.every((i) => respondidos.has(i.id)) ? "completo" : "respondeu", respondidoEm: new Date() } });
    });
    await avisarDepois("cotacao", { titulo: "Cotação: preço para conferir", texto: `${quem?.empresa ?? quem?.nome}: ${r.resumoParaEquipe}`.slice(0, 180), link: "/compras/cotacao", tag: "cotacao" });
  } else if (r.precisaDeGente) {
    await avisarDepois("whatsapp", { titulo: `WhatsApp: ${quem?.nome ?? m.nomePerfil ?? m.telefone}`, texto: r.resumoParaEquipe.slice(0, 180), link: `/compras/whatsapp?tel=${m.telefone}`, tag: `whats-${m.telefone}` });
  }

  // resposta (com um pequeno tempo de "digitando", como gente)
  if (opcoes.responder) {
    if (whatsLigado()) await new Promise((ok) => setTimeout(ok, Math.min(6000, 1200 + r.resposta.length * 35)));
    await enviarTexto(m.telefone, r.resposta, ids);
    if (r.midiaId) await enviarMidiaDaBiblioteca(m.telefone, r.midiaId, ids);
  } else {
    await guardarMensagem({ ...ids, telefone: m.telefone, direcao: "saida", texto: r.resposta, status: "simulada" });
  }
  return r;
}

/** Confirma um preço da cotação: atualiza o preço na aba do fornecedor e, se ele for o principal do item, o histórico 30/60/90. */
export async function confirmarPreco(id: number, usuario: string) {
  const p = await db.cotacaoPreco.findUniqueOrThrow({ where: { id }, include: { item: true, cotacaoFornecedor: true } });
  if (p.status !== "a_conferir") return null;
  const fornecedorId = p.cotacaoFornecedor.fornecedorId;
  const principal = p.item.fornecedorId == null || p.item.fornecedorId === fornecedorId;
  return db.$transaction(async (tx) => {
    const extra = { ...(p.prazoEntregaDias != null ? { prazoEntregaDias: p.prazoEntregaDias } : {}), ...(p.compraMinima != null ? { compraMinima: p.compraMinima } : {}) };
    await tx.fornecedorItem.upsert({ where: { fornecedorId_itemId: { fornecedorId, itemId: p.itemId } }, create: { fornecedorId, itemId: p.itemId, preco: p.preco, ...extra }, update: { preco: p.preco, ...extra } });
    let recorde = false;
    if (principal) recorde = (await registrarPreco(tx, { itemId: p.itemId, preco: p.preco, data: dia(), origem: "cotação", fornecedorId, usuario })).novoRecorde;
    await tx.cotacaoPreco.update({ where: { id }, data: { status: "confirmado", decididoPor: usuario, decididoEm: new Date() } });
    return { principal, recorde };
  });
}
