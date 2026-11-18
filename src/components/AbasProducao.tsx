type Aba = "producao" | "processos";
const ABAS: [Aba, string, string][] = [
  ["producao", "Produção do dia", "/producao"],
  ["processos", "Processos das peças", "/producao/processos"],
];
export default function AbasProducao({ ativo }: { ativo: Aba }) {
  return (
    <div className="abas">
      {ABAS.map(([k, nome, href]) => <a key={k} href={href} className={k === ativo ? "ativo" : ""}>{nome}</a>)}
    </div>
  );
}
