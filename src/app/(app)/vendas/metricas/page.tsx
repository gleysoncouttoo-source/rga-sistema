import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigir, auditar } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, num } from "@/lib/formato";
import { vendas, resumo, porPeriodo, recordes, nomePeriodo, diaBR, CANAIS, TIPOS_REC, METRICAS, type Recorde } from "@/lib/metricasVendas";
import AbasVendas from "@/components/AbasVendas";
import { sincronizarSeAntigo } from "@/lib/shopeeAuto";

async function decidir(form: FormData) {
  "use server";
  const u = await exigir("vendas", "aprovar");
  const confirmar = form.get("decisao") === "confirmar";
  const lista = String(form.get("recs") || "").split(";").filter(Boolean);
  for (const r of lista) {
    const [tipo, metrica, escopo, periodo, valor] = r.split("|");
    if (confirmar) await db.recordeVenda.updateMany({ where: { tipo, metrica, escopo, status: "confirmado" }, data: { status: "superado" } });
    await db.recordeVenda.create({ data: { tipo, metrica, escopo, periodo, valor: Number(valor), status: confirmar ? "confirmado" : "recusado", decididoPor: u.nome } });
  }
  await auditar(u.nome, confirmar ? "confirmou recorde de vendas" : "recusou recorde de vendas", `${lista.length} recorde(s)`);
  revalidatePath("/vendas/metricas");
}

const PERIODOS: [string, string][] = [["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"], ["mes", "Este mês"], ["ano", "Este ano"], ["365", "12 meses"]];
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);
const valorFmt = (metrica: string, v: number) => (metrica === "faturamento" ? brl(v, 0) : `${num(v)} un`);
const codigo = (r: Recorde) => `${r.tipo}|${r.metrica}|${r.escopo}|${r.candidato!.periodo}|${r.candidato!.valor}`;

function Variacao({ atual, antes }: { atual: number; antes: number }) {
  const p = pct(atual, antes);
  if (p == null) return <span className="suave">sem período anterior</span>;
  return <span style={{ color: p >= 0 ? "var(--ok)" : "var(--erro)", fontWeight: 600 }}>{p >= 0 ? "▲" : "▼"} {num(Math.abs(p), 0)}% <span className="suave" style={{ fontWeight: 400 }}>vs. período anterior</span></span>;
}

