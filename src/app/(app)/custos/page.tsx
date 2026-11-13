import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { custoHora, lerConfig } from "@/lib/config";
import { brl, num, pecasHora } from "@/lib/formato";
import { custosUnitarios, lerCfgLucro } from "@/lib/custoProduto";

async function salvarConfig(form: FormData) {
  "use server";
  const u = await exigir("custos", "editar");
  for (const chave of ["horasMes", "encargosPct", "minutosMinimoRecorde"]) {
    const v = Number(String(form.get(chave) ?? "").replace(",", "."));
    if (Number.isFinite(v) && v >= 0) await db.configuracao.upsert({ where: { chave }, update: { valor: String(v) }, create: { chave, valor: String(v) } });
  }
  await auditar(u.nome, "alterou parâmetros de custo");
  revalidatePath("/custos");
}

export default async function Custos() {
  const u = await exigir("custos");
  const cfg = await lerConfig();
  const desde = new Date(Date.now() - 30 * 86_400_000);
  const [etapas, funcs, aps] = await Promise.all([
    db.etapa.findMany({ orderBy: { ordem: "asc" }, include: { operacoes: { where: { ativo: true }, orderBy: { nome: "asc" } } } }),
    db.funcionario.findMany({ where: { ativo: true, salario: { not: null } } }),
    db.apontamento.findMany({ where: { data: { gte: desde } } }),
  ]);

  // custo da hora médio de quem trabalha em cada setor (ou da fábrica, se o setor não tiver ninguém)
  const horas = funcs.map((f) => ({ setor: f.setor, ch: custoHora(f.salario, cfg, f)! }));
  const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
  const chFabrica = media(horas.map((h) => h.ch));
  const chSetor = (s: string) => media(horas.filter((h) => h.setor === s).map((h) => h.ch)) ?? chFabrica;

  // custo real dos últimos 30 dias por operação = soma do custo do tempo ÷ peças boas
  const real = new Map<number, { custo: number; pecas: number; semSalario: boolean }>();
  for (const a of aps) {
    const r = real.get(a.operacaoId) ?? { custo: 0, pecas: 0, semSalario: false };
    if (a.custoHora == null) r.semSalario = true;
    else r.custo += (a.custoHora * a.minutos) / 60;
    r.pecas += a.quantidade;
    real.set(a.operacaoId, r);
  }
  const edita = pode(u.permissoes, "custos", "editar");

  // custo médio de cada produto: mão de obra real da semana (7 dias) e do mês (30 dias) + material + despesas
  const cfgL = await lerCfgLucro();
  const [cSemana, cMes, produtos, feitos] = await Promise.all([
    custosUnitarios(cfgL, 7), custosUnitarios(cfgL, 30),
    db.item.findMany({ where: { ativo: true, tipo: "produto" }, select: { id: true, codigo: true, nome: true, foto: true, passos: { select: { id: true }, orderBy: { ordem: "desc" }, take: 1 } }, orderBy: { codigo: "asc" } }),
    db.apontamento.groupBy({ by: ["passoId"], where: { data: { gte: desde }, passoId: { not: null } }, _sum: { quantidade: true } }),
  ]);
  const aps7 = await db.apontamento.groupBy({ by: ["passoId"], where: { data: { gte: new Date(Date.now() - 7 * 86_400_000) }, passoId: { not: null } }, _sum: { quantidade: true } });
  const montados = (l: typeof feitos, pid?: number) => (pid ? l.find((x) => x.passoId === pid)?._sum.quantidade ?? 0 : 0);

  return (
    <>
      <h1>Custos</h1>
      <div className="card">
        <b>Parâmetros</b>
        <form action={salvarConfig} className="campos" style={{ marginTop: 12 }}>
          <label>Horas trabalhadas por mês<input name="horasMes" type="number" step="any" defaultValue={cfg.horasMes} disabled={!edita} /></label>
          <label>Encargos padrão (%) — para quem não tem os próprios<input name="encargosPct" type="number" step="any" defaultValue={cfg.encargosPct} disabled={!edita} /></label>
          <label>Tempo mínimo para valer recorde (min)<input name="minutosMinimoRecorde" type="number" step="any" defaultValue={cfg.minutosMinimoRecorde} disabled={!edita} /></label>
          {edita && <div className="inteiro"><button className="btn">Salvar parâmetros</button></div>}
        </form>
        <p className="suave" style={{ marginBottom: 0 }}>
          Custo da hora = (salário × (1 + encargos do colaborador) + benefícios) ÷ horas/mês. Os encargos de cada um ficam na ficha do colaborador. Custo por peça = custo da hora ÷ peças por hora.
          Quando a folha de pagamento entrar no sistema, os encargos e as provisões de 13º, férias e rescisão serão calculados por ela.
        </p>
      </div>
      <h2>Custo médio por produto</h2>
      <p className="suave">Material da estrutura + mão de obra real dos lançamentos da semana (últimos 7 dias) e do mês (últimos 30 dias) + {num(cfgL.custoExtraPct, 1)}% de despesas{cfgL.custoExtraUnidade ? ` + ${brl(cfgL.custoExtraUnidade)} por unidade` : ""}. Operação sem lançamento no período usa o tempo do recorde.</p>
      <div className="card tabela">
        <table>
          <thead><tr><th>Produto</th><th className="n">Material</th><th className="n">MO semana</th><th className="n"><b>Custo semana</b></th><th className="n">MO mês</th><th className="n"><b>Custo mês</b></th><th className="n">Variação</th><th className="n">Montados semana / mês</th></tr></thead>
          <tbody>{produtos.map((p) => {
            const s = cSemana(p.id), m = cMes(p.id);
            const v = m.total ? ((s.total - m.total) / m.total) * 100 : null;
            return (
              <tr key={p.id}>
                <td><a href={`/produtos/${p.id}`} className="com-foto" style={{ color: "inherit" }}><span className="mini">{p.foto ? <img src={p.foto} alt="" /> : "sem foto"}</span><span className="t"><b>{p.codigo}</b><small>{p.nome}</small></span></a></td>
                <td className="n">{brl(m.material)}</td>
                <td className="n">{brl(s.mo, 3)}</td>
                <td className="n"><b>{brl(s.total)}</b></td>
                <td className="n">{brl(m.mo, 3)}</td>
                <td className="n"><b>{brl(m.total)}</b></td>
                <td className="n" style={{ color: v == null || Math.abs(v) < 0.5 ? undefined : v > 0 ? "var(--erro)" : "var(--ok)" }}>{v == null ? "—" : `${v > 0 ? "+" : ""}${num(v, 1)}%`}</td>
                <td className="n">{num(montados(aps7, p.passos[0]?.id))} / {num(montados(feitos, p.passos[0]?.id))}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>

      <h2>Mão de obra por operação</h2>
      {chFabrica == null && <div className="aviso alerta">Nenhum funcionário ativo tem salário cadastrado. Cadastre os salários em Funcionários para ver os custos.</div>}
      {etapas.map((e) => {
        const ch = chSetor(e.nome);
        return (
          <div className="card tabela" key={e.id}>
            <b>{e.nome}</b> <span className="suave">· custo da hora médio do setor {brl(ch)}</span>
            <table>
              <thead><tr><th>Operação</th><th className="n">Recorde (peças/h)</th><th className="n">MO/peça no recorde</th><th className="n">MO por 1.000 pçs</th><th className="n">MO/peça real (30 dias)</th><th className="n">Peças (30 dias)</th></tr></thead>
              <tbody>{e.operacoes.map((o) => {
                const ph = pecasHora(o.recordeSegPorPeca);
                const noRecorde = ch != null && ph ? ch / ph : null;
                const r = real.get(o.id);
                const custoReal = r && r.pecas && !r.semSalario ? r.custo / r.pecas : null;
                return (
                  <tr key={o.id}>
                    <td>{o.nome}</td>
                    <td className="n">{num(ph)}</td>
                    <td className="n">{brl(noRecorde, 4)}</td>
                    <td className="n">{brl(noRecorde != null ? noRecorde * 1000 : null)}</td>
                    <td className="n">{r?.semSalario ? <span className="selo alerta">falta salário</span> : brl(custoReal, 4)}</td>
                    <td className="n">{num(r?.pecas)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        );
      })}
      <p className="suave">O custo completo de cada produto (material + esta mão de obra + despesas) e o lucro que cada um deixa estão em <a href="/lucros">Lucros</a>.</p>
    </>
  );
}
