import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { saldosLotes } from "@/lib/fluxo";
import { acaoExcluirApontamento } from "@/lib/acoesProducao";
import { brl, dataHora, num } from "@/lib/formato";
import Trilha from "@/components/Trilha";
import Excluir from "@/components/Excluir";

async function situacao(form: FormData) {
  "use server";
  const u = await exigir("producao", "editar");
  const id = Number(form.get("id")), status = String(form.get("status"));
  await db.lote.update({ where: { id }, data: { status, concluidoEm: status === "aberto" ? null : new Date() } });
  await auditar(u.nome, `lote ${status}`, `#${id}`);
  revalidatePath(`/producao/lote/${id}`);
}

async function excluirLote(form: FormData) {
  "use server";
  const u = await exigir("producao", "excluir");
  const id = Number(form.get("id"));
  const n = await db.apontamento.count({ where: { loteId: id } });
  if (n) redirect(`/producao/lote/${id}?erro=` + encodeURIComponent("O lote tem lançamentos. Exclua os lançamentos antes (o estoque volta junto) ou marque o lote como cancelado."));
  await db.lote.delete({ where: { id } });
  await auditar(u.nome, "excluiu lote", `#${id}`);
  redirect("/producao");
}

export default async function LotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await exigir("producao");
  const id = Number((await params).id);
  const sp = await searchParams;
  const lote = await db.lote.findUnique({ where: { id }, include: { item: true, apontamentos: { include: { funcionario: true, passo: { include: { operacao: true } } }, orderBy: { data: "asc" } } } });
  if (!lote) notFound();
  const [s] = await saldosLotes({ id });
  const edita = pode(u.permissoes, "producao", "editar"), exclui = pode(u.permissoes, "producao", "excluir");
  const totMin = lote.apontamentos.reduce((t, a) => t + a.minutos, 0);
  const custo = lote.apontamentos.reduce((t, a) => t + (a.custoHora ? (a.custoHora * a.minutos) / 60 : 0), 0);
  return (
    <>
      <div className="topo">
        <div className="com-foto">
          <span className="mini media">{lote.item.foto ? <img src={lote.item.foto} alt="" /> : "sem foto"}</span>
          <span className="t"><h1 style={{ margin: 0 }}>Lote {lote.numero}</h1><small>{lote.item.nome} · {lote.item.codigo} · aberto por {lote.criadoPor ?? "—"} em {dataHora(lote.criadoEm)}</small></span>
        </div>
        <div className="acoes">
          <span className={`selo ${lote.status === "concluido" ? "ok" : lote.status === "cancelado" ? "erro" : "alerta"}`}>{lote.status}</span>
          <Link className="btn sec" href="/producao">Voltar</Link>
        </div>
      </div>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <div className="grade">
        <div className="kpi"><div className="r">Planejado</div><div className="v">{num(lote.planejado)}</div></div>
        <div className="kpi"><div className="r">Prontas</div><div className="v">{num(s.pronto)}</div></div>
        <div className="kpi"><div className="r">Paradas entre processos</div><div className="v">{num(s.emProcesso)}</div></div>
        <div className="kpi"><div className="r">Tempo total</div><div className="v">{num(totMin / 60, 1)} h</div></div>
        <div className="kpi"><div className="r">Mão de obra do lote</div><div className="v">{brl(custo, 0)}</div><div className="r">{s.pronto ? `${brl(custo / s.pronto, 4)} por peça pronta` : ""}</div></div>
      </div>
      <div className="card"><b>Caminho do lote</b><Trilha passos={s.passos} /></div>
      <h2>Quem fez cada processo</h2>
      <div className="card tabela">
        {lote.apontamentos.length === 0 ? <p className="suave">Nada lançado ainda.</p> : (
          <table>
            <thead><tr><th>Processo</th><th>Colaborador</th><th>Início</th><th>Fim</th><th className="n">Min</th><th className="n">Peças</th><th className="n">Refugo</th><th className="n">Peças/h</th><th>Lançado por</th>{exclui && <th></th>}</tr></thead>
            <tbody>{lote.apontamentos.map((a) => (
              <tr key={a.id}>
                <td>{a.passo?.operacao.nome ?? "—"}</td><td>{a.funcionario.nome}</td>
                <td>{dataHora(a.inicio)}</td><td>{dataHora(a.fim ?? a.data)}</td>
                <td className="n">{num(a.minutos, 1)}</td><td className="n">{num(a.quantidade)}</td><td className="n">{num(a.refugo)}</td>
                <td className="n">{a.quantidade ? num(3600 / a.segPorPeca) : "—"}</td><td>{a.usuario ?? <span className="suave">celular</span>}</td>
                {exclui && <td><Excluir acao={acaoExcluirApontamento} campos={{ id: a.id, volta: `/producao/lote/${id}` }} pergunta="Excluir este lançamento? O estoque volta como estava." /></td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="acoes">
        {edita && lote.status !== "aberto" && <form action={situacao}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="aberto" /><button className="btn sec">Reabrir lote</button></form>}
        {edita && lote.status === "aberto" && <form action={situacao}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="concluido" /><button className="btn sec">Marcar como concluído</button></form>}
        {edita && lote.status === "aberto" && <form action={situacao}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="cancelado" /><button className="btn sec">Cancelar lote (peças perdidas)</button></form>}
        {exclui && <Excluir acao={excluirLote} campos={{ id }} texto="Excluir lote" peq={false} pergunta="Excluir este lote?" />}
      </div>
    </>
  );
}
