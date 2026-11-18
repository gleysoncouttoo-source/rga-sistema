import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { dadosFornecedor, itensDoForm, opcoesItensCompra } from "@/lib/fornecedores";
import { registrarPreco } from "@/lib/precos";
import { dia } from "@/lib/datas";
import AbasCompras from "@/components/AbasCompras";
import FormFornecedor from "@/components/FormFornecedor";

async function criar(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const dados = dadosFornecedor(form);
  if (!dados.nome) redirect("/compras/fornecedores/novo?erro=" + encodeURIComponent("Informe o nome do fornecedor."));
  const existe = await db.fornecedor.findFirst({ where: { nome: { equals: dados.nome, mode: "insensitive" } } });
  if (existe?.ativo) redirect("/compras/fornecedores/novo?erro=" + encodeURIComponent(`Já existe o fornecedor ${existe.nome}. Abra ele na lista para editar.`));
  const f = existe ? await db.fornecedor.update({ where: { id: existe.id }, data: { ...dados, ativo: true } }) : await db.fornecedor.create({ data: dados });
  const linhas = itensDoForm(form);
  for (const l of linhas) {
    const { itemId, ...cond } = l;
    await db.fornecedorItem.upsert({ where: { fornecedorId_itemId: { fornecedorId: f.id, itemId } }, update: cond, create: { fornecedorId: f.id, ...l } });
    // item sem fornecedor passa a comprar deste (preço e compra mínima vão para o item)
    const it = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    if (!it.fornecedorId) {
      await db.item.update({ where: { id: itemId }, data: { fornecedorId: f.id, ...(l.compraMinima != null ? { loteMinimo: l.compraMinima } : {}) } });
      if (l.preco != null && l.preco !== it.precoCompra) await db.$transaction((tx) => registrarPreco(tx, { itemId, preco: l.preco!, data: dia(), origem: "manual", fornecedorId: f.id, usuario: u.nome }));
    }
  }
  await auditar(u.nome, "criou fornecedor", `${dados.nome}${linhas.length ? ` com ${linhas.length} matéria(s)-prima(s)` : ""}`);
  revalidatePath("/compras/fornecedores");
  redirect(`/compras/fornecedores/${f.id}?ok=` + encodeURIComponent(`${dados.nome} cadastrado${linhas.length ? ` com ${linhas.length} matéria(s)-prima(s)` : ""}.`));
}

export default async function NovoFornecedor({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await exigir("compras", "editar");
  const sp = await searchParams;
  const itens = await opcoesItensCompra();
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="fornecedores" />
      <Link href="/compras/fornecedores" className="suave">← Todos os fornecedores</Link>
      <h2 style={{ margin: "4px 0 12px" }}>Novo fornecedor</h2>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      <div className="card">
        <FormFornecedor acao={criar} itens={itens} comItens textoBotao="Cadastrar fornecedor" />
      </div>
    </>
  );
}
