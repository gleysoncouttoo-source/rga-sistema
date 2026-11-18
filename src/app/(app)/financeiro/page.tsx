import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { BANCOS, CATEGORIAS, diaDoPagamento, diaPagamentoSalario, gerarContasMensais } from "@/lib/financeiro";
import { brl, dataDia } from "@/lib/formato";
import { chave, dia, semana, somaDias } from "@/lib/datas";
import Copiar from "@/components/Copiar";
import AbasFinanceiro from "@/components/AbasFinanceiro";

const FORMAS = ["boleto", "pix", "transferência", "débito automático", "dinheiro", "cartão"];
const txt = (f: FormData, k: string) => String(f.get(k) || "").trim() || null;

const valorBR = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));

async function adicionar(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "criar");
  const descricao = String(form.get("descricao") || "").trim();
  const categoria = String(form.get("categoria") || "Outras");
  const valor = valorBR(form.get("valor"));
  const venc = String(form.get("vencimento") || "");
  const banco = String(form.get("banco") || "") || null;
  const fornecedorId = Number(form.get("fornecedorId")) || null;
  const observacao = String(form.get("obs") || "").trim() || null;
  const forn = fornecedorId ? await db.fornecedor.findUnique({ where: { id: fornecedorId } }) : null;
  const pag = {
    formaPagamento: txt(form, "forma"), codigoBarras: txt(form, "codigo")?.replace(/[^0-9]/g, "") || null,
    chavePix: txt(form, "pix") ?? forn?.chavePix ?? null, favorecido: txt(form, "favorecido") ?? forn?.nome ?? null,
  };
  const repetir = form.get("repetir") === "mensal";
  const parcelas = Math.min(60, Math.max(1, Number(form.get("parcelas")) || 1));
  if (!descricao || !(valor > 0) || !venc) redirect("/financeiro?novo=1&erro=" + encodeURIComponent("Preencha descrição, valor e vencimento."));
  const d0 = dia(venc);
  if (repetir) {
    const f = await db.contaRecorrente.create({ data: { descricao, categoria, valor, dia: d0.getUTCDate(), banco, observacao, criadoEm: somaDias(d0, -1) } });
    // a primeira já entra mesmo que seja hoje; as próximas o sistema lança sozinho
    const comp = venc.slice(0, 7);
    await db.contaPagar.create({ data: { descricao, categoria, valor, vencimento: d0, banco, fornecedorId, observacao, recorrenteId: f.id, competencia: comp, ...pag } });
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
  redirect("/financeiro?ok=" + encodeURIComponent(repetir ? "Conta fixa criada: o sistema lança ela todo mês." : "Conta adicionada."));
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
      },
    });
  }
  await auditar(u.nome, `conta a pagar: ${a}`, `#${id} ${c.descricao}`);
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

const PERIODOS: Record<string, string> = { "7": "Próximos 7 dias", "15": "Próximos 15 dias", "30": "Próximos 30 dias", "60": "Próximos 60 dias", mes: "Este mês", prox: "Mês que vem" };

