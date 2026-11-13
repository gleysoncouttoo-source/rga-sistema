import { acaoPasso } from "@/lib/acoesProdutos";

type Op = { id: number; nome: string; etapa: string; etapaId: number };
type P = { id: number; ordem: number; operacao: { nome: string; etapa: { nome: string } } };

/** Lista e edita o processo (passos) de uma peça: adicionar, tirar, mudar a ordem. */
export default function EditorProcesso({ itemId, pagina, passos, ops, etapas, edita }: {
  itemId: number; pagina: number; passos: P[]; ops: Op[]; etapas: { id: number; nome: string }[]; edita: boolean;
}) {
  const h = (acao: string, passoId?: number) => (
    <>
      <input type="hidden" name="itemId" value={itemId} /><input type="hidden" name="pagina" value={pagina} />
      <input type="hidden" name="acao" value={acao} />{passoId && <input type="hidden" name="passoId" value={passoId} />}
    </>
  );
  return (
    <>
      {passos.length === 0 ? <p className="suave" style={{ margin: "6px 0" }}>Sem processo cadastrado. A produção desta peça não pode ser lançada até ter pelo menos um processo.</p> : (
        <table>
          <tbody>{passos.map((p, i) => (
            <tr key={p.id}>
              <td style={{ width: 34 }}><span className="passo-n">{i + 1}</span></td>
              <td><b>{p.operacao.nome}</b> <span className="suave">· {p.operacao.etapa.nome}</span>{i === passos.length - 1 && <span className="suave"> · depois deste a peça fica pronta</span>}</td>
              {edita && (
                <td className="n">
                  <div className="acoes" style={{ justifyContent: "flex-end" }}>
                    {i > 0 && <form action={acaoPasso}>{h("subir", p.id)}<button className="btn sec peq" title="Subir">↑</button></form>}
                    {i < passos.length - 1 && <form action={acaoPasso}>{h("descer", p.id)}<button className="btn sec peq" title="Descer">↓</button></form>}
                    <form action={acaoPasso}>{h("remover", p.id)}<button className="btn sec peq perigo-txt">Tirar</button></form>
                  </div>
                </td>
              )}
            </tr>
          ))}</tbody>
        </table>
      )}
      {edita && (
        <form action={acaoPasso} className="linha-form" style={{ marginTop: 10 }}>
          {h("add")}
          <label>Adicionar processo<select name="operacaoId" defaultValue="">
            <option value="">— nova operação (escreva ao lado) —</option>
            {etapas.map((e) => (
              <optgroup key={e.id} label={e.nome}>{ops.filter((o) => o.etapaId === e.id).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</optgroup>
            ))}
          </select></label>
          <label>Ou nova: etapa<select name="etapaId" defaultValue="">{[<option key="" value="">—</option>, ...etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)]}</select></label>
          <label>Nome da nova operação<input name="novaOperacao" placeholder="ex.: Verniz espelho" /></label>
          <button className="btn sec">Adicionar</button>
        </form>
      )}
    </>
  );
}
