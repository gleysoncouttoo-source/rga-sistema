import { db } from "./db";
import { custoHora, lerConfig } from "./config";
import { avisar } from "./notificacoes";

export type ResultadoApontamento = {
  apontamentoId: number;
  pecasHora: number;
  recordePecasHora: number | null;
  novoRecorde: boolean;
  abaixoDoMinimo: boolean;
};

/** Registra a produção e verifica se é um novo recorde (menor tempo por peça). */
export async function registrarApontamento(p: {
  funcionarioId: number; operacaoId: number; quantidade: number; refugo: number; minutos: number;
  itemId?: number; passoId?: number; loteId?: number; inicio?: Date; fim?: Date; usuario?: string | null;
}): Promise<ResultadoApontamento> {
  const [cfg, func, op] = await Promise.all([
    lerConfig(),
    db.funcionario.findUniqueOrThrow({ where: { id: p.funcionarioId } }),
    db.operacao.findUniqueOrThrow({ where: { id: p.operacaoId } }),
  ]);
  const segPorPeca = (p.minutos * 60) / p.quantidade;
  const ch = custoHora(func.salario, cfg, func);
  const custoPorPeca = ch != null ? (ch * p.minutos) / 60 / p.quantidade : null;

  const ap = await db.apontamento.create({
    data: { ...p, segPorPeca, custoHora: ch, custoPorPeca },
  });

  const abaixoDoMinimo = p.minutos < cfg.minutosMinimoRecorde;
  const recordeAtual = op.recordeSegPorPeca;
  // o recorde também precisa bater qualquer recorde pendente melhor ainda não decidido
  const pendenteMelhor = await db.recorde.findFirst({
    where: { operacaoId: op.id, status: "pendente", segPorPeca: { lte: segPorPeca } },
  });
  const novoRecorde = !abaixoDoMinimo && !pendenteMelhor && (recordeAtual == null || segPorPeca < recordeAtual);
  if (novoRecorde) {
    await db.recorde.create({
      data: { operacaoId: op.id, funcionarioId: func.id, apontamentoId: ap.id, segPorPeca, status: "pendente" },
    });
    await avisar("recorde", {
      titulo: "Novo recorde para confirmar",
      texto: `${func.nome} · ${op.nome}: ${Math.round(3600 / segPorPeca)} peças/hora${recordeAtual ? ` (antes ${Math.round(3600 / recordeAtual)})` : ""}`,
      link: "/producao", tag: `recorde-${op.id}`,
    });
  }
  return {
    apontamentoId: ap.id,
    pecasHora: 3600 / segPorPeca,
    recordePecasHora: recordeAtual ? 3600 / recordeAtual : null,
    novoRecorde,
    abaixoDoMinimo,
  };
}

/** Confirma ou recusa um recorde pendente. Ao confirmar, ele vira a nova meta da operação. */
export async function decidirRecorde(id: number, confirmar: boolean, quem: string) {
  const r = await db.recorde.findUniqueOrThrow({ where: { id } });
  if (r.status !== "pendente") return;
  await db.recorde.update({
    where: { id },
    data: { status: confirmar ? "confirmado" : "recusado", decididoPor: quem, decididoEm: new Date() },
  });
  if (confirmar) {
    const op = await db.operacao.findUniqueOrThrow({ where: { id: r.operacaoId } });
    if (op.recordeSegPorPeca == null || r.segPorPeca < op.recordeSegPorPeca) {
      await db.operacao.update({ where: { id: op.id }, data: { recordeSegPorPeca: r.segPorPeca } });
    }
  }
}
