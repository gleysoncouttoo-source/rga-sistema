// v1.0: processo inicial de cada peça (passos), montado a partir das operações da planilha de julho.
// Só cria para quem ainda não tem nenhum passo, então pode rodar várias vezes sem desfazer o que foi editado na tela.

// [códigos (prefixo termina com *), [[etapa, operação], ...]]
const ROTEIROS = [
  [["PC-TESTA"], [["Estamparia", "Estampa testa"], ["Solda", "Solda testa"]]],
  [["PC-CTESTA"], [["Estamparia", "Estampa contra-testa"]]],
  [["PC-CAIXA"], [["Estamparia", "Estampa caixa residencial"]]],
  [["PC-TAMPA"], [["Estamparia", "Estampa tampa (todos os tamanhos)"]]],
  [["PC-LINGUETA"], [["Injeção", "Lingueta residencial"]]],
  [["PC-TRINCO"], [["Injeção", "Trinco residencial"]]],
  [["PC-TAMBOR"], [["Injeção", "Tambor residencial"], ["Usinagem", "Brocha tambor"]]],
  [["PC-CILINDRO"], [["Injeção", "Cilindro"]]],
  // exemplo dado pelo gleyson: espelho L.O = estampo, pintura, lixa e verniz final
  [["ESP-400LO", "ESP-403LO"], [["Estamparia", "Estampa espelho"], ["Pintura", "Pintura espelho"], ["Lixa", "Lixa espelho"], ["Verniz", "Verniz espelho"]]],
  [["ESP-400PT", "ESP-403PT"], [["Estamparia", "Estampa espelho"], ["Polimento", "Polimento espelho"], ["Banho de zinco", "Banho de zinco — espelho (lote)"]]],
  [["MAC-900*"], [["Injeção", "Maçaneta 900"], ["Polimento", "Maçaneta 900"]]],
  [["MAC-902*"], [["Injeção", "Maçaneta 902"], ["Polimento", "Maçaneta 902 (lixa)"]]],
  [["MAC-905*"], [["Injeção", "Maçaneta 905"], ["Injeção", "Tampa 905"], ["Polimento", "Maçaneta 905"]]],
  [["MAC-904*"], [["Injeção", "Maçaneta 904"], ["Polimento", "Maçaneta 904"]]],
  // 18/11: peças pequenas. Aço = estampa; zamac = injeção (proposta, o gleyson ajusta na aba Produção → Processos das peças)
  [["PC-CAD-TESTA"], [["Estamparia", "Estampa cadeira da testa"]]],
  [["PC-CAD-CAIXA"], [["Estamparia", "Estampa cadeira da caixa"]]],
  [["PC-TRAVA-TRINCO"], [["Estamparia", "Estampa trava do trinco"]]],
  [["PC-TRAVA-REV"], [["Estamparia", "Estampa trava da reversão"]]],
  [["PC-TRAVA-CIL"], [["Estamparia", "Estampa trava do cilindro"]]],
  [["PC-ALAV-TRINCO"], [["Estamparia", "Estampa alavanca do trinco"]]],
  [["PC-CHAVE"], [["Estamparia", "Estampa chave"]]],
  [["PC-CHAVE-EMERG"], [["Estamparia", "Estampa chave emergência"]]],
  [["PC-ESPELHO-ACO"], [["Estamparia", "Estampa espelho de aço"]]],
  [["PC-CUBO-NOZ"], [["Injeção", "Cubo noz"]]],
  [["PC-ALAV-GORGE"], [["Injeção", "Alavanca gorge"]]],
  [["PC-NARIZ"], [["Injeção", "Nariz"]]],
  [["PC-CHAVE-INT"], [["Injeção", "Chave interna"]]],
  [["PC-NOZ-TRANQ"], [["Injeção", "Noz tranqueta"]]],
  [["PC-CHAVE-WC"], [["Injeção", "Chave WC"]]],
  [["CJ-*"], [["Montagem", "Montagem do corpo"]]],
  [["FM-*"], [["Montagem", "Montagem final"]]],
];

export async function carregarRoteiros(prisma) {
  const itens = await prisma.item.findMany({ where: { codigo: { not: null } }, include: { _count: { select: { passos: true } } } });
  for (const [codigos, passos] of ROTEIROS) {
    const alvo = itens.filter((i) => !i._count.passos && codigos.some((c) => (c.endsWith("*") ? i.codigo.startsWith(c.slice(0, -1)) : i.codigo === c)));
    if (!alvo.length) continue;
    const ops = [];
    for (const [etapaNome, nome] of passos) {
      const etapa = await prisma.etapa.findUnique({ where: { nome: etapaNome } });
      const op = await prisma.operacao.upsert({ where: { etapaId_nome: { etapaId: etapa.id, nome } }, update: {}, create: { etapaId: etapa.id, nome, observacao: "Criada com o processo das peças (v1.0). Tempo vem dos apontamentos." } });
      ops.push(op.id);
    }
    for (const it of alvo) {
      for (const [i, operacaoId] of ops.entries()) {
        await prisma.passo.create({ data: { itemId: it.id, ordem: i + 1, operacaoId } });
        await prisma.itemOperacao.upsert({ where: { itemId_operacaoId: { itemId: it.id, operacaoId } }, update: { sugerida: false }, create: { itemId: it.id, operacaoId } });
      }
    }
  }
  // material da matéria-prima que veio da planilha
  await prisma.item.updateMany({ where: { codigo: { startsWith: "MP-ACO" }, material: null }, data: { material: "Aço" } });
  await prisma.item.updateMany({ where: { codigo: "MP-ZAMAC", material: null }, data: { material: "Zamac" } });
}