export default async function Metricas({ searchParams }: { searchParams: Promise<{ periodo?: string; canal?: string }> }) {
  const u = await exigir("vendas");
  await sincronizarSeAntigo();
  const sp = await searchParams;
  const periodo = PERIODOS.some(([k]) => k === sp.periodo) ? sp.periodo! : "30";
  const canal = sp.canal && CANAIS[sp.canal] ? sp.canal : "";
  const hoje = diaBR(new Date());
  const ini = (k: string) => new Date(k + "T00:00:00-03:00");
  let de: Date, ateAnterior: Date, deAnterior: Date;
  if (periodo === "mes") { de = ini(hoje.slice(0, 8) + "01"); const m = new Date(de); m.setMonth(m.getMonth() - 1); deAnterior = m; }
  else if (periodo === "ano") { de = ini(hoje.slice(0, 4) + "-01-01"); deAnterior = ini(`${+hoje.slice(0, 4) - 1}-01-01`); }
  else { const n = Number(periodo); de = new Date(ini(hoje).getTime() - (n - 1) * 86400000); deAnterior = new Date(de.getTime() - n * 86400000); }
  ateAnterior = new Date(deAnterior.getTime() + (Date.now() - de.getTime())); // mesmo tamanho, para comparar justo

  const todas = await vendas();
  const doCanal = canal ? todas.filter((v) => v.origem === canal) : todas;
  const atual = doCanal.filter((v) => v.data >= de);
  const anterior = doCanal.filter((v) => v.data >= deAnterior && v.data < ateAnterior);
  const ra = resumo(atual), rb = resumo(anterior);

  const taxasShopee = await db.pedidoVenda.aggregate({
    where: { origem: "shopee", status: { not: "cancelado" }, dataPedido: { gte: de } }, _sum: { taxas: true },
  });
  const fatShopee = atual.filter((v) => v.origem === "shopee").reduce((t, v) => t + v.valor, 0);

  // por canal
  const canais = Object.entries(CANAIS).map(([k, nome]) => ({ k, nome, ...resumo(todas.filter((v) => v.origem === k && v.data >= de)) })).filter((c) => c.pedidos);

  // últimos 12 meses
  const meses: string[] = [];
  { const d = new Date(hoje.slice(0, 7) + "-15T12:00:00Z"); for (let i = 11; i >= 0; i--) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() - i); meses.push(x.toISOString().slice(0, 7)); } }
  const pm = porPeriodo(doCanal, "mes");
  const maxMes = Math.max(1, ...meses.map((m) => pm.get(m)?.faturamento ?? 0));

  // produtos
  const prod = new Map<number, { codigo: string; nome: string; un: number; fat: number; pedidos: Set<number>; antes: number }>();
  for (const v of atual) {
    const p = prod.get(v.itemId) ?? { codigo: v.codigo, nome: v.nome, un: 0, fat: 0, pedidos: new Set<number>(), antes: 0 };
    p.un += v.quantidade; p.fat += v.valor; p.pedidos.add(v.pedidoId); prod.set(v.itemId, p);
  }
  for (const v of anterior) { const p = prod.get(v.itemId); if (p) p.antes += v.quantidade; }
  const produtos = [...prod.entries()].sort((a, b) => b[1].fat - a[1].fat);

  // recordes (sempre sobre todo o histórico)
  const recs = await recordes(todas, hoje);
  const escopo = canal ? `canal:${canal}` : "total";
  const doEscopo = recs.filter((r) => r.escopo === escopo);
  const pendentes = recs.filter((r) => r.candidato);
  const recItem = new Map(recs.filter((r) => r.escopo.startsWith("item:")).map((r) => [Number(r.escopo.slice(5)), r]));
  const podeAprovar = pode(u.permissoes, "vendas", "aprovar");
  const nomeEsc = (r: Recorde) => (r.escopo.startsWith("item:") ? `Produto ${r.nomeEscopo}` : r.nomeEscopo);
  const nomeTipo = (t: string) => TIPOS_REC.find(([k]) => k === t)![1];
  const nomeMet = (m: string) => METRICAS.find(([k]) => k === m)![1];
  const link = (p: Record<string, string>) => "/vendas/metricas?" + new URLSearchParams({ periodo, ...(canal ? { canal } : {}), ...p }).toString().replace(/canal=&?/, "");

  return (
    <>
      <h1>Vendas</h1>
      <AbasVendas ativo="metricas" />
      <div className="abas">
        {PERIODOS.map(([k, n]) => <a key={k} href={link({ periodo: k })} className={k === periodo ? "ativo" : ""}>{n}</a>)}
        <span style={{ width: 12 }} />
        <a href={link({ canal: "" })} className={!canal ? "ativo" : ""}>Todos os canais</a>
        {Object.entries(CANAIS).map(([k, n]) => <a key={k} href={link({ canal: k })} className={canal === k ? "ativo" : ""}>{n}</a>)}
      </div>

      {todas.length === 0 && <div className="aviso alerta">Ainda não há vendas. <Link href="/vendas/shopee">Importe a planilha de pedidos da Shopee</Link> ou lance um pedido.</div>}

      {pendentes.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>🏆 {pendentes.length} novo(s) recorde(s) aguardando confirmação</h2>
          <p className="suave">Recorde só vale depois que um diretor ou gestor confirma. Só entram períodos já fechados (dia, semana ou mês que terminou).</p>
          <div className="tabela"><table>
            <thead><tr><th>Recorde</th><th>De quem</th><th>Período</th><th className="n">Novo</th><th className="n">Anterior</th><th /></tr></thead>
            <tbody>{pendentes.map((r) => (
              <tr key={codigo(r)}>
                <td>{nomeTipo(r.tipo)} · {nomeMet(r.metrica)}</td>
                <td>{nomeEsc(r)}</td>
                <td>{nomePeriodo(r.tipo, r.candidato!.periodo)}</td>
                <td className="n"><b>{valorFmt(r.metrica, r.candidato!.valor)}</b></td>
                <td className="n suave">{r.confirmado ? valorFmt(r.metrica, r.confirmado.valor) : "primeiro"}</td>
                <td>{podeAprovar && <div className="acoes">
                  <form action={decidir}><input type="hidden" name="recs" value={codigo(r)} /><input type="hidden" name="decisao" value="confirmar" /><button className="btn peq">Confirmar</button></form>
                  <form action={decidir}><input type="hidden" name="recs" value={codigo(r)} /><input type="hidden" name="decisao" value="recusar" /><button className="btn sec peq">Recusar</button></form>
                </div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {podeAprovar && pendentes.length > 1 && (
            <form action={decidir} style={{ marginTop: 10 }}><input type="hidden" name="recs" value={pendentes.map(codigo).join(";")} /><input type="hidden" name="decisao" value="confirmar" /><button className="btn sec">Confirmar todos</button></form>
          )}
        </div>
      )}

      <div className="grade">
        <div className="kpi"><div className="r">Faturamento</div><div className="v">{brl(ra.faturamento, 0)}</div><div className="r"><Variacao atual={ra.faturamento} antes={rb.faturamento} /></div></div>
        <div className="kpi"><div className="r">Fechaduras vendidas</div><div className="v">{num(ra.unidades)}</div><div className="r"><Variacao atual={ra.unidades} antes={rb.unidades} /></div></div>
        <div className="kpi"><div className="r">Pedidos</div><div className="v">{num(ra.pedidos)}</div><div className="r"><Variacao atual={ra.pedidos} antes={rb.pedidos} /></div></div>
        <div className="kpi"><div className="r">Ticket médio</div><div className="v">{brl(ra.ticket, 0)}</div><div className="r">por pedido</div></div>
        {(!canal || canal === "shopee") && fatShopee > 0 && (
          <div className="kpi"><div className="r">Taxas da Shopee</div><div className="v">{brl(taxasShopee._sum.taxas ?? 0, 0)}</div><div className="r">{num(((taxasShopee._sum.taxas ?? 0) / fatShopee) * 100, 1)}% do vendido lá</div></div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recordes {canal ? `· ${CANAIS[canal]}` : ""}</h2>
        <div className="tabela"><table>
          <thead><tr><th /><th>Recorde confirmado</th><th>Agora</th><th style={{ width: "30%" }}>Falta para bater</th></tr></thead>
          <tbody>{TIPOS_REC.flatMap(([t, nt]) => METRICAS.map(([m, nm]) => {
            const r = doEscopo.find((x) => x.tipo === t && x.metrica === m);
            const alvo = r?.confirmado?.valor ?? 0;
            const agora = r?.atual.valor ?? 0;
            const p = alvo ? Math.min(100, (agora / alvo) * 100) : 0;
            return (
              <tr key={t + m}>
                <td><b>{nt}</b><div className="suave">{nm}</div></td>
                <td>{r?.confirmado ? <>{valorFmt(m, alvo)}<div className="suave">{nomePeriodo(t, r.confirmado.periodo)}</div></> : <span className="suave">ainda não confirmado</span>}</td>
                <td>{valorFmt(m, agora)}<div className="suave">{t === "dia" ? "hoje" : t === "semana" ? "esta semana" : "este mês"}</div></td>
                <td>{alvo ? (
                  agora > alvo ? <span className="selo ok">Batendo o recorde! 🏆</span> : <>
                    <div style={{ height: 8, background: "var(--linha)", borderRadius: 4 }}><div style={{ width: `${p}%`, height: 8, background: "var(--pri)", borderRadius: 4 }} /></div>
                    <div className="suave">faltam {valorFmt(m, alvo - agora)}</div></>
                ) : <span className="suave">—</span>}</td>
              </tr>
            );
          }))}</tbody>
        </table></div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Faturamento por mês {canal ? `· ${CANAIS[canal]}` : ""}</h2>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 180, paddingTop: 20 }}>
          {meses.map((m) => {
            const v = pm.get(m)?.faturamento ?? 0, un = pm.get(m)?.unidades ?? 0;
            const rec = doEscopo.find((x) => x.tipo === "mes" && x.metrica === "faturamento")?.confirmado?.periodo === m;
            return (
              <div key={m} title={`${nomePeriodo("mes", m)}: ${brl(v, 0)} · ${num(un)} un${rec ? " · recorde" : ""}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
                <div className="suave" style={{ fontSize: ".7rem", whiteSpace: "nowrap" }}>{v ? (rec ? "🏆 " : "") + num(v / 1000, 1) + "k" : ""}</div>
                <div style={{ width: "70%", maxWidth: 36, height: `${(v / maxMes) * 140}px`, minHeight: v ? 3 : 0, background: m === hoje.slice(0, 7) ? "#8FB3A0" : "var(--pri)", borderRadius: "4px 4px 0 0" }} />
                <div className="suave" style={{ fontSize: ".7rem", marginTop: 4 }}>{nomePeriodo("mes", m).split(" ")[0].replace(".", "")}</div>
              </div>
            );
          })}
        </div>
        <p className="suave" style={{ marginBottom: 0 }}>Mês atual em verde mais claro (ainda em andamento). Passe o mouse para ver o valor e as unidades.</p>
      </div>

      {canais.length > 1 && !canal && (
        <div className="card tabela">
          <h2 style={{ marginTop: 0 }}>Por canal</h2>
          <table>
            <thead><tr><th>Canal</th><th className="n">Pedidos</th><th className="n">Fechaduras</th><th className="n">Faturamento</th><th className="n">% do total</th><th className="n">Ticket médio</th></tr></thead>
            <tbody>{canais.map((c) => (
              <tr key={c.k}><td><a href={link({ canal: c.k })}>{c.nome}</a></td><td className="n">{num(c.pedidos)}</td><td className="n">{num(c.unidades)}</td><td className="n">{brl(c.faturamento, 0)}</td><td className="n">{num(ra.faturamento ? (c.faturamento / ra.faturamento) * 100 : 0, 0)}%</td><td className="n">{brl(c.ticket, 0)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="card tabela">
        <h2 style={{ marginTop: 0 }}>Produtos mais vendidos</h2>
        {produtos.length === 0 ? <p className="suave">Nenhuma venda no período.</p> : (
          <table>
            <thead><tr><th>Produto</th><th className="n">Fechaduras</th><th className="n">vs. anterior</th><th className="n">Pedidos</th><th className="n">Faturamento</th><th className="n">Preço médio</th><th className="n">Recorde do mês</th></tr></thead>
            <tbody>{produtos.map(([id, p]) => {
              const r = recItem.get(id);
              const var_ = pct(p.un, p.antes);
              return (
                <tr key={id}>
                  <td><Link href={`/estoque/${id}`}>{p.codigo}</Link><div className="suave">{p.nome}</div></td>
                  <td className="n">{num(p.un)}</td>
                  <td className="n">{var_ == null ? <span className="suave">novo</span> : <span style={{ color: var_ >= 0 ? "var(--ok)" : "var(--erro)" }}>{var_ >= 0 ? "▲" : "▼"} {num(Math.abs(var_), 0)}%</span>}</td>
                  <td className="n">{num(p.pedidos.size)}</td>
                  <td className="n">{brl(p.fat, 0)}</td>
                  <td className="n">{brl(p.un ? p.fat / p.un : 0)}</td>
                  <td className="n">{r?.confirmado ? <>{num(r.confirmado.valor)} un<div className="suave">{nomePeriodo("mes", r.confirmado.periodo)}</div></> : r?.candidato ? <span className="selo alerta">a confirmar</span> : <span className="suave">—</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
