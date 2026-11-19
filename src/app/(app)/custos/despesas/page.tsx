import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, dataDia, num } from "@/lib/formato";
import { contasDoMes, grupoDa, mesAtual, mesDoCusto, mesValido, MOTIVO_FORA, nomeMes, regrasGrupos } from "@/lib/despesasCusto";
import { custosUnitarios, tempoTxt } from "@/lib/custoProduto";
import IrPara from "@/components/IrPara";
import MarcarAuto from "@/components/MarcarAuto";

function revalidar() {
  for (const p of ["/custos/despesas", "/custos", "/lucros", "/vendas/anuncios"]) revalidatePath(p);
}

/** Marca ou desmarca uma categoria inteira; as contas dela no mês voltam a seguir a categoria. */
async function marcarGrupo(form: FormData) {
  "use server";
  const u = await exigir("custos", "editar");
  const grupo = String(form.get("grupo") || ""), entra = form.get("entra") === "on", mes = mesValido(String(form.get("mes"))) ?? mesAtual();
  const regras = await regrasGrupos();
  regras[grupo] = entra;
  await db.configuracao.upsert({ where: { chave: "custoGrupos" }, update: { valor: JSON.stringify(regras) }, create: { chave: "custoGrupos", valor: JSON.stringify(regras) } });
  const r = await contasDoMes(mes);
  const ids = r.grupos.find((g) => g.nome === grupo)?.contas.map((c) => c.id) ?? [];
  if (ids.length) await db.contaPagar.updateMany({ where: { id: { in: ids } }, data: { noCusto: null } });
  await auditar(u.nome, entra ? "colocou no custo dos produtos" : "tirou do custo dos produtos", grupo);
  revalidar();
}

/** Marca ou desmarca uma conta só (fica "escolhida à mão" se for diferente da categoria). */
async function marcarConta(form: FormData) {
  "use server";
  const u = await exigir("custos", "editar");
  const id = Number(form.get("id")), entra = form.get("entra") === "on";
  const c = await db.contaPagar.findUnique({ where: { id } });
  if (!c) return;
  const regras = await regrasGrupos();
  const regra = regras[grupoDa(c)] ?? true;
  await db.contaPagar.update({ where: { id }, data: { noCusto: entra === regra ? null : entra } });
  await auditar(u.nome, entra ? "colocou conta no custo dos produtos" : "tirou conta do custo dos produtos", `#${id} ${c.descricao}`);
  revalidar();
}

async function usarMes(form: FormData) {
  "use server";
  const u = await exigir("custos", "editar");
  const mes = mesValido(String(form.get("mes")));
  if (!mes) return;
  await db.configuracao.upsert({ where: { chave: "custoMesDespesas" }, update: { valor: mes }, create: { chave: "custoMesDespesas", valor: mes } });
  await auditar(u.nome, "mudou o mês das contas no custo", mes);
  revalidar();
}

