import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerPrazos } from "@/lib/planejamento";
import AbasCompras from "@/components/AbasCompras";

async function criar(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const nome = String(form.get("nome") || "").trim().replace(/\s+/g, " ");
  if (!nome) redirect("/compras/fornecedores?erro=" + encodeURIComponent("Informe o nome."));
  const existe = await db.fornecedor.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } });
  if (existe) {
    if (!existe.ativo) await db.fornecedor.update({ where: { id: existe.id }, data: { ativo: true } });
    redirect(`/compras/fornecedores/${existe.id}`);
  }
  const f = await db.fornecedor.create({
    data: {
      nome, telefone: String(form.get("telefone") || "").trim() || null,
      prazoPagamento: lerPrazos(String(form.get("prazoPagamento") || "28")).join("/"),
      prazoEntregaDias: Math.max(0, Number(form.get("prazoEntregaDias")) || 0),
    },
  });
  await auditar(u.nome, "criou fornecedor", nome);
  revalidatePath("/compras/fornecedores");
  redirect(`/compras/fornecedores/${f.id}?ok=` + encodeURIComponent(`${nome} cadastrado. Agora adicione as matérias-primas que ele vende.`));
}

export default async function Fornecedores({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await exigir("compras");
  const sp = await searchParams;
  const lista = await db.fornecedor.findMany({
    where: { ativo: true },
    include: { ofertas: { where: { item: { ativo: true } }, include: { item: { select: { nome: true, foto: true } } }, orderBy: { item: { nome: "asc" } } } },
    orderBy: { nome: "asc" },
  });
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="fornecedores" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <p className="suave">Cada fornecedor com as matérias-primas que ele vende: preço, prazo de pagamento, prazo de entrega e compra mínima. Clique no fornecedor para ver e editar.</p>
      <div className="card tabela">
        {lista.length === 0 ? <p className="suave">Nenhum fornecedor cadastrado ainda.</p> : (
          <table>
            <thead><tr><th>Fornecedor</th><th>Contato</th><th>Matérias-primas que vende</th><th>Pagamento</th><th>Entrega</th></tr></thead>
            <tbody>{lista.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/compras/fornecedores/${f.id}`}><b>{f.nome}</b></Link>{f.cnpj && <div className="suave">{f.cnpj}</div>}</td>
                <td>{[f.contato, f.telefone].filter(Boolean).join(" · ") || <span className="suave">—</span>}</td>
                <td>
                  {f.ofertas.length ? (
                    <div className="fotos-linha">
                      {f.ofertas.slice(0, 5).map((o) => <span key={o.id} className="mini peq" title={o.item.nome}>{o.item.foto ? <img src={o.item.foto} alt="" /> : null}</span>)}
                      <span className="suave">{f.ofertas.length} {f.ofertas.length === 1 ? "item" : "itens"}: {f.ofertas.slice(0, 2).map((o) => o.item.nome).join(", ")}{f.ofertas.length > 2 ? "…" : ""}</span>
                    </div>
                  ) : <span className="suave">nenhuma ainda</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{f.prazoPagamento} dias</td>
                <td style={{ whiteSpace: "nowrap" }}>{f.prazoEntregaDias} dias</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {pode(u.permissoes, "compras", "editar") && (
        <div className="card">
          <b>Novo fornecedor</b>
          <form action={criar} className="campos" style={{ marginTop: 12 }}>
            <label>Nome<input name="nome" required /></label>
            <label>Telefone / WhatsApp<input name="telefone" /></label>
            <label>Prazo de pagamento geral (dias)<input name="prazoPagamento" defaultValue="28" placeholder="28 ou 28/42/56" /></label>
            <label>Prazo de entrega geral (dias)<input name="prazoEntregaDias" type="number" min={0} defaultValue={7} /></label>
            <div className="inteiro"><button className="btn">Cadastrar e adicionar matérias-primas</button></div>
          </form>
        </div>
      )}
    </>
  );
}
