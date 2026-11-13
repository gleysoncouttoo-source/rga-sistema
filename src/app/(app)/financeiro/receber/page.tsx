import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { BANCOS } from "@/lib/financeiro";
import { brl, dataDia } from "@/lib/formato";
import { chave, dia, semana, somaDias } from "@/lib/datas";
import AbasFinanceiro from "@/components/AbasFinanceiro";

const CAT = ["Vendas", "Site / Shopee", "Serviços", "Outros"];
const valorBR = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));

async function adicionar(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "criar");
  const descricao = String(form.get("descricao") || "").trim(), valor = valorBR(form.get("valor")), venc = String(form.get("vencimento") || "");
  const parcelas = Math.min(24, Math.max(1, Number(form.get("parcelas")) || 1)), intervalo = Math.max(1, Number(form.get("intervalo")) || 30);
  if (!descricao || !(valor > 0) || !venc) redirect("/financeiro/receber?erro=" + encodeURIComponent("Preencha cliente, valor e data."));
  const pedidoVendaId = Number(form.get("pedido")) || null;
  const parcela = Math.round((valor / parcelas) * 100) / 100;
  for (let i = 0; i < parcelas; i++) {
    await db.contaReceber.create({
      data: {
        descricao, categoria: String(form.get("categoria") || "Vendas"), banco: String(form.get("banco") || "") || null, pedidoVendaId,
        valor: i === parcelas - 1 ? Math.round((valor - parcela * (parcelas - 1)) * 100) / 100 : parcela,
        vencimento: somaDias(dia(venc), i * intervalo), parcela: parcelas > 1 ? `${i + 1}/${parcelas}` : null, observacao: String(form.get("obs") || "").trim() || null,
      },
    });
  }
  await auditar(u.nome, "lançou recebimento", `${descricao} ${valor}`);
  revalidatePath("/financeiro/receber");
  redirect("/financeiro/receber?ok=1");
}

async function acao(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id")), a = String(form.get("a"));
  if (a === "recebido") await db.contaReceber.update({ where: { id }, data: { status: "recebido", recebidoEm: dia() } });
  if (a === "desfazer") await db.contaReceber.update({ where: { id }, data: { status: "aberto", recebidoEm: null } });
  if (a === "excluir") await db.contaReceber.delete({ where: { id } });
  await auditar(u.nome, `recebimento: ${a}`, `#${id}`);
  revalidatePath("/financeiro/receber");
}

export default async function Receber({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; pedido?: string }> }) {
  const u = await exigir("financeiro");
  const sp = await searchParams;
  const hoje = dia();
  const [abertos, recentes, pedidos] = await Promise.all([
    db.contaReceber.findMany({ where: { status: "aberto" }, include: { pedidoVenda: true }, orderBy: { vencimento: "asc" }, take: 300 }),
    db.contaReceber.findMany({ where: { status: "recebido", recebidoEm: { gte: somaDias(hoje, -30) } }, orderBy: { recebidoEm: "desc" }, take: 30 }),
    db.pedidoVenda.findMany({ where: { status: { in: ["aberto", "entregue"] } }, include: { itens: true }, orderBy: { id: "desc" }, take: 50 }),
  ]);
  const pv = pedidos.find((p) => p.id === Number(sp.pedido));
  const vencidos = abertos.filter((r) => chave(r.vencimento) < chave(hoje));
  const edita = pode(u.permissoes, "financeiro", "editar");
  const total = abertos.reduce((t, r) => t + r.valor, 0);
  return (
    <>
      <h1>Financeiro</h1>
      <AbasFinanceiro ativo="receber" />
      {sp.ok && <div className="aviso ok">Recebimento lançado. Ele já aparece no fluxo de caixa.</div>}
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      <div className="grade">
        <div className="kpi"><div className="r">A receber</div><div className="v">{brl(total, 0)}</div><div className="r">{abertos.length} lançamento(s)</div></div>
        <div className="kpi"><div className="r">Vencidos sem baixa</div><div className="v" style={{ color: vencidos.length ? "var(--erro)" : undefined }}>{brl(vencidos.reduce((t, r) => t + r.valor, 0), 0)}</div><div className="r">{vencidos.length} lançamento(s)</div></div>
      </div>
      {pode(u.permissoes, "financeiro", "criar") && (
        <div className="card">
          <b>Lançar recebimento</b>
          <form action={adicionar} className="campos" style={{ marginTop: 12 }}>
            <label>Cliente / origem<input name="descricao" required defaultValue={pv?.cliente ?? ""} placeholder="ex.: Shoppe RGA, Salomão" /></label>
            <label>Categoria<select name="categoria">{CAT.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Valor total (R$)<input name="valor" inputMode="decimal" required defaultValue={pv ? pv.itens.reduce((t, i) => t + i.quantidade * (i.precoUnitario ?? 0), 0).toFixed(2).replace(".", ",") : ""} /></label>
            <label>Data (1ª parcela)<input name="vencimento" type="date" defaultValue={chave(hoje)} required /></label>
            <label>Parcelas<input name="parcelas" type="number" min={1} max={24} defaultValue={1} /></label>
            <label>Dias entre parcelas<input name="intervalo" type="number" min={1} defaultValue={30} /></label>
            <label>Banco<select name="banco"><option value="">—</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label>Pedido de venda<select name="pedido" defaultValue={pv?.id ?? ""}><option value="">—</option>{pedidos.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.cliente}</option>)}</select></label>
            <label className="inteiro">Observação<input name="obs" /></label>
            <div className="inteiro"><button className="btn">Lançar</button></div>
          </form>
        </div>
      )}
      <h2>A receber</h2>
      <div className="card tabela">
        {abertos.length === 0 ? <p className="suave">Nada a receber lançado.</p> : (
          <table>
            <thead><tr><th>Data</th><th>Cliente / origem</th><th>Categoria</th><th>Banco</th><th className="n">Valor</th><th></th></tr></thead>
            <tbody>{abertos.map((r) => {
              const venc = chave(r.vencimento) < chave(hoje);
              return (
                <tr key={r.id}>
                  <td style={venc ? { color: "var(--erro)" } : undefined}>{semana(dia(r.vencimento.toISOString()))} {dataDia(r.vencimento)}{venc && <div style={{ fontSize: ".8rem" }}>vencido</div>}</td>
                  <td>{r.descricao}{r.parcela && <span className="suave"> · {r.parcela}</span>}{r.pedidoVenda && <div className="suave" style={{ fontSize: ".82rem" }}><Link href={`/vendas/${r.pedidoVendaId}`}>pedido #{r.pedidoVendaId}</Link></div>}</td>
                  <td><span className="selo ok">{r.categoria}</span></td>
                  <td className="suave">{r.banco ?? ""}</td>
                  <td className="n"><b>{brl(r.valor)}</b></td>
                  <td>{edita && <div className="acoes">
                    <form action={acao}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="a" value="recebido" /><button className="btn peq">Recebido</button></form>
                    <form action={acao}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="a" value="excluir" /><button className="btn sec peq">Excluir</button></form>
                  </div>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {recentes.length > 0 && (
        <>
          <h2>Recebidos nos últimos 30 dias</h2>
          <div className="card tabela"><table><tbody>{recentes.map((r) => (
            <tr key={r.id}><td>{dataDia(r.recebidoEm)}</td><td>{r.descricao}</td><td className="n">{brl(r.valor)}</td>
              <td>{edita && <form action={acao}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="a" value="desfazer" /><button className="btn sec peq">Desfazer</button></form>}</td></tr>
          ))}</tbody></table></div>
        </>
      )}
    </>
  );
}