export default async function ContasNoCusto({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const u = await exigir("custos");
  const sp = await searchParams;
  const usado = await mesDoCusto();
  const mes = mesValido(sp.mes) ?? usado;
  const [r, custo] = await Promise.all([contasDoMes(mes), custosUnitarios(undefined, 30, mes)]);
  const rt = custo.rateio;
  const itens = await db.item.findMany({ where: { id: { in: [...r.unidades.keys()] } }, select: { id: true, codigo: true, nome: true, foto: true }, orderBy: { codigo: "asc" } });
  const feitas = itens.map((i) => ({ ...i, q: r.unidades.get(i.id) ?? 0, c: custo(i.id) })).filter((f) => f.q > 0);
  const edita = pode(u.permissoes, "custos", "editar");

  // últimos 12 meses na lista suspensa
  const hoje = mesAtual();
  const meses: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1 - i, 15));
    meses.push(d.toISOString().slice(0, 7));
  }
  if (!meses.includes(mes)) meses.push(mes);
  const fora = r.total - r.noCusto;

  return (
    <>
      <h1>Contas no custo</h1>
      <p className="suave">
        Todas as contas pagas no mês (Contas a pagar, Histórico de pagamentos e pagamentos lançados). Marque o que entra no custo dos produtos.
        O total marcado é dividido pelas horas de produção do mês: cada fechadura leva a parte do tempo que gasta para ser feita. Esse valor vai para a coluna “despesas” do custo de cada fechadura, em <Link href="/custos">Custos</Link> e <Link href="/lucros">Lucros</Link>.
      </p>

      <div className="card linha-form" style={{ justifyContent: "space-between" }}>
        <IrPara rotulo="Mês" valor={`/custos/despesas?mes=${mes}`} opcoes={meses.map((m) => ({ href: `/custos/despesas?mes=${m}`, nome: nomeMes(m) }))} />
        {mes === usado ? (
          <span className="selo-etapa">Este é o mês usado no custo dos produtos</span>
        ) : (
          <span className="acoes">
            <span className="suave">O custo dos produtos usa as contas de <b>{nomeMes(usado)}</b>.</span>
            {edita && <form action={usarMes}><input type="hidden" name="mes" value={mes} /><button className="btn sec peq">Usar {nomeMes(mes)}</button></form>}
          </span>
        )}
      </div>

      <div className="grade">
        <div className="kpi"><div className="r">Pago no mês</div><div className="v">{brl(r.total, 0)}</div><div className="r">{num(r.grupos.reduce((s, g) => s + g.contas.length, 0))} contas</div></div>
        <div className="kpi"><div className="r">Entra no custo</div><div className="v">{brl(r.noCusto, 0)}</div><div className="r">marcado abaixo</div></div>
        <div className="kpi"><div className="r">Fica fora</div><div className="v">{brl(fora, 0)}</div><div className="r">material, mão de obra e o que você desmarcou</div></div>
        <div className="kpi"><div className="r">Horas de produção</div><div className="v">{num(rt.horas, 1)} h</div><div className="r">{num(r.base.un)} fechaduras {r.base.por === "vendidas" ? "vendidas (sem produção lançada)" : "produzidas"}</div></div>
        {rt.modo === "igual"
          ? <div className="kpi"><div className="r">Despesa por fechadura</div><div className="v">{brl(rt.porUnidade)}</div><div className="r">dividido igual: falta tempo de produção</div></div>
          : <div className="kpi"><div className="r">Despesa por hora de produção</div><div className="v">{brl(rt.porHora)}</div><div className="r">{brl(r.noCusto, 0)} ÷ {num(rt.horas, 1)} h</div></div>}
      </div>

      {rt.modo === "pct" && r.noCusto > 0 && <div className="aviso alerta">Nenhuma fechadura produzida nem vendida neste mês: as contas ainda não têm por onde ser divididas. Enquanto isso o custo usa o % de despesas da tela Lucros.</div>}
      {rt.modo === "igual" && <div className="aviso alerta">Sem tempo de produção para {rt.semTempo.join(", ")}: enquanto isso as contas são divididas igual por fechadura. O tempo vem do cronômetro dos lotes (ou do recorde da operação).</div>}
      {feitas.length > 0 && r.noCusto > 0 && (
        <div className="card tabela">
          <b>Quanto cada fechadura leva das contas</b>
          <span className="suave"> · quem leva mais tempo para produzir leva mais despesa</span>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Produto</th><th className="n">{r.base.por === "vendidas" ? "Vendidas" : "Produzidas"}</th><th className="n">Tempo por fechadura</th><th className="n">Despesa por fechadura</th><th className="n">Total no mês</th></tr></thead>
            <tbody>{feitas.map((f) => (
              <tr key={f.id}>
                <td><a href={`/produtos/${f.id}`} className="com-foto" style={{ color: "inherit" }}><span className="mini">{f.foto ? <img src={f.foto} alt="" /> : "sem foto"}</span><span className="t"><b>{f.codigo}</b><small>{f.nome}</small></span></a></td>
                <td className="n">{num(f.q)}</td>
                <td className="n">{tempoTxt(f.c.seg)}</td>
                <td className="n"><b>{brl(f.c.despesas)}</b></td>
                <td className="n">{brl(f.c.despesas * f.q)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {r.grupos.length === 0 && <div className="card"><p className="suave" style={{ margin: 0 }}>Nenhuma conta paga em {nomeMes(mes)}. As contas aparecem aqui quando são marcadas como pagas no Financeiro.</p></div>}

      {r.grupos.length > 0 && <div className="card grupos-custo">
      {r.grupos.map((g) => (
        <div className="grupo-custo tabela" key={g.nome}>
          <div className="linha-form" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <MarcarAuto acao={marcarGrupo} campos={{ grupo: g.nome, mes }} marcado={g.regra} desativado={!edita} rotulo={g.nome} />
            <span className="acoes">
              {!g.regra && MOTIVO_FORA[g.nome] && <span className="selo">{MOTIVO_FORA[g.nome]}</span>}
              <span>Pago <b>{brl(g.total)}</b> · no custo <b>{brl(g.noCusto)}</b></span>
            </span>
          </div>
          <details className="editar" style={{ marginTop: 4 }}>
            <summary>{g.contas.length > 1 ? `Ver as ${g.contas.length} contas` : "Ver a conta"}</summary>
            <table>
              <thead><tr><th>No custo</th><th>Pago em</th><th>Conta</th><th>Quem recebeu</th><th className="n">Valor</th></tr></thead>
              <tbody>{g.contas.map((c) => (
                <tr key={c.id}>
                  <td><MarcarAuto acao={marcarConta} campos={{ id: c.id }} marcado={c.entra} desativado={!edita} />{c.aMao && <small className="suave"> escolhida à mão</small>}</td>
                  <td>{dataDia(c.pagoEm!)}</td>
                  <td>{c.descricao}</td>
                  <td>{c.fornecedor?.nome ?? c.funcionario?.nome ?? c.favorecido ?? "—"}</td>
                  <td className="n">{brl(c.valor)}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        </div>
      ))}
      </div>}

      <p className="suave">
        Começam fora para não contar duas vezes: boletos de pedido de compra (o material já está na estrutura da fechadura) e pagamentos de colaboradores (a mão de obra já vem dos lançamentos de produção)
        {r.grupos.some((g) => g.nome === "Impostos" && !g.regra) ? ", e impostos quando o Lucros já desconta imposto sobre a venda" : ""}. Você pode marcar qualquer um se preferir.
        Desmarcar uma categoria vale para os próximos meses também; uma conta escolhida à mão vale só para ela.
      </p>
    </>
  );
}
