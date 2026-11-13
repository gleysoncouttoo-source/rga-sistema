type Aba = "pedidos" | "metricas" | "anuncios" | "shopee";
const ABAS: [Aba, string, string][] = [
  ["pedidos", "Pedidos de venda", "/vendas"],
  ["metricas", "Métricas e recordes", "/vendas/metricas"],
  ["anuncios", "Lucro por anúncio", "/vendas/anuncios"],
  ["shopee", "Shopee", "/vendas/shopee"],
];
export default function AbasVendas({ ativo }: { ativo: Aba }) {
  return (
    <div className="abas">
      {ABAS.map(([k, nome, href]) => <a key={k} href={href} className={k === ativo ? "ativo" : ""}>{nome}</a>)}
    </div>
  );
}
