"use server";
// Produtos, peças, estrutura e processo (passos) de cada peça
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir, usuarioAtual } from "@/lib/auth";
import { pode, type Acao, type Modulo } from "@/lib/permissoes";

async function exigirAlgum(l: [Modulo, Acao][]) {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (!l.some(([m, a]) => pode(u.permissoes, m, a))) redirect("/?sem-permissao=1");
  return u;
}

const nn = (v: FormDataEntryValue | null) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const txt = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;
const volta = (id: number, k: "erro" | "ok", m: string) => redirect(`/produtos/${id}?${k}=` + encodeURIComponent(m));

export async function acaoNovoItem(form: FormData) {
  const u = await exigir("produtos", "criar");
  const nome = txt(form.get("nome")), tipo = String(form.get("tipo") || "produto");
  if (!nome) redirect("/produtos?erro=" + encodeURIComponent("Informe o nome."));
  let id = 0;
  try {
    const it = await db.item.create({
      data: {
        nome: nome!, tipo, codigo: txt(form.get("codigo")), foto: txt(form.get("foto")), precoVenda: form.get("precoVenda") ? nn(form.get("precoVenda")) : null,
        origem: "fabricado", setor: tipo === "produto" || tipo === "conjunto" ? "Montagem" : txt(form.get("setor")),
      },
    });
    id = it.id;
  } catch {
    redirect("/produtos?erro=" + encodeURIComponent("Já existe um item com esse SKU/código."));
  }
  await auditar(u.nome, "criou item", nome!);
  redirect(`/produtos/${id}?ok=` + encodeURIComponent("Criado. Agora cadastre as peças que vão nele e o processo."));
}

export async function acaoSalvarItem(form: FormData) {
  const u = await exigir("produtos", "editar");
  const id = nn(form.get("id"));
  try {
    await db.item.update({
      where: { id },
      data: {
        nome: String(form.get("nome")).trim(), codigo: txt(form.get("codigo")), foto: txt(form.get("foto")),
        precoVenda: form.get("precoVenda") ? nn(form.get("precoVenda")) : null, setor: txt(form.get("setor")), observacao: txt(form.get("obs")),
        diasFabricacao: Math.max(0, Math.round(nn(form.get("diasFabricacao")))),
      },
    });
  } catch {
    volta(id, "erro", "Já existe outro item com esse SKU/código.");
  }
  await auditar(u.nome, "editou produto/peça", `#${id}`);
  revalidatePath(`/produtos/${id}`);
  volta(id, "ok", "Salvo.");
}

/** Exclui de vez quando nunca foi usado; senão só tira das listas (fica no histórico de vendas, compras e produção). */
export async function acaoExcluirItem(form: FormData) {
  const u = await exigirAlgum([["produtos", "excluir"], ["estoque", "excluir"]]);
  const id = nn(form.get("id"));
  const destino = String(form.get("volta") || "/produtos");
  const it = await db.item.findUniqueOrThrow({ where: { id }, include: { _count: { select: { usadoEm: true, vendas: true, compras: true, apontamentos: true, lotes: true, movimentos: true, reservas: true, necessidades: true, anuncios: true } } } });
  const c = it._count;
  if (c.usadoEm) {
    const pais = await db.componente.findMany({ where: { filhoId: id, pai: { ativo: true } }, include: { pai: true }, take: 3 });
    if (pais.length) redirect(`${destino}${destino.includes("?") ? "&" : "?"}erro=` + encodeURIComponent(`${it.nome} faz parte de ${pais.map((p) => p.pai.codigo ?? p.pai.nome).join(", ")}${c.usadoEm > 3 ? "…" : ""}. Tire da estrutura deles antes.`));
  }
  if (c.vendas + c.compras + c.apontamentos + c.lotes + c.movimentos + c.reservas + c.necessidades + c.anuncios + c.usadoEm === 0) {
    await db.item.delete({ where: { id } });
  } else {
    await db.item.update({ where: { id }, data: { ativo: false, codigo: it.codigo ? `${it.codigo} (excluído ${id})` : null } });
  }
  await auditar(u.nome, "excluiu item", it.nome);
  revalidatePath("/produtos");
  redirect(`${destino.startsWith("/produtos/") ? "/produtos" : destino}${destino.includes("?") ? "&" : "?"}ok=` + encodeURIComponent(`${it.nome} excluído.`));
}

