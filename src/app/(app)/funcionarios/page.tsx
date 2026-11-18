import Link from "next/link";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, data, dataHora, num } from "@/lib/formato";
import Excluir from "@/components/Excluir";
import { excluirFuncionario } from "./acoes";

export default async function Funcionarios({ searchParams }: { searchParams: Promise<{ todos?: string; ok?: string; erro?: string }> }) {
  const u = await exigir("funcionarios");
  const sp = await searchParams;
  const agora = new Date();
  const inicioMes = new Date(agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 8) + "01T03:00:00Z");
  const [lista, recordes, aps] = await Promise.all([
    db.funcionario.findMany({ where: sp.todos ? {} : { ativo: true }, orderBy: { nome: "asc" } }),
    db.recorde.findMany({
      where: { criadoEm: { gte: inicioMes }, status: { in: ["pendente", "confirmado"] }, funcionarioId: { not: null } },
      include: { funcionario: true, operacao: { include: { etapa: true } }, apontamento: { include: { item: true } } }, orderBy: { criadoEm: "desc" },
    }),
    db.apontamento.groupBy({ by: ["funcionarioId"], where: { data: { gte: inicioMes } }, _sum: { quantidade: true, minutos: true, refugo: true }, _count: true }),
  ]);
  // recorde anterior de cada operação (para mostrar quanto foi ultrapassado)
  const anteriores = await db.recorde.findMany({ where: { operacaoId: { in: recordes.map((r) => r.operacaoId) }, status: { in: ["confirmado", "inicial"] } }, orderBy: { criadoEm: "asc" } });
  const antes = (r: (typeof recordes)[number]) => {
    const l = anteriores.filter((a) => a.operacaoId === r.operacaoId && a.criadoEm < r.criadoEm && a.id !== r.id);
    return l.length ? Math.min(...l.map((a) => a.segPorPeca)) : null;
  };
  const prod = new Map(aps.map((a) => [a.funcionarioId, a]));
  const contaRec = new Map<number, number>();
  for (const r of recordes) contaRec.set(r.funcionarioId!, (contaRec.get(r.funcionarioId!) ?? 0) + 1);
  const verSal = pode(u.permissoes, "funcionarios", "ver_salario");
  const exclui = pode(u.permissoes, "funcionarios", "excluir");
  const mes = agora.toLocaleDateString("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });
  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Colaboradores</h1>
        <div className="acoes">
          <Link className="btn sec" href={sp.todos ? "/funcionarios" : "/funcionarios?todos=1"}>{sp.todos ? "Só ativos" : "Mostrar desligados"}</Link>
          {pode(u.permissoes, "funcionarios", "criar") && <Link className="btn" href="/funcionarios/novo">+ Novo colaborador</Link>}
        </div>
      </div>
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}

      <h2>🏆 Recordes ultrapassados em {mes} ({recordes.length})</h2>
      {recordes.length === 0 ? <p className="suave">Nenhum recorde batido este mês ainda.</p> : (
        <div className="cartoes">
          {recordes.map((r) => {
            const ant = antes(r);
            const ganho = ant ? (ant / r.segPorPeca - 1) * 100 : null;
            return (
              <div className="card" key={r.id} style={{ borderLeft: "5px solid var(--acento)" }}>
                <div className="topo" style={{ marginBottom: 6 }}>
                  <b style={{ fontSize: "1.05rem" }}>{r.funcionario!.nome}</b>
                  <span className={`selo ${r.status === "confirmado" ? "ok" : "alerta"}`}>{r.status === "confirmado" ? "confirmado" : "a confirmar"}</span>
                </div>
                <div><b>{r.operacao.nome}</b> <span className="suave">· {r.operacao.etapa.nome}{r.apontamento?.item ? ` · ${r.apontamento.item.nome}` : ""}</span></div>
                <div style={{ marginTop: 6 }}><span className="cronometro" style={{ fontSize: "1.3rem" }}>{num(3600 / r.segPorPeca)}</span> <span className="suave">peças/h{ant ? ` · antes ${num(3600 / ant)}` : ""}</span>{ganho != null && <b style={{ color: "var(--ok)" }}> +{num(ganho, 1)}%</b>}</div>
                <div className="suave" style={{ fontSize: ".82rem" }}>{dataHora(r.criadoEm)}</div>
              </div>
            );
          })}
        </div>
      )}

      <h2>Equipe</h2>
      <div className="card tabela">
        {lista.length === 0 ? <p className="suave">Nenhum colaborador cadastrado ainda.</p> : (
          <table>
            <thead><tr><th>Nome</th><th>Cargo</th><th>Setor</th><th>Admissão</th>{verSal && <th className="n">Salário</th>}<th className="n">Peças no mês</th><th className="n">Horas no mês</th><th className="n">Recordes</th>{exclui && <th></th>}</tr></thead>
            <tbody>{lista.map((f) => {
              const p = prod.get(f.id);
              return (
                <tr key={f.id}>
                  <td><Link href={`/funcionarios/${f.id}`}>{f.nome}</Link> {!f.ativo && <span className="selo">desligado</span>}</td>
                  <td>{f.cargo}</td><td>{f.setor ?? "—"}</td><td>{data(f.admissao)}</td>
                  {verSal && <td className="n">{brl(f.salario)}</td>}
                  <td className="n">{num(p?._sum.quantidade ?? 0)}</td>
                  <td className="n">{num((p?._sum.minutos ?? 0) / 60, 1)}</td>
                  <td className="n">{contaRec.get(f.id) ? <b>🏆 {contaRec.get(f.id)}</b> : "—"}</td>
                  {exclui && <td>{f.ativo && <Excluir acao={excluirFuncionario} campos={{ id: f.id }} pergunta={`Excluir ${f.nome}? Se já tiver produção ou contas, fica como desligado.`} />}</td>}
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      <p className="suave">{lista.length} colaborador(es). Não há limite de cadastro.</p>
    </>
  );
}
