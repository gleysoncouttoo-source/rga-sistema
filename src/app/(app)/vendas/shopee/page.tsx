import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigir, auditar } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerPlanilha } from "@/lib/planilha";
import { lerPedidosShopee } from "@/lib/shopee";
import { dataHora } from "@/lib/formato";
import AbasVendas from "@/components/AbasVendas";
import { headers } from "next/headers";
import { configShopee, urlAutorizacao, sincronizar } from "@/lib/shopeeApi";
import { sincronizarSeAntigo } from "@/lib/shopeeAuto";

async function origem() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

async function conexao(form: FormData) {
  "use server";
  const u = await exigir("vendas", "editar");
  const a = String(form.get("a"));
  if (a === "conectar") redirect(urlAutorizacao(`${await origem()}/api/shopee/retorno`));
  if (a === "sincronizar") {
    let msg = "";
    try { const r = await sincronizar(); msg = "ok=" + encodeURIComponent(`Conferido: ${r.novos + r.abertos} pedido(s) novo(s), ${r.atualizados + r.cancelados} atualizado(s)${r.semVinculo ? `, ${r.semVinculo} com anúncio sem produto` : ""}.`); }
    catch (e) { msg = "erro=" + encodeURIComponent(e instanceof Error ? e.message : String(e)); }
    redirect("/vendas/shopee?" + msg);
  }
  if (a === "baixar") await db.shopeeConexao.update({ where: { id: 1 }, data: { baixarEnviados: form.get("valor") === "1" } });
  if (a === "desconectar") {
    await db.shopeeConexao.delete({ where: { id: 1 } });
    await auditar(u.nome, "desconectou a loja da Shopee");
  }
  revalidatePath("/vendas/shopee");
}

async function enviar(form: FormData) {
  "use server";
  const u = await exigir("vendas", "criar");
  const f = form.get("arquivo");
  if (!(f instanceof File) || !f.size) redirect("/vendas/shopee?erro=" + encodeURIComponent("Escolha a planilha exportada da Shopee."));
  let id: number;
  try {
    const linhas = lerPlanilha(f.name, new Uint8Array(await f.arrayBuffer()));
    const { pedidos, avisos } = lerPedidosShopee(linhas);
    if (!pedidos.length) throw new Error("Nenhum pedido encontrado na planilha.");
    const imp = await db.importacaoVenda.create({ data: { canal: "shopee", arquivo: f.name, dados: { pedidos, avisos }, usuario: u.nome } });
    id = imp.id;
  } catch (e) {
    redirect("/vendas/shopee?erro=" + encodeURIComponent(e instanceof Error ? e.message : "Não consegui ler a planilha."));
  }
  redirect(`/vendas/shopee/${id}`);
}

async function desligar(form: FormData) {
  "use server";
  const u = await exigir("vendas", "editar");
  const id = Number(form.get("id"));
  const a = await db.anuncioCanal.delete({ where: { id } });
  await auditar(u.nome, "desligou anúncio da Shopee", a.chave);
  revalidatePath("/vendas/shopee");
}

