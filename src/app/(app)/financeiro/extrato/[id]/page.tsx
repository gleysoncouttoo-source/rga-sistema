import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { CATEGORIAS } from "@/lib/financeiro";
import { categoriaSugerida, conferir, type Conta, type Linha, type Mov } from "@/lib/extrato";
import { brl, dataDia, dataCurta } from "@/lib/formato";
import { dia } from "@/lib/datas";
import AbasFinanceiro from "@/components/AbasFinanceiro";

const CAT_RECEBER = ["Vendas", "Site / Shopee", "Serviços", "Outros"];

async function confirmar(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id"));
  const imp = await db.importacaoExtrato.findUniqueOrThrow({ where: { id } });
  const movs = (imp.dados as { movs: Mov[] }).movs;
  let baixas = 0, novas = 0, ignorados = 0;
  for (const [i, m] of movs.entries()) {
    const v = String(form.get(`m${i}`) ?? "");
    if (!v) continue; // deixar para depois (ou já conferido)
    const data = dia(m.data), valor = Math.abs(m.valor), entrada = m.valor > 0;
    let reg;
    try {
      reg = await db.movimentoBanco.create({ data: { banco: imp.banco, chave: m.chave, data, valor: m.valor, descricao: m.descricao, acao: v.startsWith("baixa") ? "baixa" : v, importacaoId: id, usuario: u.nome } });
    } catch { continue; } // já conferido em outro envio
    if (v.startsWith("baixa:")) {
      const [, tipo, cid] = v.split(":");
      const obs = (antes: string | null, era: number) => Math.abs(era - valor) >= 0.01 ? { valor, observacao: [antes, `no sistema era ${brl(era)}; ${entrada ? "recebido" : "pago"} ${brl(valor)} pelo extrato`].filter(Boolean).join(" · ") } : {};
      if (tipo === "pagar") {
        const c = await db.contaPagar.findUnique({ where: { id: Number(cid) } });
        if (!c || c.status !== "aberto") { await db.movimentoBanco.delete({ where: { id: reg.id } }); continue; }
        await db.contaPagar.update({ where: { id: c.id }, data: { status: "pago", pagoEm: data, banco: c.banco ?? imp.banco, ...obs(c.observacao, c.valor) } });
        await db.movimentoBanco.update({ where: { id: reg.id }, data: { contaPagarId: c.id } });
      } else {
        const c = await db.contaReceber.findUnique({ where: { id: Number(cid) } });
        if (!c || c.status !== "aberto") { await db.movimentoBanco.delete({ where: { id: reg.id } }); continue; }
        await db.contaReceber.update({ where: { id: c.id }, data: { status: "recebido", recebidoEm: data, banco: c.banco ?? imp.banco, ...obs(c.observacao, c.valor) } });
        await db.movimentoBanco.update({ where: { id: reg.id }, data: { contaReceberId: c.id } });
      }
      baixas++;
    } else if (v === "nova") {
      const categoria = String(form.get(`c${i}`) || categoriaSugerida(m.descricao, entrada));
      const base = { descricao: m.descricao.slice(0, 120), categoria, valor, vencimento: data, banco: imp.banco, observacao: "Lançada pelo extrato do banco" };
      if (entrada) {
        const c = await db.contaReceber.create({ data: { ...base, status: "recebido", recebidoEm: data } });
        await db.movimentoBanco.update({ where: { id: reg.id }, data: { contaReceberId: c.id } });
      } else {
        const c = await db.contaPagar.create({ data: { ...base, status: "pago", pagoEm: data } });
        await db.movimentoBanco.update({ where: { id: reg.id }, data: { contaPagarId: c.id } });
      }
      novas++;
    } else ignorados++;
  }
  if (form.get("saldo") === "1" && imp.saldo != null) {
    await db.contaBancaria.upsert({ where: { nome: imp.banco }, create: { nome: imp.banco, saldo: imp.saldo, atualizadoPor: u.nome }, update: { saldo: imp.saldo, atualizadoEm: new Date(), atualizadoPor: u.nome } });
  }
  const conferidos = await db.movimentoBanco.count({ where: { banco: imp.banco, chave: { in: movs.map((m) => m.chave) } } });
  const faltam = movs.length - conferidos;
  const resumo = `${baixas} baixa(s), ${novas} nova(s), ${ignorados} ignorado(s)${faltam ? `, ${faltam} para depois` : ""}`;
  await db.importacaoExtrato.update({ where: { id }, data: { status: faltam ? "parcial" : "conferida", conferidoEm: new Date(), resumo } });
  await auditar(u.nome, "conferiu extrato do banco", `${imp.banco} ${imp.arquivo}: ${resumo}`);
  revalidatePath("/financeiro");
  redirect(`/financeiro/extrato/${id}?ok=` + encodeURIComponent(`Pronto: ${resumo}.`));
}

