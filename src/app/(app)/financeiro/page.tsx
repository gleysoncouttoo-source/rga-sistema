import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { BANCOS, CATEGORIAS, CATEGORIAS_RECEBER, diaDoPagamento, diaPagamentoSalario, gerarContasMensais, linhasFluxo } from "@/lib/financeiro";
import { lerCfgCompras } from "@/lib/planejamento";
import { brl, dataDia } from "@/lib/formato";
import { chave, dia, diaUtil, semana, somaDias } from "@/lib/datas";
import Copiar from "@/components/Copiar";
import IrPara from "@/components/IrPara";
import AbasFinanceiro from "@/components/AbasFinanceiro";
import "./calendario.css";

const FORMAS = ["boleto", "pix", "transferência", "débito automático", "dinheiro", "cartão"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const txt = (f: FormData, k: string) => String(f.get(k) || "").trim() || null;
const valorBR = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
const voltar = (f: FormData) => { const v = String(f.get("voltar") || ""); return v.startsWith("/financeiro") ? v : "/financeiro"; };
const curto = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const Valor = ({ v, sinal }: { v: number; sinal: string }) => <><span className="longo">{sinal} {brl(v, 0)}</span><span className="curto">{sinal}{curto(v)}</span></>;
const comAviso = (url: string, k: "ok" | "erro", msg: string) => `${url}${url.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}#dia`;

/** Dados de transferência numa linha só, para copiar e colar no app do banco. */
function dadosBancarios(c: { favorecido?: string | null; bancoRecebedor?: string | null; agencia?: string | null; contaRecebedor?: string | null; documento?: string | null }) {
  if (!c.bancoRecebedor && !c.agencia && !c.contaRecebedor) return null;
  return [c.favorecido, c.bancoRecebedor && `Banco ${c.bancoRecebedor}`, c.agencia && `Ag. ${c.agencia}`, c.contaRecebedor && `Conta ${c.contaRecebedor}`, c.documento && `CPF/CNPJ ${c.documento}`].filter(Boolean).join(" · ");
}

async function adicionar(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "criar");
  const tipo = form.get("tipo") === "entrada" ? "entrada" : "saida";
  const descricao = String(form.get("descricao") || "").trim();
  const valor = valorBR(form.get("valor"));
  const venc = String(form.get("vencimento") || "");
  const banco = String(form.get("banco") || "") || null;
  const observacao = txt(form, "obs");
  const url = voltar(form);
  if (!descricao || !(valor > 0) || !venc) redirect(comAviso(url + "&novo=1", "erro", "Preencha descrição, valor e vencimento."));
  const d0 = dia(venc);
  if (tipo === "entrada") {
    const cat = String(form.get("categoria") || "");
    await db.contaReceber.create({ data: { descricao, categoria: CATEGORIAS_RECEBER.includes(cat) ? cat : "Vendas", valor, vencimento: d0, banco, observacao } });
    await auditar(u.nome, "lançou recebimento", `${descricao} ${valor}`);
    revalidatePath("/financeiro");
    redirect(comAviso(url, "ok", "Entrada adicionada."));
  }
  const categoria = CATEGORIAS.includes(String(form.get("categoria"))) ? String(form.get("categoria")) : "Outras";
  const fornecedorId = Number(form.get("fornecedorId")) || null;
  const forn = fornecedorId ? await db.fornecedor.findUnique({ where: { id: fornecedorId } }) : null;
  const pag = {
    formaPagamento: txt(form, "forma"), codigoBarras: txt(form, "codigo")?.replace(/[^0-9]/g, "") || null,
    chavePix: txt(form, "pix") ?? forn?.chavePix ?? null, favorecido: txt(form, "favorecido") ?? forn?.nome ?? null,
    bancoRecebedor: txt(form, "bancoRec") ?? forn?.banco ?? null, agencia: txt(form, "agencia"), contaRecebedor: txt(form, "contaRec"), documento: txt(form, "documento") ?? forn?.cnpj ?? null,
    notaFiscal: txt(form, "nota"),
  };
  const repetir = form.get("repetir") === "mensal";
  const parcelas = Math.min(60, Math.max(1, Number(form.get("parcelas")) || 1));
  if (repetir) {
    const f = await db.contaRecorrente.create({ data: { descricao, categoria, valor, dia: d0.getUTCDate(), banco, observacao, criadoEm: somaDias(d0, -1) } });
    await db.contaPagar.create({ data: { descricao, categoria, valor, vencimento: d0, banco, fornecedorId, observacao, recorrenteId: f.id, competencia: venc.slice(0, 7), ...pag } });
  } else {
    for (let i = 0; i < parcelas; i++) {
      const v = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i, 1, 12));
      const ultimo = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth() + 1, 0, 12)).getUTCDate();
      v.setUTCDate(Math.min(d0.getUTCDate(), ultimo));
      await db.contaPagar.create({ data: { descricao, categoria, valor, vencimento: v, banco, fornecedorId, observacao, parcela: parcelas > 1 ? `${i + 1}/${parcelas}` : null, ...pag, codigoBarras: i === 0 ? pag.codigoBarras : null } });
    }
  }
  await auditar(u.nome, "adicionou conta a pagar", `${descricao} ${valor}${repetir ? " (todo mês)" : parcelas > 1 ? ` (${parcelas}x)` : ""}`);
  revalidatePath("/financeiro");
  redirect(comAviso(url, "ok", repetir ? "Conta fixa criada: o sistema lança ela todo mês." : "Conta adicionada."));
}

