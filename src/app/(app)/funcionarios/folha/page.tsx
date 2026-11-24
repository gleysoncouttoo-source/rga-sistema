import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, dataHora, num } from "@/lib/formato";
import { mesAtual, mesValido, nomeMes } from "@/lib/despesasCusto";
import { configEnvio, enviarEmail } from "@/lib/envio";
import { diaPagamentoSalario, enesimoDiaUtil } from "@/lib/financeiro";
import { hhmm, statusPonto } from "@/lib/secullum";
import { csvEspelho, csvMovimento, emailContador, fecharFolha, folhaDoMes, reabrirFolha } from "@/lib/folha";
import IrPara from "@/components/IrPara";

export const maxDuration = 300;

const mesAnterior = () => { const h = mesAtual(); const d = new Date(Date.UTC(Number(h.slice(0, 4)), Number(h.slice(5, 7)) - 2, 15)); return d.toISOString().slice(0, 7); };
const proximoMes = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 15)).toISOString().slice(0, 7);
const ir = (mes: string, tipo: "ok" | "erro", msg: string) => redirect(`/funcionarios/folha?mes=${mes}&${tipo}=${encodeURIComponent(msg)}`);

async function acao(form: FormData) {
  "use server";
  const u = await exigir("funcionarios", "editar");
  if (!pode(u.permissoes, "funcionarios", "ver_salario")) redirect("/funcionarios/folha?erro=" + encodeURIComponent("Seu login não vê salários."));
  const mes = mesValido(String(form.get("mes"))) ?? mesAnterior();
  const a = String(form.get("a"));
  if (a === "fechar") {
    const f = await fecharFolha(mes, u.nome);
    await auditar(u.nome, "fechou a folha", `${nomeMes(mes)} · ${f.linhas.length} colaborador(es) · bruto ${brl(f.linhas.reduce((s, l) => s + l.bruto, 0))}`);
    revalidatePath("/funcionarios/folha");
    ir(mes, "ok", `Folha de ${nomeMes(mes)} fechada. Os valores ficaram congelados e o custo real da hora já vale no custo dos produtos.`);
  }
  if (a === "reabrir") {
    await reabrirFolha(mes);
    await auditar(u.nome, "reabriu a folha", nomeMes(mes));
    revalidatePath("/funcionarios/folha");
    ir(mes, "ok", `Folha de ${nomeMes(mes)} reaberta. Ela volta a seguir o ponto.`);
  }
  if (a === "contador") {
    const email = String(form.get("email") || "").trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) ir(mes, "erro", "E-mail do contador inválido.");
    await db.configuracao.upsert({ where: { chave: "contadorEmail" }, create: { chave: "contadorEmail", valor: email }, update: { valor: email } });
    revalidatePath("/funcionarios/folha");
    ir(mes, "ok", email ? `E-mail do contador salvo: ${email}.` : "E-mail do contador apagado.");
  }
  if (a === "enviar") {
    const email = await emailContador();
    if (!email) ir(mes, "erro", "Coloque o e-mail do contador primeiro.");
    const f = await folhaDoMes(mes);
    if (!f.fechada) ir(mes, "erro", "Feche a folha antes de enviar ao contador.");
    const enc = new TextEncoder();
    const texto = `Olá! Segue o movimento da folha de ${nomeMes(mes)} da R.G.A, tirado do cartão de ponto (Secullum): horas extras, adicional noturno, faltas, atrasos e afastamentos de cada colaborador, e o espelho de ponto com todas as batidas.\n\nOs valores em R$ são uma prévia nossa; INSS, IRRF, FGTS e demais descontos ficam com vocês. Quando a folha estiver pronta, por favor nos mandem o líquido de cada um.\n\nObrigado!`;
    let falha = "";
    try {
      await enviarEmail(email, `Folha de ${nomeMes(mes)} — R.G.A`, texto, [
        { nome: `folha-movimento-${mes}.csv`, tipo: "text/csv", dados: enc.encode(csvMovimento(mes, f.linhas)) },
        { nome: `espelho-de-ponto-${mes}.csv`, tipo: "text/csv", dados: enc.encode(await csvEspelho(mes)) },
      ]);
    } catch (e) { falha = e instanceof Error ? e.message : String(e); }
    if (falha) ir(mes, "erro", falha);
    await db.folhaMes.update({ where: { mes }, data: { enviadaEm: new Date(), enviadaPara: email } });
    await auditar(u.nome, "enviou a folha ao contador", `${nomeMes(mes)} → ${email}`);
    revalidatePath("/funcionarios/folha");
    ir(mes, "ok", `Enviado para ${email}.`);
  }
  if (a === "marcar-enviada") {
    await db.folhaMes.update({ where: { mes }, data: { enviadaEm: new Date(), enviadaPara: (await emailContador()) || "enviado à mão" } });
    revalidatePath("/funcionarios/folha");
    ir(mes, "ok", "Marcada como enviada ao contador.");
  }
  if (a === "liquidos") {
    const folha = await db.folhaMes.findUnique({ where: { mes }, include: { pessoas: { include: { funcionario: true } } } });
    if (folha?.status !== "fechada") ir(mes, "erro", "Feche a folha antes de lançar os líquidos.");
    const competencia = proximoMes(mes);
    const venc = enesimoDiaUtil(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)) - 1, await diaPagamentoSalario());
    let n = 0;
    for (const p of folha!.pessoas) {
      const bruto = String(form.get(`liq_${p.funcionarioId}`) ?? "").trim();
      if (!bruto) continue;
      const v = Number(bruto.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(v) || v <= 0) continue;
      await db.folhaPessoa.update({ where: { id: p.id }, data: { liquido: v } });
      const f = p.funcionario;
      const conta = await db.contaPagar.findUnique({ where: { funcionarioId_competencia: { funcionarioId: f.id, competencia } } });
      if (conta && conta.status === "pago") continue;
      if (conta) await db.contaPagar.update({ where: { id: conta.id }, data: { valor: v, folhaMes: mes } });
      else await db.contaPagar.create({ data: { descricao: `Salário — ${f.nome}`, categoria: "Colaboradores", valor: v, vencimento: venc, funcionarioId: f.id, competencia, status: "aberto", formaPagamento: f.chavePix ? "pix" : null, chavePix: f.chavePix, favorecido: f.nome, folhaMes: mes } });
      n++;
    }
    await auditar(u.nome, "lançou líquidos da folha", `${nomeMes(mes)} · ${n} colaborador(es)`);
    revalidatePath("/funcionarios/folha"); revalidatePath("/financeiro");
    ir(mes, "ok", `${n} líquido(s) salvo(s). As contas de salário em Financeiro → Contas a pagar já estão com esses valores.`);
  }
}

