import { acaoSalvarAbas } from "@/lib/acoesConta";

/** Caixas para marcar quais abas aparecem no menu de um login. */
export default function EscolherAbas({ id, abas, volta }: { id: number; abas: { id: string; nome: string; oculta: boolean }[]; volta: string }) {
  return (
    <form action={acaoSalvarAbas}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="volta" value={volta} />
      <div className="chk-grade">
        {abas.map((a) => (
          <label key={a.id} className="chk"><input type="checkbox" name={`aba:${a.id}`} defaultChecked={!a.oculta} disabled={a.id === "painel"} /> {a.nome}</label>
        ))}
      </div>
      <div style={{ marginTop: 12 }}><button className="btn sec peq">Salvar abas</button></div>
    </form>
  );
}