async function acaoConta(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id")), a = String(form.get("a"));
  const c = await db.contaPagar.findUniqueOrThrow({ where: { id } });
  if (a === "pagar") await db.contaPagar.update({ where: { id }, data: { status: "pago", pagoEm: new Date() } });
  if (a === "desfazer") await db.contaPagar.update({ where: { id }, data: { status: "aberto", pagoEm: null } });
  if (a === "excluir" && !c.pedidoCompraId) {
    // conta gerada todo mês fica marcada como cancelada para não voltar
    if (c.recorrenteId || c.funcionarioId) await db.contaPagar.update({ where: { id }, data: { status: "cancelado" } });
    else await db.contaPagar.delete({ where: { id } });
  }
  if (a === "editar") {
    const v = valorBR(form.get("valor")), venc = String(form.get("vencimento") || "");
    await db.contaPagar.update({
      where: { id },
      data: {
        ...(v > 0 ? { valor: v } : {}), ...(venc ? { vencimento: dia(venc) } : {}), banco: txt(form, "banco"),
        formaPagamento: txt(form, "forma"), favorecido: txt(form, "favorecido"), chavePix: txt(form, "pix"),
        codigoBarras: txt(form, "codigo")?.replace(/[^0-9]/g, "") || null, observacao: txt(form, "obs"),
        bancoRecebedor: txt(form, "bancoRec"), agencia: txt(form, "agencia"), contaRecebedor: txt(form, "contaRec"), documento: txt(form, "documento"),
        notaFiscal: txt(form, "nota"),
      },
    });
  }
  await auditar(u.nome, `conta a pagar: ${a}`, `#${id} ${c.descricao}`);
  revalidatePath("/financeiro");
}

async function acaoReceber(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id")), a = String(form.get("a"));
  if (a === "recebido") await db.contaReceber.update({ where: { id }, data: { status: "recebido", recebidoEm: dia() } });
  if (a === "desfazer") await db.contaReceber.update({ where: { id }, data: { status: "aberto", recebidoEm: null } });
  if (a === "excluir") await db.contaReceber.delete({ where: { id } });
  await auditar(u.nome, `recebimento: ${a}`, `#${id}`);
  revalidatePath("/financeiro");
}

async function acaoFixa(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id"));
  if (form.get("a") === "desativar") {
    await db.contaRecorrente.update({ where: { id }, data: { ativo: false } });
    await db.contaPagar.deleteMany({ where: { recorrenteId: id, status: "aberto", vencimento: { gt: dia() } } });
  } else {
    const valor = valorBR(form.get("valor")), d = Number(form.get("dia"));
    await db.contaRecorrente.update({ where: { id }, data: { ...(valor > 0 ? { valor } : {}), ...(d >= 1 && d <= 31 ? { dia: d } : {}) } });
  }
  await auditar(u.nome, "alterou conta fixa", `#${id}`);
  revalidatePath("/financeiro");
}

