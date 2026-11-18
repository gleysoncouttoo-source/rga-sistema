import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { BANCOS } from "@/lib/financeiro";
import { lerExtrato } from "@/lib/extrato";
import { brl, dataDia, dataHora } from "@/lib/formato";
import { dia } from "@/lib/datas";
import AbasFinanceiro from "@/components/AbasFinanceiro";

async function enviar(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const f = form.get("arquivo");
  if (!(f instanceof File) || !f.size) redirect("/financeiro/extrato?erro=" + encodeURIComponent("Escolha o arquivo do extrato."));
  let id: number;
  try {
    const ext = lerExtrato(f.name, new Uint8Array(await f.arrayBuffer()));
    const escolhido = String(form.get("banco") || "");
    const banco = escolhido || ext.banco;
    if (!banco) throw new Error("Não consegui descobrir de qual banco é o arquivo. Escolha o banco e envie de novo.");
    if (!ext.movs.length) throw new Error("O arquivo não tem nenhum lançamento nesse período.");
    const imp = await db.importacaoExtrato.create({
      data: {
        banco, arquivo: f.name, usuario: u.nome, dados: { movs: ext.movs },
        de: ext.de ? dia(ext.de) : null, ate: ext.ate ? dia(ext.ate) : null, saldo: ext.saldo, saldoEm: ext.saldoEm ? dia(ext.saldoEm) : null,
      },
    });
    id = imp.id;
  } catch (e) {
    redirect("/financeiro/extrato?erro=" + encodeURIComponent(e instanceof Error ? e.message : "Não consegui ler o arquivo."));
  }
  redirect(`/financeiro/extrato/${id}`);
}

const SITUACAO: Record<string, [string, string]> = { lida: ["alerta", "Aguardando conferir"], parcial: ["alerta", "Falta decidir alguns"], conferida: ["ok", "Conferido"] };

export default async function Extrato({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const u = await exigir("financeiro");
  const { erro } = await searchParams;
  const imps = await db.importacaoExtrato.findMany({ orderBy: { criadoEm: "desc" }, take: 20 });
  const edita = pode(u.permissoes, "financeiro", "editar");
  return (
    <>
      <h1>Financeiro</h1>
      <AbasFinanceiro ativo="extrato" />
      {erro && <div className="aviso erro">{erro}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Subir extrato da semana</h2>
        <p className="suave">Baixe o extrato da semana no internet banking e envie aqui. O sistema procura cada lançamento nas contas a pagar e a receber e mostra o que bateu, para você só confirmar. O que não bater aparece separado para você decidir.</p>
        {edita ? (
          <form action={enviar} className="linha-form">
            <label>Banco<select name="banco" defaultValue=""><option value="">Descobrir pelo arquivo</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label style={{ flex: "2 1 240px" }}>Arquivo do extrato (OFX de preferência)<input type="file" name="arquivo" accept=".ofx,.csv,.xlsx,.txt,.pdf" required /></label>
            <button className="btn">Ler extrato</button>
          </form>
        ) : <p className="suave">Seu perfil não pode dar baixa em contas.</p>}
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer" }}><b>Como baixar o extrato em OFX</b></summary>
          <ul className="suave" style={{ marginBottom: 0 }}>
            <li><b>Santander (Internet Banking Empresas):</b> Conta corrente → Extrato → escolha o período da semana → botão de salvar/exportar → formato <b>OFX</b> (pode aparecer como "Money").</li>
            <li><b>Bradesco (Net Empresa):</b> Saldos e extratos → Extrato → escolha o período → <b>Exportar</b> ou <b>Salvar como</b> → formato <b>OFX</b>.</li>
            <li>Se o banco não oferecer OFX, a planilha em <b>CSV</b> ou <b>Excel</b> também serve. PDF não serve, porque não dá para ler os valores com segurança.</li>
            <li>Pode mandar períodos que se repetem: o que já foi conferido antes não recebe baixa duas vezes.</li>
          </ul>
        </details>
      </div>

      <div className="card tabela">
        <h2 style={{ marginTop: 0 }}>Extratos enviados</h2>
        {imps.length === 0 ? <p className="suave">Nenhum ainda.</p> : (
          <table>
            <thead><tr><th>Enviado em</th><th>Banco</th><th>Período</th><th className="n">Lançamentos</th><th className="n">Saldo no extrato</th><th>Quem</th><th>Situação</th></tr></thead>
            <tbody>{imps.map((i) => {
              const n = (i.dados as { movs?: unknown[] }).movs?.length ?? 0;
              const [cls, txt] = SITUACAO[i.status] ?? SITUACAO.lida;
              return (
                <tr key={i.id}>
                  <td><Link href={`/financeiro/extrato/${i.id}`}>{dataHora(i.criadoEm)}</Link></td>
                  <td>{i.banco}</td>
                  <td>{i.de ? `${dataDia(i.de)} a ${dataDia(i.ate)}` : "—"}</td>
                  <td className="n">{n}</td>
                  <td className="n">{i.saldo != null ? brl(i.saldo) : "—"}</td>
                  <td>{i.usuario}</td>
                  <td><Link href={`/financeiro/extrato/${i.id}`}><span className={`selo ${cls}`}>{txt}</span></Link>{i.resumo && <div className="suave" style={{ fontSize: ".8rem" }}>{i.resumo}</div>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
