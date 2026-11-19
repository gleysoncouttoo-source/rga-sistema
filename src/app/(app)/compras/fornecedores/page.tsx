import Link from "next/link";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl } from "@/lib/formato";
import AbasCompras from "@/components/AbasCompras";

export default async function Fornecedores({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await exigir("compras");
  const sp = await searchParams;
  const lista = await db.fornecedor.findMany({
    where: { ativo: true },
    include: { ofertas: { where: { item: { ativo: true } }, include: { item: { select: { nome: true, foto: true } } }, orderBy: { item: { nome: "asc" } } } },
    orderBy: { nome: "asc" },
  });
  const cria = pode(u.permissoes, "compras", "editar");
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="fornecedores" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <div className="acoes" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <p className="suave" style={{ margin: 0, flex: "1 1 320px" }}>Cada fornecedor com os dados da empresa, contato, condições de pagamento e frete, e as matérias-primas que ele vende com preço, prazos e compra mínima.</p>
        {cria && <Link className="btn" href="/compras/fornecedores/novo">+ Novo fornecedor</Link>}
      </div>
      <div className="card tabela">
        {lista.length === 0 ? (
          <p className="suave" style={{ margin: 0 }}>Nenhum fornecedor cadastrado ainda.{cria && <> Clique em <Link href="/compras/fornecedores/novo">Novo fornecedor</Link> para cadastrar o primeiro, já com as matérias-primas que ele vende.</>}</p>
        ) : (
          <table>
            <thead><tr><th>Fornecedor</th><th>Cidade</th><th>Contato</th><th>Matérias-primas que vende</th><th>Pagamento</th><th>Entrega</th><th>Frete</th></tr></thead>
            <tbody>{lista.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/compras/fornecedores/${f.id}`}><b>{f.nome}</b></Link><div className="suave" style={{ fontSize: ".8rem" }}>{f.categoria ?? f.cnpj ?? ""}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>{[f.cidade, f.uf].filter(Boolean).join("/") || <span className="suave">—</span>}</td>
                <td>{f.contato && <div>{f.contato}</div>}<div className="suave" style={{ fontSize: ".82rem" }}>{f.whatsapp ?? f.telefone ?? (f.contato ? "" : "—")}</div></td>
                <td>
                  {f.ofertas.length ? (
                    <div className="fotos-linha">
                      {f.ofertas.slice(0, 5).map((o) => <span key={o.id} className="mini peq" title={o.item.nome}>{o.item.foto ? <img src={o.item.foto} alt="" /> : null}</span>)}
                      <span className="suave">{f.ofertas.length} {f.ofertas.length === 1 ? "item" : "itens"}: {f.ofertas.slice(0, 2).map((o) => o.item.nome).join(", ")}{f.ofertas.length > 2 ? "…" : ""}</span>
                    </div>
                  ) : <span className="suave">nenhuma ainda</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{f.prazoPagamento} dias{f.formaPagamento && <div className="suave" style={{ fontSize: ".8rem" }}>{f.formaPagamento}</div>}</td>
                <td style={{ whiteSpace: "nowrap" }}>{f.prazoEntregaDias} dias</td>
                <td style={{ whiteSpace: "nowrap" }}>{f.frete ? <>{f.frete}{f.frete === "FOB" && f.valorFrete != null && <div className="suave" style={{ fontSize: ".8rem" }}>{brl(f.valorFrete)}</div>}</> : <span className="suave">—</span>}{f.pedidoMinimo != null && <div className="suave" style={{ fontSize: ".8rem" }}>mín. {brl(f.pedidoMinimo, 0)}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
