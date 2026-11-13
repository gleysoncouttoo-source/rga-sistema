import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { aprovarCompra, cancelarCompra, reprogramarCompra } from "@/lib/planejamento";
import { brl, dataDia, qtd } from "@/lib/formato";
import { chave, dia } from "@/lib/datas";
import { STATUS_COMPRA } from "@/lib/rotulos";
import AbasCompras from "@/components/AbasCompras";

async function acao(form: FormData) {
  "use server";
  const id = Number(form.get("id")), a = String(form.get("a"));
  const u = await exigir("compras", a === "reprogramar" ? "editar" : "aprovar");
  try {
    if (a === "aprovar") await aprovarCompra(id, u.nome);
    if (a === "cancelar") await cancelarCompra(id, u.nome);
    if (a === "reprogramar") {
      const f = String(form.get("fornecedorId") ?? "");
      const d = String(form.get("data") || "");
      const pz = String(form.get("prazo") ?? "").trim();
      await reprogramarCompra(id, { fornecedorId: f === "" ? undefined : Number(f) || null, data: d ? dia(d) : null, prazoEntregaDias: pz === "" ? undefined : Math.max(0, Number(pz) || 0) }, u.nome);
    }
  } catch (e) {
    redirect("/compras?erro=" + encodeURIComponent((e as Error).message));
  }
  revalidatePath("/compras");
  redirect(`/compras#c${id}`);
}