export default async function Financeiro({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await exigir("financeiro");
  await gerarContasMensais();
  const sp = await searchParams;
  const hoje = dia();
  const sel = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? dia(sp.dia) : hoje;
  const [ano, mes0] = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) && !sp.dia ? [Number(sp.mes.slice(0, 4)), Number(sp.mes.slice(5)) - 1] : [sel.getUTCFullYear(), sel.getUTCMonth()];
  const ini = new Date(Date.UTC(ano, mes0, 1, 12)), fimMes = new Date(Date.UTC(ano, mes0 + 1, 0, 12));
  const gradeIni = somaDias(ini, -ini.getUTCDay()), gradeFim = somaDias(fimMes, 6 - fimMes.getUTCDay());
  const kMes = `${ano}-${String(mes0 + 1).padStart(2, "0")}`;
  const k = chave(sel);
  const url = `/financeiro?dia=${k}`;

  const perto = { gte: somaDias(sel, -4), lte: somaDias(sel, 1) };
  const [linhas, pagarDia, receberDia, vencidas, fixas, fornecedores, nSal, cfg] = await Promise.all([
    linhasFluxo(gradeIni, gradeFim, true),
    db.contaPagar.findMany({ where: { status: { in: ["aberto", "pago", "previsto"] }, OR: [{ vencimento: perto }, { pagoEm: { gte: somaDias(sel, -1), lte: somaDias(sel, 1) } }] }, include: { fornecedor: true, comprovantes: { select: { id: true } }, pedidoCompra: { include: { itens: { include: { item: true } } } } }, orderBy: [{ categoria: "asc" }, { descricao: "asc" }] }),
    db.contaReceber.findMany({ where: { status: { in: ["aberto", "recebido"] }, OR: [{ vencimento: perto }, { recebidoEm: { gte: somaDias(sel, -1), lte: somaDias(sel, 1) } }] }, orderBy: { descricao: "asc" } }),
    db.contaPagar.findMany({ where: { status: "aberto", vencimento: { lt: hoje } }, orderBy: { vencimento: "asc" } }).then((l) => l.filter((c) => diaDoPagamento(c.vencimento) < hoje)),
    db.contaRecorrente.findMany({ where: { ativo: true }, orderBy: { dia: "asc" } }),
    db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    diaPagamentoSalario(),
    lerCfgCompras(),
  ]);
  // contas do dia escolhido: paga no dia em que foi paga; em aberto no dia útil do vencimento
  const doDia = <T extends { status: string; vencimento: Date }>(c: T, quando: Date | null, feito: string) => chave(c.status === feito && quando ? dia(quando) : diaDoPagamento(c.vencimento)) === k;
  const pagar = pagarDia.filter((c) => doDia(c, c.pagoEm, "pago"));
  const receber = receberDia.filter((c) => doDia(c, c.recebidoEm, "recebido"));
  const somaP = pagar.filter((c) => c.status !== "previsto").reduce((t, c) => t + c.valor, 0), faltaP = pagar.filter((c) => c.status === "aberto").reduce((t, c) => t + c.valor, 0);
  const somaR = receber.reduce((t, c) => t + c.valor, 0), faltaR = receber.filter((c) => c.status === "aberto").reduce((t, c) => t + c.valor, 0);

  // calendário: totais por dia
  type Dia = { sai: number; saiPago: number; entra: number; nPagar: number; boletos: number; previstos: number; atrasado: boolean };
  const cal = new Map<string, Dia>();
  for (const l of linhas) {
    const kk = chave(l.data);
    const x = cal.get(kk) ?? { sai: 0, saiPago: 0, entra: 0, nPagar: 0, boletos: 0, previstos: 0, atrasado: false };
    if (l.tipo === "pagar") {
      if (l.status === "previsto") x.previstos++;
      else { x.nPagar++; if (l.status === "pago") x.saiPago += l.valor; else x.sai += l.valor; }
      if (l.forma === "boleto" || l.categoria === "Fornecedor") x.boletos++;
      if (l.status === "aberto" && l.data < hoje) x.atrasado = true;
    } else if (l.status === "aberto" || l.status === "recebido") x.entra += l.valor;
    cal.set(kk, x);
  }
  const semanas: Date[][] = [];
  for (let d = gradeIni; d <= gradeFim; d = somaDias(d, 7)) semanas.push(Array.from({ length: 7 }, (_, i) => somaDias(d, i)));
  const totalMes = linhas.filter((l) => l.tipo === "pagar" && l.status !== "previsto" && l.data >= ini && l.data <= fimMes).reduce((t, l) => t + l.valor, 0);
  const entraMes = linhas.filter((l) => l.tipo === "receber" && l.data >= ini && l.data <= fimMes).reduce((t, l) => t + l.valor, 0);
  const opMeses = Array.from({ length: 19 }, (_, i) => {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 6 + i, 1, 12));
    const km = chave(d).slice(0, 7);
    return { href: `/financeiro?mes=${km}`, nome: `${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`, km };
  });
  const mesAnt = chave(new Date(Date.UTC(ano, mes0 - 1, 1, 12))).slice(0, 7), mesProx = chave(new Date(Date.UTC(ano, mes0 + 1, 1, 12))).slice(0, 7);

  const edita = pode(u.permissoes, "financeiro", "editar"), cria = pode(u.permissoes, "financeiro", "criar");
  const ehHoje = k === chave(hoje);
  const nomeDia = `${ehHoje ? "Hoje, " : ""}${semana(sel)} ${dataDia(sel)}`;

  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Financeiro</h1>
        <div className="acoes">
          {edita && <a className="btn sec peq" href="/financeiro/extrato">Subir extrato do banco</a>}
          <a className="btn sec peq" href="/financeiro/exportar?p=mes">Baixar planilha</a>
          {cria && <a className="btn peq" href={`${url}&novo=1#nova`}>+ Adicionar conta</a>}
        </div>
      </div>
      <AbasFinanceiro ativo="pagamentos" />
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}

      <div className="grade">
        <div className="kpi" style={{ borderTopColor: "var(--ok)" }}><div className="r">Entra · {nomeDia}</div><div className="v" style={{ color: "var(--ok)" }}>{brl(somaR)}</div><div className="r">{receber.length} entrada(s){faltaR > 0 && faltaR !== somaR ? ` · falta receber ${brl(faltaR)}` : ""}</div></div>
        <div className="kpi" style={{ borderTopColor: "var(--erro)" }}><div className="r">Sai · {nomeDia}</div><div className="v" style={{ color: "var(--erro)" }}>{brl(somaP)}</div><div className="r">{pagar.filter((c) => c.status !== "previsto").length} conta(s){faltaP !== somaP ? ` · falta pagar ${brl(faltaP)}` : ""}</div></div>
        <div className="kpi"><div className="r">Resultado do dia</div><div className="v" style={{ color: somaR - somaP < 0 ? "var(--erro)" : undefined }}>{brl(somaR - somaP)}</div><div className="r">entra menos sai</div></div>
        <div className="kpi" style={vencidas.length ? { borderTopColor: "var(--erro)" } : undefined}><div className="r">Vencidas sem baixa</div><div className="v" style={{ color: vencidas.length ? "var(--erro)" : undefined }}>{vencidas.length}</div>{vencidas.length > 0 && <div className="r">{brl(vencidas.reduce((t, c) => t + c.valor, 0))}</div>}</div>
      </div>

      {sp.novo && cria && (
        <div className="card" id="nova" style={{ borderColor: "var(--acento)", borderWidth: 2 }}>
          <b>Adicionar conta</b>
          <form action={adicionar} className="campos" style={{ marginTop: 12 }}>
            <input type="hidden" name="voltar" value={url} />
            <label>Tipo<select name="tipo" defaultValue="saida"><option value="saida">Saída (conta a pagar)</option><option value="entrada">Entrada (a receber)</option></select></label>
            <label>Descrição<input name="descricao" required placeholder="ex.: Condomínio do galpão" autoFocus /></label>
            <label>Categoria<select name="categoria" defaultValue="Outras">
              <optgroup label="Saída">{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</optgroup>
              <optgroup label="Entrada">{CATEGORIAS_RECEBER.map((c) => <option key={"r" + c} value={c}>{c}</option>)}</optgroup>
            </select></label>
            <label>Valor (R$)<input name="valor" inputMode="decimal" required /></label>
            <label>Vencimento<input name="vencimento" type="date" defaultValue={k} required /></label>
            <label>Sai/entra pelo banco<select name="banco"><option value="">—</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label>Fornecedor (opcional)<select name="fornecedorId"><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
            <label>Forma de pagamento<select name="forma" defaultValue="boleto"><option value="">—</option>{FORMAS.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>Repetir<select name="repetir"><option value="">Só uma vez / parcelado</option><option value="mensal">Todo mês (conta fixa)</option></select></label>
            <label>Parcelas<select name="parcelas" defaultValue="1">{Array.from({ length: 24 }, (_, i) => <option key={i} value={i + 1}>{i === 0 ? "1 (à vista)" : `${i + 1}x`}</option>)}</select></label>
            <div className="inteiro subtitulo">Como pagar (só para saída)</div>
            <label className="inteiro">Linha digitável do boleto<input name="codigo" inputMode="numeric" placeholder="cole os números do boleto" /></label>
            <label>Chave Pix<input name="pix" placeholder="CPF, CNPJ, e-mail, telefone ou aleatória" /></label>
            <label>Favorecido (quem recebe)<input name="favorecido" placeholder="nome de quem recebe" /></label>
            <label>CPF/CNPJ do favorecido<input name="documento" /></label>
            <label>Banco do favorecido<input name="bancoRec" placeholder="ex.: Itaú (341)" /></label>
            <label>Agência<input name="agencia" inputMode="numeric" /></label>
            <label>Conta<input name="contaRec" placeholder="ex.: 12345-6" /></label>
            <label>Nota fiscal<input name="nota" placeholder="nº da nota" /></label>
            <label className="inteiro">Observação<input name="obs" /></label>
            <div className="inteiro acoes"><button className="btn">Salvar</button><a className="btn sec" href={`${url}#dia`}>Cancelar</a></div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="topo" style={{ marginBottom: 10 }}>
          <div className="acoes">
            <a className="btn sec peq" href={`/financeiro?mes=${mesAnt}`} aria-label="Mês anterior">‹</a>
            <IrPara opcoes={opMeses.some((o) => o.km === kMes) ? opMeses : [{ href: `/financeiro?mes=${kMes}`, nome: `${MESES[mes0]} de ${ano}`, km: kMes }, ...opMeses]} valor={`/financeiro?mes=${kMes}`} />
            <a className="btn sec peq" href={`/financeiro?mes=${mesProx}`} aria-label="Próximo mês">›</a>
            {!(ano === hoje.getUTCFullYear() && mes0 === hoje.getUTCMonth()) && <a className="suave" href="/financeiro">voltar para hoje</a>}
          </div>
          <span className="suave">No mês: sai <b style={{ color: "var(--erro)" }}>{brl(totalMes, 0)}</b> · entra <b style={{ color: "var(--ok)" }}>{brl(entraMes, 0)}</b></span>
        </div>
        <div className="calmes">
          {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((s) => <div key={s} className="cab">{s}</div>)}
          {semanas.flat().map((d) => {
            const kk = chave(d), x = cal.get(kk), fora = d.getUTCMonth() !== mes0, util = diaUtil(d);
            const cheio = x && x.boletos >= cfg.maxBoletosDia + 1 ? "c3" : x && x.boletos >= cfg.maxBoletosDia ? "c2" : "";
            return (
              <a key={kk} href={`/financeiro?dia=${kk}#dia`} className={["dia", fora && "fora", !util && "folga", kk === chave(hoje) && "hoje", kk === k && "sel", x?.atrasado && "atrasado", cheio].filter(Boolean).join(" ")}>
                <span className="n">{d.getUTCDate()}{!util && d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && <small> feriado</small>}</span>
                {x && x.sai > 0 && <span className="sai"><Valor v={x.sai} sinal="−" /></span>}
                {x && x.sai === 0 && x.saiPago > 0 && <span className="pago"><Valor v={x.saiPago} sinal="✓" /></span>}
                {x && x.entra > 0 && <span className="entra"><Valor v={x.entra} sinal="+" /></span>}
                {x && (x.nPagar > 0 || x.previstos > 0) && <span className="qt">{x.nPagar > 0 ? `${x.nPagar} conta${x.nPagar > 1 ? "s" : ""}` : ""}{x.previstos > 0 ? `${x.nPagar ? " · " : ""}${x.previstos} prevista${x.previstos > 1 ? "s" : ""}` : ""}</span>}
              </a>
            );
          })}
        </div>
        <p className="suave legenda">
          <span className="sai">− a pagar</span> <span className="entra">+ a receber</span> <span className="pago">✓ já pago</span> · fundo vermelho = conta atrasada sem baixa · fundo âmbar = dia com {cfg.maxBoletosDia} boletos ou mais.
          {" "}O sistema usa este calendário para escolher o dia das compras: o boleto novo vai para o dia com menos boletos.
        </p>
      </div>

      {vencidas.length > 0 && (
        <div className="card tabela" style={{ borderLeft: "5px solid var(--erro)" }}>
          <b style={{ color: "var(--erro)" }}>Vencidas e ainda não marcadas como pagas</b>
          <table><tbody>{vencidas.map((c) => (
            <tr key={c.id}>
              <td><a href={`/financeiro?dia=${chave(diaDoPagamento(c.vencimento))}#dia`}>{dataDia(c.vencimento)}</a></td><td><span className="selo">{c.categoria}</span></td><td>{c.descricao}{c.parcela && <span className="suave"> · {c.parcela}</span>}</td>
              <td className="n"><b>{brl(c.valor)}</b></td>
              <td>{edita && <form action={acaoConta}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="pagar" /><button className="btn peq">Pago</button></form>}</td>
            </tr>
          ))}</tbody></table>
        </div>
      )}

      <div id="dia" className="card tabela" style={{ borderColor: ehHoje ? "var(--acento)" : undefined, borderWidth: ehHoje ? 2 : undefined }}>
        <div className="topo" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{nomeDia}</h2>
          <div className="acoes">
            <a className="btn sec peq" href={`/financeiro?dia=${chave(somaDias(sel, -1))}#dia`} aria-label="Dia anterior">‹ dia</a>
            <a className="btn sec peq" href={`/financeiro?dia=${chave(somaDias(sel, 1))}#dia`} aria-label="Próximo dia">dia ›</a>
            {cria && <a className="btn peq" href={`${url}&novo=1#nova`}>+ Adicionar neste dia</a>}
          </div>
        </div>
        {pagar.length + receber.length === 0 && <p className="suave" style={{ marginBottom: 0 }}>Nada para pagar ou receber neste dia.</p>}

        {receber.length > 0 && (<>
          <div className="subtitulo" style={{ color: "var(--ok)" }}>Entradas · {brl(somaR)}</div>
          <table className="lista-dia"><tbody>{receber.map((r) => (
            <tr key={"r" + r.id} style={r.status === "recebido" ? { opacity: 0.55 } : undefined}>
              <td style={{ width: 150 }}><span className="selo ok">{r.categoria}</span></td>
              <td>{r.pedidoVendaId ? <Link href={`/vendas/${r.pedidoVendaId}`}>{r.descricao}</Link> : r.descricao}{r.parcela && <span className="suave"> · {r.parcela}</span>}{r.observacao && <div className="suave" style={{ fontSize: ".82rem" }}>{r.observacao}</div>}</td>
              <td className="suave">{r.banco ?? ""}</td>
              <td className="n" style={{ width: 120 }}><b style={{ color: "var(--ok)" }}>+ {brl(r.valor)}</b></td>
              <td style={{ width: 210 }}>{edita && (r.status === "aberto" ? (
                <div className="acoes">
                  <form action={acaoReceber}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="a" value="recebido" /><button className="btn peq">Recebido</button></form>
                  <form action={acaoReceber}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="a" value="excluir" /><button className="btn sec peq">Excluir</button></form>
                </div>
              ) : <form action={acaoReceber}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="a" value="desfazer" /><span className="selo ok">recebido</span> <button className="btn sec peq">Desfazer</button></form>)}</td>
            </tr>
          ))}</tbody></table>
        </>)}

        {pagar.length > 0 && (<>
          <div className="subtitulo" style={{ color: "var(--erro)" }}>Saídas · {brl(somaP)}</div>
          <table className="lista-dia"><tbody>{pagar.map((c) => {
            const banc = dadosBancarios(c);
            return (
              <tr key={c.id} style={c.status === "pago" ? { opacity: 0.55 } : undefined}>
                <td style={{ width: 150 }}><span className={`selo ${c.categoria === "Fornecedor" ? "alerta" : c.categoria === "Colaboradores" ? "ok" : ""}`}>{c.categoria}</span></td>
                <td>
                  {c.pedidoCompraId ? <Link href={`/compras?ver=todos#c${c.pedidoCompraId}`}>{c.descricao}</Link> : c.descricao}
                  {c.parcela && <span className="suave"> · parcela {c.parcela}</span>}
                  {c.recorrenteId && <span className="suave"> · todo mês</span>}
                  {c.pedidoCompra && <div className="suave" style={{ fontSize: ".82rem" }}>{c.pedidoCompra.itens.map((i) => i.item.nome).slice(0, 4).join(", ")}{c.pedidoCompra.itens.length > 4 ? "…" : ""}</div>}
                  {chave(dia(c.vencimento.toISOString())) !== k && c.status !== "pago" && <div className="suave" style={{ fontSize: ".82rem" }}>vence {dataDia(c.vencimento)} (fim de semana/feriado)</div>}
                  {c.observacao && <div className="suave" style={{ fontSize: ".82rem" }}>{c.observacao}</div>}
                  {(c.formaPagamento || c.codigoBarras || c.chavePix || banc) && (
                    <div className="acoes" style={{ marginTop: 6 }}>
                      {c.formaPagamento && <span className="selo">{c.formaPagamento}</span>}
                      {c.favorecido && c.favorecido !== c.fornecedor?.nome && <span className="suave" style={{ fontSize: ".82rem" }}>para {c.favorecido}</span>}
                      {c.codigoBarras && <Copiar texto={c.codigoBarras} rotulo="Copiar boleto" />}
                      {c.chavePix && <Copiar texto={c.chavePix} rotulo={`Copiar Pix ${c.chavePix.length > 22 ? c.chavePix.slice(0, 20) + "…" : c.chavePix}`} />}
                      {banc && <Copiar texto={banc} rotulo="Copiar dados bancários" />}
                    </div>
                  )}
                  {banc && <div className="suave" style={{ fontSize: ".8rem", marginTop: 4 }}>{banc}</div>}
                  {c.formaPagamento === "boleto" && !c.codigoBarras && c.status === "aberto" && <div style={{ fontSize: ".8rem", color: "var(--alerta)", marginTop: 4 }}>Falta a linha digitável do boleto</div>}
                  {edita && c.status !== "pago" && (
                    <details style={{ marginTop: 6 }}>
                      <summary className="suave" style={{ cursor: "pointer", fontSize: ".82rem" }}>Editar / dados de pagamento</summary>
                      <form action={acaoConta} className="campos" style={{ marginTop: 8 }}>
                        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="editar" />
                        <label>Valor<input name="valor" inputMode="decimal" defaultValue={c.valor.toFixed(2).replace(".", ",")} /></label>
                        <label>Vencimento<input name="vencimento" type="date" defaultValue={chave(dia(c.vencimento.toISOString()))} /></label>
                        <label>Forma<select name="forma" defaultValue={c.formaPagamento ?? ""}><option value="">—</option>{FORMAS.map((f) => <option key={f}>{f}</option>)}</select></label>
                        <label>Sai pelo banco<select name="banco" defaultValue={c.banco ?? ""}><option value="">—</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
                        <label className="inteiro">Linha digitável do boleto<input name="codigo" inputMode="numeric" defaultValue={c.codigoBarras ?? ""} /></label>
                        <label>Chave Pix<input name="pix" defaultValue={c.chavePix ?? ""} /></label>
                        <label>Favorecido<input name="favorecido" defaultValue={c.favorecido ?? ""} /></label>
                        <label>CPF/CNPJ<input name="documento" defaultValue={c.documento ?? ""} /></label>
                        <label>Banco do favorecido<input name="bancoRec" defaultValue={c.bancoRecebedor ?? ""} /></label>
                        <label>Agência<input name="agencia" defaultValue={c.agencia ?? ""} /></label>
                        <label>Conta<input name="contaRec" defaultValue={c.contaRecebedor ?? ""} /></label>
                        <label>Nota fiscal<input name="nota" defaultValue={c.notaFiscal ?? ""} /></label>
                        <label className="inteiro">Observação<input name="obs" defaultValue={c.observacao ?? ""} /></label>
                        <div className="inteiro"><button className="btn peq">Salvar</button></div>
                      </form>
                    </details>
                  )}
                </td>
                <td className="suave">{c.banco ?? ""}</td>
                <td className="n" style={{ width: 120 }}><b style={{ color: "var(--erro)" }}>− {brl(c.valor)}</b></td>
                <td style={{ width: 210 }}>
                  {c.status === "previsto" && <span className="selo alerta">compra não aprovada</span>}
                  {edita && c.status === "aberto" && (
                    <div className="acoes">
                      <form action={acaoConta}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="pagar" /><button className="btn peq">Pago</button></form>
                      {!c.pedidoCompraId && <form action={acaoConta}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="excluir" /><button className="btn sec peq" title={c.recorrenteId || c.funcionarioId ? "Tira só deste mês" : "Excluir"}>Excluir</button></form>}
                    </div>
                  )}
                  {edita && c.status === "pago" && <form action={acaoConta}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="desfazer" /><span className="selo ok">pago</span> <button className="btn sec peq">Desfazer</button></form>}
                  {c.status === "pago" && <div style={{ marginTop: 6 }}><a href={`/financeiro/historico?id=${c.id}#p${c.id}`} style={{ fontSize: ".82rem" }}>{c.comprovantes.length ? "ver comprovante" : "anexar comprovante"}</a></div>}
                </td>
              </tr>
            );
          })}</tbody></table>
        </>)}
      </div>

      <h2>Contas fixas (lançadas todo mês)</h2>
      <p className="suave">Salários entram sozinhos no {nSal}º dia útil do mês, com o valor do cadastro de cada colaborador. Para criar uma conta fixa, use <b>Adicionar conta</b> e escolha &quot;Todo mês&quot;.</p>
      <div className="card tabela">
        {fixas.length === 0 ? <p className="suave">Nenhuma conta fixa ainda (condomínio, aluguel, energia, contador...).</p> : (
          <table>
            <thead><tr><th>Conta</th><th>Categoria</th><th>Banco</th><th className="n">Valor</th><th>Dia</th>{edita && <th></th>}</tr></thead>
            <tbody>{fixas.map((f) => (
              <tr key={f.id}>
                <td>{f.descricao}</td><td><span className="selo">{f.categoria}</span></td><td className="suave">{f.banco ?? ""}</td>
                {edita ? (
                  <td colSpan={3}>
                    <div className="acoes" style={{ justifyContent: "flex-end" }}>
                      <form action={acaoFixa} className="acoes">
                        <input type="hidden" name="id" value={f.id} />
                        <input name="valor" inputMode="decimal" defaultValue={f.valor.toFixed(2).replace(".", ",")} style={{ width: 110, minHeight: 36 }} />
                        <span className="suave">dia</span><input name="dia" type="number" min={1} max={31} defaultValue={f.dia} style={{ width: 64, minHeight: 36 }} />
                        <button className="btn sec peq">Salvar</button>
                      </form>
                      <form action={acaoFixa}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="a" value="desativar" /><button className="btn sec peq">Parar</button></form>
                    </div>
                  </td>
                ) : (<><td className="n">{brl(f.valor)}</td><td>{f.diaUtil ? `${f.dia}º dia útil` : `dia ${f.dia}`}</td></>)}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
