// Atualização pela planilha "Tabela Atualizada 11.2026" (enviada em 27/11/2026).
// Roda uma única vez (marca em Configuracao "planilhaCustosAplicada"), então não desfaz o que for alterado depois no sistema.
// - preço da matéria-prima: aço 9 → 9,63/kg, aço 10 → 10,70/kg, zamac 32 → 36/kg (entra no histórico de preços)
// - componentes dos 3 corpos conferidos com a aba "Fechaduras" (só acerta quantidade e põe o que faltar; não tira nada)
// - preço de venda NÃO muda (fica o do site). Se uma prévia já tinha trocado, volta ao valor de antes.
import { CORPOS, ESPELHOS, MACANETAS } from "./fechaduras.mjs";

const VERSAO = "2026-11b"; // "b": preço de venda fica o do site (pedido de 28/11)
const QUEM = "Planilha Tabela Atualizada 11.2026";

const MP = [
  ["MP-ACO-9", 9.63, "Aço (R$ 9/kg)", "Aço (R$ 9,63/kg)"],
  ["MP-ACO-10", 10.7, "Aço (R$ 10/kg)", "Aço (R$ 10,70/kg)"],
  ["MP-ZAMAC", 36],
];
// custo do corpo como está na planilha (coluna Externa)
const CORPO_PLANILHA = { EXT: 14.74, INT: 9.95, WC: 9.84 };
export const FATOR_VENDA = 1 + 0.2 + 0.2 + 0.1 + 0.2 + 0.3; // 2,0

export function precoPlanilha(sig, esp, acab, mod) {
  const custo = CORPO_PLANILHA[sig] + ESPELHOS[`${esp}${acab}`] + MACANETAS[acab][mod];
  return Math.round(custo * FATOR_VENDA * 1.08 * 100) / 100;
}

const br = (n) => (n == null ? null : String(n).replace(".", ","));

export async function aplicarPlanilha2026_11(prisma) {
  // na Vercel só aplica na publicação de verdade (main), nunca na prévia de um PR
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return;
  const feito = await prisma.configuracao.findUnique({ where: { chave: "planilhaCustosAplicada" } });
  if (feito?.valor === VERSAO) return;
  const log = [];
  const alt = (it, campo, antes, depois) => log.push({ usuario: QUEM, acao: "alterou", tabela: "Item", registroId: String(it.id), registro: it.nome, campo, antes: br(antes), depois: br(depois) });

  const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const hoje = new Date(`${dia}T12:00:00Z`);
  for (const [codigo, preco, nomeVelho, nomeNovo] of MP) {
    const it = await prisma.item.findUnique({ where: { codigo } });
    if (!it) continue;
    const data = {};
    if (it.precoCompra !== preco) { data.precoCompra = preco; alt(it, "precoCompra", it.precoCompra, preco); }
    if (nomeNovo && it.nome === nomeVelho) { data.nome = nomeNovo; alt(it, "nome", it.nome, nomeNovo); }
    if (Object.keys(data).length) await prisma.item.update({ where: { id: it.id }, data });
    if (data.precoCompra != null) await prisma.precoHistorico.create({ data: { itemId: it.id, fornecedorId: it.fornecedorId, preco, data: hoje, origem: "planilha", usuario: QUEM } });
  }

  const porCodigo = async (c) => prisma.item.findUnique({ where: { codigo: c } });
  for (const [codigo, , comps] of CORPOS) {
    const pai = await porCodigo(codigo);
    if (!pai) continue;
    for (const [c, q] of comps) {
      const filho = await porCodigo(c);
      if (!filho) continue;
      const atual = await prisma.componente.findUnique({ where: { paiId_filhoId: { paiId: pai.id, filhoId: filho.id } } });
      if (!atual) {
        await prisma.componente.create({ data: { paiId: pai.id, filhoId: filho.id, quantidade: q } });
        alt(pai, `componente ${filho.nome}`, null, q);
      } else if (atual.quantidade !== q) {
        await prisma.componente.update({ where: { id: atual.id }, data: { quantidade: q } });
        alt(pai, `componente ${filho.nome}`, atual.quantidade, q);
      }
    }
  }

  // preço de venda: volta o de antes onde a primeira versão desta atualização trocou (e ninguém mexeu depois)
  const trocas = await prisma.alteracao.findMany({ where: { usuario: QUEM, tabela: "Item", campo: "precoVenda" }, orderBy: { id: "asc" } });
  const num = (t) => (t == null ? null : Number(String(t).replace(",", ".")));
  for (const a of trocas) {
    const it = await prisma.item.findUnique({ where: { id: Number(a.registroId) } });
    if (!it || it.precoVenda !== num(a.depois)) continue;
    await prisma.item.update({ where: { id: it.id }, data: { precoVenda: num(a.antes) } });
    alt(it, "precoVenda", it.precoVenda, num(a.antes));
  }

  if (log.length) await prisma.alteracao.createMany({ data: log });
  await prisma.configuracao.upsert({ where: { chave: "planilhaCustosAplicada" }, update: { valor: VERSAO }, create: { chave: "planilhaCustosAplicada", valor: VERSAO } });
  console.log(`Planilha ${VERSAO}: ${log.length} alterações.`);
}
