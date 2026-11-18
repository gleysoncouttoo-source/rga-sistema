import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { BANCOS, CATEGORIAS } from "@/lib/financeiro";
import { configEnvio, enviarEmail, enviarWhats, numeroWhats, textoComprovante } from "@/lib/envio";
import { brl, dataDia, dataHora } from "@/lib/formato";
import { chave, dia, somaDias } from "@/lib/datas";
import AbasFinanceiro from "@/components/AbasFinanceiro";
import ComprovanteInput from "@/components/ComprovanteInput";
import Copiar from "@/components/Copiar";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const txt = (f: FormData, k: string) => String(f.get(k) || "").trim() || null;
const volta = (f: FormData) => { const v = String(f.get("voltar") || ""); return v.startsWith("/financeiro/historico") ? v : "/financeiro/historico"; };
const aviso = (url: string, k: "ok" | "erro", m: string) => `${url}${url.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`;

async function origem() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

const incluir = { fornecedor: true, funcionario: true, pedidoCompra: { select: { notaFiscal: true } }, comprovantes: { select: { id: true, nome: true, tipo: true, token: true, enviadoEm: true, enviadoPara: true, criadoEm: true, usuario: true }, orderBy: { criadoEm: "desc" } } } satisfies Prisma.ContaPagarInclude;

/** Manda o comprovante para o e-mail e o WhatsApp de quem recebeu (o que estiver cadastrado e ligado). */
async function mandar(contaId: number, comprovanteId: number, canais: { email: string | null; whats: string | null }) {
  const [c, arq] = await Promise.all([
    db.contaPagar.findUniqueOrThrow({ where: { id: contaId }, include: { pedidoCompra: { select: { notaFiscal: true } } } }),
    db.comprovante.findUniqueOrThrow({ where: { id: comprovanteId } }),
  ]);
  const cfg = configEnvio(), texto = textoComprovante(c), anexo = { nome: arq.nome, tipo: arq.tipo, dados: arq.dados };
  const foi: string[] = [], falhou: string[] = [];
  if (canais.email && cfg.email) {
    try { await enviarEmail(canais.email, texto.split(" — ")[0], texto, anexo); foi.push(`e-mail ${canais.email}`); } catch (e) { falhou.push(e instanceof Error ? e.message : "e-mail"); }
  }
  const n = numeroWhats(canais.whats);
  if (n && cfg.whats) {
    try { await enviarWhats(n, texto, anexo); foi.push(`WhatsApp ${canais.whats}`); } catch (e) { falhou.push(e instanceof Error ? e.message : "WhatsApp"); }
  }
  if (foi.length) await db.comprovante.update({ where: { id: comprovanteId }, data: { enviadoEm: new Date(), enviadoPara: foi.join(" e ") } });
  return { foi, falhou };
}

async function anexar(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id")), url = volta(form);
  const arq = String(form.get("arq") || "");
  const m = arq.match(/^data:([\w/.+-]+);base64,(.+)$/);
  if (!m) redirect(aviso(url, "erro", "Escolha a foto ou o PDF do comprovante."));
  const dados = Buffer.from(m[2], "base64");
  if (dados.length > 4.5 * 1024 * 1024) redirect(aviso(url, "erro", "Arquivo grande demais (máximo 4 MB)."));
  const c = await db.contaPagar.findUniqueOrThrow({ where: { id }, include: { fornecedor: true, funcionario: true } });
  const nome = String(form.get("arqNome") || "comprovante").slice(0, 120);
  const novo = await db.comprovante.create({ data: { contaPagarId: id, nome, tipo: m[1], tamanho: dados.length, dados, token: randomBytes(18).toString("base64url"), usuario: u.nome } });
  // quem paga e ainda estava em aberto: anexar o comprovante já dá baixa
  if (c.status !== "pago") await db.contaPagar.update({ where: { id }, data: { status: "pago", pagoEm: new Date() } });
  await auditar(u.nome, "anexou comprovante", `#${id} ${c.descricao}`);
  let msg = "Comprovante anexado.";
  if (form.get("enviar") === "1") {
    const r = await mandar(id, novo.id, { email: c.emailContato ?? c.fornecedor?.email ?? null, whats: c.whatsContato ?? c.fornecedor?.telefone ?? c.funcionario?.telefone ?? null });
    if (r.foi.length) msg += ` Enviado por ${r.foi.join(" e ")}.`;
    if (r.falhou.length) msg += ` Não consegui enviar: ${r.falhou.join("; ")}`;
  }
  revalidatePath("/financeiro/historico");
  redirect(aviso(url, "ok", msg) + `#p${id}`);
}