export default async function Shopee({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string; conectado?: string }> }) {
  const u = await exigir("vendas");
  const { erro, ok, conectado } = await searchParams;
  await sincronizarSeAntigo();
  const cfgApi = configShopee();
  const podeEditar = pode(u.permissoes, "vendas", "editar");
  const [con, imps, anuncios, abertos] = await Promise.all([
    db.shopeeConexao.findUnique({ where: { id: 1 } }),
    db.importacaoVenda.findMany({ where: { canal: "shopee" }, orderBy: { criadoEm: "desc" }, take: 15 }),
    db.anuncioCanal.findMany({ where: { canal: "shopee" }, include: { item: true }, orderBy: { chave: "asc" } }),
    db.pedidoVenda.count({ where: { origem: "shopee", status: "aberto" } }),
  ]);
  return (
    <>
      <h1>Vendas</h1>
      <AbasVendas ativo="shopee" />
      {erro && <div className="aviso erro">{erro}</div>}
      {ok && <div className="aviso ok">{ok}</div>}
      {conectado && <div className="aviso ok">Loja conectada! Os pedidos dos últimos 15 dias estão sendo puxados agora; daqui em diante cada pedido novo ou mudança de situação entra sozinho.</div>}

      <div className="card">
        <div className="topo" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Ligação automática</h2>
          {con ? <span className="selo ok">Conectada{con.nomeLoja ? ` · ${con.nomeLoja}` : ""}</span> : <span className="selo">Desligada</span>}
        </div>
        {!cfgApi ? (
          <p className="suave" style={{ marginBottom: 0 }}>Falta o cadastro do app na Shopee Open Platform. Quando a Shopee aprovar, coloque o <b>Partner ID</b> e a <b>Partner Key</b> nas configurações do sistema (SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY) e o botão <b>Conectar loja</b> aparece aqui. Enquanto isso, use a planilha abaixo.</p>
        ) : !con ? (
          <>
            <p className="suave">Clique, entre com a conta da loja na Shopee e autorize. Depois disso todo pedido novo e toda mudança de situação (enviado, concluído, cancelado) entra sozinho, com as taxas da Shopee.{cfgApi.ambiente === "teste" && <b> Ambiente de teste da Shopee.</b>}</p>
            {podeEditar && <form action={conexao}><input type="hidden" name="a" value="conectar" /><button className="btn">Conectar loja da Shopee</button></form>}
          </>
        ) : (
          <>
            <p className="suave">Loja {con.shopId} conectada por {con.conectadoPor} em {dataHora(con.conectadoEm)}. A Shopee avisa o sistema na hora de cada pedido; além disso o sistema confere tudo uma vez por dia e sempre que alguém abre Vendas.
              {" "}Última conferência: <b>{con.ultimaSync ? dataHora(con.ultimaSync) : "ainda não"}</b>.</p>
            {con.erro && <div className="aviso erro">Última tentativa falhou: {con.erro}</div>}
            {podeEditar && (
              <div className="acoes" style={{ flexWrap: "wrap" }}>
                <form action={conexao}><input type="hidden" name="a" value="sincronizar" /><button className="btn">Conferir agora</button></form>
                <form action={conexao}><input type="hidden" name="a" value="baixar" /><input type="hidden" name="valor" value={con.baixarEnviados ? "0" : "1"} />
                  <button className="btn sec">{con.baixarEnviados ? "✓ Dá baixa no estoque ao enviar" : "Não dá baixa no estoque ao enviar"}</button></form>
                <form action={conexao}><input type="hidden" name="a" value="desconectar" /><button className="btn sec">Desconectar</button></form>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Importar pedidos da Shopee pela planilha</h2>
        <p className="suave">{con ? "Com a loja conectada, a planilha só serve para trazer pedidos antigos (mais de 15 dias). " : ""}No Seller Center, abra <b>Meus pedidos</b>, escolha o período e clique em <b>Exportar</b>. Quando o arquivo ficar pronto, baixe e envie aqui (.xlsx ou .csv), sem mudar as colunas.
          Pode enviar a mesma planilha de novo ou um período que se repete: pedido que já entrou só tem a situação atualizada.</p>
        {pode(u.permissoes, "vendas", "criar") ? (
          <form action={enviar} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input type="file" name="arquivo" accept=".xlsx,.csv" required />
            <button className="btn">Ler planilha</button>
          </form>
        ) : <p className="suave">Seu perfil não pode importar pedidos.</p>}
        <p className="suave" style={{ marginBottom: 0 }}>O que acontece com cada pedido:
          <b> A enviar</b> entra como pedido em aberto e passa pela análise de sempre (separa estoque, manda produzir e sugere compras);
          <b> Enviado/Concluído</b> entra como venda entregue, para métricas e recordes (a baixa no estoque é opcional);
          <b> Cancelado/Devolução</b> não conta nas vendas; <b>Não pago</b> é ignorado. {abertos > 0 && <>Hoje há <Link href="/vendas">{abertos} pedido(s) da Shopee em aberto</Link>.</>}</p>
      </div>

      <div className="card tabela">
        <h2 style={{ marginTop: 0 }}>Planilhas enviadas</h2>
        {imps.length === 0 ? <p className="suave">Nenhuma ainda.</p> : (
          <table>
            <thead><tr><th>Quando</th><th>Arquivo</th><th>Quem</th><th>Pedidos</th><th>Situação</th></tr></thead>
            <tbody>{imps.map((i) => {
              const n = (i.dados as { pedidos?: unknown[] }).pedidos?.length ?? 0;
              const r = i.resumo ? JSON.parse(i.resumo) as Record<string, number> : null;
              return (
                <tr key={i.id}>
                  <td><Link href={`/vendas/shopee/${i.id}`}>{dataHora(i.criadoEm)}</Link></td>
                  <td>{i.arquivo}</td><td>{i.usuario}</td><td>{n}</td>
                  <td>{i.status === "importada" && r
                    ? <span className="selo ok">{r.novos + r.abertos} novos · {r.atualizados} atualizados{r.semVinculo ? ` · ${r.semVinculo} sem produto` : ""}</span>
                    : <span className="selo alerta">{i.arquivo.startsWith("Automático") ? "Ligar anúncio a um produto" : "Aguardando confirmar"}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>

      <div className="card tabela">
        <h2 style={{ marginTop: 0 }}>Anúncios ligados a produtos</h2>
        <p className="suave">Quando o SKU do anúncio é igual ao código do produto (ex.: FM-EXT400LO900) a ligação é automática. Os outros você liga uma vez na primeira importação e o sistema lembra.</p>
        {anuncios.length === 0 ? <p className="suave">Nenhuma ligação manual ainda.</p> : (
          <table>
            <thead><tr><th>Anúncio na Shopee</th><th>Produto</th><th className="n">Fechaduras por venda</th><th /></tr></thead>
            <tbody>{anuncios.map((a) => (
              <tr key={a.id}>
                <td>{a.chave}{a.descricao && a.descricao !== a.chave && <div className="suave">{a.descricao}</div>}</td>
                <td>{a.item.codigo} — {a.item.nome}</td>
                <td className="n">{a.fator}</td>
                <td>{pode(u.permissoes, "vendas", "editar") && <form action={desligar}><input type="hidden" name="id" value={a.id} /><button className="btn sec peq">Desligar</button></form>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
