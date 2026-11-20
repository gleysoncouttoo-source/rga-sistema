// v1.0 — Produção seguindo o processo de cada peça.
// Cada peça tem passos (Estampa → Pintura → Lixa → Verniz). As peças andam em LOTES:
//   • no 1º passo o lote consome a matéria-prima/peças da estrutura;
//   • em cada passo seguinte, só pode entrar o que saiu do passo anterior (peças + refugo);
//   • o que sai do último passo entra no estoque da peça pronta.
// O "estoque parcial" é o que saiu de um passo e ainda espera o próximo.
import { db } from "./db";
import { avisarDepois } from "./notificacoes";
import { registrarApontamento, type ResultadoApontamento } from "./producao";
import { num } from "./formato";

export type PassoInfo = { id: number; ordem: number; nome: string; etapa: string; operacaoId: number };
export type SaldoPasso = PassoInfo & { feito: number; refugo: number; aguardando: number; minutos: number; quem: { nome: string; qtd: number; minutos: number }[]; emAndamento: number };
export type SaldoLote = { loteId: number; numero: string; itemId: number; status: string; planejado: number | null; passos: SaldoPasso[]; pronto: number; emProcesso: number };

export async function passosDe(itemId: number): Promise<PassoInfo[]> {
  const ps = await db.passo.findMany({ where: { itemId }, orderBy: { ordem: "asc" }, include: { operacao: { include: { etapa: true } } } });
  return ps.map((p) => ({ id: p.id, ordem: p.ordem, nome: p.operacao.nome, etapa: p.operacao.etapa.nome, operacaoId: p.operacaoId }));
}

/** Saldo de cada passo de cada lote (feito, refugo, esperando o próximo, quem fez). */
export async function saldosLotes(where: { status?: string | { in: string[] }; itemId?: number; id?: number } = { status: "aberto" }): Promise<SaldoLote[]> {
  const lotes = await db.lote.findMany({
    where, orderBy: { criadoEm: "asc" },
    include: {
      apontamentos: { include: { funcionario: true } },
      processos: { where: { status: "andamento" } },
      item: { include: { passos: { orderBy: { ordem: "asc" }, include: { operacao: { include: { etapa: true } } } } } },
    },
  });
  return lotes.map((l) => {
    const passos: SaldoPasso[] = l.item.passos.map((p) => {
      const aps = l.apontamentos.filter((a) => a.passoId === p.id);
      const quem = new Map<string, { nome: string; qtd: number; minutos: number }>();
      for (const a of aps) {
        const q = quem.get(a.funcionario.nome) ?? { nome: a.funcionario.nome, qtd: 0, minutos: 0 };
        q.qtd += a.quantidade; q.minutos += a.minutos; quem.set(q.nome, q);
      }
      const entrada = l.entradaOrdem === p.ordem ? l.entradaQtd ?? 0 : 0;
      return {
        id: p.id, ordem: p.ordem, nome: p.operacao.nome, etapa: p.operacao.etapa.nome, operacaoId: p.operacaoId,
        feito: aps.reduce((s, a) => s + a.quantidade, 0) + entrada,
        refugo: aps.reduce((s, a) => s + a.refugo, 0),
        minutos: aps.reduce((s, a) => s + a.minutos, 0),
        aguardando: 0, quem: [...quem.values()],
        emAndamento: l.processos.filter((x) => x.passoId === p.id).length,
      };
    });
    // entrada de lote aberto "no meio" do processo (peças que já estavam prontas até o passo X)
    if (l.entradaOrdem != null && !passos.some((p) => p.ordem === l.entradaOrdem)) {
      const prox = passos.find((p) => p.ordem > l.entradaOrdem!);
      if (prox) passos.splice(passos.indexOf(prox), 0, { id: 0, ordem: l.entradaOrdem, nome: "Peças que já estavam prontas", etapa: "", operacaoId: 0, feito: l.entradaQtd ?? 0, refugo: 0, minutos: 0, aguardando: 0, quem: [], emAndamento: 0 });
    }
    for (let i = 0; i < passos.length - 1; i++) {
      const prox = l.apontamentos.filter((a) => a.passoId === passos[i + 1].id);
      passos[i].aguardando = passos[i].feito - prox.reduce((s, a) => s + a.quantidade + a.refugo, 0);
    }
    const ultimo = passos[passos.length - 1];
    return {
      loteId: l.id, numero: l.numero, itemId: l.itemId, status: l.status, planejado: l.planejado, passos,
      pronto: ultimo?.feito ?? 0, emProcesso: passos.slice(0, -1).reduce((s, p) => s + Math.max(0, p.aguardando), 0),
    };
  });
}

