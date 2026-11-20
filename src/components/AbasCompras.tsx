type Aba = "pedidos" | "receber" | "historico" | "precos" | "cotacao" | "whatsapp" | "fornecedores" | "boletos";
const ABAS: [Aba, string, string][] = [
  ["pedidos", "Pedidos de compra", "/compras"],
  ["receber", "Receber material", "/compras/receber"],
  ["historico", "Histórico de compras", "/compras/historico"],
  ["precos", "Preços", "/compras/precos"],
  ["cotacao", "Cotação semanal", "/compras/cotacao"],
  ["whatsapp", "Sambot (WhatsApp)", "/compras/whatsapp"],
  ["fornecedores", "Fornecedores", "/compras/fornecedores"],
];
export default function AbasCompras({ ativo }: { ativo: Aba }) {
  return (
    <div className="abas">
      {ABAS.map(([k, nome, href]) => <a key={k} href={href} className={k === ativo ? "ativo" : ""}>{nome}</a>)}
    </div>
  );
}
