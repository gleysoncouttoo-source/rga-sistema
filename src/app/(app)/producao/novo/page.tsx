import Link from "next/link";
import { exigir } from "@/lib/auth";
import { dadosNovoProcesso } from "@/lib/fluxo";
import { acaoIniciarProcesso } from "@/lib/acoesProducao";
import NovoProcesso from "@/components/NovoProcesso";

export default async function NovoProcessoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigir("producao", "criar");
  const sp = await searchParams;
  const dados = await dadosNovoProcesso();
  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Iniciar novo processo</h1>
        <Link className="btn sec" href="/producao">Voltar</Link>
      </div>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      <div className="card">
        <NovoProcesso dados={dados} acao={acaoIniciarProcesso} inicial={{ itemId: Number(sp.item) || undefined, passoId: Number(sp.passo) || undefined, loteId: Number(sp.lote) || undefined }} />
      </div>
    </>
  );
}
