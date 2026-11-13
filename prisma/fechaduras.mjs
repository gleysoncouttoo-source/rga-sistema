// Estrutura das fechaduras mecânicas, da planilha "Tabela de Custos - Fechadura Mecânica RGA" (enviada em 06/11/2026).
// Só cria o que ainda não existe (pelo código), então pode rodar várias vezes sem apagar estoque ou preços alterados.

const MP = [
  // código, nome, unidade, preço
  ["MP-ACO-9", "Aço (R$ 9/kg)", "kg", 9],
  ["MP-ACO-10", "Aço (R$ 10/kg)", "kg", 10],
  ["MP-ZAMAC", "Zamac", "kg", 32],
];

// peças fabricadas: código, nome, matéria-prima, peso em kg por peça
const PECAS = [
  ["PC-TESTA", "Testa", "MP-ACO-9", 0.038],
  ["PC-CTESTA", "Contra testa", "MP-ACO-9", 0.018],
  ["PC-CAIXA", "Caixa", "MP-ACO-10", 0.043],
  ["PC-TAMPA", "Tampa", "MP-ACO-10", 0.045],
  ["PC-CAD-TESTA", "Cadeira da testa", "MP-ACO-9", 0.003],
  ["PC-CAD-CAIXA", "Cadeira da caixa", "MP-ACO-9", 0.002],
  ["PC-TRAVA-TRINCO", "Trava do trinco", "MP-ACO-9", 0.002],
  ["PC-TRAVA-REV", "Trava da reversão", "MP-ACO-9", 0.002],
  ["PC-TRAVA-CIL", "Trava do cilindro", "MP-ACO-10", 0.002],
  ["PC-ALAV-TRINCO", "Alavanca do trinco", "MP-ACO-9", 0.006],
  ["PC-CHAVE", "Chave", "MP-ACO-9", 0.008],
  ["PC-ESPELHO-ACO", "Espelho (aço)", "MP-ACO-9", 0.028],
  ["PC-CHAVE-EMERG", "Chave emergência", "MP-ACO-10", 0.007],
  ["PC-CUBO-NOZ", "Cubo noz", "MP-ZAMAC", 0.016],
  ["PC-LINGUETA", "Lingueta", "MP-ZAMAC", 0.041],
  ["PC-TRINCO", "Trinco", "MP-ZAMAC", 0.022],
  ["PC-ALAV-GORGE", "Alavanca gorge", "MP-ZAMAC", 0.006],
  ["PC-NARIZ", "Nariz", "MP-ZAMAC", 0.002],
  ["PC-TAMBOR", "Tambor", "MP-ZAMAC", 0.077],
  ["PC-CILINDRO", "Cilindro", "MP-ZAMAC", 0.016],
  ["PC-CHAVE-INT", "Chave interna", "MP-ZAMAC", 0.016],
  ["PC-NOZ-TRANQ", "Noz tranqueta", "MP-ZAMAC", 0.012],
  ["PC-CHAVE-WC", "Chave WC", "MP-ZAMAC", 0.017],
];

// insumos comprados: código, nome, preço unitário
const INSUMOS = [
  ["IN-MOLA-NOZ", "Mola do cubo noz", 0.28],
  ["IN-MOLA-TRINCO", "Mola do trinco", 0.09],
  ["IN-MOLA-LING", "Mola da lingueta", 0.05],
  ["IN-PINO-SEG", "Pino segredo", 0.05],
  ["IN-CONTRA-PINO", "Contra pino", 0.05],
  ["IN-MOLA-TRAVA-CIL", "Mola trava cilindro", 0.04],
  ["IN-MOLA-CPINO", "Mola contra pino", 0.03],
  ["IN-ARGOLA", "Argola", 0.06],
  ["IN-TAMPA-TAMBOR", "Tampa do tambor", 0.06],
  ["IN-PAR-35X20", "Parafuso 3,5x20", 0.03],
  ["IN-PAR-3X12", "Parafuso 3x12", 0.02],
  ["IN-PAR-M4X50", "Parafuso M4 0,7x50", 0.12],
  ["IN-ESPACADOR", "Espaçador", 0.06],
  ["IN-BALMAZ", "Balmaz 2x16", 0.06],
  ["IN-CX-PAPELAO", "Caixa papelão", 1.55],
  ["IN-SACOLA", "Sacola kit", 0.05],
  ["IN-VERNIZ", "Verniz/tinta", 0.9],
  ["IN-ETIQUETA", "Etiqueta", 0.13],
];

