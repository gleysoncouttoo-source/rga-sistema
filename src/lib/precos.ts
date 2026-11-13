// Histórico de preços de compra: valor pago hoje, recorde (menor preço já pago) e variação em 30/60/90 dias.
import type { Prisma } from "@prisma/client";
import { db } from "./db";

type Tx = Prisma.TransactionClient;
const DIA = 86_400_000;

/** Grava um preço. Se for o mais recente, vira o preço atual do item. Diz se bateu o recorde de menor preço. */
export async function registrarPreco(tx: Tx, p: {
  itemId: number; preco: number; data: Date; origem: string; fornecedorId?: number | null; pedidoCompraId?: number | null; usuario?: string;
}) {
  const recordeAntes = await tx.precoHistorico.aggregate({ where: { itemId: p.itemId }, _min: { preco: true } });
  const maisNovo = await tx.precoHistorico.findFirst({ where: { itemId: p.itemId, data: { gt: p.data } } });
  await tx.precoHistorico.create({ data: { ...p, fornecedorId: p.fornecedorId ?? null, pedidoCompraId: p.pedidoCompraId ?? null } });
  if (!maisNovo) await tx.item.update({ where: { id: p.itemId }, data: { precoCompra: p.preco } });
  const antes = recordeAntes._min.preco;
  return { novoRecorde: antes != null && p.preco < antes - 1e-9 };
}

export type LinhaPreco = {
  id: number; codigo: string | null; nome: string; tipo: string; unidade: string; fornecedor: string | null;
  atual: number | null; atualData: Date | null;
  recorde: { preco: number; data: Date; fornecedor: string | null } | null;
  periodos: { dias: number; preco: number | null; variacao: number | null }[];
  registros: number;
};

/** preço vigente N dias atrás = último preço registrado até aquela data */
export async function tabelaPrecos(): Promise<LinhaPreco[]> {
  const [itens, hist] = await Promise.all([
    db.item.findMany({ where: { origem: "comprado", ativo: true }, include: { fornecedor: true }, orderBy: [{ tipo: "asc" }, { nome: "asc" }] }),
    db.precoHistorico.findMany({ include: { fornecedor: true }, orderBy: { data: "asc" } }),
  ]);
  const porItem = new Map<number, typeof hist>();
  for (const h of hist) porItem.set(h.itemId, [...(porItem.get(h.itemId) ?? []), h]);
  const agora = Date.now();
  return itens.map((it) => {
    const hs = porItem.get(it.id) ?? [];
    const ult = hs.at(-1);
    const atual = ult?.preco ?? it.precoCompra;
    const rec = hs.reduce<(typeof hs)[number] | null>((m, h) => (!m || h.preco < m.preco ? h : m), null);
    const periodos = [30, 60, 90].map((dias) => {
      const corte = agora - dias * DIA;
      const antes = hs.filter((h) => h.data.getTime() <= corte).at(-1);
      const preco = antes?.preco ?? null;
      return { dias, preco, variacao: preco && atual != null ? (atual - preco) / preco : null };
    });
    return {
      id: it.id, codigo: it.codigo, nome: it.nome, tipo: it.tipo, unidade: it.unidade, fornecedor: it.fornecedor?.nome ?? null,
      atual, atualData: ult?.data ?? null,
      recorde: rec ? { preco: rec.preco, data: rec.data, fornecedor: rec.fornecedor?.nome ?? null } : null,
      periodos, registros: hs.length,
    };
  });
}
