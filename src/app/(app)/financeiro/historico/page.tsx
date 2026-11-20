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
import { configEnvio, enviarEmail, enviarWhats, numeroWhats, textoComprovante, assuntoComprovante } from "@/lib/envio";
import { nomeRemetente } from "@/lib/whatsapp";
import { brl, dataDia } from "@/lib/formato";
import { chave, dia, somaDias } from "@/lib/datas";
import AbasFinanceiro from "@/components/AbasFinanceiro";
import ComprovanteInput from "@/components/ComprovanteInput";
import "./historico.css";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const volta = (f: FormData) => { const v = String(f.get("voltar") || ""); return v.startsWith("/financeiro/historico") ? v : "/financeiro/historico"; };
const FORMAS = ["pix", "boleto", "transferência", "débito automático", "dinheiro", "cartão"];
const txt = (f: FormData, k: string) => String(f.get(k) || "").trim() || null;
const valorBR = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
const aviso = (url: string, k: "ok" | "erro", m: string) => `${url}${url.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`;

async function origem() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** E-mail e WhatsApp de quem recebeu, pelo cadastro do colaborador ou do fornecedor. */
const contato = (c: { funcionario: { email: string | null; telefone: string | null; nome: string } | null; fornecedor: { email: string | null; telefone: string | null; whatsapp: string | null; contato: string | null; nome: string } | null }) => {
  if (c.funcionario) return { email: c.funcionario.email || null, whats: c.funcionario.telefone || null, nome: c.funcionario.nome };
  const f = c.fornecedor;
  return { email: f?.email || null, whats: f?.whatsapp || f?.telefone || null, nome: f?.contato || null };
};

async function anexar(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id")), url = volta(form);
  const m = String(form.get("arq") || "").match(/^data:([\w/.+-]+);base64,(.+)$/);
  if (!m) redirect(aviso(url, "erro", "Escolha a foto ou o PDF do comprovante."));
  const dados = Buffer.from(m[2], "base64");
  if (dados.length > 4.5 * 1024 * 1024) redirect(aviso(url, "erro", "Arquivo grande demais (máximo 4 MB)."));
  // um comprovante por pagamento: anexar de novo troca o anterior
  await db.comprovante.deleteMany({ where: { contaPagarId: id } });
  await db.comprovante.create({ data: { contaPagarId: id, nome: String(form.get("arqNome") || "comprovante").slice(0, 120), tipo: m[1], tamanho: dados.length, dados, token: randomBytes(18).toString("base64url"), usuario: u.nome } });
  await auditar(u.nome, "anexou comprovante", `#${id}`);
  revalidatePath("/financeiro/historico");
  redirect(aviso(url, "ok", "Comprovante anexado.") + `#p${id}`);
}

/** Lança direto no histórico um pagamento já feito (imposto, tarifa, conta paga na hora), com o comprovante junto. */
async function lancar(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "criar");
  const url = volta(form);
  const descricao = String(form.get("descricao") || "").trim(), valor = valorBR(form.get("valor")), quando = String(form.get("pagoEm") || "");
  if (!descricao || !(valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(quando)) redirect(aviso(url + (url.includes("?") ? "&" : "?") + "novo=1", "erro", "Preencha descrição, valor e a data em que foi pago."));
  const [tipo, idQuem] = String(form.get("quem") || "").split(":");
  const fornecedorId = tipo === "f" ? Number(idQuem) || null : null, funcionarioId = tipo === "c" ? Number(idQuem) || null : null;
  const forn = fornecedorId ? await db.fornecedor.findUnique({ where: { id: fornecedorId } }) : null;
  const cat = String(form.get("categoria") || "");
  const categoria = CATEGORIAS.includes(cat) ? cat : funcionarioId ? "Colaboradores" : fornecedorId ? "Fornecedor" : "Outras";
  const d = dia(quando);
  const c = await db.contaPagar.create({ data: {
    descricao, categoria, valor, vencimento: d, pagoEm: d, status: "pago", banco: txt(form, "banco"), formaPagamento: txt(form, "forma"),
    fornecedorId, funcionarioId, favorecido: forn?.nome ?? null, documento: forn?.cnpj ?? null, notaFiscal: txt(form, "nota"), observacao: txt(form, "obs"),
  } });
  const m = String(form.get("arq") || "").match(/^data:([\w/.+-]+);base64,(.+)$/);
  if (m) {
    const dados = Buffer.from(m[2], "base64");
    if (dados.length <= 4.5 * 1024 * 1024) await db.comprovante.create({ data: { contaPagarId: c.id, nome: String(form.get("arqNome") || "comprovante").slice(0, 120), tipo: m[1], tamanho: dados.length, dados, token: randomBytes(18).toString("base64url"), usuario: u.nome } });
  }
  await auditar(u.nome, "lançou pagamento feito", `${descricao} ${valor}`);
  revalidatePath("/financeiro/historico"); revalidatePath("/financeiro");
  redirect(aviso(`/financeiro/historico?id=${c.id}`, "ok", m ? "Pagamento lançado com o comprovante guardado." : "Pagamento lançado. Anexe o comprovante quando tiver.") + `#p${c.id}`);
}