const COMUM_INT = [
  ["PC-TESTA", 1], ["PC-CTESTA", 1], ["PC-CAIXA", 1], ["PC-TAMPA", 1], ["PC-CAD-TESTA", 2], ["PC-CAD-CAIXA", 4],
  ["PC-TRAVA-TRINCO", 1], ["PC-TRAVA-REV", 1], ["PC-ESPELHO-ACO", 2],
  ["PC-CUBO-NOZ", 1], ["PC-LINGUETA", 1], ["PC-TRINCO", 1], ["PC-ALAV-GORGE", 1],
  ["IN-MOLA-NOZ", 1], ["IN-MOLA-TRINCO", 1], ["IN-MOLA-LING", 2], ["IN-ARGOLA", 1], ["IN-PAR-35X20", 2], ["IN-PAR-3X12", 7],
  ["IN-ESPACADOR", 2], ["IN-BALMAZ", 1], ["IN-CX-PAPELAO", 1], ["IN-VERNIZ", 1], ["IN-SACOLA", 1], ["IN-ETIQUETA", 1],
];

// corpos (conjuntos montados): código, nome, componentes
const CORPOS = [
  ["CJ-EXT", "Corpo fechadura externa", [
    ["PC-TESTA", 1], ["PC-CTESTA", 1], ["PC-CAIXA", 1], ["PC-TAMPA", 1], ["PC-CAD-TESTA", 2], ["PC-CAD-CAIXA", 4],
    ["PC-TRAVA-TRINCO", 1], ["PC-TRAVA-REV", 1], ["PC-TRAVA-CIL", 2], ["PC-ALAV-TRINCO", 1], ["PC-CHAVE", 2], ["PC-ESPELHO-ACO", 2],
    ["PC-CUBO-NOZ", 1], ["PC-LINGUETA", 1], ["PC-TRINCO", 1], ["PC-ALAV-GORGE", 1], ["PC-NARIZ", 2], ["PC-TAMBOR", 1], ["PC-CILINDRO", 2],
    ["IN-MOLA-NOZ", 1], ["IN-MOLA-TRINCO", 1], ["IN-MOLA-LING", 2], ["IN-PINO-SEG", 10], ["IN-CONTRA-PINO", 10], ["IN-MOLA-TRAVA-CIL", 2],
    ["IN-MOLA-CPINO", 10], ["IN-ARGOLA", 1], ["IN-TAMPA-TAMBOR", 2], ["IN-PAR-35X20", 2], ["IN-PAR-3X12", 7], ["IN-PAR-M4X50", 1],
    ["IN-ESPACADOR", 2], ["IN-BALMAZ", 1], ["IN-CX-PAPELAO", 1], ["IN-SACOLA", 1], ["IN-VERNIZ", 1], ["IN-ETIQUETA", 1],
  ]],
  ["CJ-INT", "Corpo fechadura interna", [...COMUM_INT, ["PC-CHAVE-INT", 2]]],
  ["CJ-WC", "Corpo fechadura banheiro", [...COMUM_INT, ["PC-CHAVE-EMERG", 1], ["PC-NOZ-TRANQ", 1], ["PC-CHAVE-WC", 1]]],
];

// espelhos e maçanetas: custo informado na planilha (estrutura de matéria-prima ainda não cadastrada)
const ESPELHOS = { "400LO": 1.75, "403LO": 1.85, "400PT": 1.4, "403PT": 1.65 };
const MACANETAS = {
  LO: { 900: 3.97, 902: 5.35, 904: 4.75, 905: 6.98 },
  PT: { 900: 3.77, 902: 5.15, 904: 4.55, 905: 6.53 },
};
const LINHAS = [["EXT", "Externa", "CJ-EXT"], ["INT", "Interna", "CJ-INT"], ["WC", "Banheiro", "CJ-WC"]];

