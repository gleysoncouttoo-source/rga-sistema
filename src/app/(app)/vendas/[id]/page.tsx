import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import Excluir from "@/components/Excluir";
import { pode } from "@/lib/permissoes";
import { analisarPedido, cancelarPedido, entregarPedido } from "@/lib/planejamento";
import { brl, dataDia, qtd } from "@/lib/formato";
import { SITUACAO, STATUS_COMPRA, STATUS_VENDA, TIPOS } from "@/lib/rotulos";

async function acao(form: FormData) {
  "use server";
  const id = Number(form.get("id")), a = String(form.get("a"));
  const u = await exigir("vendas", a === "analisar" ? "editar" : "aprovar");
  if (a === "analisar") await analisarPedido(id, u.nome);
  if (a === "entregar") await entregarPedido(id, u.nome);
  if (a === "cancelar") await cancelarPedido(id, u.nome);
  revalidatePath(`/vendas/${id}`);
  redirect(`/vendas/${id}`);
}

async function excluirPedido(form: FormData) {
  "use server";
  const u = await exigir("vendas", "excluir");
  const id = Number(form.get("id"));
  const p = await db.pedidoVenda.findUniqueOrThrow({ where: { id }, include: { compras: { where: { status: { in: ["aprovado", "recebido"] } } } } });
  if (p.compras.length) redirect(`/vendas/${id}?erro=` + encodeURIComponent("Este pedido tem compras aprovadas ou recebidas. Cancele o pedido em vez de excluir."));
  if (p.status === "aberto") await cancelarPedido(id, u.nome);
  await db.pedidoCompra.updateMany({ where: { pedidoVendaId: id }, data: { pedidoVendaId: null } });
  await db.pedidoVenda.delete({ where: { id } });
  await auditar(u.nome, "excluiu pedido de venda", `#${id} ${p.cliente}`);
  redirect("/vendas");
}

