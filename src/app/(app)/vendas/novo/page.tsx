import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { criarPedidoVenda, lerCfgCompras } from "@/lib/planejamento";
import { dia, proximoDiaUtil, somaDias, chave } from "@/lib/datas";

const LINHAS = 8;

async function salvar(form: FormData) {
  "use server";
  const u = await exigir("vendas", "criar");
  const cliente = String(form.get("cliente") || "").trim();
  const entrega = String(form.get("entrega") || "");
  const itens: { itemId: number; quantidade: number; precoUnitario: number | null }[] = [];
  for (let i = 0; i < LINHAS; i++) {
    const itemId = Number(form.get(`item${i}`)), quantidade = Number(String(form.get(`qtd${i}`) || "").replace(",", "."));
    const preco = Number(String(form.get(`preco${i}`) || "").replace(",", "."));
    if (itemId && quantidade > 0) itens.push({ itemId, quantidade, precoUnitario: preco > 0 ? preco : null });
  }
  if (!cliente || !itens.length || !entrega) redirect("/vendas/novo?erro=" + encodeURIComponent("Informe o cliente, a data de entrega e ao menos um produto com quantidade."));
  // preço em branco = valor de venda do cadastro
  const cad = await db.item.findMany({ where: { id: { in: itens.map((i) => i.itemId) } } });
  for (const i of itens) i.precoUnitario ??= cad.find((c) => c.id === i.itemId)?.precoVenda ?? null;
  const id = await criarPedidoVenda({
    cliente, numero: String(form.get("numero") || "").trim() || undefined, dataEntrega: dia(entrega),
    observacao: String(form.get("obs") || "").trim() || undefined, itens,
  }, u.nome);
  redirect(`/vendas/${id}`);
}

export default async function NovoPedido({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await exigir("vendas", "criar");
  const { erro } = await searchParams;
  const [produtos, cfg] = await Promise.all([
    db.item.findMany({ where: { tipo: "produto", ativo: true }, orderBy: { codigo: "asc" } }),
    lerCfgCompras(),
  ]);
  const padrao = chave(proximoDiaUtil(somaDias(dia(), cfg.prazoEntregaPadrao)));
  return (
    <>
      <h1>Novo pedido de venda</h1>
      {erro && <div className="aviso erro">{erro}</div>}
      <form action={salvar}>
        <div className="card">
          <div className="campos" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <label>Cliente<input name="cliente" required /></label>
            <label>Nº do pedido (site ou cliente)<input name="numero" /></label>
            <label>Data de entrega<input name="entrega" type="date" defaultValue={padrao} required /></label>
            <label>Observação<input name="obs" /></label>
          </div>
        </div>
        <div className="card tabela">
          <b>Produtos</b>
          <table>
            <thead><tr><th>Produto</th><th style={{ width: 130 }}>Quantidade</th><th style={{ width: 150 }}>Preço unit. (opcional)</th></tr></thead>
            <tbody>{Array.from({ length: LINHAS }, (_, i) => (
              <tr key={i}>
                <td><select name={`item${i}`} defaultValue="" style={{ width: "100%" }}>
                  <option value="">—</option>
                  {produtos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
                </select></td>
                <td><input name={`qtd${i}`} inputMode="decimal" style={{ width: "100%" }} /></td>
                <td><input name={`preco${i}`} inputMode="decimal" placeholder="do cadastro" style={{ width: "100%" }} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <button className="btn">Salvar e analisar</button>
      </form>
    </>
  );
}