export default async function Compras({ searchParams }: { searchParams: Promise<{ erro?: string; ver?: string }> }) {
  const u = await exigir("compras");
  const sp = await searchParams;
  const todos = sp.ver === "todos";
  const [compras, fornecedores] = await Promise.all([
    db.pedidoCompra.findMany({
      where: todos ? {} : { status: { in: ["sugerido", "aprovado"] } },
      include: { fornecedor: true, pedidoVenda: true, itens: { include: { item: true } }, boletos: { orderBy: { vencimento: "asc" } } },
      orderBy: [{ urgente: "desc" }, { dataCompra: "asc" }], take: 200,
    }),
    db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
  ]);
  const ordem = ["sugerido", "aprovado", "recebido", "cancelado"];
  compras.sort((a, b) => ordem.indexOf(a.status) - ordem.indexOf(b.status));
  const sugeridos = compras.filter((c) => c.status === "sugerido");
  const hoje = chave(dia());
  const paraHoje = sugeridos.filter((c) => chave(c.dataCompra) <= hoje);
  const aprova = pode(u.permissoes, "compras", "aprovar"), edita = pode(u.permissoes, "compras", "editar");
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="pedidos" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sugeridos.length > 0 && (
        <div className="aviso alerta">
          O sistema lançou {sugeridos.length} pedido(s) de compra a partir das vendas{paraHoje.length ? `, ${paraHoje.length} para comprar hoje` : ""}. Confira e aprove: ao aprovar, os boletos entram no calendário como contas a pagar.
        </div>
      )}
      <div className="abas">
        <a href="/compras" className={todos ? "" : "ativo"}>Em andamento</a>
        <a href="/compras?ver=todos" className={todos ? "ativo" : ""}>Todos</a>
      </div>
      {compras.length === 0 && <div className="card suave">Nenhum pedido de compra {todos ? "" : "em andamento"}.</div>}
      {compras.map((c) => {
        const st = STATUS_COMPRA[c.status];
        const total = c.itens.reduce((t, i) => t + i.quantidade * (i.precoUnitario ?? 0), 0);
        return (
          <div id={`c${c.id}`} key={c.id} className={`card ${c.status === "sugerido" ? "sinal" : ""} ${c.urgente && c.status === "sugerido" ? "urgente" : ""}`}>
            <div className="topo" style={{ marginBottom: 4 }}>
              <div>
                <b>Compra #{c.id} · {c.fornecedor?.nome ?? <span style={{ color: "var(--erro)" }}>fornecedor a definir</span>}</b>
                <div className="suave">
                  {c.pedidoVenda ? <>Para o <Link href={`/vendas/${c.pedidoVenda.id}`}>pedido #{c.pedidoVenda.id}</Link> ({c.pedidoVenda.cliente}, entrega {dataDia(c.pedidoVenda.dataEntrega)})</> : "Compra avulsa"}
                  {c.fornecedor && ` · paga em ${c.fornecedor.prazoPagamento} dias · entrega em ${c.prazoEntregaDias ?? c.fornecedor.prazoEntregaDias} dias${c.prazoEntregaDias != null ? " (combinado nesta compra)" : ""}`}
                </div>
              </div>
              <div className="acoes">
                {c.urgente && c.status === "sugerido" && <span className="selo erro">Urgente</span>}
                <span className={`selo ${st.cls}`}>{st.nome}</span>
              </div>
            </div>
            {c.status === "sugerido" && <div className="motivo">{c.motivo}</div>}
            {c.status === "recebido" && <div className="motivo">Chegou em {dataDia(c.recebidoEm)}{c.notaFiscal ? ` · NF ${c.notaFiscal}` : ""}{c.obsRecebimento ? ` · ${c.obsRecebimento}` : ""}</div>}
            <div className="grade" style={{ margin: "10px 0" }}>
              <div><div className="suave">Comprar em</div><b>{dataDia(c.dataCompra)}</b></div>
              <div><div className="suave">Limite</div><b>{dataDia(c.dataLimite)}</b></div>
              <div><div className="suave">Chegada prevista</div><b>{dataDia(c.chegadaPrevista)}</b></div>
              <div><div className="suave">Boleto(s)</div><b>{c.boletos.map((b) => dataDia(b.vencimento)).join(", ") || "—"}</b></div>
              <div><div className="suave">Total</div><b>{brl(total)}</b></div>
            </div>
            <div className="tabela">
              <table>
                <thead><tr><th>Item</th><th className="n">Precisa</th><th className="n">Comprar</th><th className="n">Preço</th><th className="n">Total</th></tr></thead>
                <tbody>{c.itens.map((i) => (
                  <tr key={i.id}><td><Link href={`/estoque/${i.itemId}`}>{i.item.nome}</Link></td><td className="n">{qtd(i.necessaria, i.item.unidade)}</td><td className="n"><b>{qtd(i.quantidade, i.item.unidade)}</b></td><td className="n">{brl(i.precoUnitario, 2)}</td><td className="n">{brl(i.quantidade * (i.precoUnitario ?? 0))}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {(c.status === "sugerido" || c.status === "aprovado") && (
              <div className="acoes" style={{ marginTop: 12 }}>
                {c.status === "sugerido" && aprova && <form action={acao}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="aprovar" /><button className="btn" disabled={!c.fornecedorId}>Aprovar compra</button></form>}
                {c.status === "aprovado" && pode(u.permissoes, "compras", "editar") && <Link className="btn" href={`/compras/receber/${c.id}`}>Material chegou</Link>}
                {edita && (
                  <form action={acao} className="acoes">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="reprogramar" />
                    <select name="fornecedorId" defaultValue={c.fornecedorId ?? ""} style={{ minHeight: 36 }}>
                      <option value="">{c.fornecedorId ? "mesmo fornecedor" : "escolher fornecedor"}</option>
                      {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                    </select>
                    <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>Prazo de entrega<input type="number" name="prazo" min={0} defaultValue={c.prazoEntregaDias ?? c.fornecedor?.prazoEntregaDias ?? ""} style={{ minHeight: 36, width: 70 }} />dias</label>
                    <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>Data<input type="date" name="data" style={{ minHeight: 36 }} title="Deixe em branco para o sistema escolher o melhor dia" /></label>
                    <button className="btn sec peq">{c.fornecedorId ? "Salvar alteração" : "Definir fornecedor"}</button>
                  </form>
                )}
                {aprova && <form action={acao}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="cancelar" /><button className="btn sec peq">Cancelar</button></form>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