export async function acaoComponente(form: FormData) {
  await exigir("produtos", "editar");
  const paiId = nn(form.get("id")), filhoId = nn(form.get("filhoId")), q = nn(form.get("quantidade"));
  if (form.get("remover")) await db.componente.delete({ where: { paiId_filhoId: { paiId, filhoId } } });
  else if (filhoId && q > 0 && filhoId !== paiId) await db.componente.upsert({ where: { paiId_filhoId: { paiId, filhoId } }, update: { quantidade: q }, create: { paiId, filhoId, quantidade: q } });
  revalidatePath(`/produtos/${paiId}`);
}

// ───── processo (passos) ─────
async function renumerar(itemId: number) {
  const ps = await db.passo.findMany({ where: { itemId }, orderBy: [{ ordem: "asc" }, { id: "asc" }] });
  for (const [i, p] of ps.entries()) if (p.ordem !== i + 1) await db.passo.update({ where: { id: p.id }, data: { ordem: i + 1 } });
}
async function ligarCusto(itemId: number) {
  // a mão de obra do produto soma as operações do processo de cada peça (Custos e Lucros)
  const ps = await db.passo.findMany({ where: { itemId } });
  const ops = new Set(ps.map((p) => p.operacaoId));
  for (const o of ops) await db.itemOperacao.upsert({ where: { itemId_operacaoId: { itemId, operacaoId: o } }, update: { sugerida: false }, create: { itemId, operacaoId: o } });
  if (ops.size) await db.itemOperacao.deleteMany({ where: { itemId, operacaoId: { notIn: [...ops] } } });
}

export async function acaoPasso(form: FormData) {
  const u = await exigir("produtos", "editar");
  const itemId = nn(form.get("itemId")), pagina = nn(form.get("pagina")) || itemId;
  const acao = String(form.get("acao"));
  if (acao === "add") {
    let operacaoId = nn(form.get("operacaoId"));
    const nome = txt(form.get("novaOperacao")), etapaId = nn(form.get("etapaId"));
    if (!operacaoId && nome && etapaId) {
      const op = await db.operacao.upsert({ where: { etapaId_nome: { etapaId, nome } }, update: { ativo: true }, create: { etapaId, nome } });
      operacaoId = op.id;
    }
    if (!operacaoId) volta(pagina, "erro", "Escolha uma operação ou escreva o nome de uma nova (com a etapa).");
    const ult = await db.passo.findFirst({ where: { itemId }, orderBy: { ordem: "desc" } });
    await db.passo.create({ data: { itemId, operacaoId, ordem: (ult?.ordem ?? 0) + 1 } });
  } else if (acao === "remover") {
    const id = nn(form.get("passoId"));
    const usado = (await db.apontamento.count({ where: { passoId: id } })) + (await db.processoProducao.count({ where: { passoId: id, status: "andamento" } }));
    if (usado) volta(pagina, "erro", "Esse processo já tem produção lançada. Não dá para tirar (o histórico dos lotes usa ele).");
    await db.passo.delete({ where: { id } });
  } else if (acao === "subir" || acao === "descer") {
    const id = nn(form.get("passoId"));
    const ps = await db.passo.findMany({ where: { itemId }, orderBy: { ordem: "asc" } });
    const i = ps.findIndex((p) => p.id === id), j = acao === "subir" ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < ps.length) {
      await db.passo.update({ where: { id: ps[i].id }, data: { ordem: ps[j].ordem } });
      await db.passo.update({ where: { id: ps[j].id }, data: { ordem: ps[i].ordem } });
    }
  }
  await renumerar(itemId);
  await ligarCusto(itemId);
  await auditar(u.nome, "alterou processo", `item #${itemId}`);
  revalidatePath(`/produtos/${pagina}`);
}
