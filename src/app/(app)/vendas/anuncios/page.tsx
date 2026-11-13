import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigir, auditar } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, num, dataDia } from "@/lib/formato";
import { lerPlanilha } from "@/lib/planilha";
import { lerAdsPlanilha, lucroPorAnuncio, type LinhaLucro } from "@/lib/lucroAnuncios";
import { dia, chave } from "@/lib/datas";
import { diaBR } from "@/lib/metricasVendas";
import AbasVendas from "@/components/AbasVendas";

async function enviarAds(form: FormData) {
  "use server";
  const u = await exigir("vendas", "criar");
  const f = form.get("arquivo");
  if (!(f instanceof File) || !f.size) redirect("/vendas/anuncios?erro=" + encodeURIComponent("Escolha o relatório dos Anúncios Shopee."));
  let destino = "";
  try {
    const r = lerAdsPlanilha(lerPlanilha(f.name, new Uint8Array(await f.arrayBuffer())));
    const de = r.de ?? (String(form.get("de") || "") || null), ate = r.ate ?? (String(form.get("ate") || "") || null);
    if (!de || !ate) throw new Error("Não achei o período no relatório. Informe as datas de início e fim e envie de novo.");
    if (!r.linhas.length) throw new Error("O relatório não tem nenhum anúncio com gasto.");
    // mesmo período enviado de novo substitui o anterior
    await db.adsRelatorio.deleteMany({ where: { de: dia(de), ate: dia(ate) } });
    await db.adsRelatorio.create({ data: { arquivo: f.name, de: dia(de), ate: dia(ate), usuario: u.nome, linhas: { create: r.linhas } } });
    await auditar(u.nome, "importou relatório de Anúncios Shopee", `${f.name} (${de} a ${ate})`);
    destino = `/vendas/anuncios?de=${de}&ate=${ate}`;
  } catch (e) {
    destino = "/vendas/anuncios?erro=" + encodeURIComponent(e instanceof Error ? e.message : "Não consegui ler o relatório.");
  }
  redirect(destino);
}

const roas = (vendas: number, gasto: number) => (gasto > 0 ? vendas / gasto : null);
const fmtRoas = (v: number | null) => (v == null ? "—" : num(v, 1));

function Situacao({ l }: { l: LinhaLucro }) {
  if (l.sobra < 0) return <span className="selo erro">Dá prejuízo</span>;
  if (!l.ads.gasto) return <span className="selo">Sem Ads</span>;
  const r = roas(l.ads.vendas, l.ads.gasto);
  if (l.roasMinimo != null && r != null && r < l.roasMinimo) return <span className="selo alerta">Ads não se paga sozinho</span>;
  return <span className="selo ok">Ads se paga</span>;
}

