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

// ───────── Cadastro completo do fornecedor ─────────

/** Número digitado do jeito brasileiro: "9,50", "1.000", "1.000,5" ou "9.5". Vazio = null. */
export function numeroBr(v: FormDataEntryValue | null | undefined): number | null {
  let s = String(v ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const x = Number(s);
  return Number.isFinite(x) && x >= 0 ? x : null;
}
const txt = (v: FormDataEntryValue | null) => String(v ?? "").trim().replace(/\s+/g, " ") || null;
/** "28", "28/42/56", "28 42 56" → "28/42/56". Vazio = null. */
export function prazosTexto(v: FormDataEntryValue | null): string | null {
  const n = String(v ?? "").split(/[^0-9]+/).filter(Boolean).map(Number).filter((x) => x >= 0 && x <= 365);
  return n.length ? n.join("/") : null;
}

/** Campos do fornecedor vindos do formulário (cadastro e edição usam o mesmo). */
export function dadosFornecedor(form: FormData) {
  const ent = numeroBr(form.get("prazoEntregaDias"));
  return {
    nome: txt(form.get("nome")) ?? "",
    razaoSocial: txt(form.get("razaoSocial")), cnpj: txt(form.get("cnpj")), inscricaoEstadual: txt(form.get("inscricaoEstadual")), categoria: txt(form.get("categoria")),
    contato: txt(form.get("contato")), telefone: txt(form.get("telefone")), whatsapp: txt(form.get("whatsapp")), email: txt(form.get("email")), site: txt(form.get("site")),
    cep: txt(form.get("cep")), endereco: txt(form.get("endereco")), bairro: txt(form.get("bairro")), cidade: txt(form.get("cidade")), uf: txt(form.get("uf"))?.toUpperCase().slice(0, 2) ?? null,
    formaPagamento: txt(form.get("formaPagamento")), prazoPagamento: prazosTexto(form.get("prazoPagamento")) ?? "28", prazoEntregaDias: ent == null ? 7 : Math.round(ent),
    frete: txt(form.get("frete")), valorFrete: numeroBr(form.get("valorFrete")), pedidoMinimo: numeroBr(form.get("pedidoMinimo")),
    chavePix: txt(form.get("chavePix")), banco: txt(form.get("bancoDados")), observacao: txt(form.get("obs")),
  };
}

/** Linhas de matéria-prima do formulário (campos repetidos mp_*; linha sem item é ignorada). */
export function itensDoForm(form: FormData) {
  const ids = form.getAll("mp_item"), g = (k: string) => form.getAll(k);
  const [pr, pg, en, mi, co] = [g("mp_preco"), g("mp_pagamento"), g("mp_entrega"), g("mp_minima"), g("mp_codigo")];
  const vistos = new Set<number>();
  return ids.flatMap((v, i) => {
    const itemId = Number(v);
    if (!itemId || vistos.has(itemId)) return [];
    vistos.add(itemId);
    const ent = numeroBr(en[i]);
    return [{ itemId, preco: numeroBr(pr[i]), prazoPagamento: prazosTexto(pg[i] ?? null), prazoEntregaDias: ent == null ? null : Math.round(ent), compraMinima: numeroBr(mi[i]), codigoFornecedor: txt(co[i] ?? null) }];
  });
}

const ORDEM_TIPO = ["materia_prima", "insumo", "peca", "conjunto"];
const NOME_TIPO: Record<string, string> = { materia_prima: "Matéria-prima", insumo: "Insumo", peca: "Peça comprada", conjunto: "Conjunto comprado" };

/** Itens comprados para escolher na lista suspensa com foto (matéria-prima primeiro). */
export async function opcoesItensCompra(jaNaLista: Set<number> = new Set()) {
  const its = await db.item.findMany({ where: { ativo: true, origem: "comprado", tipo: { not: "produto" } }, include: { fornecedor: { select: { nome: true } } } });
  return its
    .sort((a, b) => (ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo)) || a.nome.localeCompare(b.nome))
    .map((i) => ({
      valor: String(i.id), titulo: i.nome, foto: i.foto, grupo: NOME_TIPO[i.tipo] ?? i.tipo, desativada: jaNaLista.has(i.id), unidade: i.unidade,
      sub: [i.codigo, i.unidade, jaNaLista.has(i.id) ? "já está na lista" : i.fornecedor ? `hoje compra de ${i.fornecedor.nome}` : "sem fornecedor"].filter(Boolean).join(" · "),
    }));
}
