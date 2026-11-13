import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerConfig, custoHora } from "@/lib/config";
import { brl, dataHora, num } from "@/lib/formato";
import FormFuncionario from "@/components/FormFuncionario";

export default async function Editar({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await exigir("funcionarios");
  const { id } = await params;
  const { erro, ok } = await searchParams;
  const f = await db.funcionario.findUnique({ where: { id: Number(id) } });
  if (!f) notFound();
  const [etapas, cfg, aps] = await Promise.all([
    db.etapa.findMany({ orderBy: { ordem: "asc" } }),
    lerConfig(),
    db.apontamento.findMany({ where: { funcionarioId: f.id }, include: { operacao: { include: { etapa: true } } }, orderBy: { data: "desc" }, take: 15 }),
  ]);
  const verSal = pode(u.permissoes, "funcionarios", "ver_salario");
  const podeEditar = pode(u.permissoes, "funcionarios", "editar");
  const ch = custoHora(f.salario, cfg, f);
  return (
    <>
      <h1>{f.nome}</h1>
      {erro && <div className="aviso erro">{erro}</div>}
      {ok && <div className="aviso ok">Dados salvos.</div>}
      {verSal && (
        <div className="grade">
          <div className="kpi"><div className="r">Salário</div><div className="v">{brl(f.salario)}</div></div>
          <div className="kpi"><div className="r">Custo da hora</div><div className="v">{brl(ch)}</div><div className="r">{cfg.horasMes} h/mês · encargos {num(f.encargosPct ?? cfg.encargosPct)}%{f.encargosPct == null ? " (padrão)" : ""}{f.beneficios ? ` + ${brl(f.beneficios)} benefícios` : ""}</div></div>
        </div>
      )}
      <div className="card">
        {podeEditar ? (
          <FormFuncionario f={f} setores={etapas.map((e) => e.nome)} verSalario={verSal} />
        ) : (
          <p>{f.cargo} · {f.setor ?? "sem setor"} · {f.tipoContrato}</p>
        )}
      </div>
      <h2>Últimos apontamentos</h2>
      <div className="card tabela">
        {aps.length === 0 ? <p className="suave">Nenhum apontamento ainda.</p> : (
          <table>
            <thead><tr><th>Data</th><th>Etapa</th><th>Operação</th><th className="n">Peças</th><th className="n">Refugo</th><th className="n">Peças/h</th><th className="n">MO/peça</th></tr></thead>
            <tbody>{aps.map((a) => (
              <tr key={a.id}><td>{dataHora(a.data)}</td><td>{a.operacao.etapa.nome}</td><td>{a.operacao.nome}</td><td className="n">{num(a.quantidade)}</td><td className="n">{num(a.refugo)}</td><td className="n">{num(3600 / a.segPorPeca)}</td><td className="n">{brl(a.custoPorPeca, 4)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