async function acao(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id")), a = String(form.get("a")), url = volta(form);
  if (a === "contato") {
    await db.contaPagar.update({ where: { id }, data: { emailContato: txt(form, "email"), whatsContato: txt(form, "whats"), notaFiscal: txt(form, "nota") } });
    redirect(aviso(url, "ok", "Dados salvos.") + `#p${id}`);
  }
  if (a === "tirar") {
    const cid = Number(form.get("cid"));
    await db.comprovante.delete({ where: { id: cid } });
    await auditar(u.nome, "tirou comprovante", `#${id}`);
    redirect(aviso(url, "ok", "Comprovante retirado.") + `#p${id}`);
  }
  if (a === "enviar") {
    const r = await mandar(id, Number(form.get("cid")), { email: txt(form, "email"), whats: txt(form, "whats") });
    await db.contaPagar.update({ where: { id }, data: { emailContato: txt(form, "email"), whatsContato: txt(form, "whats") } });
    await auditar(u.nome, "enviou comprovante", `#${id} ${r.foi.join(", ")}`);
    redirect(aviso(url, r.falhou.length && !r.foi.length ? "erro" : "ok", [r.foi.length ? `Enviado por ${r.foi.join(" e ")}.` : "", r.falhou.length ? `Não consegui enviar: ${r.falhou.join("; ")}` : ""].join(" ").trim() || "Nada para enviar.") + `#p${id}`);
  }
  if (a === "desfazer") {
    await db.contaPagar.update({ where: { id }, data: { status: "aberto", pagoEm: null } });
    await auditar(u.nome, "desfez pagamento", `#${id}`);
  }
  revalidatePath("/financeiro/historico");
}

