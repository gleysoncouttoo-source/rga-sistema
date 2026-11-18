import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { decidirRecorde } from "@/lib/producao";
import { brl, dataHora, num, pecasHora } from "@/lib/formato";
import { saldosLotes } from "@/lib/fluxo";
import { acaoCancelarCronometro, acaoExcluirApontamento, acaoFinalizar, acaoPausar } from "@/lib/acoesProducao";
import Cronometro from "@/components/Cronometro";
import Excluir from "@/components/Excluir";
import Trilha from "@/components/Trilha";
import AbasProducao from "@/components/AbasProducao";

async function decidir(form: FormData) {
  "use server";
  const u = await exigir("producao", "aprovar");
  const id = Number(form.get("id"));
  const confirmar = form.get("decisao") === "confirmar";
  await decidirRecorde(id, confirmar, u.nome);
  await auditar(u.nome, confirmar ? "confirmou recorde" : "recusou recorde", `recorde #${id}`);
  revalidatePath("/producao");
}

async function novaOperacao(form: FormData) {
  "use server";
  const u = await exigir("producao", "criar");
  const etapaId = Number(form.get("etapa"));
  const nome = String(form.get("nome") || "").trim();
  const qtd = Number(form.get("qtd")), min = Number(form.get("min"));
  if (!etapaId || !nome) redirect("/producao?erro=" + encodeURIComponent("Informe a etapa e o nome da operação."));
  const seg = qtd > 0 && min > 0 ? (min * 60) / qtd : null;
  try {
    const op = await db.operacao.create({ data: { etapaId, nome, recordeSegPorPeca: seg } });
    if (seg) await db.recorde.create({ data: { operacaoId: op.id, segPorPeca: seg, status: "inicial", decididoPor: u.nome } });
  } catch {
    redirect("/producao?erro=" + encodeURIComponent("Essa operação já existe nessa etapa."));
  }
  await auditar(u.nome, "criou operação", nome);
  revalidatePath("/producao");
}

async function salvarLote(form: FormData) {
  "use server";
  await exigir("producao", "editar");
  const id = Number(form.get("id"));
  const pecas = Number(form.get("pecasPorLote")) || null;
  await db.operacao.update({ where: { id }, data: { pecasPorLote: pecas } });
  revalidatePath("/producao");
}

async function excluirOperacao(form: FormData) {
  "use server";
  const u = await exigir("producao", "excluir");
  const id = Number(form.get("id"));
  const usos = await db.passo.count({ where: { operacaoId: id } });
  if (usos) redirect("/producao?erro=" + encodeURIComponent(`Essa operação está no processo de ${usos} peça(s)/produto(s). Tire dos processos em Produtos antes de excluir.`));
  const aps = await db.apontamento.count({ where: { operacaoId: id } });
  if (aps) await db.operacao.update({ where: { id }, data: { ativo: false } });
  else { await db.recorde.deleteMany({ where: { operacaoId: id } }); await db.itemOperacao.deleteMany({ where: { operacaoId: id } }); await db.operacao.delete({ where: { id } }); }
  await auditar(u.nome, "excluiu operação", `#${id}`);
  revalidatePath("/producao");
}