async function acao(form: FormData) {
  "use server";
  const u = await exigir("financeiro", "editar");
  const id = Number(form.get("id")), a = String(form.get("a")), url = volta(form);
  if (a === "tirar") {
    await db.comprovante.deleteMany({ where: { contaPagarId: id } });
    await auditar(u.nome, "tirou comprovante", `#${id}`);
    redirect(aviso(url, "ok", "Comprovante retirado. Anexe o novo.") + `#p${id}`);
  }
  // enviar: para o e-mail e o WhatsApp do cadastro (os dois, se tiver os dois)
  const c = await db.contaPagar.findUniqueOrThrow({ where: { id }, include: { fornecedor: true, funcionario: true, pedidoCompra: { select: { notaFiscal: true } }, comprovantes: true } });
  const arq = c.comprovantes[0];
  if (!arq) redirect(aviso(url, "erro", "Anexe o comprovante antes de enviar.") + `#p${id}`);
  const { email, whats, nome } = contato(c), cfg = configEnvio();
  const texto = textoComprovante(c, nome, await nomeRemetente()), anexo = { nome: arq.nome, tipo: arq.tipo, dados: arq.dados };
  const foi: string[] = [], falhou: string[] = [];
  if (email && cfg.email) {
    try { await enviarEmail(email, assuntoComprovante(c), texto, anexo); foi.push(email); } catch (e) { falhou.push(e instanceof Error ? e.message : "e-mail"); }
  }
  const n = numeroWhats(whats);
  if (n && cfg.whats) {
    try { await enviarWhats(n, texto, anexo, { fornecedorId: c.fornecedorId, funcionarioId: c.funcionarioId, nome: nome ?? c.favorecido }); foi.push(`WhatsApp ${whats}`); } catch (e) { falhou.push(e instanceof Error ? e.message : "WhatsApp"); }
  }
  if (foi.length) {
    await db.comprovante.update({ where: { id: arq.id }, data: { enviadoEm: new Date(), enviadoPara: foi.join(" e ") } });
    await auditar(u.nome, "enviou comprovante", `#${id} ${foi.join(", ")}`);
  }
  revalidatePath("/financeiro/historico");
  const msg = foi.length ? `Comprovante enviado para ${foi.join(" e ")}.` : !email && !whats ? "Cadastre o e-mail ou o telefone no cadastro do fornecedor/colaborador." : "O envio automático ainda não está ligado.";
  redirect(aviso(url, foi.length && !falhou.length ? "ok" : "erro", [msg, falhou.length ? `Não foi: ${falhou.join("; ")}` : ""].join(" ").trim()) + `#p${id}`);
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
    db.contaPagar.findMany({
      where, orderBy: [{ pagoEm: "desc" }, { id: "desc" }], take: 300,
      include: { fornecedor: true, funcionario: true, pedidoCompra: { select: { notaFiscal: true } }, comprovantes: { select: { id: true, tipo: true, token: true, enviadoEm: true, enviadoPara: true } } },
    }),
    db.fornecedor.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    db.funcionario.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const pagos = lista.filter((c) => c.pagoEm && (!de || dia(c.pagoEm) >= de) && (!ate || dia(c.pagoEm) <= ate));
  const total = pagos.reduce((t, c) => t + c.valor, 0), semComp = pagos.filter((c) => !c.comprovantes.length).length;
  const meses = new Map<string, typeof pagos>();
  for (const c of pagos) { const k = chave(dia(c.pagoEm!)).slice(0, 7); meses.set(k, [...(meses.get(k) ?? []), c]); }
  const edita = pode(u.permissoes, "financeiro", "editar"), cria = pode(u.permissoes, "financeiro", "criar");
  const cfg = configEnvio(), automatico = cfg.email || cfg.whats, base = await origem(), remetente = await nomeRemetente();
  const qsAtual = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["ok", "erro", "novo"].includes(k)) as [string, string][]).toString();
  const url = `/financeiro/historico${qsAtual ? "?" + qsAtual : ""}`;
  const H = ({ n, v }: { n: string; v: string }) => <input type="hidden" name={n} value={v} />;

  return (
    <>
      <h1>Financeiro</h1>
      <AbasFinanceiro ativo="historico" />
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}

      {cria && !sp.novo && <div className="topo-hist"><a className="btn" href={`${url}${url.includes("?") ? "&" : "?"}novo=1#lancar`}>+ Lançar pagamento</a></div>}
      {cria && sp.novo && (
        <div className="card" id="lancar" style={{ borderColor: "var(--acento)", borderWidth: 2 }}>
          <b>Lançar pagamento já feito</b>
          <p className="suave pq" style={{ margin: "4px 0 0" }}>Para imposto, tarifa ou qualquer conta que você já pagou. Se quem recebeu não tem e-mail ou telefone no cadastro, o comprovante só fica guardado aqui.</p>
          <form action={lancar} className="campos" style={{ marginTop: 12 }}>
            <H n="voltar" v={url.replace(/[?&]novo=1/, "")} />
            <label>Descrição<input name="descricao" required placeholder="ex.: DAS do Simples, novembro" autoFocus /></label>
            <label>Valor (R$)<input name="valor" inputMode="decimal" required placeholder="0,00" /></label>
            <label>Pago em<input name="pagoEm" type="date" defaultValue={chave(hoje)} required /></label>
            <label>Categoria<select name="categoria" defaultValue="Impostos">{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Quem recebeu<select name="quem" defaultValue="">
              <option value="">Ninguém para avisar (só guardar)</option>
              <optgroup label="Fornecedores">{fornecedores.map((f) => <option key={"f" + f.id} value={`f:${f.id}`}>{f.nome}</option>)}</optgroup>
              <optgroup label="Colaboradores">{colaboradores.map((f) => <option key={"c" + f.id} value={`c:${f.id}`}>{f.nome}</option>)}</optgroup>
            </select></label>
            <label>Saiu pelo banco<select name="banco" defaultValue=""><option value="">—</option>{BANCOS.map((b) => <option key={b}>{b}</option>)}</select></label>
            <label>Forma<select name="forma" defaultValue="pix"><option value="">—</option>{FORMAS.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>Nota / guia (opcional)<input name="nota" placeholder="nº da nota ou da guia" /></label>
            <label className="inteiro">Comprovante (foto ou PDF)<span className="anexar"><ComprovanteInput opcional /></span></label>
            <label className="inteiro">Observação<input name="obs" /></label>
            <div className="inteiro acoes"><button className="btn">Salvar</button><a className="btn sec" href={url.replace(/[?&]novo=1/, "") || "/financeiro/historico"}>Cancelar</a></div>
          </form>
        </div>
      )}

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

      <p className="suave resumo-hist">
        <b>{pagos.length}{lista.length === 300 ? "+" : ""}</b> pagamento(s) · <b>{brl(total)}</b>
        {semComp > 0 && <> · <a href={`/financeiro/historico?comp=sem${de ? `&de=${chave(de)}` : ""}`}>{semComp} sem comprovante</a></>}
        {" "}· {de ? `desde ${dataDia(de)}` : "todo o período"}{ate ? ` até ${dataDia(ate)}` : ""}
      </p>

      {pagos.length === 0 && <div className="card suave">Nenhum pagamento encontrado com essa pesquisa.</div>}
      {[...meses.entries()].map(([km, cs]) => (
        <div className="card tabela" key={km}>
          <div className="topo" style={{ marginBottom: 4 }}>
            <b>{MESES[Number(km.slice(5)) - 1].replace(/^./, (x) => x.toUpperCase())} de {km.slice(0, 4)}</b>
            <span className="suave">{brl(cs.reduce((t, c) => t + c.valor, 0))}</span>
          </div>
          <table className="hist">
            <tbody>{cs.map((c) => {
              const quem = c.funcionario?.nome ?? c.fornecedor?.nome ?? c.favorecido ?? null;
              const nota = c.notaFiscal ?? c.pedidoCompra?.notaFiscal;
              const { email, whats, nome } = contato(c);
              const comp = c.comprovantes[0];
              const texto = textoComprovante(c, nome, remetente), link = comp ? `${base}/api/comprovante/${comp.token}` : "", nW = numeroWhats(whats);
              return (
                <tr key={c.id} id={`p${c.id}`} className={String(c.id) === sp.id ? "marcado" : undefined}>
                  <td className="data">{dataDia(dia(c.pagoEm!))}</td>
                  <td>
                    <div><b>{c.descricao}</b></div>
                    <div className="suave pq">{[quem && !c.descricao.includes(quem) ? quem : null, c.categoria, c.parcela && `parcela ${c.parcela}`, nota && `nota ${nota}`, c.banco].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="n"><b>{brl(c.valor)}</b></td>
                  <td className="comp">
                    {comp ? (
                      <div className="acoes">
                        <a className="btn sec peq" href={`/api/comprovante/${comp.token}`} target="_blank" rel="noreferrer">Ver</a>
                        {edita && (email || whats) && <form action={acao}><H n="id" v={String(c.id)} /><H n="a" v="enviar" /><H n="voltar" v={url} /><button className="btn peq">Enviar comprovante</button></form>}
                      </div>
                    ) : edita ? (
                      <form action={anexar} className="anexar"><H n="id" v={String(c.id)} /><H n="voltar" v={url} /><ComprovanteInput /><button className="btn sec peq">Anexar</button></form>
                    ) : <span className="suave pq">sem comprovante</span>}
                    {comp && (
                      <div className="suave pq" style={{ marginTop: 4 }}>
                        {comp.enviadoEm ? <>✓ enviado {dataDia(dia(comp.enviadoEm))} para {comp.enviadoPara}</> : email || whats ? <>vai para {[email, whats].filter(Boolean).join(" e ")}</> : <>✓ guardado (sem contato para enviar)</>}
                        {!automatico && (email || nW) && <> · enviar à mão: {email && <a href={`mailto:${email}?subject=${encodeURIComponent(assuntoComprovante(c))}&body=${encodeURIComponent(`${texto}\n\n${link}`)}`}>e-mail</a>}{email && nW && " / "}{nW && <a target="_blank" rel="noreferrer" href={`https://wa.me/${nW}?text=${encodeURIComponent(`${texto}\n${link}`)}`}>WhatsApp</a>}</>}
                        {edita && <> · <form action={acao} className="inline"><H n="id" v={String(c.id)} /><H n="a" v="tirar" /><H n="voltar" v={url} /><button className="link">trocar</button></form></>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ))}
      <p className="suave pq">
        O comprovante vai para o e-mail e o telefone do cadastro do <Link href="/compras/fornecedores">fornecedor</Link> ou do <Link href="/funcionarios">colaborador</Link>. Pagamento sem contato (imposto, tarifa) só guarda o comprovante.
        {" "}{automatico ? `Envio automático ligado: ${[cfg.email && "e-mail", cfg.whats && "WhatsApp"].filter(Boolean).join(" e ")}.` : "O envio automático ainda não foi ligado; enquanto isso, use os links \"enviar à mão\"."}
      </p>
    </>
  );
}