export async function carregarFechaduras(prisma) {
  const id = {};
  async function item(codigo, data) {
    const ex = await prisma.item.findUnique({ where: { codigo } });
    id[codigo] = ex ? ex.id : (await prisma.item.create({ data: { codigo, ...data } })).id;
    return !ex;
  }
  async function estrutura(pai, comps, novo) {
    if (!novo) return;
    for (const [c, q] of comps) await prisma.componente.create({ data: { paiId: id[pai], filhoId: id[c], quantidade: q } });
  }
  for (const [c, nome, unidade, preco] of MP) await item(c, { nome, tipo: "materia_prima", origem: "comprado", unidade, precoCompra: preco });
  for (const [c, nome, preco] of INSUMOS) await item(c, { nome, tipo: "insumo", origem: "comprado", precoCompra: preco });
  for (const [c, nome, mp, kg] of PECAS) {
    const novo = await item(c, { nome, tipo: "peca", origem: "fabricado", diasFabricacao: 2, setor: mp === "MP-ZAMAC" ? "Injeção" : "Estamparia" });
    await estrutura(c, [[mp, kg]], novo);
  }
  for (const [c, nome, comps] of CORPOS) {
    const novo = await item(c, { nome, tipo: "conjunto", origem: "fabricado", diasFabricacao: 1, setor: "Montagem" });
    await estrutura(c, comps, novo);
  }
  for (const [k, custo] of Object.entries(ESPELHOS)) {
    await item(`ESP-${k}`, { nome: `Espelho ${k.slice(0, 3)} ${k.slice(3)}`, tipo: "peca", origem: "fabricado", precoCompra: custo, diasFabricacao: 2, setor: "Estamparia",
      observacao: "Custo da planilha. Cadastre a matéria-prima para o sistema verificar o estoque dela." });
  }
  for (const [acab, m] of Object.entries(MACANETAS)) for (const [mod, custo] of Object.entries(m)) {
    await item(`MAC-${mod}${acab}`, { nome: `Maçaneta ${mod} ${acab}`, tipo: "peca", origem: "fabricado", precoCompra: custo, diasFabricacao: 2, setor: "Injeção",
      observacao: "Custo da planilha. Cadastre a matéria-prima para o sistema verificar o estoque dela." });
  }
  for (const [sig, nomeLinha, corpo] of LINHAS) for (const esp of ["400", "403"]) for (const acab of ["LO", "PT"]) for (const mod of [900, 902, 904, 905]) {
    const codigo = `FM-${sig}${esp}${acab}${mod}`;
    // mesma conta da aba "Valor Fechaduras": custo × 2,1 (imposto, energia, frete, MO, lucro) + 8%
    const custo = await custoMaterial(prisma, [id[corpo], id[`ESP-${esp}${acab}`], id[`MAC-${mod}${acab}`]]);
    const novo = await item(codigo, { nome: `Fechadura ${nomeLinha} ${esp} ${acab} maç. ${mod}`, tipo: "produto", origem: "fabricado", diasFabricacao: 1, setor: "Montagem",
      precoVenda: Math.round(custo * 2.1 * 1.08 * 100) / 100 });
    await estrutura(codigo, [[corpo, 1], [`ESP-${esp}${acab}`, 1], [`MAC-${mod}${acab}`, 1]], novo);
  }

  // setor de quem já existia sem setor
  const setores = { "MP-ZAMAC": "Injeção", "MP-ACO-9": "Estamparia", "MP-ACO-10": "Estamparia" };
  for (const [c, , mp] of PECAS) await prisma.item.updateMany({ where: { codigo: c, setor: null }, data: { setor: setores[mp] } });
  await prisma.item.updateMany({ where: { tipo: { in: ["produto", "conjunto"] }, setor: null }, data: { setor: "Montagem" } });
  await prisma.item.updateMany({ where: { codigo: { startsWith: "MAC-" }, setor: null }, data: { setor: "Injeção" } });
  await prisma.item.updateMany({ where: { codigo: { startsWith: "ESP-" }, setor: null }, data: { setor: "Estamparia" } });

  // preço de hoje da planilha vira o primeiro ponto do histórico de preços (só para quem ainda não tem histórico)
  const comprados = await prisma.item.findMany({ where: { origem: "comprado", precoCompra: { not: null } }, include: { _count: { select: { precos: true } } } });
  const br = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const hoje = new Date(`${br}T12:00:00Z`);
  for (const it of comprados) {
    if (it._count.precos) continue;
    await prisma.precoHistorico.create({ data: { itemId: it.id, fornecedorId: it.fornecedorId, preco: it.precoCompra, data: hoje, origem: "planilha", usuario: "Planilha de custos" } });
  }
}

async function custoMaterial(prisma, ids) {
  let t = 0;
  for (const i of ids) {
    const it = await prisma.item.findUnique({ where: { id: i }, include: { componentes: true } });
    t += it.componentes.length ? await somaComp(prisma, it.componentes) : it.precoCompra ?? 0;
  }
  return t;
}
async function somaComp(prisma, comps) {
  let t = 0;
  for (const c of comps) t += c.quantidade * (await custoMaterial(prisma, [c.filhoId]));
  return t;
}