export default async function Financeiro({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await exigir("financeiro");
  await gerarContasMensais();
  const sp = await searchParams;
  const hoje = dia();
  const per = sp.p && PERIODOS[sp.p] ? sp.p : "30";
  let de = hoje, ate = somaDias(hoje, Number(per) || 30);
  if (per === "mes") { de = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1, 12)); ate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0, 12)); }
  if (per === "prox") { de = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 1, 12)); ate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 2, 0, 12)); }
  const status = ["aberto", ...(sp.previstos ? ["previsto"] : []), ...(sp.pagas ? ["pago"] : [])];
  const where: Prisma.ContaPagarWhereInput = { status: { in: status }, vencimento: { gte: somaDias(de, -3), lte: somaDias(ate, 1) } };
  if (sp.cat) where.categoria = sp.cat;
  if (sp.banco) where.banco = sp.banco;
  const [contas, vencidas, fixas, fornecedores, nSal] = await Promise.all([
    db.contaPagar.findMany({ where, include: { fornecedor: true, pedidoCompra: { include: { itens: { include: { item: true } } } } }, orderBy: [{ vencimento: "asc" }, { categoria: "asc" }] }),
    db.contaPagar.findMany({ where: { status: "aberto", vencimento: { lt: hoje } }, include: { fornecedor: true }, orderBy: { vencimento: "asc" } }).then((l) => l.filter((c) => diaDoPagamento(c.vencimento) < hoje)),
    db.contaRecorrente.findMany({ where: { ativo: true }, orderBy: { dia: "asc" } }),
    db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    diaPagamentoSalario(),
  ]);
  // agrupa pelo dia em que o dinheiro sai (fim de semana/feriado vai para o próximo dia útil)
  const dias = new Map<string, { d: Date; contas: typeof contas }>();
  for (const c of contas) {
    const d = diaDoPagamento(c.vencimento);
    if (d < de || d > ate || (d < hoje && c.status !== "pago")) continue;
    const k = chave(d);
    if (!dias.has(k)) dias.set(k, { d, contas: [] });
    dias.get(k)!.contas.push(c);
  }
  const lista = [...dias.values()].sort((a, b) => a.d.getTime() - b.d.getTime());
  const soma = (cs: { valor: number; status: string }[]) => cs.filter((c) => c.status !== "pago").reduce((t, c) => t + c.valor, 0);
  const totalPeriodo = lista.reduce((t, x) => t + soma(x.contas), 0);
  const deHoje = dias.get(chave(hoje))?.contas ?? [];
  const sete = lista.filter((x) => x.d <= somaDias(hoje, 7)).reduce((t, x) => t + soma(x.contas), 0);
  const edita = pode(u.permissoes, "financeiro", "editar");
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ p: per, cat: sp.cat, banco: sp.banco, previstos: sp.previstos, pagas: sp.pagas, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };

  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Financeiro</h1>
        <div className="acoes">
          {edita && <a className="btn sec" href="/financeiro/extrato">Subir extrato do banco</a>}
          <a className="btn sec" href={`/financeiro/exportar${qs({})}`}>Baixar planilha</a>
          {pode(u.permissoes, "financeiro", "criar") && <a className="btn" href={`/financeiro${qs({ novo: "1" })}#nova`}>+ Adicionar conta</a>}
        </div>
      </div>
      <AbasFinanceiro ativo="pagamentos" />
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}

      <div className="grade">
        <div className="kpi"><div className="r">Pagar hoje</div><div className="v">{brl(soma(deHoje), 0)}</div><div className="r">{deHoje.filter((c) => c.status !== "pago").length} conta(s)</div></div>
        <div className="kpi"><div className="r">Próximos 7 dias</div><div className="v">{brl(sete, 0)}</div></div>
        <div className="kpi"><div className="r">{PERIODOS[per]}</div><div className="v">{brl(totalPeriodo, 0)}</div></div>
        <div className="kpi"><div className="r">Vencidas sem baixa</div><div className="v" style={{ color: vencidas.length ? "var(--erro)" : undefined }}>{vencidas.length}</div>{vencidas.length > 0 && <div className="r">{brl(soma(vencidas))}</div>}</div>
      </div>

      {sp.novo && pode(u.permissoes, "financeiro", "criar") && (
        <div className="card" id="nova" style={{ borderColor: "var(--pri)" }}>
          <b>Adicionar conta</b>
          <form action={adicionar} className="campos" style={{ marginTop: 12 }}>
            <label>Descrição<input name="descricao" required placeholder="ex.: Condomínio do galpão" autoFocus /></label>
            <label>Categoria<select name="categoria" defaultValue="Outras">{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Valor (R$)<input name="valor" inputMode="decimal" required /></label>
            <label>Vencimento<input name="vencimento" type="date" defaultValue={chave(hoje)} required /></label>
            <label>Banco<select name="banco"><option value="">—</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label>Fornecedor (opcional)<select name="fornecedorId"><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
            <label>Forma de pagamento<select name="forma" defaultValue="boleto"><option value="">—</option>{FORMAS.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>Favorecido (quem recebe)<input name="favorecido" placeholder="se for diferente do fornecedor" /></label>
            <label>Linha digitável do boleto<input name="codigo" inputMode="numeric" placeholder="cole os números do boleto" /></label>
            <label>Chave Pix<input name="pix" placeholder="CPF, CNPJ, e-mail, telefone ou aleatória" /></label>
            <label>Repetir<select name="repetir"><option value="">Só uma vez / parcelado</option><option value="mensal">Todo mês (conta fixa)</option></select></label>
            <label>Parcelas (se não for todo mês)<input name="parcelas" type="number" min={1} max={60} defaultValue={1} /></label>
            <label className="inteiro">Observação<input name="obs" /></label>
            <div className="inteiro acoes"><button className="btn">Salvar conta</button><a className="btn sec" href={`/financeiro${qs({})}`}>Cancelar</a></div>
          </form>
        </div>
      )}

      {vencidas.length > 0 && (
        <div className="card" style={{ borderLeft: "5px solid var(--erro)" }}>
          <b style={{ color: "var(--erro)" }}>Vencidas e ainda não marcadas como pagas</b>
          <div className="tabela"><table><tbody>{vencidas.map((c) => (
            <tr key={c.id}>
              <td>{dataDia(c.vencimento)}</td><td><span className="selo">{c.categoria}</span></td><td>{c.descricao}{c.parcela && <span className="suave"> · {c.parcela}</span>}</td>
              <td className="n"><b>{brl(c.valor)}</b></td>
              <td>{edita && <form action={acaoConta}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="pagar" /><button className="btn peq">Pago</button></form>}</td>
            </tr>
          ))}</tbody></table></div>
        </div>
      )}

      <form className="linha-form card" method="get">
        <label>Período<select name="p" defaultValue={per}>{Object.entries(PERIODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Categoria<select name="cat" defaultValue={sp.cat ?? ""}><option value="">Todas</option>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Banco<select name="banco" defaultValue={sp.banco ?? ""}><option value="">Todos</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: "0 1 auto" }}><input type="checkbox" name="previstos" value="1" defaultChecked={!!sp.previstos} />Compras ainda não aprovadas</label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: "0 1 auto" }}><input type="checkbox" name="pagas" value="1" defaultChecked={!!sp.pagas} />Mostrar pagas</label>
        <button className="btn sec">Filtrar</button>
      </form>

      {lista.length === 0 && <div className="card suave">Nenhuma conta nesse período.</div>}
      {lista.map(({ d, contas: cs }) => {
        const ehHoje = chave(d) === chave(hoje);
        return (
          <div className="card tabela" key={chave(d)} style={ehHoje ? { borderColor: "var(--pri)", borderWidth: 2 } : undefined}>
            <div className="topo" style={{ marginBottom: 0 }}>
              <b>{ehHoje ? "Hoje · " : ""}{semana(d)} {dataDia(d)}</b>
              <span><span className="suave">{cs.length} conta(s) · </span><b>{brl(soma(cs))}</b></span>
            </div>
            <table>
              <tbody>{cs.map((c) => (
                <tr key={c.id} style={c.status === "pago" ? { opacity: 0.55 } : undefined}>
                  <td style={{ width: 130 }}><span className={`selo ${c.categoria === "Fornecedor" ? "alerta" : c.categoria === "Colaboradores" ? "ok" : ""}`}>{c.categoria}</span></td>
                  <td>
                    {c.pedidoCompraId ? <Link href={`/compras?ver=todos#c${c.pedidoCompraId}`}>{c.descricao}</Link> : c.descricao}
                    {c.parcela && <span className="suave"> · parcela {c.parcela}</span>}
                    {c.recorrenteId && <span className="suave"> · todo mês</span>}
                    {c.pedidoCompra && <div className="suave" style={{ fontSize: ".82rem" }}>{c.pedidoCompra.itens.map((i) => i.item.nome).slice(0, 4).join(", ")}{c.pedidoCompra.itens.length > 4 ? "…" : ""}</div>}
                    {chave(dia(c.vencimento.toISOString())) !== chave(d) && <div className="suave" style={{ fontSize: ".82rem" }}>vence {dataDia(c.vencimento)} (fim de semana/feriado)</div>}
                    {c.observacao && <div className="suave" style={{ fontSize: ".82rem" }}>{c.observacao}</div>}
                    {(c.formaPagamento || c.codigoBarras || c.chavePix) && (
                      <div className="acoes" style={{ marginTop: 6 }}>
                        {c.formaPagamento && <span className="selo">{c.formaPagamento}</span>}
                        {c.favorecido && c.favorecido !== c.fornecedor?.nome && <span className="suave" style={{ fontSize: ".82rem" }}>para {c.favorecido}</span>}
                        {c.codigoBarras && <Copiar texto={c.codigoBarras} rotulo="Copiar boleto" />}
                        {c.chavePix && <Copiar texto={c.chavePix} rotulo={`Copiar Pix ${c.chavePix.length > 22 ? c.chavePix.slice(0, 20) + "…" : c.chavePix}`} />}
                      </div>
                    )}
                    {c.formaPagamento === "boleto" && !c.codigoBarras && c.status === "aberto" && <div style={{ fontSize: ".8rem", color: "var(--alerta)", marginTop: 4 }}>Falta a linha digitável do boleto</div>}
                    {edita && c.status !== "pago" && (
                      <details style={{ marginTop: 6 }}>
                        <summary className="suave" style={{ cursor: "pointer", fontSize: ".82rem" }}>Editar / dados de pagamento</summary>
                        <form action={acaoConta} className="campos" style={{ marginTop: 8 }}>
                          <input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="editar" />
                          <label>Valor<input name="valor" inputMode="decimal" defaultValue={c.valor.toFixed(2).replace(".", ",")} /></label>
                          <label>Vencimento<input name="vencimento" type="date" defaultValue={chave(dia(c.vencimento.toISOString()))} /></label>
                          <label>Forma<select name="forma" defaultValue={c.formaPagamento ?? ""}><option value="">—</option>{FORMAS.map((f) => <option key={f}>{f}</option>)}</select></label>
                          <label>Banco<select name="banco" defaultValue={c.banco ?? ""}><option value="">—</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
                          <label>Favorecido<input name="favorecido" defaultValue={c.favorecido ?? ""} /></label>
                          <label>Chave Pix<input name="pix" defaultValue={c.chavePix ?? ""} /></label>
                          <label className="inteiro">Linha digitável do boleto<input name="codigo" inputMode="numeric" defaultValue={c.codigoBarras ?? ""} /></label>
                          <label className="inteiro">Observação<input name="obs" defaultValue={c.observacao ?? ""} /></label>
                          <div className="inteiro"><button className="btn peq">Salvar</button></div>
                        </form>
                      </details>
                    )}
                  </td>
                  <td className="suave">{c.banco ?? ""}</td>
                  <td className="n" style={{ width: 120 }}><b>{brl(c.valor)}</b></td>
                  <td style={{ width: 210 }}>
                    {c.status === "previsto" && <span className="selo alerta">compra não aprovada</span>}
                    {edita && c.status === "aberto" && (
                      <div className="acoes">
                        <form action={acaoConta}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="pagar" /><button className="btn peq">Pago</button></form>
                        {!c.pedidoCompraId && <form action={acaoConta}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="excluir" /><button className="btn sec peq" title={c.recorrenteId || c.funcionarioId ? "Tira só deste mês" : "Excluir"}>Excluir</button></form>}
                      </div>
                    )}
                    {edita && c.status === "pago" && <form action={acaoConta}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="desfazer" /><span className="selo ok">pago</span> <button className="btn sec peq">Desfazer</button></form>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
      })}

      <h2>Contas fixas (lançadas todo mês)</h2>
      <p className="suave">Salários entram sozinhos no {nSal}º dia útil do mês, com o valor do cadastro de cada colaborador. Para criar uma conta fixa, use <b>Adicionar conta</b> e escolha "Todo mês".</p>
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
