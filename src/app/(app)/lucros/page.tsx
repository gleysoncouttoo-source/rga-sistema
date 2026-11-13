import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigir, auditar } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, num } from "@/lib/formato";
import { linhasVenda } from "@/lib/lucroAnuncios";
import { moPorOperacao, sugerirLigacoes } from "@/lib/custoProduto";
import { diaBR, CANAIS } from "@/lib/metricasVendas";

async function salvarCfg(form: FormData) {
  "use server";
  const u = await exigir("custos", "editar");
  for (const k of ["impostoVendaPct", "custoExtraPct", "custoExtraUnidade"]) {
    const v = Number(String(form.get(k) ?? "").replace(",", "."));
    if (Number.isFinite(v) && v >= 0) await db.configuracao.upsert({ where: { chave: k }, update: { valor: String(v) }, create: { chave: k, valor: String(v) } });
  }
  await auditar(u.nome, "alterou parâmetros do lucro");
  revalidatePath("/lucros");
}

async function ligacao(form: FormData) {
  "use server";
  const u = await exigir("custos", "editar");
  const a = String(form.get("a"));
  if (a === "sugerir") {
    const n = await sugerirLigacoes();
    await auditar(u.nome, "sugeriu ligações peça × operação", `${n}`);
  } else if (a === "ligar") {
    const itemId = Number(form.get("itemId")), operacaoId = Number(form.get("operacaoId"));
    const porUnidade = Number(String(form.get("porUnidade") || "1").replace(",", ".")) || 1;
    if (itemId && operacaoId) await db.itemOperacao.upsert({ where: { itemId_operacaoId: { itemId, operacaoId } }, create: { itemId, operacaoId, porUnidade }, update: { porUnidade, sugerida: false } });
  } else if (a === "tirar") await db.itemOperacao.delete({ where: { id: Number(form.get("id")) } });
  else if (a === "conferir") await db.itemOperacao.updateMany({ where: { sugerida: true }, data: { sugerida: false } });
  revalidatePath("/lucros");
}

const PERIODOS: [string, string][] = [["30", "30 dias"], ["mes", "Este mês"], ["mesant", "Mês passado"], ["90", "90 dias"], ["ano", "Este ano"]];
const cor = (v: number) => (v < 0 ? "var(--erro)" : "var(--ok)");