export default async function Producao({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await exigir("producao");
  const { erro, ok } = await searchParams;
  const [etapas, pendentes, recentes, recordesConfirmados, andamento, lotes, itensFoto] = await Promise.all([
    db.etapa.findMany({ orderBy: { ordem: "asc" }, include: { operacoes: { where: { ativo: true }, orderBy: { nome: "asc" } } } }),
    db.recorde.findMany({ where: { status: "pendente" }, include: { operacao: { include: { etapa: true } }, funcionario: true, apontamento: true }, orderBy: { criadoEm: "desc" } }),
    db.apontamento.findMany({ include: { funcionario: true, operacao: { include: { etapa: true } }, item: true, lote: true }, orderBy: { data: "desc" }, take: 25 }),
    db.recorde.findMany({ where: { status: "confirmado" }, include: { funcionario: true }, orderBy: { criadoEm: "desc" } }),
    db.processoProducao.findMany({ where: { status: "andamento" }, include: { item: true, passo: { include: { operacao: true } }, lote: true, funcionario: true }, orderBy: { inicio: "asc" } }),
    saldosLotes({ status: "aberto" }),
    db.item.findMany({ where: { lotes: { some: { status: "aberto" } } }, select: { id: true, nome: true, codigo: true, foto: true } }),
  ]);
  const fotos = new Map(itensFoto.map((i) => [i.id, i]));
  const cria = pode(u.permissoes, "producao", "criar");
  const exclui = pode(u.permissoes, "producao", "excluir");
  const donoRecorde = new Map<number, string>();
  for (const r of recordesConfirmados) if (!donoRecorde.has(r.operacaoId) && r.funcionario) donoRecorde.set(r.operacaoId, r.funcionario.nome);
  const aprova = pode(u.permissoes, "producao", "aprovar");

  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Produção</h1>
        <div className="acoes">
          <a className="btn sec" href="/estoque-parcial">Estoque parcial</a>
          {cria && <a className="btn sec" href="/producao/novo">+ Iniciar novo processo</a>}
          <a className="btn" href="/apontar">Apontar produção</a>
        </div>
      </div>
      <AbasProducao ativo="producao" />
      {erro && <div className="aviso erro">{erro}</div>}
      {ok && <div className="aviso ok">{ok}</div>}

      <h2>Em andamento ({andamento.length})</h2>
      {andamento.length === 0 ? <p className="suave">Nenhum cronômetro ligado. Use <b>Iniciar novo processo</b> para começar.</p> : (
        <div className="cartoes">
          {andamento.map((pr) => (
            <div className="card" key={pr.id}>
              <div className="com-foto">
                <span className="mini media">{pr.item.foto ? <img src={pr.item.foto} alt="" /> : "sem foto"}</span>
                <span className="t"><b>{pr.passo.operacao.nome}</b><small>{pr.item.nome} · {pr.item.codigo}</small><small>Lote {pr.lote.numero} · {pr.funcionario.nome}</small></span>
              </div>
              <div style={{ margin: "10px 0" }}><Cronometro inicio={pr.inicio.toISOString()} segPausado={pr.segPausado} pausadoEm={pr.pausadoEm?.toISOString() ?? null} /> <span className="suave">desde {dataHora(pr.inicio)}{pr.pausadoEm ? " · pausado" : ""}</span></div>
              {cria && (
                <>
                  <form action={acaoFinalizar} className="linha-form">
                    <input type="hidden" name="id" value={pr.id} />
                    <label>Peças boas<input name="quantidade" type="number" inputMode="numeric" min={0} required style={{ width: "100%" }} /></label>
                    <label>Refugo<input name="refugo" type="number" inputMode="numeric" min={0} defaultValue={0} style={{ width: "100%" }} /></label>
                    <button className="btn">Finalizar</button>
                  </form>
                  <div className="acoes" style={{ marginTop: 8 }}>
                    <form action={acaoPausar}><input type="hidden" name="id" value={pr.id} /><button className="btn sec peq">{pr.pausadoEm ? "▶ Retomar" : "Ⅱ Pausar"}</button></form>
                    {exclui && <Excluir acao={acaoCancelarCronometro} campos={{ id: pr.id }} texto="Cancelar" pergunta="Cancelar este cronômetro? Nada será lançado." />}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <h2>Lotes em produção ({lotes.length})</h2>
      {lotes.length === 0 ? <p className="suave">Nenhum lote aberto.</p> : lotes.map((l) => {
        const it = fotos.get(l.itemId);
        return (
          <div className="card" key={l.loteId}>
            <div className="topo" style={{ marginBottom: 0 }}>
              <div className="com-foto">
                <span className="mini">{it?.foto ? <img src={it.foto} alt="" /> : "sem foto"}</span>
                <span className="t"><b><a href={`/producao/lote/${l.loteId}`}>Lote {l.numero}</a> · {it?.nome}</b><small>{it?.codigo}{l.planejado ? ` · planejado ${num(l.planejado)}` : ""} · {num(l.pronto)} pronta(s)</small></span>
              </div>
              {cria && <a className="btn sec peq" href={`/producao/novo?item=${l.itemId}`}>Próximo processo</a>}
            </div>
            <Trilha passos={l.passos} />
          </div>
        );
      })}

      {pendentes.length > 0 && (
        <>
          <h2>Recordes aguardando confirmação</h2>
          <div className="card tabela">
            <table>
              <thead><tr><th>Operação</th><th>Quem</th><th className="n">Peças</th><th className="n">Minutos</th><th className="n">Peças/h</th><th>Quando</th>{aprova && <th></th>}</tr></thead>
              <tbody>{pendentes.map((r) => (
                <tr key={r.id}>
                  <td>{r.operacao.etapa.nome} — {r.operacao.nome}</td>
                  <td>{r.funcionario?.nome}</td>
                  <td className="n">{num(r.apontamento?.quantidade)}</td>
                  <td className="n">{num(r.apontamento?.minutos, 1)}</td>
                  <td className="n"><b>{num(pecasHora(r.segPorPeca))}</b> <span className="suave">(antes {num(pecasHora(r.operacao.recordeSegPorPeca))})</span></td>
                  <td>{dataHora(r.criadoEm)}</td>
                  {aprova && (
                    <td>
                      <div className="acoes">
                        <form action={decidir}>
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="decisao" value="confirmar" />
                          <button className="btn peq">Confirmar</button>
                        </form>
                        <form action={decidir}>
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="decisao" value="recusar" />
                          <button className="btn sec peq">Recusar</button>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <h2>Últimos apontamentos</h2>
      <div className="card tabela">
        {recentes.length === 0 ? <p className="suave">Nenhum lançamento ainda.</p> : (
          <table>
            <thead><tr><th>Quando</th><th>Quem</th><th>Processo</th><th>Peça · lote</th><th className="n">Peças</th><th className="n">Refugo</th><th className="n">Min</th><th className="n">Peças/h</th><th className="n">% do recorde</th><th className="n">MO/peça</th>{exclui && <th></th>}</tr></thead>
            <tbody>{recentes.map((a) => {
              const rec = pecasHora(a.operacao.recordeSegPorPeca);
              const ph = 3600 / a.segPorPeca;
              return (
                <tr key={a.id}>
                  <td>{dataHora(a.data)}</td><td>{a.funcionario.nome}</td><td>{a.operacao.etapa.nome} — {a.operacao.nome}</td>
                  <td>{a.item ? <>{a.item.codigo}{a.lote && <> · <a href={`/producao/lote/${a.lote.id}`}>{a.lote.numero}</a></>}</> : <span className="suave">—</span>}</td>
                  <td className="n">{num(a.quantidade)}</td><td className="n">{num(a.refugo)}</td><td className="n">{num(a.minutos, 1)}</td>
                  <td className="n">{num(ph)}</td><td className="n">{rec ? `${num((ph / rec) * 100)}%` : "—"}</td>
                  <td className="n">{brl(a.custoPorPeca, 4)}</td>
                  {exclui && <td><Excluir acao={acaoExcluirApontamento} campos={{ id: a.id }} pergunta="Excluir este lançamento? O estoque que ele mexeu volta como estava." /></td>}
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      <details className="editar" style={{ margin: "28px 0 10px" }}>
        <summary style={{ fontSize: "1.05rem" }}>Operações e recordes (metas de cada operação)</summary>

      <p className="suave">A meta de cada operação é o recorde: o menor tempo por peça já confirmado. Os valores iniciais vieram da planilha de julho.</p>
      {etapas.map((e) => (
        <div className="card tabela" key={e.id}>
          <b>{e.nome}</b>
          <table>
            <thead><tr><th>Operação</th><th className="n">Recorde (peças/h)</th><th className="n">Tempo por peça</th><th>Recordista</th><th>Observação</th>{exclui && <th></th>}</tr></thead>
            <tbody>{e.operacoes.map((o) => (
              <tr key={o.id}>
                <td>{o.nome}</td>
                <td className="n">{num(pecasHora(o.recordeSegPorPeca))}</td>
                <td className="n">{o.recordeSegPorPeca ? `${num(o.recordeSegPorPeca, 1)} s` : "—"}</td>
                <td>{donoRecorde.get(o.id) ?? <span className="suave">planilha</span>}</td>
                <td className="suave">
                  {o.porLote ? (
                    <form action={salvarLote} className="acoes">
                      <input type="hidden" name="id" value={o.id} />
                      <input name="pecasPorLote" type="number" min={1} defaultValue={o.pecasPorLote ?? ""} placeholder="Peças por lote" style={{ width: 130 }} />
                      {pode(u.permissoes, "producao", "editar") && <button className="btn sec peq">Salvar</button>}
                    </form>
                  ) : (o.observacao ?? "")}
                </td>
                {exclui && <td><Excluir acao={excluirOperacao} campos={{ id: o.id }} pergunta={`Excluir a operação ${o.nome}?`} /></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}

      {pode(u.permissoes, "producao", "criar") && (
        <div className="card">
          <b>Nova operação</b>
          <form action={novaOperacao} className="campos" style={{ marginTop: 12 }}>
            <label>Etapa<select name="etapa" required>{etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></label>
            <label>Operação / peça<input name="nome" required /></label>
            <label>Peças (tempo inicial)<input name="qtd" type="number" min={1} /></label>
            <label>Em quantos minutos<input name="min" type="number" min={1} step="any" /></label>
            <div className="inteiro"><button className="btn">Adicionar</button></div>
          </form>
        </div>
      )}

            </details>

          </>
  );
}
