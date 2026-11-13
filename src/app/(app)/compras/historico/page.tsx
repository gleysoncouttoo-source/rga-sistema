import Link from "next/link";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { brl, dataDia, qtd } from "@/lib/formato";
import { diasEntre, dia, somaDias } from "@/lib/datas";
import { STATUS_COMPRA } from "@/lib/rotulos";
import AbasCompras from "@/components/AbasCompras";
import type { Prisma } from "@prisma/client";

export default async function Historico({ searchParams }: { searchParams: Promise<{ f?: string; s?: string; dias?: string; item?: string }> }) {
  await exigir("compras");
  const sp = await searchParams;
  const dias = Number(sp.dias) || 90;
  const where: Prisma.PedidoCompraWhereInput = { dataCompra: { gte: somaDias(dia(), -dias) } };
  if (sp.f) where.fornecedorId = Number(sp.f);
  if (sp.s) where.status = sp.s; else where.status = { in: ["aprovado", "recebido"] };
  if (sp.item) where.itens = { some: { itemId: Number(sp.item) } };
  const [compras, fornecedores, itensComprados] = await Promise.all([
    db.pedidoCompra.findMany({ where, include: { fornecedor: true, pedidoVenda: true, itens: { include: { item: true } } }, orderBy: { dataCompra: "desc" }, take: 500 }),
    db.fornecedor.findMany({ orderBy: { nome: "asc" } }),
    db.item.findMany({ where: { origem: "comprado" }, orderBy: { nome: "asc" } }),
  ]);
  const valorPedido = (c: (typeof compras)[number]) => c.itens.reduce((t, i) => t + i.quantidade * (i.precoUnitario ?? 0), 0);
  const valorPago = (c: (typeof compras)[number]) => c.itens.reduce((t, i) => t + (i.quantidadeRecebida ?? 0) * (i.precoPago ?? i.precoUnitario ?? 0), 0);
  const recebidas = compras.filter((c) => c.status === "recebido");
  const total = recebidas.reduce((t, c) => t + valorPago(c), 0);
  const atrasos = recebidas.map((c) => diasEntre(dia(c.chegadaPrevista.toISOString()), dia(c.recebidoEm!)));
  const noPrazo = atrasos.filter((a) => a <= 0).length;
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="historico" />
      <form className="linha-form card" method="get">
        <label>Período<select name="dias" defaultValue={String(dias)}><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="180">6 meses</option><option value="365">1 ano</option><option value="3650">tudo</option></select></label>
        <label>Fornecedor<select name="f" defaultValue={sp.f ?? ""}><option value="">Todos</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
        <label>Item<select name="item" defaultValue={sp.item ?? ""}><option value="">Todos</option>{itensComprados.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</select></label>
        <label>Situação<select name="s" defaultValue={sp.s ?? ""}><option value="">Aprovadas e recebidas</option><option value="recebido">Recebidas</option><option value="aprovado">Esperando material</option><option value="cancelado">Canceladas</option></select></label>
        <button className="btn sec">Filtrar</button>
      </form>
      <div className="grade">
        <div className="kpi"><div className="r">Compras no período</div><div className="v">{compras.length}</div></div>
        <div className="kpi"><div className="r">Total pago (recebidas)</div><div className="v">{brl(total, 0)}</div></div>
        <div className="kpi"><div className="r">Chegaram no prazo</div><div className="v">{recebidas.length ? `${Math.round((noPrazo / recebidas.length) * 100)}%` : "—"}</div><div className="r">{recebidas.length - noPrazo} com atraso</div></div>
      </div>
      <div className="card tabela">
        {compras.length === 0 ? <p className="suave">Nenhuma compra nesse filtro.</p> : (
          <table>
            <thead><tr><th>#</th><th>Comprado em</th><th>Fornecedor</th><th>Itens</th><th className="n">Valor</th><th>Chegada prevista</th><th>Chegou</th><th>NF</th><th>Situação</th></tr></thead>
            <tbody>{compras.map((c) => {
              const atraso = c.recebidoEm ? diasEntre(dia(c.chegadaPrevista.toISOString()), dia(c.recebidoEm)) : null;
              const st = STATUS_COMPRA[c.status];
              return (
                <tr key={c.id}>
                  <td><Link href={`/compras?ver=todos#c${c.id}`}>#{c.id}</Link></td>
                  <td>{dataDia(c.dataCompra)}</td>
                  <td>{c.fornecedor?.nome ?? "—"}</td>
                  <td className="suave" style={{ fontSize: ".86rem" }}>{c.itens.map((i) => `${i.item.nome} ${qtd(i.quantidadeRecebida ?? i.quantidade, i.item.unidade)}${i.precoPago ? ` a ${brl(i.precoPago, 2)}` : ""}`).join(" · ")}</td>
                  <td className="n">{brl(c.status === "recebido" ? valorPago(c) : valorPedido(c))}</td>
                  <td>{dataDia(c.chegadaPrevista)}</td>
                  <td>{c.recebidoEm ? <>{dataDia(dia(c.recebidoEm))}{atraso! > 0 && <div style={{ color: "var(--erro)", fontSize: ".85rem" }}>{atraso} dia(s) de atraso</div>}</> : "—"}</td>
                  <td>{c.notaFiscal ?? "—"}</td>
                  <td><span className={`selo ${st.cls}`}>{st.nome.split(" —")[0]}</span>{c.obsRecebimento && <div className="suave" style={{ fontSize: ".82rem" }}>{c.obsRecebimento}</div>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