export default async function HistoricoPagamentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await exigir("financeiro");
  const sp = await searchParams;
  const hoje = dia();
  const de = sp.de && /^\d{4}-\d{2}-\d{2}$/.test(sp.de) ? dia(sp.de) : sp.id ? null : somaDias(hoje, -90);
  const ate = sp.ate && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate) ? dia(sp.ate) : null;
  const q = (sp.q ?? "").trim();
  const where: Prisma.ContaPagarWhereInput = { status: "pago" };
  if (sp.id) where.id = Number(sp.id);
  if (de || ate) where.pagoEm = { ...(de ? { gte: somaDias(de, -1) } : {}), ...(ate ? { lte: somaDias(ate, 1) } : {}) };
  if (sp.cat) where.categoria = sp.cat;
  if (sp.banco) where.banco = sp.banco;
  if (sp.forn) where.fornecedorId = Number(sp.forn);
  if (sp.func) where.funcionarioId = Number(sp.func);
  if (sp.comp === "com") where.comprovantes = { some: {} };
  if (sp.comp === "sem") where.comprovantes = { none: {} };
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    const v = Number(q.replace(/\./g, "").replace(",", "."));
    where.OR = [
      { descricao: ci }, { favorecido: ci }, { observacao: ci }, { notaFiscal: ci }, { parcela: ci }, { documento: ci },
      { fornecedor: { nome: ci } }, { funcionario: { nome: ci } }, { pedidoCompra: { notaFiscal: ci } },
      ...(Number.isFinite(v) && v > 0 ? [{ valor: { gte: v - 0.005, lte: v + 0.005 } }] : []),
    ];
  }
  const [lista, fornecedores, colaboradores] = await Promise.all([
    db.contaPagar.findMany({ where, include: incluir, orderBy: [{ pagoEm: "desc" }, { id: "desc" }], take: 300 }),
    db.fornecedor.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    db.funcionario.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  // filtro por data é no dia de Brasília
  const pagos = lista.filter((c) => c.pagoEm && (!de || dia(c.pagoEm) >= de) && (!ate || dia(c.pagoEm) <= ate));
  const total = pagos.reduce((t, c) => t + c.valor, 0), semComp = pagos.filter((c) => !c.comprovantes.length).length;
  const meses = new Map<string, typeof pagos>();
  for (const c of pagos) { const k = chave(dia(c.pagoEm!)).slice(0, 7); meses.set(k, [...(meses.get(k) ?? []), c]); }
  const edita = pode(u.permissoes, "financeiro", "editar");
  const cfg = configEnvio(), base = await origem();
  const qsAtual = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["ok", "erro"].includes(k)) as [string, string][]).toString();
  const url = `/financeiro/historico${qsAtual ? "?" + qsAtual : ""}`;

  return (
    <>
      <h1>Financeiro</h1>
      <AbasFinanceiro ativo="historico" />
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}

      <form className="card linha-form" method="get">
        <label style={{ flex: "2 1 260px" }}>Pesquisar<input name="q" defaultValue={q} placeholder="nome, fornecedor, colaborador, nota, valor..." /></label>
        <label>De<input type="date" name="de" defaultValue={de ? chave(de) : ""} /></label>
        <label>Até<input type="date" name="ate" defaultValue={ate ? chave(ate) : ""} /></label>
        <label>Categoria<select name="cat" defaultValue={sp.cat ?? ""}><option value="">Todas</option>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Fornecedor<select name="forn" defaultValue={sp.forn ?? ""}><option value="">Todos</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
        <label>Colaborador<select name="func" defaultValue={sp.func ?? ""}><option value="">Todos</option>{colaboradores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
        <label>Banco<select name="banco" defaultValue={sp.banco ?? ""}><option value="">Todos</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label>Comprovante<select name="comp" defaultValue={sp.comp ?? ""}><option value="">Todos</option><option value="com">Com comprovante</option><option value="sem">Sem comprovante</option></select></label>
        <button className="btn sec peq">Pesquisar</button>
        {qsAtual && <a className="suave" href="/financeiro/historico">limpar</a>}
      </form>

      <div className="grade">
        <div className="kpi"><div className="r">Pagamentos encontrados</div><div className="v">{pagos.length}{lista.length === 300 ? "+" : ""}</div><div className="r">{de ? `desde ${dataDia(de)}` : "todo o período"}{ate ? ` até ${dataDia(ate)}` : ""}</div></div>
        <div className="kpi"><div className="r">Total pago</div><div className="v">{brl(total)}</div></div>
        <div className="kpi" style={semComp ? { borderTopColor: "var(--acento)" } : undefined}><div className="r">Sem comprovante</div><div className="v">{semComp}</div>{semComp > 0 && <div className="r"><a href={`/financeiro/historico?comp=sem${de ? `&de=${chave(de)}` : ""}`}>ver quais</a></div>}</div>
        <div className="kpi"><div className="r">Envio automático</div><div className="v" style={{ fontSize: "1.05rem", marginTop: 8 }}>{cfg.email ? "E-mail ligado" : "E-mail desligado"}<br />{cfg.whats ? "WhatsApp ligado" : "WhatsApp desligado"}</div></div>
      </div>

      {pagos.length === 0 && <div className="card suave">Nenhum pagamento encontrado com essa pesquisa.</div>}
      {[...meses.entries()].map(([km, cs]) => (
        <div className="card tabela" key={km}>
          <div className="topo" style={{ marginBottom: 4 }}>
            <b>{MESES[Number(km.slice(5)) - 1].replace(/^./, (x) => x.toUpperCase())} de {km.slice(0, 4)}</b>
            <span><span className="suave">{cs.length} pagamento(s) · </span><b>{brl(cs.reduce((t, c) => t + c.valor, 0))}</b></span>
          </div>
          <table>
            <thead><tr><th>Pago em</th><th>Pagamento</th><th>Para quem</th><th>Banco</th><th className="n">Valor</th><th>Comprovante</th></tr></thead>
            <tbody>{cs.map((c) => {
              const quem = c.funcionario?.nome ?? c.fornecedor?.nome ?? c.favorecido ?? "—";
              const nota = c.notaFiscal ?? c.pedidoCompra?.notaFiscal;
              const email = c.emailContato ?? c.fornecedor?.email ?? "", whats = c.whatsContato ?? c.fornecedor?.telefone ?? c.funcionario?.telefone ?? "";
              const comp = c.comprovantes[0];
              const texto = textoComprovante(c);
              const link = comp ? `${base}/api/comprovante/${comp.token}` : "";
              const nW = numeroWhats(whats);
              return (
                <tr key={c.id} id={`p${c.id}`} style={String(c.id) === sp.id ? { background: "var(--acento-claro)" } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{dataDia(dia(c.pagoEm!))}</td>
                  <td>
                    <b>{c.descricao}</b>
                    <div className="suave" style={{ fontSize: ".82rem" }}>
                      <span className="selo" style={{ marginRight: 6 }}>{c.categoria}</span>
                      {[c.formaPagamento, c.parcela && `parcela ${c.parcela}`, nota && `nota ${nota}`, `vencia ${dataDia(c.vencimento)}`].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>{quem}{c.funcionario && <div className="suave" style={{ fontSize: ".8rem" }}>colaborador</div>}{c.fornecedor && !c.funcionario && <div className="suave" style={{ fontSize: ".8rem" }}>fornecedor</div>}</td>
                  <td className="suave">{c.banco ?? ""}</td>
                  <td className="n"><b>{brl(c.valor)}</b></td>
                  <td style={{ minWidth: 240 }}>
                    {comp ? (
                      <div className="acoes">
                        <a className="btn sec peq" href={`/api/comprovante/${comp.token}`} target="_blank" rel="noreferrer">Ver {comp.tipo === "application/pdf" ? "PDF" : "foto"}</a>
                        {comp.enviadoEm ? <span className="selo ok" title={comp.enviadoPara ?? ""}>enviado {dataDia(dia(comp.enviadoEm))}</span> : <span className="selo">não enviado</span>}
                      </div>
                    ) : <span className="selo alerta">sem comprovante</span>}
                    {edita && (
                      <details style={{ marginTop: 6 }} open={String(c.id) === sp.id || undefined}>
                        <summary className="suave" style={{ cursor: "pointer", fontSize: ".82rem" }}>{comp ? "Enviar / trocar comprovante" : "Anexar comprovante"}</summary>
                        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                          <form action={anexar} style={{ display: "grid", gap: 6 }}>
                            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="voltar" value={url} />
                            <ComprovanteInput />
                            {(email || whats) && (cfg.email || cfg.whats) && <label style={{ flexDirection: "row", gap: 6, alignItems: "center", fontSize: ".82rem" }}><input type="checkbox" name="enviar" value="1" defaultChecked />Enviar para {[cfg.email && email, cfg.whats && whats].filter(Boolean).join(" e ")}</label>}
                            <button className="btn peq">{comp ? "Anexar outro" : "Anexar"}</button>
                          </form>
                          {comp && (
                            <form action={acao} style={{ display: "grid", gap: 6 }}>
                              <input type="hidden" name="id" value={c.id} /><input type="hidden" name="cid" value={comp.id} /><input type="hidden" name="a" value="enviar" /><input type="hidden" name="voltar" value={url} />
                              <label style={{ fontSize: ".82rem" }}>E-mail<input name="email" type="email" defaultValue={email} style={{ minHeight: 34 }} /></label>
                              <label style={{ fontSize: ".82rem" }}>WhatsApp<input name="whats" inputMode="tel" defaultValue={whats} placeholder="(11) 99999-9999" style={{ minHeight: 34 }} /></label>
                              <div className="suave" style={{ fontSize: ".8rem" }}>Mensagem: {texto}</div>
                              <div className="acoes">
                                {(cfg.email || cfg.whats) && <button className="btn peq">Enviar automático</button>}
                                {nW && <a className="btn sec peq" target="_blank" rel="noreferrer" href={`https://wa.me/${nW}?text=${encodeURIComponent(`${texto}\n${link}`)}`}>Abrir no WhatsApp</a>}
                                {email && <a className="btn sec peq" href={`mailto:${email}?subject=${encodeURIComponent(texto.split(" — ")[0])}&body=${encodeURIComponent(`${texto}\n\n${link}`)}`}>Abrir e-mail</a>}
                                <Copiar texto={`${texto}\n${link}`} rotulo="Copiar mensagem e link" />
                              </div>
                            </form>
                          )}
                          <form action={acao} className="campos" style={{ gridTemplateColumns: "1fr", gap: 6 }}>
                            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="contato" /><input type="hidden" name="voltar" value={url} />
                            <label style={{ fontSize: ".82rem" }}>Nota fiscal<input name="nota" defaultValue={c.notaFiscal ?? ""} placeholder={c.pedidoCompra?.notaFiscal ?? "nº da nota"} style={{ minHeight: 34 }} /></label>
                            {!comp && <>
                              <label style={{ fontSize: ".82rem" }}>E-mail de quem recebe<input name="email" type="email" defaultValue={c.emailContato ?? ""} placeholder={c.fornecedor?.email ?? ""} style={{ minHeight: 34 }} /></label>
                              <label style={{ fontSize: ".82rem" }}>WhatsApp de quem recebe<input name="whats" inputMode="tel" defaultValue={c.whatsContato ?? ""} placeholder={c.fornecedor?.telefone ?? c.funcionario?.telefone ?? ""} style={{ minHeight: 34 }} /></label>
                            </>}
                            {comp && <><input type="hidden" name="email" value={c.emailContato ?? ""} /><input type="hidden" name="whats" value={c.whatsContato ?? ""} /></>}
                            <div className="acoes">
                              <button className="btn sec peq">Salvar</button>
                            </div>
                          </form>
                          <div className="acoes">
                            {comp && <form action={acao}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="cid" value={comp.id} /><input type="hidden" name="a" value="tirar" /><input type="hidden" name="voltar" value={url} /><button className="btn sec peq">Tirar comprovante</button></form>}
                            <form action={acao}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="a" value="desfazer" /><input type="hidden" name="voltar" value={url} /><button className="btn sec peq" title="Volta a conta para Contas a pagar, em aberto">Não foi pago</button></form>
                          </div>
                          {c.comprovantes.length > 1 && <div className="suave" style={{ fontSize: ".78rem" }}>Anteriores: {c.comprovantes.slice(1).map((x) => <a key={x.id} href={`/api/comprovante/${x.token}`} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{dataHora(x.criadoEm)}</a>)}</div>}
                        </div>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ))}
      <p className="suave" style={{ fontSize: ".82rem" }}>Mostra só contas pagas. Para lançar ou pagar contas, use <Link href="/financeiro">Contas a pagar</Link>.</p>
    </>
  );
}
