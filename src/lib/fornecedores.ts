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
