import Link from "next/link";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, dataDia, num } from "@/lib/formato";
import { SITUACAO, STATUS_VENDA } from "@/lib/rotulos";
import AbasVendas from "@/components/AbasVendas";
import { sincronizarSeAntigo } from "@/lib/shopeeAuto";

export default async function Vendas({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const u = await exigir("vendas");
  await sincronizarSeAntigo();
  const { ver } = await searchParams;
  const todos = ver === "todos";
  const pedidos = await db.pedidoVenda.findMany({
    where: todos ? {} : { status: "aberto" },
    include: { itens: { include: { item: true } }, compras: { where: { status: { in: ["sugerido", "aprovado"] } } } },
    orderBy: [{ dataEntrega: "asc" }], take: 200,
  });
  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Pedidos de venda</h1>
        {pode(u.permissoes, "vendas", "criar") && <Link className="btn" href="/vendas/novo">Novo pedido</Link>}
      </div>
      <AbasVendas ativo="pedidos" />
      <p className="suave">Cada pedido que entra é conferido na hora: produto pronto em estoque, peças para montar, matéria-prima para produzir e o que precisa comprar. As compras já ficam lançadas em <Link href="/compras">Compras</Link>.</p>
      <div className="abas">
        <a href="/vendas" className={todos ? "" : "ativo"}>Em aberto</a>
        <a href="/vendas?ver=todos" className={todos ? "ativo" : ""}>Todos</a>
      </div>
      <div className="card tabela">
        {pedidos.length === 0 ? <p className="suave">Nenhum pedido {todos ? "" : "em aberto"}.</p> : (
          <table>
            <thead><tr><th>#</th><th>Cliente</th><th>Itens</th><th className="n">Valor</th><th>Entrega</th><th>Situação</th><th>Compras</th></tr></thead>
            <tbody>{pedidos.map((p) => {
              const s = p.status === "aberto" ? SITUACAO[p.situacao ?? ""] : STATUS_VENDA[p.status];
              const valor = p.itens.reduce((t, i) => t + i.quantidade * (i.precoUnitario ?? 0), 0);
              const qt = p.itens.reduce((t, i) => t + i.quantidade, 0);
              return (
                <tr key={p.id}>
                  <td><Link href={`/vendas/${p.id}`}>#{p.id}</Link>{p.numero && <div className="suave">{p.origem === "site" ? "site " : p.origem === "shopee" ? "Shopee " : ""}{p.numero}</div>}</td>
                  <td>{p.cliente}</td>
                  <td>{num(qt)} un · <span className="suave">{p.itens.map((i) => i.item.codigo ?? i.item.nome).slice(0, 2).join(", ")}{p.itens.length > 2 ? "…" : ""}</span></td>
                  <td className="n">{valor ? brl(valor) : "—"}</td>
                  <td>{dataDia(p.dataEntrega)}</td>
                  <td>{s && <span className={`selo ${s.cls}`}>{s.nome}</span>}</td>
                  <td>{p.compras.length ? <Link href={`/vendas/${p.id}#compras`}>{p.compras.length} pedido(s)</Link> : <span className="suave">—</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
