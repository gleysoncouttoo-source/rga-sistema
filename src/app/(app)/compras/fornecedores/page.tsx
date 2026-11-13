import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerPrazos } from "@/lib/planejamento";
import AbasCompras from "@/components/AbasCompras";
import Excluir from "@/components/Excluir";

async function excluir(form: FormData) {
  "use server";
  const u = await exigir("compras", "excluir");
  const id = Number(form.get("id"));
  const f = await db.fornecedor.findUniqueOrThrow({ where: { id }, include: { _count: { select: { pedidos: true, precos: true, boletos: true } } } });
  await db.item.updateMany({ where: { fornecedorId: id }, data: { fornecedorId: null } });
  if (f._count.pedidos + f._count.precos + f._count.boletos === 0) await db.fornecedor.delete({ where: { id } });
  else await db.fornecedor.update({ where: { id }, data: { ativo: false } });
  await auditar(u.nome, "excluiu fornecedor", f.nome);
  revalidatePath("/compras/fornecedores");
  redirect("/compras/fornecedores");
}

async function salvar(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const id = Number(form.get("id")) || null;
  const nome = String(form.get("nome") || "").trim();
  if (!nome) redirect("/compras/fornecedores?erro=" + encodeURIComponent("Informe o nome."));
  const data = {
    nome, cnpj: String(form.get("cnpj") || "") || null, contato: String(form.get("contato") || "") || null,
    telefone: String(form.get("telefone") || "") || null, email: String(form.get("email") || "") || null,
    chavePix: String(form.get("chavePix") || "").trim() || null, banco: String(form.get("bancoDados") || "").trim() || null,
    prazoPagamento: lerPrazos(String(form.get("prazoPagamento"))).join("/"),
    prazoEntregaDias: Math.max(0, Number(form.get("prazoEntregaDias")) || 0), observacao: String(form.get("obs") || "") || null,
  };
  if (id) await db.fornecedor.update({ where: { id }, data }); else await db.fornecedor.create({ data });
  await auditar(u.nome, id ? "editou fornecedor" : "criou fornecedor", nome);
  revalidatePath("/compras/fornecedores");
  redirect("/compras/fornecedores");
}

export default async function Fornecedores({ searchParams }: { searchParams: Promise<{ editar?: string; erro?: string }> }) {
  const u = await exigir("compras");
  const sp = await searchParams;
  const lista = await db.fornecedor.findMany({ where: { ativo: true }, include: { itens: { select: { nome: true } } }, orderBy: { nome: "asc" } });
  const ed = lista.find((f) => f.id === Number(sp.editar));
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="fornecedores" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      <p className="suave">O <b>prazo de pagamento</b> define quando cai o boleto (dias depois da compra; para parcelado use 28/42/56). O <b>prazo de entrega</b> define até quando dá para comprar sem atrasar a produção.</p>
      <div className="card tabela">
        {lista.length === 0 ? <p className="suave">Nenhum fornecedor cadastrado ainda.</p> : (
          <table>
            <thead><tr><th>Fornecedor</th><th>Contato</th><th>Pagamento</th><th>Entrega</th><th>Itens</th><th></th></tr></thead>
            <tbody>{lista.map((f) => (
              <tr key={f.id}>
                <td><b>{f.nome}</b>{f.cnpj && <div className="suave">{f.cnpj}</div>}</td>
                <td>{[f.contato, f.telefone].filter(Boolean).join(" · ")}</td>
                <td>{f.prazoPagamento} dias</td>
                <td>{f.prazoEntregaDias} dias</td>
                <td className="suave">{f.itens.length ? `${f.itens.length}: ${f.itens.slice(0, 3).map((i) => i.nome).join(", ")}${f.itens.length > 3 ? "…" : ""}` : "nenhum item ligado"}</td>
                <td><div className="acoes">{pode(u.permissoes, "compras", "editar") && <a href={`/compras/fornecedores?editar=${f.id}`}>Editar</a>}{pode(u.permissoes, "compras", "excluir") && <Excluir acao={excluir} campos={{ id: f.id }} pergunta={`Excluir ${f.nome}? Os itens ligados ficam sem fornecedor.`} />}</div></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {pode(u.permissoes, "compras", "editar") && (
        <div className="card">
          <b>{ed ? `Editar ${ed.nome}` : "Novo fornecedor"}</b>
          <form action={salvar} className="campos" style={{ marginTop: 12 }} key={ed?.id ?? "novo"}>
            {ed && <input type="hidden" name="id" value={ed.id} />}
            <label>Nome<input name="nome" defaultValue={ed?.nome} required /></label>
            <label>CNPJ<input name="cnpj" defaultValue={ed?.cnpj ?? ""} /></label>
            <label>Contato<input name="contato" defaultValue={ed?.contato ?? ""} /></label>
            <label>Telefone / WhatsApp<input name="telefone" defaultValue={ed?.telefone ?? ""} /></label>
            <label>E-mail<input name="email" defaultValue={ed?.email ?? ""} /></label>
            <label>Chave Pix<input name="chavePix" defaultValue={ed?.chavePix ?? ""} /></label>
            <label>Banco / agência / conta<input name="bancoDados" defaultValue={ed?.banco ?? ""} /></label>
            <label>Prazo de pagamento (dias)<input name="prazoPagamento" defaultValue={ed?.prazoPagamento ?? "28"} placeholder="28 ou 28/42/56" /></label>
            <label>Prazo de entrega (dias)<input name="prazoEntregaDias" type="number" min={0} defaultValue={ed?.prazoEntregaDias ?? 7} /></label>
            <label>Observação<input name="obs" defaultValue={ed?.observacao ?? ""} /></label>
            <div className="inteiro acoes"><button className="btn">Salvar</button>{ed && <a className="btn sec" href="/compras/fornecedores">Cancelar</a>}</div>
          </form>
          <p className="suave" style={{ marginBottom: 0 }}>Para ligar itens ao fornecedor, abra o item em Estoque e escolha o fornecedor e o preço atual.</p>
        </div>
      )}
    </>
  );
}
