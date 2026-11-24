import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { custoHora, lerConfig } from "@/lib/config";
import { brl, dataHora, num } from "@/lib/formato";
import { dia } from "@/lib/datas";
import { mesAtual, mesValido, nomeMes } from "@/lib/despesasCusto";
import { NOME_ORIGEM, cartoes, hhmm, secullumLigado, sincronizarPonto, statusPonto, totaisDoMes } from "@/lib/secullum";
import IrPara from "@/components/IrPara";

export const maxDuration = 60;

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
// Colunas do cálculo do Secullum que interessam para a folha (as outras ficam no Secullum).
const COLUNAS_FOLHA = /^(normais|extras?|ex\d|faltas?|atras|noturn|dsr|carga|abon|banco)/i;

const ir = (tipo: "ok" | "erro", msg: string, extra = "") => redirect(`/funcionarios/ponto?${tipo}=${encodeURIComponent(msg)}${extra}`);

async function acao(form: FormData) {
  "use server";
  const a = String(form.get("a"));
  if (a === "buscar") {
    const u = await exigir("funcionarios", "editar");
    const dias = [7, 31, 62].includes(Number(form.get("dias"))) ? Number(form.get("dias")) : 7;
    const r = await sincronizarPonto(dias);
    await auditar(u.nome, "buscou batidas do Secullum", r.mensagem);
    revalidatePath("/funcionarios/ponto");
    ir(r.ok ? "ok" : "erro", r.mensagem);
  }
  if (a === "ligar") {
    const u = await exigir("funcionarios", "editar");
    const sid = Number(form.get("secullumId"));
    const p = await db.pontoPessoa.findUniqueOrThrow({ where: { secullumId: sid } });
    const destino = String(form.get("funcionarioId") || "");
    let fid: number;
    if (destino === "novo") {
      const f = await db.funcionario.create({ data: { nome: p.nome, cpf: p.cpf, pis: p.pis, admissao: p.admissao, desligamento: p.demissao, ativo: !p.demissao, cargo: "Funcionário", secullumId: sid } });
      fid = f.id;
      await auditar(u.nome, "cadastrou colaborador pelo ponto", p.nome);
    } else {
      fid = Number(destino);
      if (!fid) ir("erro", "Escolha o colaborador na lista.");
      const f = await db.funcionario.findUniqueOrThrow({ where: { id: fid } });
      await db.funcionario.update({ where: { id: fid }, data: { secullumId: sid, pis: f.pis ?? p.pis, cpf: f.cpf ?? p.cpf } });
      await auditar(u.nome, "ligou colaborador ao ponto", `${p.nome} → ${f.nome}`);
    }
    const ou = [{ secullumFuncId: sid }, ...(p.cpf ? [{ cpf: p.cpf }] : []), ...(p.pis ? [{ pis: p.pis }] : [])];
    await db.batidaPonto.updateMany({ where: { funcionarioId: null, OR: ou }, data: { funcionarioId: fid } });
    revalidatePath("/funcionarios/ponto");
    ir("ok", `${p.nome} ligado. As batidas já aparecem no cartão.`);
  }
}