export default async function Folha({ searchParams }: { searchParams: Promise<{ mes?: string; f?: string; ok?: string; erro?: string }> }) {
  const u = await exigir("funcionarios");
  const sp = await searchParams;
  if (!pode(u.permissoes, "funcionarios", "ver_salario")) return <><h1>Folha do mês</h1><div className="aviso erro">Seu login não tem acesso a salários. Peça ao diretor.</div></>;
  const mes = mesValido(sp.mes) ?? mesAnterior();
  const edita = pode(u.permissoes, "funcionarios", "editar");
  const [folha, status, contador] = await Promise.all([folhaDoMes(mes), statusPonto(), emailContador()]);
  const { linhas, fechada, info } = folha;
  const fSel = Number(sp.f) || null;
  const sel = fSel ? linhas.find((l) => l.funcionario.id === fSel) : null;
  const envio = configEnvio();
  const soma = (k: (l: (typeof linhas)[number]) => number) => linhas.reduce((s, l) => s + k(l), 0);
  const extrasMin = soma((l) => l.horas.extras.reduce((s, x) => s + x.min, 0));
  const semCalculo = linhas.filter((l) => !l.temCalculo).length;
  const temNoturno = linhas.some((l) => l.horas.noturno > 0);

  const hoje = mesAtual();
  const meses: string[] = [];
  for (let i = 0; i < 12; i++) meses.push(new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1 - i, 15)).toISOString().slice(0, 7));
  if (!meses.includes(mes)) meses.push(mes);
  const base = `/funcionarios/folha?mes=${mes}`;

  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Folha do mês</h1>
        <div className="acoes"><IrPara rotulo="Mês" valor={base} opcoes={meses.map((x) => ({ href: `/funcionarios/folha?mes=${x}`, nome: nomeMes(x) }))} /></div>
      </div>
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}

      <div className="card">
        <div className="topo" style={{ marginBottom: 0, flexWrap: "wrap", gap: 12 }}>
          <div>
            <b>{nomeMes(mes)}</b>{" "}
            {fechada ? <span className="selo ok">fechada</span> : <span className="selo alerta">prévia</span>}{" "}
            {info?.enviadaEm && <span className="selo ok">enviada ao contador</span>}
            <div className="suave" style={{ fontSize: ".88rem", marginTop: 4 }}>
              {fechada
                ? <>Fechada em {dataHora(info!.fechadaEm)} por {info!.fechadaPor}.{info?.enviadaEm ? ` Enviada para ${info.enviadaPara} em ${dataHora(info.enviadaEm)}.` : ""}</>
                : <>Prévia: os números mudam conforme o ponto. {status ? `Ponto buscado em ${dataHora(status.em)}.` : "O ponto ainda não foi buscado."} <Link href={`/funcionarios/ponto?mes=${mes}`}>Ver cartão de ponto</Link></>}
            </div>
          </div>
          {edita && (
            <form action={acao} className="acoes">
              <input type="hidden" name="mes" value={mes} />
              {fechada
                ? <button className="btn sec" name="a" value="reabrir">Reabrir folha</button>
                : <button className="btn" name="a" value="fechar" disabled={!linhas.length}>Fechar folha de {nomeMes(mes).split(" ")[0]}</button>}
            </form>
          )}
        </div>
        {!fechada && semCalculo > 0 && <p className="suave" style={{ marginBottom: 0 }}>⚠ {semCalculo} colaborador(es) sem o cálculo do Secullum neste mês (extras, faltas e atrasos ficam zerados). Busque o ponto na aba Cartão de ponto.</p>}
      </div>

      <div className="grade">
        <div className="kpi"><div className="r">Bruto da folha{fechada ? "" : " (prévia)"}</div><div className="v">{brl(soma((l) => l.bruto))}</div><div className="r">{linhas.length} colaborador(es)</div></div>
        <div className="kpi"><div className="r">Custo total para a empresa</div><div className="v">{brl(soma((l) => l.custoTotal))}</div><div className="r">bruto + encargos + benefícios</div></div>
        <div className="kpi"><div className="r">Horas extras</div><div className="v">{hhmm(extrasMin)}</div><div className="r">{brl(soma((l) => l.eventos.filter((e) => e.codigo.startsWith("HE") || e.codigo === "DSR").reduce((s, e) => s + e.provento, 0)))} com DSR</div></div>
        <div className="kpi"><div className="r">Faltas e atrasos</div><div className="v">{hhmm(soma((l) => l.horas.faltas + l.horas.atrasos))}</div><div className="r">{brl(soma((l) => l.descontos))} descontados</div></div>
      </div>

      <h2>Colaboradores</h2>
      <form action={acao}>
        <input type="hidden" name="mes" value={mes} />
        <input type="hidden" name="a" value="liquidos" />
        <div className="card tabela">
          {linhas.length === 0 ? <p className="suave">Nenhum colaborador com salário cadastrado.</p> : (
            <table>
              <thead><tr>
                <th>Colaborador</th><th className="n">Salário</th><th className="n">Horas no ponto</th><th className="n">Extras</th>{temNoturno && <th className="n">Noturno</th>}<th className="n">Faltas · atrasos</th>
                <th className="n">+ Variáveis</th><th className="n">− Descontos</th><th className="n">Bruto</th><th className="n">Custo empresa</th><th className="n">Custo real da hora</th>
                {fechada && <th className="n">Líquido (contador)</th>}
              </tr></thead>
              <tbody>{linhas.map((l) => (
                <tr key={l.funcionario.id} style={l.funcionario.id === fSel ? { background: "#fff7e6" } : undefined}>
                  <td>
                    <Link href={`${base}&f=${l.funcionario.id}#holerite`}>{l.funcionario.nome}</Link>
                    {l.afastamentos.length > 0 && <div className="suave" style={{ fontSize: ".78rem" }}>{l.afastamentos.join(" · ")}</div>}
                    {!l.temCalculo && <span className="selo">sem cálculo do ponto</span>}
                  </td>
                  <td className="n">{brl(l.salario)}</td>
                  <td className="n">{hhmm(l.minutosPonto)}</td>
                  <td className="n">{l.horas.extras.length ? l.horas.extras.map((x) => <div key={x.nome}>{hhmm(x.min)} <span className="suave">{x.pct}%</span></div>) : "—"}</td>
                  {temNoturno && <td className="n">{l.horas.noturno ? hhmm(l.horas.noturno) : "—"}</td>}
                  <td className="n">{l.horas.faltas ? <div>{hhmm(l.horas.faltas)} <span className="suave">falta</span></div> : null}{l.horas.atrasos ? <div>{hhmm(l.horas.atrasos)} <span className="suave">atraso</span></div> : null}{!l.horas.faltas && !l.horas.atrasos && "—"}</td>
                  <td className="n">{brl(l.proventos - l.salario)}</td>
                  <td className="n">{l.descontos ? brl(-l.descontos) : "—"}</td>
                  <td className="n"><b>{brl(l.bruto)}</b></td>
                  <td className="n">{brl(l.custoTotal)}</td>
                  <td className="n">{l.custoHoraReal ? brl(l.custoHoraReal) : "—"}</td>
                  {fechada && <td className="n">{edita ? <input name={`liq_${l.funcionario.id}`} defaultValue={l.liquido != null ? num(l.liquido, 2) : ""} placeholder="0,00" inputMode="decimal" style={{ width: 110, textAlign: "right" }} /> : brl(l.liquido)}</td>}
                </tr>
              ))}</tbody>
              <tfoot><tr>
                <th>Total</th><th className="n">{brl(soma((l) => l.salario))}</th><th className="n">{hhmm(soma((l) => l.minutosPonto))}</th><th className="n">{hhmm(extrasMin)}</th>{temNoturno && <th></th>}<th></th>
                <th className="n">{brl(soma((l) => l.proventos - l.salario))}</th><th className="n">{brl(-soma((l) => l.descontos))}</th><th className="n">{brl(soma((l) => l.bruto))}</th><th className="n">{brl(soma((l) => l.custoTotal))}</th><th></th>
                {fechada && <th className="n">{brl(soma((l) => l.liquido ?? 0))}</th>}
              </tr></tfoot>
            </table>
          )}
        </div>
        {fechada && edita && <div className="acoes" style={{ marginTop: -6, marginBottom: 12 }}><button className="btn">Salvar líquidos e atualizar contas de salário</button><span className="suave" style={{ fontSize: ".85rem" }}>Os valores vão para a conta de salário de {nomeMes(proximoMes(mes))} em Financeiro → Contas a pagar.</span></div>}
      </form>
      <p className="suave">Valor da hora = salário ÷ horas/mês. Extras = horas × valor da hora × (1 + %). Adicional noturno = 20% da hora. DSR = (extras + noturno) ÷ dias úteis × domingos e feriados. Faltas e atrasos descontam as horas. As horas vêm do cálculo do Secullum, com as regras de horário cadastradas lá. INSS, IRRF, FGTS, vale-transporte e outros descontos ficam com o contador.</p>

      <h2 id="holerite">Prévia do holerite</h2>
      <div className="card">
        <IrPara rotulo="Colaborador" valor={`${base}${fSel ? `&f=${fSel}` : ""}#holerite`} opcoes={[{ href: `${base}#holerite`, nome: "Escolha o colaborador" }, ...linhas.map((l) => ({ href: `${base}&f=${l.funcionario.id}#holerite`, nome: l.funcionario.nome }))]} />
        {sel && (
          <div className="tabela" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Cód.</th><th>Evento</th><th className="n">Referência</th><th className="n">Proventos</th><th className="n">Descontos</th></tr></thead>
              <tbody>{sel.eventos.map((e) => <tr key={e.codigo}><td>{e.codigo}</td><td>{e.nome}</td><td className="n">{e.referencia}</td><td className="n">{e.provento ? brl(e.provento) : ""}</td><td className="n">{e.desconto ? brl(e.desconto) : ""}</td></tr>)}</tbody>
              <tfoot>
                <tr><th></th><th>Totais</th><th></th><th className="n">{brl(sel.proventos)}</th><th className="n">{brl(sel.descontos)}</th></tr>
                <tr><th></th><th>Bruto antes de INSS/IRRF</th><th></th><th className="n" colSpan={2}>{brl(sel.bruto)}</th></tr>
              </tfoot>
            </table>
            <p className="suave" style={{ fontSize: ".85rem" }}>Encargos {brl(sel.encargos)} · benefícios {brl(sel.beneficios)} · custo para a empresa {brl(sel.custoTotal)} · {hhmm(sel.minutosPonto)} no ponto em {sel.diasPonto} dia(s){sel.incompletos ? ` · ${sel.incompletos} dia(s) com batida faltando` : ""}.</p>
          </div>
        )}
      </div>

      <h2>Enviar ao contador</h2>
      <div className="card">
        <div className="acoes" style={{ flexWrap: "wrap", marginBottom: 12 }}>
          <a className="btn sec" href={`/funcionarios/folha/exportar?mes=${mes}`}>Baixar planilha do mês</a>
          <a className="btn sec" href={`/funcionarios/folha/exportar?mes=${mes}&tipo=espelho`}>Baixar espelho de ponto</a>
          <a className="btn sec" href={`/funcionarios/folha/espelho?mes=${mes}`} target="_blank">Espelho para imprimir / PDF</a>
        </div>
        {edita && (
          <form action={acao} className="acoes" style={{ flexWrap: "wrap" }}>
            <input type="hidden" name="mes" value={mes} />
            <label className="ir-para">E-mail do contador <input name="email" type="email" defaultValue={contador} placeholder="contador@escritorio.com.br" style={{ minWidth: 260 }} /></label>
            <button className="btn sec peq" name="a" value="contador">Salvar</button>
          </form>
        )}
        <p className="suave" style={{ marginBottom: 0 }}>
          {!fechada ? "Feche a folha para enviar." : envio.email && contador
            ? <>Vai a planilha do mês e o espelho de ponto, com um texto pedindo o líquido de cada um.</>
            : <>O envio automático por e-mail ainda não está ligado (falta o Resend na Vercel). Baixe os dois arquivos e mande pelo seu e-mail{contador ? <> — <a href={`mailto:${contador}?subject=${encodeURIComponent(`Folha de ${nomeMes(mes)} — R.G.A`)}&body=${encodeURIComponent(`Olá! Seguem em anexo o movimento da folha de ${nomeMes(mes)} e o espelho de ponto. Quando a folha estiver pronta, por favor nos mandem o líquido de cada um. Obrigado!`)}`}>abrir e-mail pronto</a></> : ""}.</>}
        </p>
        {fechada && edita && (
          <form action={acao} className="acoes" style={{ marginTop: 12 }}>
            <input type="hidden" name="mes" value={mes} />
            {envio.email && contador && <button className="btn" name="a" value="enviar">Enviar para {contador}</button>}
            {!info?.enviadaEm && <button className="btn sec peq" name="a" value="marcar-enviada">Já mandei, marcar como enviada</button>}
          </form>
        )}
      </div>
    </>
  );
}