export default async function Lucros({ searchParams }: { searchParams: Promise<{ periodo?: string; canal?: string }> }) {
  const u = await exigir("custos");
  const sp = await searchParams;
  const periodo = PERIODOS.some(([k]) => k === sp.periodo) ? sp.periodo! : "30";
  const canal = sp.canal && CANAIS[sp.canal] ? sp.canal : "";
  const hoje = diaBR(new Date());
  const menosDias = (k: string, n: number) => new Date(new Date(k + "T12:00:00Z").getTime() - n * 86_400_000).toISOString().slice(0, 10);
  let de = menosDias(hoje, 29), ate = hoje;
  if (periodo === "90") de = menosDias(hoje, 89);
  if (periodo === "mes") de = hoje.slice(0, 8) + "01";
  if (periodo === "ano") de = hoje.slice(0, 5) + "01-01";
  if (periodo === "mesant") { ate = menosDias(hoje.slice(0, 8) + "01", 1); de = ate.slice(0, 8) + "01"; }

  const base = await linhasVenda(de, ate, canal || undefined);
  const { linhas, cfg } = base;
  const soma = (ls: typeof linhas) => ls.reduce((a, l) => ({
    un: a.un + l.quantidade, fat: a.fat + l.valor, taxas: a.taxas + l.taxas + l.imposto, custo: a.custo + l.custo, ads: a.ads + l.ads,
    lucro: a.lucro + l.valor - l.taxas - l.imposto - l.custo - l.ads, ped: a.ped.add(l.pedidoId),
  }), { un: 0, fat: 0, taxas: 0, custo: 0, ads: 0, lucro: 0, ped: new Set<number>() });
  const t = soma(linhas);
  const adsSemVenda = [...base.ads.values()].filter((a) => !linhas.some((l) => l.anuncioChave === a.chave)).reduce((s, a) => s + a.gasto, 0);
  const lucroFinal = t.lucro - adsSemVenda;

  const porProd = new Map<number, typeof linhas>();
  for (const l of linhas) porProd.set(l.itemId, [...(porProd.get(l.itemId) ?? []), l]);
  const produtos = [...porProd.entries()].map(([id, ls]) => ({ id, l0: ls[0], ...soma(ls) })).sort((a, b) => b.lucro - a.lucro);
  const canais = Object.entries(CANAIS).map(([k, nome]) => ({ k, nome, ...soma(linhas.filter((l) => l.origem === k)) })).filter((c) => c.un);
  const semMo = [...new Set(linhas.flatMap((l) => l.unit.pecasSemMo))];

  // peças fabricadas e suas operações
  const [pecas, ops, { mo }] = await Promise.all([
    db.item.findMany({ where: { origem: "fabricado", tipo: "peca", ativo: true }, include: { operacoes: { include: { operacao: { include: { etapa: true } } } } }, orderBy: { codigo: "asc" } }),
    db.operacao.findMany({ where: { ativo: true }, include: { etapa: true }, orderBy: [{ etapa: { ordem: "asc" } }, { nome: "asc" }] }),
    moPorOperacao(),
  ]);
  const sugeridas = pecas.reduce((n, p) => n + p.operacoes.filter((o) => o.sugerida).length, 0);
  const edita = pode(u.permissoes, "custos", "editar");
  const link = (p: Record<string, string>) => "/lucros?" + new URLSearchParams(Object.entries({ periodo, canal, ...p }).filter(([, v]) => v)).toString();

  return (
    <>
      <h1>Lucros</h1>
      <p className="suave">Quanto cada produto deixa de lucro: vendido − taxas do canal (Shopee) − imposto − custo do produto − Anúncios Shopee. O custo do produto é o mesmo da tela de <Link href="/custos">Custos</Link>: material da estrutura + mão de obra das operações + despesas.</p>
      <div className="abas">
        {PERIODOS.map(([k, n]) => <a key={k} href={link({ periodo: k })} className={k === periodo ? "ativo" : ""}>{n}</a>)}
        <span style={{ width: 12 }} />
        <a href={link({ canal: "" })} className={!canal ? "ativo" : ""}>Todos os canais</a>
        {Object.entries(CANAIS).map(([k, n]) => <a key={k} href={link({ canal: k })} className={canal === k ? "ativo" : ""}>{n}</a>)}
      </div>

      {!base.temSalario && <div className="aviso alerta">Nenhum funcionário tem salário cadastrado: a mão de obra está entrando como zero. Cadastre os salários em <Link href="/funcionarios">Funcionários</Link>.</div>}
      {semMo.length > 0 && <div className="aviso alerta">{semMo.length} peça(s) vendida(s) sem operação de produção ligada, então sem mão de obra no custo: {semMo.slice(0, 8).join(", ")}{semMo.length > 8 ? "…" : ""}. Ligue em <a href="#mao-de-obra">Mão de obra de cada peça</a>.</div>}
      {base.semTaxa > 0 && <div className="aviso alerta">{base.semTaxa} pedido(s) da Shopee ainda sem as taxas: o lucro deles aparece maior que o real.</div>}
      {base.adsProporcional && <div className="aviso alerta">O período não bate com o do relatório de Ads: o gasto foi contado na proporção dos dias.</div>}

      <div className="grade">
        <div className="kpi"><div className="r">Vendido</div><div className="v">{brl(t.fat, 0)}</div><div className="r">{num(t.un)} un · {num(t.ped.size)} pedidos</div></div>
        <div className="kpi"><div className="r">Custo dos produtos</div><div className="v">{brl(t.custo, 0)}</div><div className="r">{num(t.fat ? (t.custo / t.fat) * 100 : 0, 0)}% do vendido</div></div>
        <div className="kpi"><div className="r">Taxas e imposto</div><div className="v">{brl(t.taxas, 0)}</div><div className="r">{num(t.fat ? (t.taxas / t.fat) * 100 : 0, 0)}% do vendido</div></div>
        <div className="kpi"><div className="r">Anúncios Shopee</div><div className="v">{brl(t.ads + adsSemVenda, 0)}</div><div className="r">{adsSemVenda ? `${brl(adsSemVenda, 0)} em anúncio sem venda` : "dividido pelos produtos"}</div></div>
        <div className="kpi"><div className="r">Lucro</div><div className="v" style={{ color: cor(lucroFinal) }}>{brl(lucroFinal, 0)}</div><div className="r">{num(t.fat ? (lucroFinal / t.fat) * 100 : 0, 1)}% do vendido</div></div>
      </div>

      {!canal && canais.length > 1 && (
        <div className="card tabela">
          <h2 style={{ marginTop: 0 }}>Por canal</h2>
          <table>
            <thead><tr><th>Canal</th><th className="n">Fechaduras</th><th className="n">Vendido</th><th className="n">Taxas + imposto</th><th className="n">Custo</th><th className="n">Ads</th><th className="n">Lucro</th><th className="n">Margem</th><th className="n">Lucro por fechadura</th></tr></thead>
            <tbody>{canais.map((c) => (
              <tr key={c.k}><td><a href={link({ canal: c.k })}>{c.nome}</a></td><td className="n">{num(c.un)}</td><td className="n">{brl(c.fat, 0)}</td><td className="n">{brl(c.taxas, 0)}</td><td className="n">{brl(c.custo, 0)}</td><td className="n">{c.ads ? brl(c.ads, 0) : "—"}</td>
                <td className="n"><b style={{ color: cor(c.lucro) }}>{brl(c.lucro, 0)}</b></td><td className="n">{num(c.fat ? (c.lucro / c.fat) * 100 : 0, 0)}%</td><td className="n">{brl(c.un ? c.lucro / c.un : 0)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="card tabela">
        <h2 style={{ marginTop: 0 }}>Lucro por produto</h2>
        {produtos.length === 0 ? <p className="suave">Nenhuma venda no período.</p> : (
          <table>
            <thead><tr><th>Produto</th><th className="n">Vendidas</th><th className="n">Preço médio</th><th className="n">Custo unitário</th><th className="n">Taxas + imposto</th><th className="n">Ads</th><th className="n">Lucro</th><th className="n">Lucro por fechadura</th><th className="n">Margem</th></tr></thead>
            <tbody>{produtos.map((p) => {
              const c = p.l0.unit;
              return (
                <tr key={p.id}>
                  <td><Link href={`/estoque/${p.id}`}>{p.l0.codigo}</Link><div className="suave">{p.l0.nome}</div></td>
                  <td className="n">{num(p.un)}</td>
                  <td className="n">{brl(p.un ? p.fat / p.un : 0)}</td>
                  <td className="n">{brl(c.total)}<div className="suave" style={{ whiteSpace: "nowrap" }}>mat {brl(c.material)} · MO {brl(c.mo)}{c.despesas + c.extra ? ` · desp ${brl(c.despesas + c.extra)}` : ""}</div></td>
                  <td className="n">{brl(p.taxas, 0)}</td>
                  <td className="n">{p.ads ? brl(p.ads, 0) : "—"}</td>
                  <td className="n"><b style={{ color: cor(p.lucro) }}>{brl(p.lucro, 0)}</b></td>
                  <td className="n">{brl(p.un ? p.lucro / p.un : 0)}</td>
                  <td className="n">{num(p.fat ? (p.lucro / p.fat) * 100 : 0, 0)}%</td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr><th>Total</th><th className="n">{num(t.un)}</th><th /><th className="n">{brl(t.custo, 0)}</th><th className="n">{brl(t.taxas, 0)}</th><th className="n">{brl(t.ads, 0)}</th><th className="n">{brl(t.lucro, 0)}</th><th className="n">{brl(t.un ? t.lucro / t.un : 0)}</th><th className="n">{num(t.fat ? (t.lucro / t.fat) * 100 : 0, 0)}%</th></tr></tfoot>
          </table>
        )}
        <p className="suave" style={{ marginBottom: 0 }}>Lucro por anúncio da Shopee, com ROAS: <Link href="/vendas/anuncios">Vendas → Lucro por anúncio</Link>.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Parâmetros</h2>
        <form action={salvarCfg} className="campos" style={{ alignItems: "end" }}>
          <label>Imposto sobre a venda (%)<input name="impostoVendaPct" inputMode="decimal" defaultValue={cfg.impostoVendaPct} disabled={!edita} /></label>
          <label>Energia e despesas (% sobre material + mão de obra)<input name="custoExtraPct" inputMode="decimal" defaultValue={cfg.custoExtraPct} disabled={!edita} /></label>
          <label>Embalagem e outros por unidade (R$)<input name="custoExtraUnidade" inputMode="decimal" defaultValue={cfg.custoExtraUnidade} disabled={!edita} /></label>
          {edita && <button className="btn sec">Salvar</button>}
        </form>
        <p className="suave" style={{ marginBottom: 0 }}>Mão de obra de cada operação: custo real dos últimos 30 dias quando há apontamento; senão, no recorde (custo da hora do setor × tempo do recorde), igual à tela de Custos.</p>
      </div>

      <div className="card tabela" id="mao-de-obra">
        <div className="topo" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Mão de obra de cada peça</h2>
          {edita && <div className="acoes">
            <form action={ligacao}><input type="hidden" name="a" value="sugerir" /><button className="btn sec peq">Sugerir pelo nome</button></form>
            {sugeridas > 0 && <form action={ligacao}><input type="hidden" name="a" value="conferir" /><button className="btn peq">Marcar {sugeridas} sugestão(ões) como conferidas</button></form>}
          </div>}
        </div>
        <p className="suave">Diga quais operações da produção fazem cada peça. A mão de obra da peça entra no custo de todo produto que usa a peça. Peça comprada pronta não precisa.</p>
        <table>
          <thead><tr><th>Peça</th><th>Operações</th><th className="n">MO por peça</th>{edita && <th>Ligar operação</th>}</tr></thead>
          <tbody>{pecas.map((p) => {
            const total = p.operacoes.reduce((s, o) => s + (mo.get(o.operacaoId)?.valor ?? 0) * o.porUnidade, 0);
            return (
              <tr key={p.id}>
                <td>{p.codigo}<div className="suave">{p.nome}</div></td>
                <td>{p.operacoes.length === 0 ? <span className="selo alerta">sem operação</span> : p.operacoes.map((o) => (
                  <span key={o.id} className={`selo ${o.sugerida ? "alerta" : ""}`} style={{ marginRight: 4, marginBottom: 4 }}>
                    {o.operacao.etapa.nome}: {o.operacao.nome}{o.porUnidade !== 1 ? ` ×${num(o.porUnidade, 2)}` : ""}{o.sugerida ? " (conferir)" : ""}
                    {edita && <form action={ligacao} style={{ display: "inline" }}><input type="hidden" name="a" value="tirar" /><input type="hidden" name="id" value={o.id} /><button title="Tirar" style={{ border: 0, background: "none", cursor: "pointer", color: "inherit", padding: "0 0 0 4px" }}>×</button></form>}
                  </span>
                ))}</td>
                <td className="n">{p.operacoes.length ? brl(total, 4) : "—"}</td>
                {edita && <td>
                  <form action={ligacao} style={{ display: "flex", gap: 6 }}>
                    <input type="hidden" name="a" value="ligar" /><input type="hidden" name="itemId" value={p.id} />
                    <select name="operacaoId" defaultValue="" style={{ minWidth: 0, flex: 1 }}><option value="">—</option>{ops.map((o) => <option key={o.id} value={o.id}>{o.etapa.nome}: {o.nome}</option>)}</select>
                    <input name="porUnidade" defaultValue="1" title="vezes por peça" style={{ width: 48 }} />
                    <button className="btn sec peq">Ligar</button>
                  </form>
                </td>}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </>
  );
}
