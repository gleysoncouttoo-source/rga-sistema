import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exigir, auditar } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { importarShopee, vinculos, STATUS_SHOPEE, type PedidoShopee } from "@/lib/shopee";
import { brl, num, dataHora } from "@/lib/formato";
import AbasVendas from "@/components/AbasVendas";

async function ligar(form: FormData) {
  "use server";
  const u = await exigir("vendas", "criar");
  const id = Number(form.get("id"));
  let n = 0;
  for (const [k, v] of form.entries()) {
    const m = k.match(/^item:(.+)$/);
    if (!m || !v) continue;
    const chave = m[1], itemId = Number(v);
    const fator = Number(String(form.get(`fator:${chave}`) || "1").replace(",", ".")) || 1;
    await db.anuncioCanal.upsert({
      where: { canal_chave: { canal: "shopee", chave } },
      create: { canal: "shopee", chave, itemId, fator, descricao: String(form.get(`desc:${chave}`) || "") || null },
      update: { itemId, fator },
    });
    n++;
  }
  if (n) await auditar(u.nome, "ligou anúncios da Shopee", `${n} anúncio(s)`);
  redirect(`/vendas/shopee/${id}`);
}

async function confirmar(form: FormData) {
  "use server";
  const u = await exigir("vendas", "criar");
  const id = Number(form.get("id"));
  await importarShopee(id, u.nome, { baixarEnviados: form.get("baixar") === "1" });
  redirect(`/vendas/shopee/${id}`);
}