async function proximoNumeroLote() {
  const ult = await db.lote.findFirst({ orderBy: { id: "desc" } });
  return `L-${String((ult?.id ?? 0) + 1).padStart(4, "0")}`;
}

/** Lote informado ou um lote novo. Lote novo em passo que não é o 1º = peças que já estavam prontas no passo anterior. */
async function resolverLote(p: { itemId: number; passoId: number; loteId?: number | null; planejado?: number | null; entrada?: number }, usuario: string) {
  if (p.loteId) {
    const l = await db.lote.findUniqueOrThrow({ where: { id: p.loteId } });
    if (l.itemId !== p.itemId) throw new Erro("Esse lote é de outra peça.");
    if (l.status !== "aberto") throw new Erro(`O lote ${l.numero} já está ${l.status}.`);
    return l;
  }
  const passos = await passosDe(p.itemId);
  const idx = passos.findIndex((x) => x.id === p.passoId);
  const anterior = idx > 0 ? passos[idx - 1] : null;
  return db.lote.create({
    data: {
      numero: await proximoNumeroLote(), itemId: p.itemId, planejado: p.planejado || null, criadoPor: usuario,
      entradaOrdem: anterior ? anterior.ordem : null, entradaQtd: anterior ? p.entrada ?? 0 : null,
    },
  });
}

export class Erro extends Error {}

/** Quanto ainda pode entrar neste passo do lote (o que saiu do passo anterior). null = 1º passo, sem limite. */
async function disponivelNoPasso(loteId: number, passoId: number) {
  const [s] = await saldosLotes({ id: loteId });
  const i = s.passos.findIndex((p) => p.id === passoId);
  if (i <= 0) return null;
  return s.passos[i - 1].aguardando;
}

/** Lança uma produção (com tempo digitado ou vinda do cronômetro) e movimenta os estoques. */
export async function lancarProducao(p: {
  itemId: number; passoId: number; loteId?: number | null; planejado?: number | null; funcionarioId: number;
  quantidade: number; refugo: number; minutos: number; inicio?: Date; fim?: Date; usuario: string; logado: boolean;
}): Promise<ResultadoApontamento & { lote: string }> {
  const passo = await db.passo.findUniqueOrThrow({ where: { id: p.passoId }, include: { operacao: true, item: { include: { componentes: { include: { filho: true } }, passos: { orderBy: { ordem: "asc" } } } } } });
  if (passo.itemId !== p.itemId) throw new Erro("Esse processo não é dessa peça.");
  if (!(p.quantidade >= 0) || p.quantidade + p.refugo <= 0) throw new Erro("Informe a quantidade de peças.");
  if (!(p.minutos > 0)) throw new Erro("Informe o tempo trabalhado.");
  const lote = await resolverLote({ ...p, entrada: p.quantidade + p.refugo }, p.usuario);
  if (p.loteId) {
    const disp = await disponivelNoPasso(lote.id, p.passoId);
    if (disp != null && p.quantidade + p.refugo > disp + 1e-9)
      throw new Erro(`No lote ${lote.numero} só há ${num(Math.max(0, disp))} peça(s) prontas do processo anterior. Peças + refugo não podem passar disso.`);
  }
  const fim = p.fim ?? new Date();
  const r = await registrarApontamento({
    funcionarioId: p.funcionarioId, operacaoId: passo.operacaoId, quantidade: p.quantidade, refugo: p.refugo, minutos: p.minutos,
    itemId: p.itemId, passoId: p.passoId, loteId: lote.id, inicio: p.inicio ?? new Date(fim.getTime() - p.minutos * 60_000), fim, usuario: p.logado ? p.usuario : null,
  });
  const primeiro = passo.item.passos[0]?.id === passo.id;
  const ultimo = passo.item.passos[passo.item.passos.length - 1]?.id === passo.id;
  const motivo = `Produção ${lote.numero} — ${passo.operacao.nome}`;
  const movs: { itemId: number; quantidade: number }[] = [];
  // 1º passo de um lote novo: sai a matéria-prima / as peças da estrutura (peças boas + refugo)
  if (primeiro && lote.entradaOrdem == null) for (const c of passo.item.componentes) movs.push({ itemId: c.filhoId, quantidade: -c.quantidade * (p.quantidade + p.refugo) });
  if (ultimo && p.quantidade > 0) movs.push({ itemId: p.itemId, quantidade: p.quantidade });
  for (const m of movs) {
    await db.item.update({ where: { id: m.itemId }, data: { estoque: { increment: m.quantidade } } });
    await db.movimentoEstoque.create({ data: { ...m, motivo, usuario: p.usuario, apontamentoId: r.apontamentoId } });
  }
  await atualizarStatusLote(lote.id);
  const func = await db.funcionario.findUnique({ where: { id: p.funcionarioId }, select: { nome: true } });
  await avisarDepois("apontamento", {
    titulo: "Produção lançada",
    texto: `${func?.nome ?? "Operador"} · ${passo.item.nome} · ${passo.operacao.nome}: ${num(p.quantidade)} peça(s)${p.refugo ? `, ${num(p.refugo)} refugo` : ""} (lote ${lote.numero})`,
    link: "/producao", tag: `apontamento-${r.apontamentoId}`,
  });
  return { ...r, lote: lote.numero };
}