export default async function Anuncios({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; erro?: string }> }) {
  const u = await exigir("vendas");
  const sp = await searchParams;
  const rels = await db.adsRelatorio.findMany({ orderBy: { ate: "desc" }, take: 12, include: { _count: { select: { linhas: true } } } });
  const hoje = diaBR(new Date());
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const de = ok(sp.de) ? sp.de! : rels[0] ? chave(rels[0].de) : chave(new Date(dia(hoje).getTime() - 29 * 86_400_000));
  const ate = ok(sp.ate) ? sp.ate! : rels[0] ? chave(rels[0].ate) : hoje;
  const { lista, adsProporcional, semTaxa, pedidos, semCusto } = await lucroPorAnuncio(de, ate);
  const t = lista.reduce((a, l) => ({
    fat: a.fat + l.faturamento, taxas: a.taxas + l.taxas, imposto: a.imposto + l.imposto, custo: a.custo + l.custo,
    gasto: a.gasto + l.ads.gasto, vendasAds: a.vendasAds + l.ads.vendas, sobra: a.sobra + l.sobra, un: a.un + l.unidades,
  }), { fat: 0, taxas: 0, imposto: 0, custo: 0, gasto: 0, vendasAds: 0, sobra: 0, un: 0 });

  return (
    <>
      <h1>Vendas</h1>
      <AbasVendas ativo="anuncios" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}

      <div className="card">
        <form className="campos" style={{ alignItems: "end" }}>
          <label>De<input type="date" name="de" defaultValue={de} /></label>
          <label>Até<input type="date" name="ate" defaultValue={ate} /></label>
          <button className="btn sec">Ver período</button>
        </form>
        {rels.length > 0 && (
          <div className="abas" style={{ marginTop: 12, marginBottom: 0 }}>
            <span className="suave" style={{ alignSelf: "center" }}>Relatórios de Ads:</span>
            {rels.map((r) => {
              const k1 = chave(r.de), k2 = chave(r.ate);
              return <a key={r.id} href={`/vendas/anuncios?de=${k1}&ate=${k2}`} className={k1 === de && k2 === ate ? "ativo" : ""}>{dataDia(r.de).slice(0, 5)} a {dataDia(r.ate)}</a>;
            })}
          </div>
        )}
      </div>

      {rels.length === 0 && <div className="aviso alerta">Ainda não há relatório dos Anúncios Shopee. Envie lá embaixo para ver o gasto, o ROAS e quanto sobra depois dos Ads.</div>}
      {adsProporcional && <div className="aviso alerta">O período escolhido não bate com o do relatório de Ads: o gasto foi contado na proporção dos dias. Para o número exato, escolha o período do relatório.</div>}
      {semTaxa > 0 && <div className="aviso alerta">{semTaxa} de {pedidos} pedido(s) ainda sem as taxas da Shopee (a planilha de pedidos não trouxe, ou o extrato ainda não saiu). A sobra deles está maior do que a real.</div>}
      {semCusto > 0 && <div className="aviso alerta">{semCusto} venda(s) de fechadura sem custo cadastrado: cadastre a estrutura ou o custo em Estoque.</div>}

      <div className="grade">
        <div className="kpi"><div className="r">Vendido na Shopee</div><div className="v">{brl(t.fat, 0)}</div><div className="r">{num(t.un)} fechaduras</div></div>
        <div className="kpi"><div className="r">Gasto com Ads</div><div className="v">{brl(t.gasto, 0)}</div><div className="r">{num(t.fat ? (t.gasto / t.fat) * 100 : 0, 1)}% do vendido (TACOS)</div></div>
        <div className="kpi"><div className="r">ROAS dos Ads</div><div className="v">{fmtRoas(roas(t.vendasAds, t.gasto))}</div><div className="r">vendas pelos Ads ÷ gasto</div></div>
        <div className="kpi"><div className="r">ROAS geral</div><div className="v">{fmtRoas(roas(t.fat, t.gasto))}</div><div className="r">tudo que vendeu ÷ gasto</div></div>
        <div className="kpi"><div className="r">Sobrou</div><div className="v" style={{ color: t.sobra < 0 ? "var(--erro)" : undefined }}>{brl(t.sobra, 0)}</div><div className="r">{num(t.fat ? (t.sobra / t.fat) * 100 : 0, 1)}% do vendido</div></div>
      </div>

      <div className="card tabela">
        <h2 style={{ marginTop: 0 }}>Quanto sobra por anúncio · {dataDia(dia(de))} a {dataDia(dia(ate))}</h2>
        <p className="suave">Sobra = vendido − taxas da Shopee − imposto − custo da fechadura − gasto com Ads. <b>ROAS mínimo</b> é o ROAS a partir do qual o anúncio paga o próprio Ads: abaixo dele, cada real no Ads volta menos do que custa.</p>
        {lista.length === 0 ? <p className="suave">Nenhuma venda da Shopee nem gasto com Ads no período.</p> : (
          <table>
            <thead><tr>
              <th>Anúncio</th><th className="n">Vendas</th><th className="n">Vendido</th><th className="n">Taxas + imposto</th><th className="n">Custo</th>
              <th className="n">Gasto Ads</th><th className="n">ROAS Ads</th><th className="n">ROAS mínimo</th><th className="n">Sobra</th><th className="n">Sobra por fechadura</th><th />
            </tr></thead>
            <tbody>{lista.map((l) => {
              const r = roas(l.ads.vendas, l.ads.gasto);
              return (
                <tr key={l.chave}>
                  <td style={{ maxWidth: 260 }}>{l.anuncio}<div className="suave">{l.produtos.join(", ")}{l.ads.cliques ? ` · ${num(l.ads.cliques)} cliques` : ""}</div></td>
                  <td className="n">{num(l.pedidos)}<div className="suave">{num(l.unidades)} un</div></td>
                  <td className="n">{brl(l.faturamento, 0)}</td>
                  <td className="n">{brl(l.taxas + l.imposto, 0)}</td>
                  <td className="n">{brl(l.custo, 0)}</td>
                  <td className="n">{l.ads.gasto ? brl(l.ads.gasto, 0) : "—"}</td>
                  <td className="n"><b style={{ color: r != null && l.roasMinimo != null && r < l.roasMinimo ? "var(--erro)" : undefined }}>{fmtRoas(r)}</b></td>
                  <td className="n">{fmtRoas(l.roasMinimo)}</td>
                  <td className="n"><b style={{ color: l.sobra < 0 ? "var(--erro)" : "var(--ok)" }}>{brl(l.sobra, 0)}</b><div className="suave">{l.faturamento ? `${num((l.sobra / l.faturamento) * 100, 0)}%` : ""}</div></td>
                  <td className="n">{l.unidades ? brl(l.sobra / l.unidades) : "—"}</td>
                  <td><Situacao l={l} /></td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr>
              <th>Total</th><th className="n">{num(t.un)} un</th><th className="n">{brl(t.fat, 0)}</th><th className="n">{brl(t.taxas + t.imposto, 0)}</th><th className="n">{brl(t.custo, 0)}</th>
              <th className="n">{brl(t.gasto, 0)}</th><th className="n">{fmtRoas(roas(t.vendasAds, t.gasto))}</th><th /><th className="n">{brl(t.sobra, 0)}</th><th className="n">{t.un ? brl(t.sobra / t.un) : "—"}</th><th />
            </tr></tfoot>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Enviar relatório dos Anúncios Shopee</h2>
        <p className="suave">No Seller Center: <b>Marketing → Anúncios Shopee</b>, escolha o período e clique em <b>Exportar dados</b> (relatório por anúncio/produto). Enviar o mesmo período de novo substitui o anterior. Se o arquivo não trouxer o período, informe as datas.</p>
        {pode(u.permissoes, "vendas", "criar") && (
          <form action={enviarAds} className="campos" style={{ alignItems: "end" }}>
            <label>Arquivo (.csv ou .xlsx)<input type="file" name="arquivo" accept=".csv,.xlsx" required /></label>
            <label>Início (se faltar no arquivo)<input type="date" name="de" /></label>
            <label>Fim (se faltar no arquivo)<input type="date" name="ate" /></label>
            <button className="btn">Enviar relatório</button>
          </form>
        )}
      </div>

      <p className="suave">O custo de cada fechadura vem da tela de Custos (material + mão de obra + despesas). Os parâmetros e o lucro de cada produto em todos os canais ficam em <a href="/lucros">Lucros</a>.</p>
    </>
  );
}