export default async function Ponto({ searchParams }: { searchParams: Promise<{ mes?: string; f?: string; ok?: string; erro?: string }> }) {
  const u = await exigir("funcionarios");
  const sp = await searchParams;
  const mes = mesValido(sp.mes) ?? mesAtual();
  const [ano, m] = mes.split("-").map(Number);
  const inicio = dia(`${mes}-01`), fim = new Date(Date.UTC(ano, m, 0, 12));
  const fSel = Number(sp.f) || null;

  const [cfg, funcs, porFunc, totais, status, semLigacao, apont, semDono] = await Promise.all([
    lerConfig(),
    db.funcionario.findMany({ where: { OR: [{ ativo: true }, { secullumId: { not: null } }] }, orderBy: { nome: "asc" } }),
    cartoes(inicio, fim),
    totaisDoMes(mes),
    statusPonto(),
    db.pontoPessoa.findMany({ where: { secullumId: { notIn: (await db.funcionario.findMany({ where: { secullumId: { not: null } }, select: { secullumId: true } })).map((f) => f.secullumId!) } }, orderBy: { nome: "asc" } }),
    db.apontamento.groupBy({ by: ["funcionarioId"], where: { data: { gte: new Date(`${mes}-01T03:00:00Z`), lt: new Date(Date.UTC(ano, m, 1, 3)) } }, _sum: { minutos: true } }),
    db.batidaPonto.count({ where: { funcionarioId: null } }),
  ]);
  const prod = new Map(apont.map((a) => [a.funcionarioId, a._sum.minutos ?? 0]));
  const verSal = pode(u.permissoes, "funcionarios", "ver_salario");
  const edita = pode(u.permissoes, "funcionarios", "editar");
  const ligado = secullumLigado();

  // Colunas do Secullum que aparecem em pelo menos um colaborador
  const colunasSec: string[] = [];
  for (const t of totais.values()) for (const c of t.colunas) if (COLUNAS_FOLHA.test(c) && !colunasSec.includes(c)) colunasSec.push(c);
  const valorSec = (fid: number, col: string) => { const t = totais.get(fid); if (!t) return "—"; const i = t.colunas.indexOf(col); return i >= 0 && t.totais[i] ? t.totais[i] : "—"; };

  const linhas = funcs.filter((f) => f.ativo || porFunc.has(f.id)).map((f) => {
    const c = porFunc.get(f.id);
    const ponto = c?.minutos ?? 0, producao = prod.get(f.id) ?? 0;
    const custoMes = f.salario ? (custoHora(f.salario, cfg, f) ?? 0) * cfg.horasMes : null;
    return { f, c, ponto, producao, aproveita: ponto ? (producao / ponto) * 100 : null, custoReal: custoMes && ponto && mes < mesAtual() ? custoMes / (ponto / 60) : null, custoPadrao: custoHora(f.salario, cfg, f) };
  });
  const somaPonto = linhas.reduce((s, l) => s + l.ponto, 0), somaProd = linhas.reduce((s, l) => s + l.producao, 0);

  const hoje = mesAtual();
  const meses: string[] = [];
  for (let i = 0; i < 12; i++) meses.push(new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1 - i, 15)).toISOString().slice(0, 7));
  if (!meses.includes(mes)) meses.push(mes);

  const sel = fSel ? linhas.find((l) => l.f.id === fSel) : null;
  const batidasSel = sel ? await db.batidaPonto.findMany({ where: { funcionarioId: sel.f.id, data: { gte: inicio, lte: fim } }, orderBy: [{ data: "asc" }, { hora: "asc" }] }) : [];
  const origemDe = new Map(batidasSel.map((b) => [`${b.data.toISOString().slice(0, 10)} ${b.hora}`, b.origem]));

  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Cartão de ponto</h1>
        <div className="acoes">
          <IrPara rotulo="Mês" valor={`/funcionarios/ponto?mes=${mes}${fSel ? `&f=${fSel}` : ""}`} opcoes={meses.map((x) => ({ href: `/funcionarios/ponto?mes=${x}${fSel ? `&f=${fSel}` : ""}`, nome: nomeMes(x) }))} />
        </div>
      </div>
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}

      <div className="card">
        <div className="topo" style={{ marginBottom: 0, flexWrap: "wrap", gap: 12 }}>
          <div>
            <b>Relógio Secullum Ponto Web</b>{" "}
            {!ligado ? <span className="selo alerta">não ligado</span> : status?.ok ? <span className="selo ok">ligado</span> : status ? <span className="selo erro">com erro</span> : <span className="selo">ainda não buscou</span>}
            <div className="suave" style={{ fontSize: ".88rem", marginTop: 4 }}>
              {!ligado
                ? "Falta colocar o e-mail e a senha da conta Secullum nas variáveis da Vercel (SECULLUM_EMAIL e SECULLUM_SENHA)."
                : status ? <>Última busca {dataHora(status.em)}: {status.msg}</> : "As batidas são buscadas sozinhas todo dia às 6h da manhã (o dia anterior completo). Você também pode buscar agora."}
            </div>
          </div>
          {edita && ligado && (
            <form action={acao} className="acoes">
              <input type="hidden" name="a" value="buscar" />
              <label className="ir-para">Período
                <select name="dias" defaultValue="7">
                  <option value="7">Últimos 7 dias</option>
                  <option value="31">Últimos 31 dias</option>
                  <option value="62">Últimos 2 meses</option>
                </select>
              </label>
              <button className="btn">Buscar batidas agora</button>
            </form>
          )}
        </div>
      </div>

      <div className="grade">
        <div className="kpi"><div className="r">Horas no ponto ({nomeMes(mes)})</div><div className="v">{hhmm(somaPonto)}</div></div>
        <div className="kpi"><div className="r">Horas lançadas na produção</div><div className="v">{hhmm(somaProd)}</div></div>
        <div className="kpi"><div className="r">Aproveitamento</div><div className="v">{somaPonto ? `${num((somaProd / somaPonto) * 100)}%` : "—"}</div><div className="r">tempo de produção ÷ tempo no ponto</div></div>
        <div className="kpi"><div className="r">Dias com batida faltando</div><div className="v">{linhas.reduce((s, l) => s + (l.c?.incompletos ?? 0), 0)}</div><div className="r">número ímpar de batidas no dia</div></div>
      </div>

      <h2>Resumo do mês por colaborador</h2>
      <div className="card tabela">
        {linhas.length === 0 ? <p className="suave">Nenhum colaborador cadastrado.</p> : (
          <table>
            <thead><tr>
              <th>Colaborador</th><th className="n">Dias</th><th className="n">Horas no ponto</th><th className="n">Na produção</th><th className="n">Aproveit.</th><th className="n">Batida faltando</th>
              {colunasSec.map((c) => <th key={c} className="n" title="Calculado pelo Secullum">{c}</th>)}
              {verSal && <th className="n" title="Salário + encargos + benefícios ÷ horas no ponto">Custo real da hora</th>}
            </tr></thead>
            <tbody>{linhas.map((l) => (
              <tr key={l.f.id} style={l.f.id === fSel ? { background: "var(--destaque, #fff7e6)" } : undefined}>
                <td><Link href={`/funcionarios/ponto?mes=${mes}&f=${l.f.id}`}>{l.f.nome}</Link>{!l.f.secullumId && <span className="selo" title="Não ligado ao relógio">sem relógio</span>}</td>
                <td className="n">{l.c?.dias.length ?? 0}</td>
                <td className="n">{hhmm(l.ponto)}</td>
                <td className="n">{hhmm(l.producao)}</td>
                <td className="n">{l.aproveita != null ? `${num(l.aproveita)}%` : "—"}</td>
                <td className="n">{l.c?.incompletos ? <b style={{ color: "var(--alerta, #b7791f)" }}>{l.c.incompletos}</b> : "—"}</td>
                {colunasSec.map((c) => <td key={c} className="n">{valorSec(l.f.id, c)}</td>)}
                {verSal && <td className="n">{l.custoReal ? <>{brl(l.custoReal)}{l.custoPadrao ? <div className="suave" style={{ fontSize: ".78rem" }}>padrão {brl(l.custoPadrao)}</div> : null}</> : "—"}</td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p className="suave">Horas no ponto = soma de cada par entrada → saída das batidas. As colunas de extras, faltas e atrasos vêm do cálculo do próprio Secullum, com as regras de horário cadastradas lá. Custo real da hora = custo do mês do colaborador (salário + encargos + benefícios) ÷ horas que ele bateu no ponto; aparece quando o mês fecha.</p>

      <h2 id="cartao">Cartão do colaborador</h2>
      <div className="card">
        <IrPara rotulo="Colaborador" valor={`/funcionarios/ponto?mes=${mes}${fSel ? `&f=${fSel}` : ""}#cartao`}
          opcoes={[{ href: `/funcionarios/ponto?mes=${mes}#cartao`, nome: "Escolha o colaborador" }, ...linhas.map((l) => ({ href: `/funcionarios/ponto?mes=${mes}&f=${l.f.id}#cartao`, nome: l.f.nome }))]} />
        {sel && (
          !sel.c?.dias.length ? <p className="suave">Nenhuma batida de {sel.f.nome} em {nomeMes(mes)}.</p> : (
            <div className="tabela" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Dia</th><th>Batidas</th><th className="n">Horas</th><th></th></tr></thead>
                <tbody>{sel.c.dias.map((d) => (
                  <tr key={d.data.toISOString()}>
                    <td>{d.data.toLocaleDateString("pt-BR", { timeZone: "UTC" })} <span className="suave">{SEMANA[d.data.getUTCDay()]}</span></td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{d.horas.map((h, i) => {
                      const o = origemDe.get(`${d.data.toISOString().slice(0, 10)} ${h}`);
                      return <span key={h} title={o != null ? NOME_ORIGEM[o] : undefined} style={{ marginRight: 10, ...(o != null && o !== 1 ? { textDecoration: "underline dotted" } : {}) }}>{i % 2 === 0 ? "↘" : "↗"} {h}</span>;
                    })}</td>
                    <td className="n">{hhmm(d.minutos)}</td>
                    <td>{d.incompleto && <span className="selo alerta">falta batida</span>}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><th>Total</th><th></th><th className="n">{hhmm(sel.ponto)}</th><th></th></tr></tfoot>
              </table>
              <p className="suave" style={{ fontSize: ".85rem" }}>↘ entrada · ↗ saída. Sublinhado pontilhado = batida que não veio do relógio (incluída à mão ou pelo app).</p>
            </div>
          )
        )}
      </div>

      {(semLigacao.length > 0 || semDono > 0) && (
        <>
          <h2>Pessoas do relógio sem ligação ({semLigacao.length})</h2>
          <div className="card tabela">
            <p className="suave" style={{ marginTop: 0 }}>Estas pessoas estão no Secullum, mas não achei o colaborador com o mesmo CPF ou nome aqui. Escolha quem é, ou cadastre como novo.{semDono ? ` ${semDono} batida(s) esperando a ligação.` : ""}</p>
            {semLigacao.length > 0 && (
              <table>
                <thead><tr><th>No relógio</th><th>CPF</th><th>Ligar a</th></tr></thead>
                <tbody>{semLigacao.map((p) => (
                  <tr key={p.secullumId}>
                    <td>{p.nome}{p.demissao && <span className="selo">demitido</span>}</td>
                    <td>{p.cpf ? p.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "—"}</td>
                    <td>{edita ? (
                      <form action={acao} className="acoes">
                        <input type="hidden" name="a" value="ligar" />
                        <input type="hidden" name="secullumId" value={p.secullumId} />
                        <select name="funcionarioId" defaultValue="" required>
                          <option value="" disabled>Escolha…</option>
                          <option value="novo">+ Cadastrar como novo colaborador</option>
                          {funcs.filter((f) => !f.secullumId).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                        </select>
                        <button className="btn sec peq">Ligar</button>
                      </form>
                    ) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
