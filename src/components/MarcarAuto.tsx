"use client";
/** Caixa de marcar que salva sozinha ao clicar (manda o formulário para a ação do servidor). */
export default function MarcarAuto({ acao, campos, marcado, rotulo, desativado }: {
  acao: (f: FormData) => void | Promise<void>; campos: Record<string, string | number>; marcado: boolean; rotulo?: string; desativado?: boolean;
}) {
  return (
    <form action={acao} style={{ display: "inline" }}>
      {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="chk marcar-auto">
        <input type="checkbox" name="entra" defaultChecked={marcado} disabled={desativado} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
        {rotulo}
      </label>
    </form>
  );
}
