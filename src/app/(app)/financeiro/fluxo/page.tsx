import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { gerarContasMensais, linhasFluxo, periodoFluxo, vencidosFluxo, type LinhaFluxo } from "@/lib/financeiro";
import { brl, dataDia, dataCurta, dataHora } from "@/lib/formato";
import { chave, dia, somaDias } from "@/lib/datas";
import Copiar from "@/components/Copiar";
import AbasFinanceiro from "@/components/AbasFinanceiro";
import Imprimir from "@/components/Imprimir";

const valorBR = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));

async function salvarSaldos(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const contas = await db.contaBancaria.findMany();
  for (const c of contas) {
    const raw = String(form.get(`saldo${c.id}`) ?? "").trim();
    if (raw === "") continue;
    const v = valorBR(raw);
    if (Number.isFinite(v) && v !== c.saldo) await db.contaBancaria.update({ where: { id: c.id }, data: { saldo: v, atualizadoEm: new Date(), atualizadoPor: u.nome } });
  }
  await auditar(u.nome, "atualizou saldos bancários");
  revalidatePath("/financeiro/fluxo");
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export default async function Fluxo({ searchParams }: { searchParams: Promise<{ modo?: string; ref?: string; previstos?: string }> }) {
  const u = await exigir("financeiro");
  await gerarContasMensais();
  const sp = await searchParams;
  const modo = sp.modo === "mes" ? "mes" : "semana";
  const hoje = dia();
  const ref = sp.ref && /^\d{4}-\d{2}-\d{2}$/.test(sp.ref) ? dia(sp.ref) : hoje;
  const { de, ate, ant, prox } = periodoFluxo(modo, ref);
  const [linhas, bancos, venc] = await Promise.all([linhasFluxo(de, ate, !!sp.previstos), db.contaBancaria.findMany({ orderBy: { nome: "asc" } }), vencidosFluxo()]);
  const saldoBancos = bancos.reduce((t, b) => t + b.saldo, 0);
  const entradas = linhas.filter((l) => l.tipo === "receber").reduce((t, l) => t + l.valor, 0);
  const saidas = linhas.filter((l) => l.tipo === "pagar").reduce((t, l) => t + l.valor, 0);
  // saldo projetado: parte do saldo dos bancos hoje e soma/subtrai o que ainda está em aberto daqui para frente
  const kHoje = chave(hoje);
  const futuro = (l: LinhaFluxo) => (l.status === "aberto" || l.status === "previsto") && chave(l.data) >= kHoje;
  const aberto = (await linhasFluxo(hoje, somaDias(de, -1) > hoje ? somaDias(de, -1) : somaDias(hoje, -1), !!sp.previstos)).filter(futuro);
  const saldoInicio = saldoBancos + aberto.reduce((t, l) => t + (l.tipo === "receber" ? l.valor : -l.valor), 0);
  let saldo = saldoInicio;
  const saldoNaLinha = new Map<LinhaFluxo, number>();
  for (const l of linhas) if (futuro(l)) { saldo += l.tipo === "receber" ? l.valor : -l.valor; saldoNaLinha.set(l, saldo); }
  const saldoFinal = saldo;
  const titulo = modo === "mes" ? `${MESES[de.getUTCMonth()]} de ${de.getUTCFullYear()}` : `${dataCurta(de)} a ${dataCurta(ate)}`;
  const url = (r: Date, m = modo) => `/financeiro/fluxo?modo=${m}&ref=${chave(r)}${sp.previstos ? "&previstos=1" : ""}`;
  // resumo por semana (visão mensal)
  const semanas: { de: Date; ate: Date; ent: number; sai: number }[] = [];
  if (modo === "mes") {
    for (let d = somaDias(de, -de.getUTCDay()); d <= ate; d = somaDias(d, 7)) {
      const a = somaDias(d, 6);
      const ls = linhas.filter((l) => l.data >= d && l.data <= a);
      semanas.push({ de: d < de ? de : d, ate: a > ate ? ate : a, ent: ls.filter((l) => l.tipo === "receber").reduce((t, l) => t + l.valor, 0), sai: ls.filter((l) => l.tipo === "pagar").reduce((t, l) => t + l.valor, 0) });
    }
  }
  const temFuturo = chave(ate) >= kHoje;
  const edita = pode(u.permissoes, "financeiro", "editar");

  return (
    <>
      <h1 className="sem-print">Financeiro</h1>
      <div className="sem-print"><AbasFinanceiro ativo="fluxo" /></div>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Fluxo de caixa {modo === "mes" ? "mensal" : "semanal"} — {titulo}</h1>
        <div className="acoes sem-print">
          <a className="btn sec peq" href={url(ant)}>‹ Anterior</a>
          <a className="btn sec peq" href={url(hoje)}>{modo === "mes" ? "Este mês" : "Esta semana"}</a>
          <a className="btn sec peq" href={url(prox)}>Próxima ›</a>
          <a className={`btn peq ${modo === "semana" ? "" : "sec"}`} href={url(ref, "semana")}>Semanal</a>
          <a className={`btn peq ${modo === "mes" ? "" : "sec"}`} href={url(ref, "mes")}>Mensal</a>
        </div>
      </div>

      <div className="grade">
        <div className="kpi"><div className="r">Bancos hoje</div><div className="v">{brl(saldoBancos)}</div><div className="r">{bancos.map((b) => `${b.nome} ${brl(b.saldo)}`).join(" · ")}</div></div>
        <div className="kpi"><div className="r">Recebimentos no período</div><div className="v" style={{ color: "var(--ok)" }}>{brl(entradas)}</div></div>
        <div className="kpi"><div className="r">Pagamentos no período</div><div className="v" style={{ color: "var(--erro)" }}>{brl(saidas)}</div></div>
        <div className="kpi"><div className="r">{temFuturo ? `Saldo previsto em ${dataCurta(ate)}` : "Resultado do período"}</div><div className="v" style={{ color: (temFuturo ? saldoFinal : entradas - saidas) < 0 ? "var(--erro)" : undefined }}>{brl(temFuturo ? saldoFinal : entradas - saidas)}</div></div>
      </div>
      {temFuturo && saldoFinal < 0 && <div className="aviso erro">Pelo previsto, o caixa fica negativo neste período. Veja na coluna Saldo o dia em que isso acontece.</div>}

      {edita && (
        <form action={salvarSaldos} className="linha-form card sem-print">
          {bancos.map((b) => (
            <label key={b.id}>Saldo {b.nome} hoje<input name={`saldo${b.id}`} inputMode="decimal" defaultValue={b.saldo.toFixed(2).replace(".", ",")} />
              <span className="suave" style={{ fontSize: ".78rem" }}>atualizado {dataHora(b.atualizadoEm)}{b.atualizadoPor ? ` por ${b.atualizadoPor}` : ""}</span></label>
          ))}
          <button className="btn sec">Atualizar saldos</button>
          <div className="acoes" style={{ marginLeft: "auto" }}>
            <a className="btn sec peq" href={`/financeiro/fluxo?modo=${modo}&ref=${chave(ref)}${sp.previstos ? "" : "&previstos=1"}`}>{sp.previstos ? "Tirar compras não aprovadas" : "Incluir compras não aprovadas"}</a>
            <a className="btn sec peq" href={`/financeiro/fluxo/exportar?modo=${modo}&ref=${chave(ref)}${sp.previstos ? "&previstos=1" : ""}`}>Baixar planilha</a>
            <Imprimir />
          </div>
        </form>
      )}

      {modo === "mes" && (
        <div className="card tabela">
          <b>Resumo por semana</b>
          <table>
            <thead><tr><th>Semana</th><th className="n">Recebimentos</th><th className="n">Pagamentos</th><th className="n">Diferença</th><th></th></tr></thead>
            <tbody>{semanas.map((s) => (
              <tr key={chave(s.de)}><td>{dataCurta(s.de)} a {dataCurta(s.ate)}</td><td className="n" style={{ color: "var(--ok)" }}>{brl(s.ent)}</td><td className="n" style={{ color: "var(--erro)" }}>{brl(s.sai)}</td>
                <td className="n"><b style={{ color: s.ent - s.sai < 0 ? "var(--erro)" : undefined }}>{brl(s.ent - s.sai)}</b></td><td className="sem-print"><Link href={url(s.de, "semana")}>abrir</Link></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="fluxo-grade">
        <div className="card tabela">
          <table className="fluxo">
            <thead><tr><th>Data</th><th>Cliente / fornecedor</th><th className="n">Recebimentos</th><th className="n">Pagamentos</th><th className="n">Saldo</th><th className="sem-print">Pagar com</th></tr></thead>
            <tbody>
              {temFuturo && chave(de) <= kHoje && <tr><td colSpan={4}><b>Saldo dos bancos hoje</b>{aberto.length > 0 && <span className="suave"> + o que está em aberto até o início do período</span>}</td><td className="n"><b>{brl(saldoInicio)}</b></td><td className="sem-print"></td></tr>}
              {temFuturo && chave(de) > kHoje && <tr><td colSpan={4}><b>Saldo previsto no início do período</b></td><td className="n"><b>{brl(saldoInicio)}</b></td><td className="sem-print"></td></tr>}
              {linhas.length === 0 && <tr><td colSpan={6} className="suave">Nada lançado neste período.</td></tr>}
              {linhas.map((l, i) => {
                const s = saldoNaLinha.get(l);
                const novoDia = i === 0 || chave(linhas[i - 1].data) !== chave(l.data);
                const feito = l.status === "pago" || l.status === "recebido";
                return (
                  <tr key={`${l.tipo}${l.id}`} className={`${l.tipo === "receber" ? "entrada" : ""} ${novoDia ? "novo-dia" : ""} ${feito ? "feito" : ""}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{dataDia(l.data)}</td>
                    <td>
                      {l.link ? <Link href={l.link}>{l.nome}</Link> : l.nome}
                      {l.parcela && <span className="suave"> {l.parcela}</span>}
                      <span className="suave" style={{ fontSize: ".8rem" }}> · {l.categoria}{feito ? (l.tipo === "pagar" ? " · pago" : " · recebido") : ""}{l.status === "previsto" ? " · compra não aprovada" : ""}</span>
                    </td>
                    <td className="n">{l.tipo === "receber" ? brl(l.valor) : ""}</td>
                    <td className="n">{l.tipo === "pagar" ? brl(l.valor) : ""}</td>
                    <td className="n" style={{ color: s != null && s < 0 ? "var(--erro)" : "var(--suave)" }}>{s != null ? brl(s) : ""}</td>
                    <td className="sem-print">
                      <div className="acoes">
                        {l.forma && <span className="suave" style={{ fontSize: ".8rem" }}>{l.forma}{l.banco ? ` · ${l.banco}` : ""}</span>}
                        {!feito && l.codigoBarras && <Copiar texto={l.codigoBarras} rotulo="Boleto" />}
                        {!feito && l.chavePix && <Copiar texto={l.chavePix} rotulo="Pix" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="total"><td colSpan={2}><b>Total</b></td><td className="n"><b>{brl(entradas)}</b></td><td className="n"><b>{brl(saidas)}</b></td><td className="n"><b>{temFuturo ? brl(saldoFinal) : ""}</b></td><td className="sem-print"></td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className="card tabela">
            <b>Recebimento (vencido)</b>
            {venc.receber.length === 0 ? <p className="suave">Nenhum.</p> : <table><tbody>{venc.receber.map((r) => (
              <tr key={r.id}><td>{dataCurta(r.vencimento)}</td><td>{r.descricao}</td><td className="n">{brl(r.valor)}</td></tr>
            ))}<tr className="total"><td colSpan={3} className="n"><b>{brl(venc.receber.reduce((t, r) => t + r.valor, 0))}</b></td></tr></tbody></table>}
          </div>
          <div className="card tabela">
            <b>Pagamento (vencido)</b>
            {venc.pagar.length === 0 ? <p className="suave">Nenhum.</p> : <table><tbody>{venc.pagar.map((c) => (
              <tr key={c.id}><td>{dataCurta(c.vencimento)}</td><td>{c.descricao}{c.parcela ? ` ${c.parcela}` : ""}</td><td className="n">{brl(c.valor)}</td></tr>
            ))}<tr className="total"><td colSpan={3} className="n"><b>{brl(venc.pagar.reduce((t, c) => t + c.valor, 0))}</b></td></tr></tbody></table>}
          </div>
          <p className="suave" style={{ fontSize: ".85rem" }}>Os vencidos não entram no saldo previsto. Dê baixa em <Link href="/financeiro">Pagamentos</Link> ou <Link href="/financeiro/receber">Recebimentos</Link>.</p>
        </div>
      </div>
    </>
  );
}
