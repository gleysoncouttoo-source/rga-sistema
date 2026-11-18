// Carga inicial: perfis, usuário administrador, etapas e operações
// (tempos vindos da planilha "Custo MO por Peça", anotados em 18 a 20 de julho)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { carregarFechaduras } from "./fechaduras.mjs";
import { carregarRoteiros } from "./roteiros.mjs";
import { carregarFotos } from "./fotos.mjs";

const prisma = new PrismaClient();

const TODOS = ["ver", "criar", "editar", "excluir", "aprovar", "exportar", "ver_salario"];
const MODULOS = ["painel", "funcionarios", "producao", "custos", "usuarios", "vendas", "estoque", "compras", "financeiro", "produtos", "historico"];

const perfis = {
  Diretor: Object.fromEntries(MODULOS.map((m) => [m, TODOS])),
  Gestor: {
    painel: ["ver"],
    funcionarios: ["ver", "criar", "editar", "ver_salario"],
    producao: ["ver", "criar", "editar", "aprovar", "exportar"],
    custos: ["ver"],
    vendas: ["ver", "criar", "editar", "aprovar"],
    estoque: ["ver", "criar", "editar"],
    compras: ["ver", "criar", "editar", "aprovar"],
    financeiro: ["ver", "criar", "editar"],
    produtos: ["ver", "criar", "editar"],
    historico: ["ver"],
  },
  // para quem cria a conta pela tela "Criar conta" como colaborador; o diretor ainda escolhe as abas ao liberar
  Colaborador: {
    painel: ["ver"],
    producao: ["ver", "criar"],
    produtos: ["ver"],
    estoque: ["ver"],
  },
};
// módulos novos: entram nos perfis que já existem sem mexer no que foi personalizado
const NOVOS = ["vendas", "estoque", "compras", "financeiro", "produtos", "historico"];

// [etapa, operação, qtd de peças, minutos, observação]
const operacoes = [
  ["Estamparia", "Estampa testa", 500, 30],
  ["Estamparia", "Estampa contra-testa", 500, 30, "Sai 2 peças por estampagem"],
  ["Estamparia", "Estampa tampa (todos os tamanhos)", 1600, 60],
  ["Estamparia", "Estampa caixa residencial", 1600, 60],
  ["Solda", "Solda testa", 100, 60],
  ["Injeção", "Maçaneta 900", 150, 60],
  ["Injeção", "Maçaneta 905", 170, 60],
  ["Injeção", "Maçaneta 902", 200, 60],
  ["Injeção", "Tampa 905", 300, 60],
  ["Injeção", "Lingueta residencial", 300, 60],
  ["Injeção", "Trinco residencial", 300, 60],
  ["Injeção", "Tambor residencial", 120, 60],
  ["Injeção", "Cilindro", 180, 60],
  ["Usinagem", "Brocha tambor", 500, 60],
  ["Polimento", "Polimento espelho", 250, 60, "Tempo estimado"],
  ["Polimento", "Maçaneta 900", 200, 60, "Tempo estimado"],
  ["Polimento", "Maçaneta 905", 200, 60, "Tempo estimado"],
  ["Polimento", "Maçaneta 902 (lixa)", 250, 60, "Tempo estimado — lixa"],
  ["Banho de zinco", "Banho de zinco (lote)", null, 40, "35 a 40 min por lote. Falta informar peças por lote", true],
  ["Banho de zinco", "Banho de zinco — espelho (lote)", null, 10, "10 min por lote. Falta informar peças por lote", true],
];
const etapas = ["Estamparia", "Solda", "Injeção", "Usinagem", "Polimento", "Pintura", "Lixa", "Verniz", "Banho de zinco", "Montagem"];

async function main() {
  for (const [nome, p] of Object.entries(perfis)) {
    await prisma.perfil.upsert({
      where: { nome },
      update: {},
      create: { nome, permissoes: JSON.stringify(p) },
    });
  }
  for (const perfil of await prisma.perfil.findMany()) {
    const atual = JSON.parse(perfil.permissoes || "{}");
    const base = perfis[perfil.nome];
    if (!base || NOVOS.every((m) => m in atual)) continue;
    for (const m of NOVOS) if (!(m in atual) && base[m]) atual[m] = base[m];
    await prisma.perfil.update({ where: { id: perfil.id }, data: { permissoes: JSON.stringify(atual) } });
  }

  const config = { horasMes: "220", encargosPct: "0", minutosMinimoRecorde: "30", folgaCompraDias: "2", maxBoletosDia: "2", prazoEntregaPadrao: "10", salarioDiaUtil: "5" };
  for (const [chave, valor] of Object.entries(config)) {
    await prisma.configuracao.upsert({ where: { chave }, update: {}, create: { chave, valor } });
  }

  // Login inicial só é criado se ADMIN_EMAIL e ADMIN_SENHA estiverem definidos.
  // Sem eles, o primeiro acesso é criado pela tela /primeiro-acesso (só funciona enquanto não existe nenhum login).
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const senha = process.env.ADMIN_SENHA;
  if (email && senha) {
    const diretor = await prisma.perfil.findUnique({ where: { nome: "Diretor" } });
    const existe = await prisma.usuario.findUnique({ where: { email } });
    if (!existe) {
      await prisma.usuario.create({
        data: { nome: "Administrador", email, senhaHash: await bcrypt.hash(senha, 10), perfilId: diretor.id },
      });
      console.log(`Login inicial criado: ${email}`);
    }
  }

  for (const [i, nome] of etapas.entries()) {
    await prisma.etapa.upsert({ where: { nome }, update: { ordem: i }, create: { nome, ordem: i } });
  }
  for (const [etapaNome, nome, qtd, min, obs, porLote] of operacoes) {
    const etapa = await prisma.etapa.findUnique({ where: { nome: etapaNome } });
    const seg = qtd ? (min * 60) / qtd : null;
    const existente = await prisma.operacao.findUnique({ where: { etapaId_nome: { etapaId: etapa.id, nome } } });
    if (existente) continue;
    const op = await prisma.operacao.create({
      data: { etapaId: etapa.id, nome, recordeSegPorPeca: seg, observacao: obs ?? null, porLote: !!porLote },
    });
    if (seg) {
      await prisma.recorde.create({ data: { operacaoId: op.id, segPorPeca: seg, status: "inicial", decididoPor: "Planilha de julho" } });
    }
  }
  for (const nome of ["Bradesco", "Santander"]) await prisma.contaBancaria.upsert({ where: { nome }, update: {}, create: { nome } });
  await carregarFechaduras(prisma);
  await carregarRoteiros(prisma);
  await carregarFotos(prisma);
  // aba Fornecedores: item que já tem fornecedor aparece na lista dele (só cria o que falta)
  const ligados = await prisma.item.findMany({ where: { fornecedorId: { not: null }, ativo: true }, select: { id: true, fornecedorId: true, precoCompra: true, loteMinimo: true } });
  if (ligados.length) {
    await prisma.fornecedorItem.createMany({
      data: ligados.map((i) => ({ fornecedorId: i.fornecedorId, itemId: i.id, preco: i.precoCompra, compraMinima: i.loteMinimo })),
      skipDuplicates: true,
    });
  }
  console.log("Carga inicial concluída.");
}

main().finally(() => prisma.$disconnect());