export default async function Pedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }> }) {
  const u = await exigir("vendas");
  const { erro } = await searchParams;
  const id = Number((await params).id);
  const p = await db.pedidoVenda.findUnique({
    where: { id },
    include: {
      itens: { include: { item: true } },
      necessidades: { include: { item: true }, orderBy: { ordem: "asc" } },
      compras: { include: { fornecedor: true, itens: { include: { item: true } }, boletos: { orderBy: { vencimento: "asc" } } }, orderBy: { id: "asc" } },
    },
  });
  if (!p) notFound();
  const s = p.status === "aberto" ? SITUACAO[p.situacao ?? ""] : STATUS_VENDA[p.status];
  const total = p.itens.reduce((t, i) => t + i.quantidade * (i.precoUnitario ?? 0), 0);
  const abertas = p.compras.filter((c) => c.status !== "cancelado");
  const aguardando = p.compras.filter((c) => c.status === "sugerido" || c.status === "aprovado").length;
  // soma por item (a mesma matéria-prima aparece em várias peças)
  const porItem = new Map<number, { nome: string; tipo: string; setor: string | null; unidade: string; itemId: number; necessario: number; doEstoque: number; aFabricar: number; aComprar: number; precisaEm: Date; aviso: string | null }>();
  for (const n of p.necessidades) {
    const a = porItem.get(n.itemId);
    if (!a) porItem.set(n.itemId, { nome: n.item.nome, tipo: n.item.tipo, setor: n.item.setor, unidade: n.item.unidade, itemId: n.itemId, necessario: n.necessario, doEstoque: n.doEstoque, aFabricar: n.aFabricar, aComprar: n.aComprar, precisaEm: n.precisaEm, aviso: n.aviso });
    else { a.necessario += n.necessario; a.doEstoque += n.doEstoque; a.aFabricar += n.aFabricar; a.aComprar += n.aComprar; if (n.precisaEm < a.precisaEm) a.precisaEm = n.precisaEm; a.aviso ??= n.aviso; }
  }
  const ORD = ["Estamparia", "Solda", "Injeção", "Usinagem", "Polimento", "Banho de zinco", "Montagem"];
  const fabricar = [...porItem.values()].filter((x) => x.aFabricar > 0).sort((a, b) => ORD.indexOf(a.setor ?? "") - ORD.indexOf(b.setor ?? ""));
  const comprarL = [...porItem.values()].filter((x) => x.aComprar > 0);
  const resumo = {
    estoque: p.necessidades.filter((n) => n.nivel === 0).reduce((t, n) => t + n.doEstoque, 0),
    montar: p.necessidades.filter((n) => n.nivel === 0).reduce((t, n) => t + n.aFabricar, 0),
    produzir: p.necessidades.filter((n) => n.nivel > 0 && n.aFabricar > 0).length,
    comprar: p.necessidades.filter((n) => n.aComprar > 0).length,
  };
  return (
    <>
      <div className="topo">
        <div>
          <h1 style={{ margin: 0 }}>Pedido #{p.id} — {p.cliente}</h1>
          <span className="suave">{p.numero ? `Nº ${p.numero} · ` : ""}{p.origem === "site" ? "veio do site · " : p.origem === "shopee" ? "veio da Shopee · " : ""}entrega {dataDia(p.dataEntrega)} · {brl(total)}</span>
        </div>
        {s && <span className={`selo ${s.cls}`}>{s.nome}</span>}
      </div>
      {erro && <div className="aviso erro">{erro}</div>}
      {p.observacao && <div className="aviso alerta">{p.observacao}</div>}

      {p.status === "aberto" && (
        <div className="grade">
          <div className="kpi"><div className="r">Sai pronto do estoque</div><div className="v">{qtd(resumo.estoque)}</div><div className="r">unidades</div></div>
          <div className="kpi"><div className="r">Montar</div><div className="v">{qtd(resumo.montar)}</div><div className="r">unidades</div></div>
          <div className="kpi"><div className="r">Peças a produzir</div><div className="v">{resumo.produzir}</div><div className="r">tipos de peça</div></div>
          <div className="kpi"><div className="r">Itens a comprar</div><div className="v">{resumo.comprar}</div><div className="r">{abertas.length} pedido(s) de compra</div></div>
        </div>
      )}

      {p.status === "aberto" && (
        <div className="acoes" style={{ marginBottom: 14 }}>
          {pode(u.permissoes, "vendas", "editar") && <form action={acao}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="a" value="analisar" /><button className="btn sec">Analisar de novo</button></form>}
          {pode(u.permissoes, "vendas", "aprovar") && <form action={acao}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="a" value="entregar" /><button className="btn">Marcar como entregue</button></form>}
          {pode(u.permissoes, "vendas", "aprovar") && <form action={acao}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="a" value="cancelar" /><button className="btn sec">Cancelar pedido</button></form>}
          {pode(u.permissoes, "vendas", "excluir") && <Excluir acao={excluirPedido} campos={{ id: p.id }} peq={false} pergunta="Excluir este pedido de vez? (Para manter no histórico, use Cancelar.)" />}
        </div>
      )}
      {p.status === "aberto" && aguardando > 0 && <div className="aviso alerta">Este pedido depende de {aguardando} compra(s) ainda não recebida(s). Ao receber o material em Compras, ele entra no estoque já separado para este pedido.</div>}

      <h2 id="compras">Compras lançadas para este pedido</h2>
      {abertas.length === 0 ? <div className="card suave">Nada a comprar: tudo sai do estoque ou da produção.</div> : abertas.map((c) => {
        const st = STATUS_COMPRA[c.status];
        return (
          <div key={c.id} className={`card ${c.status === "sugerido" ? "sinal" : ""} ${c.urgente ? "urgente" : ""}`}>
            <div className="topo" style={{ marginBottom: 6 }}>
              <b><Link href={`/compras#c${c.id}`}>Compra #{c.id}</Link> · {c.fornecedor?.nome ?? <span style={{ color: "var(--erro)" }}>fornecedor a definir</span>}</b>
              <span className={`selo ${c.urgente ? "erro" : st.cls}`}>{c.urgente ? "Urgente" : st.nome}</span>
            </div>
            <div className="motivo">{c.motivo}</div>
            <span className="suave">{c.itens.map((i) => `${i.item.nome} ${qtd(i.quantidade, i.item.unidade)}`).join(" · ")} — chega por volta de {dataDia(c.chegadaPrevista)} — boletos: {c.boletos.map((b) => `${dataDia(b.vencimento)} ${brl(b.valor)}`).join(", ") || "—"}</span>
          </div>
        );
      })}

      <h2>Itens do pedido</h2>
      <div className="card tabela">
        <table>
          <thead><tr><th>Produto</th><th className="n">Qtd</th><th className="n">Preço</th><th className="n">Total</th></tr></thead>
          <tbody>{p.itens.map((i) => (
            <tr key={i.id}><td><Link href={`/estoque/${i.itemId}`}>{i.item.codigo}</Link> {i.item.nome}</td><td className="n">{qtd(i.quantidade)}</td><td className="n">{brl(i.precoUnitario)}</td><td className="n">{brl(i.quantidade * (i.precoUnitario ?? 0))}</td></tr>
          ))}</tbody>
        </table>
      </div>

      {fabricar.length > 0 && (
        <>
          <h2>Produzir e montar</h2>
          <div className="card tabela">
            <table>
              <thead><tr><th>Item</th><th>Setor</th><th className="n">Precisa</th><th className="n">Do estoque</th><th className="n">Produzir/montar</th><th>Pronto até</th><th>Observação</th></tr></thead>
              <tbody>{fabricar.map((n) => (
                <tr key={n.itemId}>
                  <td><Link href={`/estoque/${n.itemId}`}>{n.nome}</Link></td><td className="suave">{n.setor ?? TIPOS[n.tipo]}</td>
                  <td className="n">{qtd(n.necessario, n.unidade)}</td><td className="n">{n.doEstoque ? qtd(n.doEstoque, n.unidade) : "—"}</td>
                  <td className="n"><b>{qtd(n.aFabricar, n.unidade)}</b></td><td>{dataDia(n.precisaEm)}</td><td className="suave" style={{ fontSize: ".85rem" }}>{n.aviso}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {comprarL.length > 0 && (
        <>
          <h2>Falta comprar</h2>
          <div className="card tabela">
            <table>
              <thead><tr><th>Item</th><th>Tipo</th><th className="n">Precisa</th><th className="n">Do estoque</th><th className="n">Comprar</th><th>Precisa chegar até</th><th>Observação</th></tr></thead>
              <tbody>{comprarL.map((n) => (
                <tr key={n.itemId}>
                  <td><Link href={`/estoque/${n.itemId}`}>{n.nome}</Link></td><td className="suave">{TIPOS[n.tipo]}</td>
                  <td className="n">{qtd(n.necessario, n.unidade)}</td><td className="n">{n.doEstoque ? qtd(n.doEstoque, n.unidade) : "—"}</td>
                  <td className="n"><b style={{ color: "var(--alerta)" }}>{qtd(n.aComprar, n.unidade)}</b></td><td>{dataDia(n.precisaEm)}</td><td className="suave" style={{ fontSize: ".85rem" }}>{n.aviso}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {p.necessidades.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Ver a análise completa, do produto até a matéria-prima ({p.necessidades.length} linhas)</summary>
          <p className="suave">Só desce para o nível de baixo o que falta no estoque. As linhas em destaque precisam de compra.</p>
          <div className="tabela">
            <table>
              <thead><tr><th>Item</th><th>Tipo</th><th className="n">Precisa</th><th className="n">Do estoque</th><th className="n">Produzir/montar</th><th className="n">Comprar</th><th>Até</th><th>Observação</th></tr></thead>
              <tbody>{p.necessidades.map((n) => (
                <tr key={n.id} className={`nivel${Math.min(n.nivel, 3)} ${n.aComprar > 0 ? "falta" : ""}`}>
                  <td>{n.nivel > 0 && <span className="suave">└ </span>}<Link href={`/estoque/${n.itemId}`}>{n.item.nome}</Link></td>
                  <td className="suave">{TIPOS[n.item.tipo] ?? n.item.tipo}</td>
                  <td className="n">{qtd(n.necessario, n.item.unidade)}</td>
                  <td className="n">{n.doEstoque ? qtd(n.doEstoque, n.item.unidade) : "—"}</td>
                  <td className="n">{n.aFabricar ? <b>{qtd(n.aFabricar, n.item.unidade)}</b> : "—"}</td>
                  <td className="n">{n.aComprar ? <b style={{ color: "var(--alerta)" }}>{qtd(n.aComprar, n.item.unidade)}</b> : "—"}</td>
                  <td>{dataDia(n.precisaEm)}</td>
                  <td className="suave" style={{ fontSize: ".85rem" }}>{n.aviso}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