export default async function Importacao({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigir("vendas");
  const id = Number((await params).id);
  const imp = await db.importacaoVenda.findUnique({ where: { id } });
  if (!imp) notFound();
  const { pedidos, avisos } = imp.dados as unknown as { pedidos: PedidoShopee[]; avisos: string[] };
  const anuncios = new Map<string, { chave: string; sku: string; nome: string; variacao: string; qtd: number; pedidos: number }>();
  for (const p of pedidos) for (const i of p.itens) {
    const a = anuncios.get(i.chave) ?? { chave: i.chave, sku: i.sku, nome: i.nome, variacao: i.variacao, qtd: 0, pedidos: 0 };
    a.qtd += i.quantidade; a.pedidos++;
    anuncios.set(i.chave, a);
  }
  const [vinc, produtos, existentes] = await Promise.all([
    vinculos([...anuncios.keys()]),
    db.item.findMany({ where: { tipo: "produto", ativo: true }, orderBy: { codigo: "asc" } }),
    db.pedidoVenda.findMany({ where: { origem: "shopee", numero: { in: pedidos.map((p) => p.numero) } }, select: { numero: true, canalStatus: true, itens: { select: { anuncio: true } } } }),
  ]);
  const semVinculo = [...anuncios.values()].filter((a) => !vinc.has(a.chave)).sort((a, b) => b.qtd - a.qtd);
  const ligados = [...anuncios.values()].filter((a) => vinc.has(a.chave));
  const ja = new Map(existentes.map((e) => [e.numero!, e.canalStatus]));
  const cont: Record<string, number> = {};
  for (const p of pedidos) cont[p.status] = (cont[p.status] ?? 0) + 1;
  const novos = pedidos.filter((p) => !ja.has(p.numero) && p.status !== "nao_pago");
  const mudaram = pedidos.filter((p) => ja.has(p.numero) && ja.get(p.numero) !== p.status).length;
  // vendas que entraram antes de o sistema guardar o nome do anúncio (para o lucro por anúncio)
  const semAnuncio = existentes.filter((e) => e.itens.some((i) => !i.anuncio)).length;
  const bloqueados = novos.filter((p) => p.status !== "nao_pago" && p.itens.some((i) => !vinc.has(i.chave))).length;
  const datas = pedidos.map((p) => p.criadoEm).sort();
  const fat = pedidos.filter((p) => !["cancelado", "devolvido", "nao_pago"].includes(p.status))
    .reduce((t, p) => t + p.itens.reduce((s, i) => s + i.quantidade * (i.preco ?? 0), 0), 0);
  const importada = imp.status === "importada";
  const r = imp.resumo ? JSON.parse(imp.resumo) as Record<string, number> : null;
  const podeCriar = pode(u.permissoes, "vendas", "criar");

  return (
    <>
      <h1>Vendas</h1>
      <AbasVendas ativo="shopee" />
      <p><Link href="/vendas/shopee">← Shopee</Link></p>
      <div className="topo">
        <div>
          <h2 style={{ margin: 0 }}>{imp.arquivo}</h2>
          <span className="suave">enviada por {imp.usuario} em {dataHora(imp.criadoEm)} · pedidos de {datas[0]?.slice(0, 10).split("-").reverse().join("/")} a {datas.at(-1)?.slice(0, 10).split("-").reverse().join("/")}</span>
        </div>
      </div>
      {avisos?.map((a) => <div key={a} className="aviso alerta">{a}</div>)}
      {importada && r && (
        <div className="aviso ok">
          Importada em {dataHora(imp.importadoEm)}: {r.novos} venda(s) entregue(s), {r.abertos} pedido(s) em aberto (já analisados para produção e compras), {r.atualizados} atualizado(s), {r.cancelados} cancelado(s){r.baixas ? `, ${r.baixas} baixa(s) no estoque` : ""}.
          {r.semVinculo > 0 && <> {r.semVinculo} pedido(s) ficaram de fora porque o anúncio não está ligado a um produto: ligue abaixo e confirme de novo.</>}
          {" "}<Link href="/vendas/metricas">Ver métricas e recordes →</Link>
        </div>
      )}

      <div className="grade">
        <div className="kpi"><div className="r">Pedidos na planilha</div><div className="v">{num(pedidos.length)}</div><div className="r">{num(novos.length)} novos · {num(mudaram)} mudaram de situação</div></div>
        <div className="kpi"><div className="r">Vendido (sem cancelados)</div><div className="v">{brl(fat, 0)}</div></div>
        {Object.entries(cont).map(([s, n]) => (
          <div key={s} className="kpi"><div className="r">{STATUS_SHOPEE[s]?.nome ?? s}</div><div className="v">{num(n)}</div></div>
        ))}
      </div>

      {semVinculo.length > 0 && (
        <div className="card tabela">
          <h2 style={{ marginTop: 0 }}>Ligue {semVinculo.length} anúncio(s) a um produto</h2>
          <p className="suave">O SKU destes anúncios não é igual a nenhum código cadastrado. Escolha a fechadura de cada um (só precisa fazer uma vez). Se o anúncio é um kit, informe quantas fechaduras saem em cada venda. {bloqueados > 0 && <b>{bloqueados} pedido(s) dependem disso.</b>}</p>
          <form action={ligar}>
            <input type="hidden" name="id" value={id} />
            <table>
              <thead><tr><th>Anúncio (SKU · nome · variação)</th><th className="n">Vendido</th><th>Produto</th><th style={{ width: 120 }}>Fechaduras por venda</th></tr></thead>
              <tbody>{semVinculo.map((a) => (
                <tr key={a.chave}>
                  <td>{a.sku ? <b>{a.sku}</b> : <span className="suave">sem SKU</span>}<div className="suave">{a.nome}{a.variacao && ` · ${a.variacao}`}</div>
                    <input type="hidden" name={`desc:${a.chave}`} value={`${a.nome}${a.variacao ? " · " + a.variacao : ""}`} /></td>
                  <td className="n">{num(a.qtd)} un</td>
                  <td><select name={`item:${a.chave}`} defaultValue="" style={{ width: "100%" }}>
                    <option value="">— escolher —</option>
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
                  </select></td>
                  <td><input name={`fator:${a.chave}`} defaultValue="1" inputMode="decimal" style={{ width: "100%" }} /></td>
                </tr>
              ))}</tbody>
            </table>
            {podeCriar && <button className="btn sec">Salvar ligações</button>}
          </form>
        </div>
      )}

      {!importada && novos.length === 0 && mudaram === 0 && semAnuncio === 0 && <div className="aviso ok">Todos os pedidos desta planilha já estão no sistema, com a mesma situação. Nada a importar.</div>}
      {podeCriar && (novos.length > 0 || mudaram > 0 || semAnuncio > 0) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{importada ? "Importar o que faltou" : "Confirmar importação"}</h2>
          {semAnuncio > 0 && <p className="suave">{semAnuncio} venda(s) já no sistema vão ganhar o nome do anúncio, para aparecerem no lucro por anúncio.</p>}
          <form action={confirmar}>
            <input type="hidden" name="id" value={id} />
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12 }}>
              <input type="checkbox" name="baixar" value="1" style={{ marginTop: 4 }} />
              <span>Dar baixa no estoque dos pedidos já enviados/concluídos.<br /><span className="suave">Deixe desmarcado se o estoque do sistema foi contado depois desses envios (ex.: importando o histórico). Pedidos &quot;A enviar&quot; sempre separam o estoque.</span></span>
            </label>
            <button className="btn">{bloqueados ? `Importar (${bloqueados} pedido(s) sem produto ficam de fora)` : "Importar pedidos"}</button>
          </form>
        </div>
      )}

      <div className="card tabela">
        <h2 style={{ marginTop: 0 }}>Anúncios na planilha</h2>
        <table>
          <thead><tr><th>Anúncio</th><th>Produto</th><th className="n">Pedidos</th><th className="n">Unidades</th></tr></thead>
          <tbody>{[...ligados, ...semVinculo].map((a) => {
            const v = vinc.get(a.chave);
            return (
              <tr key={a.chave}>
                <td>{a.sku || "sem SKU"}<div className="suave">{a.nome}{a.variacao && ` · ${a.variacao}`}</div></td>
                <td>{v ? <>{v.codigo}{v.fator !== 1 && <span className="suave"> × {v.fator}</span>}{v.auto && <span className="suave"> (pelo SKU)</span>}</> : <span className="selo alerta">sem produto</span>}</td>
                <td className="n">{num(a.pedidos)}</td><td className="n">{num(a.qtd)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </>
  );
}