async function excluir(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id"));
  const imp = await db.importacaoExtrato.delete({ where: { id } });
  await auditar(u.nome, "apagou extrato enviado", `${imp.banco} ${imp.arquivo} (as baixas feitas continuam)`);
  redirect("/financeiro/extrato");
}

const nomeConta = (c: Conta) => `${c.nome} · ${brl(c.valor)} · vence ${dataCurta(c.vencimento)}`;
const Valor = ({ v }: { v: number }) => <b style={{ color: v < 0 ? "var(--erro)" : "var(--ok)", whiteSpace: "nowrap" }}>{v < 0 ? "− " : "+ "}{brl(Math.abs(v))}</b>;

export default async function ConferirExtrato({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const u = await exigir("financeiro");
  const { id } = await params;
  const { ok } = await searchParams;
  const imp = await db.importacaoExtrato.findUnique({ where: { id: Number(id) } });
  if (!imp) notFound();
  const movs = (imp.dados as { movs: Mov[] }).movs;
  const { linhas, faltando } = await conferir(imp.banco, movs);
  const edita = pode(u.permissoes, "financeiro", "editar");
  const bateu = linhas.filter((l) => !l.ja && l.par), semPar = linhas.filter((l) => !l.ja && !l.par), ja = linhas.filter((l) => l.ja);
  const entradas = movs.filter((m) => m.valor > 0).reduce((t, m) => t + m.valor, 0), saidas = movs.filter((m) => m.valor < 0).reduce((t, m) => t - m.valor, 0);
  const contaBanco = await db.contaBancaria.findUnique({ where: { nome: imp.banco } });

  const Cab = ({ extra }: { extra: string }) => <thead><tr><th>Data</th><th>No extrato do banco</th><th className="n">Valor</th><th>{extra}</th></tr></thead>;
  const Lanc = ({ l }: { l: Linha }) => (<>
    <td style={{ whiteSpace: "nowrap" }}>{dataDia(dia(l.data))}</td>
    <td>{l.descricao}{l.doc && <span className="suave" style={{ fontSize: ".8rem" }}> · doc {l.doc}</span>}</td>
    <td className="n"><Valor v={l.valor} /></td>
  </>);

  return (
    <>
      <h1>Financeiro</h1>
      <AbasFinanceiro ativo="extrato" />
      <div className="topo">
        <div>
          <h2 style={{ margin: 0 }}>Extrato {imp.banco}{imp.de ? ` · ${dataDia(imp.de)} a ${dataDia(imp.ate)}` : ""}</h2>
          <div className="suave" style={{ fontSize: ".85rem" }}>{imp.arquivo} · enviado por {imp.usuario}</div>
        </div>
        <div className="acoes">
          <Link className="btn sec peq" href="/financeiro/extrato">‹ Voltar</Link>
          {edita && <form action={excluir}><input type="hidden" name="id" value={imp.id} /><button className="btn sec peq" title="Apaga só o arquivo enviado; as baixas feitas continuam">Apagar envio</button></form>}
        </div>
      </div>
      {ok && <div className="aviso ok">{ok}</div>}

      <div className="grade">
        <div className="kpi"><div className="r">Entradas no extrato</div><div className="v" style={{ color: "var(--ok)" }}>{brl(entradas, 0)}</div></div>
        <div className="kpi"><div className="r">Saídas no extrato</div><div className="v" style={{ color: "var(--erro)" }}>{brl(saidas, 0)}</div></div>
        <div className="kpi"><div className="r">Bateram com o sistema</div><div className="v">{bateu.length}</div><div className="r">de {movs.length} lançamento(s)</div></div>
        <div className="kpi"><div className="r">Para você decidir</div><div className="v" style={{ color: semPar.length ? "var(--alerta)" : undefined }}>{semPar.length}</div>{ja.length > 0 && <div className="r">{ja.length} já conferido(s) antes</div>}</div>
      </div>

      {bateu.length + semPar.length === 0 ? <div className="aviso ok">Tudo deste extrato já foi conferido.</div> : (
        <form action={confirmar}>
          <input type="hidden" name="id" value={imp.id} />
          {bateu.length > 0 && (
            <div className="card tabela" style={{ borderLeft: "5px solid var(--ok)" }}>
              <b>Bateram com contas do sistema ({bateu.length})</b>
              <p className="suave" style={{ margin: "4px 0 0" }}>Mesmo valor e data perto do vencimento. Ao confirmar, a conta fica como paga (ou recebida) no dia do extrato.</p>
              <table>
                <Cab extra="Conta no sistema" />
                <tbody>{bateu.map((l) => (
                  <tr key={l.i}>
                    <Lanc l={l} />
                    <td style={{ minWidth: 260 }}>
                      <div><b>{l.par!.nome}</b> <span className="selo">{l.par!.categoria}</span></div>
                      <div className="suave" style={{ fontSize: ".82rem" }}>vence {dataDia(l.par!.vencimento)}{l.par!.banco && l.par!.banco !== imp.banco ? ` · estava no ${l.par!.banco}` : ""}</div>
                      {edita && (
                        <select name={`m${l.i}`} defaultValue={`baixa:${l.par!.tipo}:${l.par!.id}`} style={{ marginTop: 6, minHeight: 36 }}>
                          <option value={`baixa:${l.par!.tipo}:${l.par!.id}`}>✓ Dar baixa nesta conta</option>
                          <option value="">Não é essa: deixar para depois</option>
                          <option value="nova">Não é essa: lançar como conta nova</option>
                        </select>
                      )}
                      <input type="hidden" name={`c${l.i}`} value={categoriaSugerida(l.descricao, l.valor > 0)} />
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {semPar.length > 0 && (
            <div className="card tabela" style={{ borderLeft: "5px solid var(--alerta)" }}>
              <b>Não achei no sistema ({semPar.length}): escolha o que fazer</b>
              <p className="suave" style={{ margin: "4px 0 0" }}>Pode ser conta que ninguém lançou (tarifa, imposto), pagamento com juros ou desconto, ou transferência entre as suas contas. O que ficar em &quot;deixar para depois&quot; aparece de novo no próximo envio.</p>
              <table>
                <Cab extra="O que fazer" />
                <tbody>{semPar.map((l) => {
                  const cats = l.valor > 0 ? CAT_RECEBER : CATEGORIAS;
                  const sug = categoriaSugerida(l.descricao, l.valor > 0);
                  return (
                    <tr key={l.i}>
                      <Lanc l={l} />
                      <td style={{ minWidth: 280 }}>
                        {edita ? (
                          <div style={{ display: "grid", gap: 6 }}>
                            <select name={`m${l.i}`} defaultValue="" style={{ minHeight: 36 }}>
                              <option value="">Deixar para depois</option>
                              <option value="nova">Lançar como conta nova ({l.valor > 0 ? "já recebida" : "já paga"})</option>
                              {l.perto.length > 0 && <optgroup label={`Dar baixa numa conta ${l.valor > 0 ? "a receber" : "a pagar"}:`}>
                                {l.perto.map((c) => <option key={c.id} value={`baixa:${c.tipo}:${c.id}`}>{nomeConta(c)}</option>)}
                              </optgroup>}
                              <option value="ignorar">Ignorar (transferência entre contas, aplicação...)</option>
                            </select>
                            <label className="suave" style={{ fontSize: ".8rem" }}>Categoria se for conta nova
                              <select name={`c${l.i}`} defaultValue={cats.includes(sug) ? sug : cats[cats.length - 1]} style={{ minHeight: 34 }}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
                            </label>
                          </div>
                        ) : <span className="selo alerta">sem conta no sistema</span>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}

          {edita && (
            <div className="card">
              {imp.saldo != null && (
                <label style={{ flexDirection: "row", alignItems: "center", gap: 8, display: "flex", marginBottom: 12 }}>
                  <input type="checkbox" name="saldo" value="1" defaultChecked />
                  <span>Atualizar o saldo do <b>{imp.banco}</b> para <b>{brl(imp.saldo)}</b> (saldo do extrato{imp.saldoEm ? ` em ${dataDia(imp.saldoEm)}` : ""}{contaBanco ? `; hoje no sistema: ${brl(contaBanco.saldo)}` : ""})</span>
                </label>
              )}
              <button className="btn">Confirmar conferência</button>
            </div>
          )}
        </form>
      )}

      {faltando.length > 0 && (
        <div className="card tabela">
          <b>Contas que venciam nesse período e não apareceram no extrato ({faltando.length})</b>
          <p className="suave" style={{ margin: "4px 0 0" }}>Continuam em aberto. Pode ser que ainda não foram pagas, ou que saíram por outro banco.</p>
          <table><tbody>{faltando.map((c) => (
            <tr key={`${c.tipo}${c.id}`}>
              <td>{dataDia(c.dia)}</td><td>{c.nome}</td><td><span className="selo">{c.tipo === "pagar" ? "a pagar" : "a receber"}</span></td>
              <td className="n"><b>{brl(c.valor)}</b></td>
              <td><Link href={c.tipo === "pagar" ? "/financeiro" : "/financeiro/receber"}>abrir</Link></td>
            </tr>
          ))}</tbody></table>
        </div>
      )}

      {ja.length > 0 && (
        <details className="card tabela">
          <summary style={{ cursor: "pointer" }}><b>Já conferidos antes ({ja.length})</b></summary>
          <table><Cab extra="O que foi feito" /><tbody>{ja.map((l) => (
            <tr key={l.i}><Lanc l={l} /><td><span className="selo ok">{l.ja!.acao === "baixa" ? "baixa dada" : l.ja!.acao === "nova" ? "lançado como conta nova" : "ignorado"}</span>{l.ja!.contaNome && <span className="suave"> · {l.ja!.contaNome}</span>}</td></tr>
          ))}</tbody></table>
        </details>
      )}
    </>
  );
}