/** Lote fica concluído quando tudo o que entrou chegou ao último passo (ou virou refugo). */
export async function atualizarStatusLote(loteId: number) {
  const [s] = await saldosLotes({ id: loteId });
  if (!s || s.status === "cancelado") return;
  const andando = s.passos.some((p) => p.emAndamento > 0);
  const parado = s.passos.slice(0, -1).some((p) => p.aguardando > 0);
  const primeiro = s.passos[0];
  const faltaPlanejado = s.planejado != null && primeiro && primeiro.id !== 0 && primeiro.feito + primeiro.refugo < s.planejado;
  const concluido = s.pronto > 0 && !andando && !parado && !faltaPlanejado;
  if (concluido !== (s.status === "concluido"))
  {
    const l = await db.lote.update({ where: { id: loteId }, data: { status: concluido ? "concluido" : "aberto", concluidoEm: concluido ? new Date() : null }, include: { item: true } });
    if (concluido) await avisarDepois("lote", { titulo: "Lote concluído", texto: `Lote ${l.numero} · ${l.item.nome}: ${num(s.pronto)} peça(s) prontas`, link: "/producao", tag: `lote-${l.id}` });
  }
}

/** Liga o cronômetro: o colaborador começou um processo. */
export async function iniciarCronometro(p: { itemId: number; passoId: number; loteId?: number | null; planejado?: number | null; funcionarioId: number; usuario: string }) {
  const passo = await db.passo.findUniqueOrThrow({ where: { id: p.passoId } });
  if (passo.itemId !== p.itemId) throw new Erro("Esse processo não é dessa peça.");
  const lote = await resolverLote({ ...p, entrada: 0 }, p.usuario);
  const pr = await db.processoProducao.create({ data: { itemId: p.itemId, passoId: p.passoId, loteId: lote.id, funcionarioId: p.funcionarioId, iniciadoPor: p.usuario } });
  if (lote.status !== "aberto") await db.lote.update({ where: { id: lote.id }, data: { status: "aberto", concluidoEm: null } });
  return { id: pr.id, lote: lote.numero };
}

export function segundosCorridos(pr: { inicio: Date; pausadoEm: Date | null; segPausado: number }, agora = new Date()) {
  const fim = pr.pausadoEm ?? agora;
  return Math.max(0, (fim.getTime() - pr.inicio.getTime()) / 1000 - pr.segPausado);
}

export async function pausarCronometro(id: number) {
  const pr = await db.processoProducao.findUniqueOrThrow({ where: { id } });
  if (pr.status !== "andamento") return;
  if (pr.pausadoEm) await db.processoProducao.update({ where: { id }, data: { pausadoEm: null, segPausado: pr.segPausado + (Date.now() - pr.pausadoEm.getTime()) / 1000 } });
  else await db.processoProducao.update({ where: { id }, data: { pausadoEm: new Date() } });
}

