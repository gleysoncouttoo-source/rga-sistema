import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import FormFuncionario from "@/components/FormFuncionario";

export default async function Novo({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const u = await exigir("funcionarios", "criar");
  const { erro } = await searchParams;
  const etapas = await db.etapa.findMany({ orderBy: { ordem: "asc" } });
  return (
    <>
      <h1>Novo colaborador</h1>
      {erro && <div className="aviso erro">{erro}</div>}
      <div className="card">
        <FormFuncionario setores={etapas.map((e) => e.nome)} verSalario={pode(u.permissoes, "funcionarios", "ver_salario")} />
      </div>
    </>
  );
}
