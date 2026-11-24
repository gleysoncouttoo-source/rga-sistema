import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { mesAtual, mesValido, nomeMes } from "@/lib/despesasCusto";
import { afastamentosDoPeriodo, cartoes, hhmm, totaisDoMes } from "@/lib/secullum";
import { limitesMes } from "@/lib/folha";
import Imprimir from "@/components/Imprimir";

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Espelho de ponto do mês para imprimir ou salvar em PDF (um colaborador por página). */
export default async function Espelho({ searchParams }: { searchParams: Promise<{ mes?: string; f?: string }> }) {
  await exigir("funcionarios");
  const sp = await searchParams;
  const mes = mesValido(sp.mes) ?? mesAtual();
  const { inicio, fim } = limitesMes(mes);
  const [cs, tot, afs, funcs] = await Promise.all([cartoes(inicio, fim), totaisDoMes(mes), afastamentosDoPeriodo(inicio, fim), db.funcionario.findMany({ where: sp.f ? { id: Number(sp.f) } : {}, orderBy: { nome: "asc" } })]);
  const lista = funcs.filter((f) => cs.has(f.id) || tot.has(f.id));
  const br = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return (
    <>
      <div className="topo sem-print">
        <h1 style={{ margin: 0 }}>Espelho de ponto · {nomeMes(mes)}</h1>
        <div className="acoes"><Imprimir /></div>
      </div>
      <p className="suave sem-print">Na janela de impressão, escolha “Salvar como PDF” para mandar ao contador. Cada colaborador sai numa página.</p>
      {lista.length === 0 && <p className="suave">Nenhuma batida em {nomeMes(mes)}.</p>}
      {lista.map((f, i) => {
        const c = cs.get(f.id), t = tot.get(f.id);
        const porDia = new Map((c?.dias ?? []).map((d) => [d.data.toISOString().slice(0, 10), d]));
        const calc = new Map((t?.linhas ?? []).map((l) => [l.data, l.valores]));
        const cols = (t?.colunas ?? []).map((nome, k) => ({ nome, k })).filter((x) => x.k > 0 && (t?.totais[x.k] ?? "") !== "");
        const max = Math.max(4, ...(c?.dias ?? []).map((d) => d.horas.length));
        const dias: Date[] = [];
        for (let d = inicio; d <= fim; d = new Date(d.getTime() + 86_400_000)) dias.push(d);
        return (
          <div key={f.id} className="card" style={{ breakAfter: i < lista.length - 1 ? "page" : undefined, marginBottom: 24 }}>
            <div className="topo" style={{ marginBottom: 8 }}>
              <div><b style={{ fontSize: "1.1rem" }}>{f.nome}</b><div className="suave" style={{ fontSize: ".85rem" }}>CPF {f.cpf ?? "—"} · PIS {f.pis ?? "—"} · {f.cargo}{f.setor ? ` · ${f.setor}` : ""}{f.admissao ? ` · admissão ${br(f.admissao)}` : ""}</div></div>
              <div style={{ textAlign: "right" }}><b>R.G.A</b><div className="suave" style={{ fontSize: ".85rem" }}>{br(inicio)} a {br(fim)}</div></div>
            </div>
            <div className="tabela">
              <table style={{ fontSize: ".85rem" }}>
                <thead><tr><th>Dia</th>{Array.from({ length: max }, (_, k) => <th key={k}>{k % 2 ? "Saída" : "Entrada"}</th>)}<th className="n">Horas</th>{cols.map((x) => <th key={x.k} className="n">{x.nome}</th>)}</tr></thead>
                <tbody>{dias.map((d) => {
                  const k = d.toISOString().slice(0, 10), b = porDia.get(k), v = calc.get(k);
                  const af = (afs.get(f.id) ?? []).find((a) => a.inicio <= d && a.fim >= d);
                  return (
                    <tr key={k} style={d.getUTCDay() === 0 ? { color: "var(--suave)" } : undefined}>
                      <td>{br(d).slice(0, 5)} {SEMANA[d.getUTCDay()]}</td>
                      {af && !b ? <td colSpan={max}>{af.justificativa ?? "Afastamento"}{af.motivo ? ` — ${af.motivo}` : ""}</td> : Array.from({ length: max }, (_, j) => <td key={j}>{b?.horas[j] ?? ""}</td>)}
                      <td className="n">{b ? hhmm(b.minutos) : ""}{b?.incompleto ? " ⚠" : ""}</td>
                      {cols.map((x) => <td key={x.k} className="n">{v?.[x.k] ?? ""}</td>)}
                    </tr>
                  );
                })}</tbody>
                <tfoot><tr><th>Total</th>{Array.from({ length: max }, (_, k) => <th key={k}></th>)}<th className="n">{hhmm(c?.minutos ?? 0)}</th>{cols.map((x) => <th key={x.k} className="n">{t?.totais[x.k]}</th>)}</tr></tfoot>
              </table>
            </div>
            <div style={{ display: "flex", gap: 40, marginTop: 36 }}>
              <div style={{ flex: 1, borderTop: "1px solid var(--texto)", paddingTop: 4, fontSize: ".8rem" }}>Assinatura do colaborador</div>
              <div style={{ flex: 1, borderTop: "1px solid var(--texto)", paddingTop: 4, fontSize: ".8rem" }}>R.G.A</div>
            </div>
          </div>
        );
      })}
    </>
  );
}