/** Para o cronômetro e lança a produção com o tempo contado. */
export async function finalizarCronometro(id: number, p: { quantidade: number; refugo: number; usuario: string; logado: boolean }) {
  const pr = await db.processoProducao.findUniqueOrThrow({ where: { id } });
  if (pr.status !== "andamento") throw new Erro("Esse processo já foi finalizado.");
  const agora = new Date();
  const minutos = Math.max(segundosCorridos(pr, agora) / 60, 0.1);
  // cronômetro iniciado "sem lote" num passo do meio: as peças que entraram são as que já estavam prontas
  const lote = await db.lote.findUniqueOrThrow({ where: { id: pr.loteId }, include: { _count: { select: { apontamentos: true } } } });
  if (lote.entradaOrdem != null && !lote.entradaQtd && lote._count.apontamentos === 0)
    await db.lote.update({ where: { id: lote.id }, data: { entradaQtd: p.quantidade + p.refugo } });
  // o processo sai de "andamento" antes de lançar, para o lote poder fechar
  await db.processoProducao.update({ where: { id }, data: { status: "concluido", pausadoEm: null } });
  try {
    const r = await lancarProducao({ itemId: pr.itemId, passoId: pr.passoId, loteId: pr.loteId, funcionarioId: pr.funcionarioId, quantidade: p.quantidade, refugo: p.refugo, minutos, inicio: pr.inicio, fim: agora, usuario: p.usuario, logado: p.logado });
    await db.processoProducao.update({ where: { id }, data: { apontamentoId: r.apontamentoId } });
    return r;
  } catch (e) {
    await db.processoProducao.update({ where: { id }, data: { status: "andamento", pausadoEm: pr.pausadoEm } });
    throw e;
  }
}

export async function cancelarCronometro(id: number) {
  const pr = await db.processoProducao.findUniqueOrThrow({ where: { id }, include: { lote: { include: { _count: { select: { apontamentos: true, processos: true } } } } } });
  if (pr.status !== "andamento") return;
  await db.processoProducao.delete({ where: { id } });
  // lote criado só para este cronômetro e sem nada lançado: some junto
  if (pr.lote._count.apontamentos === 0 && pr.lote._count.processos === 1) await db.lote.delete({ where: { id: pr.loteId } });
}

/** Exclui um lançamento de produção e desfaz o que ele mexeu no estoque. */
export async function excluirApontamento(id: number, usuario: string) {
  const a = await db.apontamento.findUniqueOrThrow({ where: { id }, include: { recorde: true } });
  if (a.recorde && a.recorde.status === "confirmado") throw new Erro("Esse lançamento é um recorde já confirmado. Não dá para excluir.");
  const movs = await db.movimentoEstoque.findMany({ where: { apontamentoId: id } });
  for (const m of movs) {
    await db.item.update({ where: { id: m.itemId }, data: { estoque: { increment: -m.quantidade } } });
    await db.movimentoEstoque.create({ data: { itemId: m.itemId, quantidade: -m.quantidade, motivo: `Exclusão do lançamento de produção #${id}`, usuario } });
  }
  if (a.recorde) await db.recorde.delete({ where: { id: a.recorde.id } });
  await db.processoProducao.deleteMany({ where: { apontamentoId: id } });
  await db.apontamento.delete({ where: { id } });
  if (a.loteId) {
    const l = await db.lote.findUnique({ where: { id: a.loteId }, include: { _count: { select: { apontamentos: true, processos: true } } } });
    if (l && l._count.apontamentos === 0 && l._count.processos === 0) await db.lote.delete({ where: { id: l.id } });
    else if (l) await atualizarStatusLote(l.id);
  }
}

/** Dados para a tela "Iniciar novo processo": produtos, peças da estrutura com seus passos, lotes abertos. */
export async function dadosNovoProcesso() {
  const [itens, lotes, funcs] = await Promise.all([
    db.item.findMany({
      where: { ativo: true, OR: [{ tipo: { in: ["produto", "conjunto", "peca"] } }, { passos: { some: {} } }] },
      select: { id: true, codigo: true, nome: true, tipo: true, foto: true, componentes: { select: { filhoId: true, quantidade: true } },
        passos: { orderBy: { ordem: "asc" }, select: { id: true, ordem: true, operacao: { select: { nome: true, etapa: { select: { nome: true } } } } } } },
      orderBy: [{ codigo: "asc" }],
    }),
    saldosLotes({ status: "aberto" }),
    db.funcionario.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, setor: true, pinHash: true } }),
  ]);
  return {
    itens: itens.map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome, tipo: i.tipo, foto: i.foto, filhos: i.componentes.map((c) => c.filhoId),
      passos: i.passos.map((p) => ({ id: p.id, ordem: p.ordem, nome: p.operacao.nome, etapa: p.operacao.etapa.nome })) })),
    lotes: lotes.map((l) => ({ id: l.loteId, numero: l.numero, itemId: l.itemId, planejado: l.planejado,
      passos: l.passos.map((p) => ({ id: p.id, feito: p.feito, aguardando: p.aguardando, emAndamento: p.emAndamento })) })),
    funcs: funcs.map((f) => ({ id: f.id, nome: f.nome, setor: f.setor, temPin: !!f.pinHash })),
  };
}
export type DadosNovoProcesso = Awaited<ReturnType<typeof dadosNovoProcesso>>;
