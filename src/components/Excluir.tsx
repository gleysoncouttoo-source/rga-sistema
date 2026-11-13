"use client";
/** Botão Excluir com confirmação. Manda os campos escondidos para a ação do servidor. */
export default function Excluir({ acao, campos, texto = "Excluir", pergunta = "Excluir este registro?", peq = true }: {
  acao: (f: FormData) => void | Promise<void>; campos: Record<string, string | number>; texto?: string; pergunta?: string; peq?: boolean;
}) {
  return (
    <form action={acao} onSubmit={(e) => { if (!confirm(pergunta)) e.preventDefault(); }} style={{ display: "inline" }}>
      {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={`btn sec ${peq ? "peq" : ""} perigo-txt`}>{texto}</button>
    </form>
  );
}
