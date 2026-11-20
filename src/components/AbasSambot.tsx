type Aba = "cotacao" | "conversas";
const ABAS: [Aba, string, string][] = [
  ["cotacao", "Cotação de preços", "/sambot"],
  ["conversas", "Conversas, áudios e figurinhas", "/sambot/conversas"],
];
export default function AbasSambot({ ativo }: { ativo: Aba }) {
  return (
    <div className="abas">
      {ABAS.map(([k, nome, href]) => <a key={k} href={href} className={k === ativo ? "ativo" : ""}>{nome}</a>)}
    </div>
  );
}
