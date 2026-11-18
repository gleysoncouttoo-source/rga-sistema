import { db } from "@/lib/db";

/** Fornecedor digitado no cadastro: acha pelo nome (sem diferenciar maiúsculas) ou cria um novo. Vazio = sem fornecedor. */
export async function fornecedorPorNome(nome: FormDataEntryValue | null, prazoEntregaDias?: number | null): Promise<number | null> {
  const n = String(nome ?? "").trim().replace(/\s+/g, " ");
  if (!n) return null;
  const achado = await db.fornecedor.findFirst({ where: { nome: { equals: n, mode: "insensitive" } }, orderBy: { ativo: "desc" } });
  const prazo = prazoEntregaDias != null && Number.isFinite(prazoEntregaDias) ? Math.max(0, Math.round(prazoEntregaDias)) : null;
  if (achado) {
    const data: { ativo?: boolean; prazoEntregaDias?: number } = {};
    if (!achado.ativo) data.ativo = true;
    if (prazo != null && prazo !== achado.prazoEntregaDias) data.prazoEntregaDias = prazo;
    if (Object.keys(data).length) await db.fornecedor.update({ where: { id: achado.id }, data });
    return achado.id;
  }
  const novo = await db.fornecedor.create({ data: { nome: n, ...(prazo != null ? { prazoEntregaDias: prazo } : {}) } });
  return novo.id;
}

/** Garante que o item aparece na lista do fornecedor (aba Fornecedores). Preço e compra mínima informados no cadastro do item atualizam a lista; prazos combinados ficam como estão. */
export async function garantirOferta(fornecedorId: number | null, itemId: number, p: { preco?: number | null; compraMinima?: number | null } = {}) {
  if (!fornecedorId) return;
  await db.fornecedorItem.upsert({
    where: { fornecedorId_itemId: { fornecedorId, itemId } },
    update: { ...(p.preco != null ? { preco: p.preco } : {}), ...(p.compraMinima != null ? { compraMinima: p.compraMinima } : {}) },
    create: { fornecedorId, itemId, preco: p.preco ?? null, compraMinima: p.compraMinima ?? null },
  });
}
