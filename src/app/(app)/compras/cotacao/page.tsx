import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, dataHora, dataDia } from "@/lib/formato";
import { DIAS_SEMANA, abrirCotacao, configAuto, confirmarPreco, proximasCotacoes, enviarPedido, itensDoFornecedor, receberMensagem, segundaDaSemana, textoPedidoCotacao } from "@/lib/cotacao";
import { numeroWhats, primeiroNome, statusWhats, whatsLigado } from "@/lib/whatsapp";
import { iaLigada } from "@/lib/ia";
import AbasCompras from "@/components/AbasCompras";

const ir = (tipo: "ok" | "erro", msg: string, ancora = "") => redirect(`/compras/cotacao?${tipo}=${encodeURIComponent(msg)}${ancora}`);

async function acao(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const a = String(form.get("a"));
  if (a === "abrir") {
    const r = await abrirCotacao(u.nome);
    await auditar(u.nome, "abriu cotação semanal", `${r.enviados} enviada(s)`);
    revalidatePath("/compras/cotacao");
    ir("ok", whatsLigado() ? `Cotação da semana aberta. ${r.enviados} fornecedor(es) receberam no WhatsApp.` : "Cotação da semana aberta. O WhatsApp ainda não está ligado: lance as respostas que chegarem pelo seu celular em \"Lançar resposta\".");
  }
  if (a === "auto") {
    const vezes = String([0, 1, 2, 4].includes(Number(form.get("vezes"))) ? Number(form.get("vezes")) : 0);
    const d = Number(form.get("dia")), diaSemana = String(d >= 1 && d <= 5 ? d : 1);
    for (const [chave, valor] of [["cotacaoVezesMes", vezes], ["cotacaoDiaSemana", diaSemana]]) await db.configuracao.upsert({ where: { chave }, create: { chave, valor }, update: { valor } });
    await auditar(u.nome, "alterou cotação automática", vezes === "0" ? "desligada" : `${vezes}x por mês, ${DIAS_SEMANA[Number(diaSemana)]}`);
    revalidatePath("/compras/cotacao");
    const prox = proximasCotacoes({ vezes: Number(vezes) as 0 | 1 | 2 | 4, diaSemana: Number(diaSemana) }, 1)[0];
    ir("ok", vezes === "0" ? "Cotação automática desligada. Você ainda pode mandar pelo botão quando quiser." : `Pronto: ${vezes === "4" ? "toda semana" : `${vezes}x por mês`}, ${DIAS_SEMANA[Number(diaSemana)]} às 8h. Próxima: ${prox ? dataDia(prox) : "—"}. Dois dias depois o Sambot lembra quem não respondeu.`);
  }
  if (a === "reenviar") {
    const ok = await enviarPedido(Number(form.get("cf")));
    revalidatePath("/compras/cotacao");
    ir(ok ? "ok" : "erro", ok ? "Pedido de cotação reenviado." : "Não foi enviado. Veja o motivo na linha do fornecedor.", "#fornecedores");
  }
  if (a === "resposta") {
    const fornecedorId = Number(form.get("fornecedorId")), texto = String(form.get("texto") || "").trim();
    if (!texto) ir("erro", "Cole a resposta do fornecedor.");
    const f = await db.fornecedor.findUniqueOrThrow({ where: { id: fornecedorId } });
    const r = await receberMensagem({ telefone: numeroWhats(f.whatsapp || f.telefone) ?? `sem-numero-${f.id}`, texto }, { responder: false, fornecedorId });
    await auditar(u.nome, "lançou resposta de cotação", f.nome);
    revalidatePath("/compras/cotacao");
    ir(r?.precos.length ? "ok" : "erro", r?.precos.length ? `${r.precos.length} preço(s) lido(s) de ${f.nome}. Confira abaixo.` : `Não achei preço da lista de ${f.nome} nesse texto.`, "#conferir");
  }
  if (a === "confirmar" || a === "confirmar-todos") {
    const ids = a === "confirmar" ? [Number(form.get("id"))] : (await db.cotacaoPreco.findMany({ where: { status: "a_conferir" }, select: { id: true } })).map((x) => x.id);
    let recordes = 0;
    for (const id of ids) if ((await confirmarPreco(id, u.nome))?.recorde) recordes++;
    await auditar(u.nome, "confirmou preços da cotação", `${ids.length} preço(s)`);
    revalidatePath("/compras/cotacao"); revalidatePath("/compras/precos");
    ir("ok", `${ids.length} preço(s) confirmado(s) e salvos no sistema.${recordes ? ` ${recordes} novo(s) recorde(s) de menor preço!` : ""}`, "#conferir");
  }
  if (a === "descartar") {
    await db.cotacaoPreco.update({ where: { id: Number(form.get("id")) }, data: { status: "descartado", decididoPor: u.nome, decididoEm: new Date() } });
    revalidatePath("/compras/cotacao");
    ir("ok", "Preço descartado.", "#conferir");
  }
  if (a === "corrigir") {
    const preco = Number(String(form.get("preco") || "").replace(/\./g, "").replace(",", "."));
    if (!(preco > 0)) ir("erro", "Preço inválido.");
    await db.cotacaoPreco.update({ where: { id: Number(form.get("id")) }, data: { preco } });
    revalidatePath("/compras/cotacao");
    ir("ok", "Preço corrigido. Agora é só confirmar.", "#conferir");
  }
  ir("erro", "Ação desconhecida.");
}

const STATUS: Record<string, [string, string]> = {
  pronto: ["Pronto para enviar", ""], enviado: ["Aguardando resposta", "alerta"], respondeu: ["Respondeu parte", "alerta"],
  completo: ["Respondeu tudo", "ok"], sem_whats: ["Sem WhatsApp no cadastro", "alerta"], erro: ["Não foi", "alerta"],
};

const Dif = ({ novo, antigo }: { novo: number; antigo: number | null }) => {
  if (!antigo) return <span className="suave">—</span>;
  const p = (novo / antigo - 1) * 100;
  if (Math.abs(p) < 0.05) return <span className="suave">igual</span>;
  return <b style={{ color: p > 0 ? "var(--erro)" : "var(--ok)" }}>{p > 0 ? "▲ +" : "▼ "}{p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b>;
};
const r$ = (v: number | null | undefined) => brl(v, v != null && v < 1 ? 4 : 2);

export default async function Cotacao({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigir("compras");
  const sp = await searchParams;
  const edita = pode(u.permissoes, "compras", "editar");
  const semana = segundaDaSemana();
  const [cot, aConferir, auto, fornsAtivos] = await Promise.all([
    db.cotacao.findUnique({ where: { semana }, include: { fornecedores: { include: { fornecedor: true, precos: { where: { status: { not: "descartado" } }, include: { item: true } } }, orderBy: { fornecedor: { nome: "asc" } } } } }),
    db.cotacaoPreco.findMany({ where: { status: "a_conferir" }, include: { item: { include: { ofertas: true } }, cotacaoFornecedor: { include: { fornecedor: true } } }, orderBy: { criadoEm: "asc" } }),
    configAuto(),
    db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
  ]);
  const itensPor = new Map<number, Awaited<ReturnType<typeof itensDoFornecedor>>>();
  for (const f of fornsAtivos) itensPor.set(f.id, await itensDoFornecedor(f.id));
  const comItens = fornsAtivos.filter((f) => (itensPor.get(f.id)?.length ?? 0) > 0);
  const linhas = cot?.fornecedores ?? [];
  const responderam = linhas.filter((l) => l.status === "respondeu" || l.status === "completo").length;
  const status = statusWhats(), tudoLigado = status.every((s) => s.ok);
  const exemplo = comItens[0];

  // comparativo: preços desta semana por item
  const porItem = new Map<number, { nome: string; unidade: string; ofertas: { forn: string; preco: number; status: string }[] }>();
  for (const l of linhas) for (const p of l.precos) {
    const e = porItem.get(p.itemId) ?? { nome: p.item.nome, unidade: p.item.unidade, ofertas: [] };
    e.ofertas.push({ forn: l.fornecedor.nome, preco: p.preco, status: p.status });
    porItem.set(p.itemId, e);
  }

  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="cotacao" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}

      <p className="suave">
        Nos dias que você escolher (até toda semana), o Sambot pergunta no WhatsApp o preço do que cada fornecedor vende. Ele conversa como gente, entende áudio, foto e PDF de tabela, e anota os preços aqui como <b>a conferir</b>.
        Você confirma com um toque e o preço entra no sistema: na aba do fornecedor e, quando ele é o fornecedor principal do item, no histórico de 30/60/90 dias em Preços.
      </p>

      {!tudoLigado && (
        <div className="card" style={{ borderLeft: "4px solid var(--acento)" }}>
          <b>O que falta para o Sambot mandar e responder sozinho</b>
          <ul style={{ margin: "10px 0 6px", paddingLeft: 20, lineHeight: 1.8 }}>
            {status.map((s) => <li key={s.nome}>{s.ok ? "✅" : "⬜"} {s.nome}</li>)}
          </ul>
          <span className="suave">Enquanto isso, tudo já funciona à mão: abra a cotação, pergunte pelo seu WhatsApp e cole a resposta do fornecedor em <b>Lançar resposta</b>. {iaLigada() ? "A inteligência lê os preços." : "O sistema procura o nome do material e o preço ao lado."}</span>
        </div>
      )}

      <div className="grade">
        <div className="kpi"><div className="suave">Cotação da semana de</div><div className="v" style={{ fontSize: "1.3rem" }}>{dataDia(semana)}</div><div className="r">{cot ? "cotação aberta" : "ainda não aberta"}</div></div>
        <div className="kpi"><div className="suave">Fornecedores na cotação</div><div className="v">{linhas.length || comItens.length}</div><div className="r">com matéria-prima cadastrada</div></div>
        <div className="kpi"><div className="suave">Responderam</div><div className="v">{responderam}</div><div className="r">de {linhas.length || "—"}</div></div>
        <a className="kpi" href="#conferir"><div className="suave">Preços a conferir</div><div className="v" style={{ color: aConferir.length ? "var(--acento-escuro)" : undefined }}>{aConferir.length}</div><div className="r">toque para ver</div></a>
      </div>

      {edita && (
        <div className="card">
          <div className="acoes" style={{ justifyContent: "space-between" }}>
            <form action={acao}><input type="hidden" name="a" value="abrir" /><button className="btn destaque">{cot ? "Mandar para quem ainda não recebeu" : "Fazer cotação agora"}</button></form>
            <form action={acao} className="acoes">
              <input type="hidden" name="a" value="auto" />
              <label style={{ flexDirection: "row", alignItems: "center" }}>Cotação automática
                <select name="vezes" defaultValue={String(auto.vezes)}>
                  <option value="0">Desligada (só pelo botão)</option>
                  <option value="1">1 vez por mês</option>
                  <option value="2">2 vezes por mês</option>
                  <option value="4">Toda semana (4 por mês)</option>
                </select>
              </label>
              <label style={{ flexDirection: "row", alignItems: "center" }}>no dia
                <select name="dia" defaultValue={String(auto.diaSemana)}>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{DIAS_SEMANA[d]}</option>)}</select>
              </label>
              <button className="btn sec peq">Salvar</button>
            </form>
          </div>
          <p className="suave" style={{ margin: "10px 0 0" }}>
            {auto.vezes ? <>Próximas cotações às 8h: <b>{proximasCotacoes(auto).map((d) => dataDia(d)).join(", ")}</b>. Dois dias depois, o Sambot lembra uma vez quem não respondeu.{!whatsLigado() && " (Começa a mandar sozinho quando o WhatsApp for ligado.)"}</> : "Sem cotação automática. Use o botão sempre que quiser atualizar os preços."}
          </p>
          {exemplo && (
            <details style={{ marginTop: 12 }}>
              <summary className="suave" style={{ cursor: "pointer" }}>Ver a mensagem que o fornecedor recebe</summary>
              <div className="bolha saida" style={{ marginTop: 10 }}>{textoPedidoCotacao(primeiroNome(exemplo.contato) || exemplo.nome, itensPor.get(exemplo.id) ?? [])}</div>
            </details>
          )}
        </div>
      )}

      <h2 id="conferir">Preços a conferir</h2>
      {aConferir.length === 0 ? <div className="card suave">Nenhum preço esperando conferência.</div> : (
        <div className="card tabela">
          <table>
            <thead><tr><th>Item</th><th>Fornecedor</th><th className="n">Preço novo</th><th className="n">Preço de antes</th><th className="n">Diferença</th><th>Como ele escreveu</th>{edita && <th></th>}</tr></thead>
            <tbody>{aConferir.map((p) => {
              const f = p.cotacaoFornecedor.fornecedor;
              const antes = p.item.ofertas.find((o) => o.fornecedorId === f.id)?.preco ?? (p.item.fornecedorId === f.id ? p.item.precoCompra : null) ?? p.item.precoCompra;
              return (
                <tr key={p.id}>
                  <td>
                    <span className="com-foto">{p.item.foto && <img src={p.item.foto} alt="" width={32} height={32} style={{ borderRadius: 6, objectFit: "cover", verticalAlign: "middle", marginRight: 8 }} />}<b>{p.item.nome}</b></span>
                    {p.item.fornecedorId === f.id && <span className="selo ok" style={{ marginLeft: 6 }}>principal</span>}
                  </td>
                  <td>{f.nome}{p.prazoEntregaDias != null && <div className="suave" style={{ fontSize: ".8rem" }}>entrega em {p.prazoEntregaDias} dias</div>}</td>
                  <td className="n"><b>{r$(p.preco)}</b>/{p.item.unidade}</td>
                  <td className="n">{antes != null ? <>{r$(antes)}/{p.item.unidade}</> : "—"}</td>
                  <td className="n"><Dif novo={p.preco} antigo={antes} /></td>
                  <td><span className="suave">“{p.precoInformado ?? p.textoOriginal?.slice(0, 60)}”</span>{p.observacao && <div className="suave" style={{ fontSize: ".8rem" }}>{p.observacao}</div>}</td>
                  {edita && (
                    <td>
                      <div className="acoes" style={{ flexWrap: "nowrap" }}>
                        <form action={acao}><input type="hidden" name="a" value="confirmar" /><input type="hidden" name="id" value={p.id} /><button className="btn peq">Confirmar</button></form>
                        <details className="corrigir">
                          <summary className="btn sec peq">Corrigir</summary>
                          <form action={acao} className="acoes" style={{ marginTop: 6 }}><input type="hidden" name="a" value="corrigir" /><input type="hidden" name="id" value={p.id} /><input name="preco" inputMode="decimal" defaultValue={String(p.preco).replace(".", ",")} style={{ width: 110 }} /><button className="btn sec peq">Salvar</button></form>
                        </details>
                        <form action={acao}><input type="hidden" name="a" value="descartar" /><input type="hidden" name="id" value={p.id} /><button className="btn sec peq">Descartar</button></form>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}</tbody>
          </table>
          {edita && aConferir.length > 1 && <form action={acao} style={{ padding: 12 }}><input type="hidden" name="a" value="confirmar-todos" /><button className="btn">Confirmar todos ({aConferir.length})</button></form>}
        </div>
      )}

      {porItem.size > 0 && (
        <>
          <h2>Comparativo da semana</h2>
          <div className="card tabela">
            <table>
              <thead><tr><th>Item</th><th>Melhor preço</th><th>Outros</th></tr></thead>
              <tbody>{[...porItem.entries()].map(([id, e]) => {
                const ord = [...e.ofertas].sort((a, b) => a.preco - b.preco);
                return (
                  <tr key={id}>
                    <td><b>{e.nome}</b></td>
                    <td><span className="selo ok">{ord[0].forn} · {r$(ord[0].preco)}/{e.unidade}</span></td>
                    <td className="suave">{ord.slice(1).map((o) => `${o.forn} ${r$(o.preco)}`).join(" · ") || "só um fornecedor respondeu"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      )}

      <h2 id="fornecedores">Fornecedores</h2>
      <div className="card tabela">
        <table>
          <thead><tr><th>Fornecedor</th><th>O que é cotado</th><th>WhatsApp</th><th>Situação</th>{edita && <th></th>}</tr></thead>
          <tbody>{comItens.map((f) => {
            const l = linhas.find((x) => x.fornecedorId === f.id);
            const [rot, cls] = l ? STATUS[l.status] ?? [l.status, ""] : ["Fora da cotação desta semana", ""];
            const numero = f.whatsapp || f.telefone;
            const itens = itensPor.get(f.id) ?? [];
            return (
              <tr key={f.id}>
                <td><Link href={`/compras/fornecedores/${f.id}`}>{f.nome}</Link>{f.contato && <div className="suave" style={{ fontSize: ".8rem" }}>{f.contato}</div>}</td>
                <td className="suave" style={{ maxWidth: 280 }}>{itens.map((i) => i.nome).join(", ")}</td>
                <td>{numero ? <Link href={`/compras/whatsapp?tel=${numeroWhats(numero)}`}>{numero}</Link> : <span className="selo alerta">sem número</span>}</td>
                <td>
                  <span className={`selo ${cls}`}>{rot}</span>
                  {l?.respondidoEm && <div className="suave" style={{ fontSize: ".8rem" }}>respondeu {dataHora(l.respondidoEm)}</div>}
                  {l?.erro && l.status !== "sem_whats" && <div className="suave" style={{ fontSize: ".8rem", color: "var(--erro)" }}>{l.erro}</div>}
                </td>
                {edita && (
                  <td>
                    <div className="acoes">
                      <details>
                        <summary className="btn sec peq">Lançar resposta</summary>
                        <form action={acao} style={{ marginTop: 8, display: "grid", gap: 8, minWidth: 260 }}>
                          <input type="hidden" name="a" value="resposta" /><input type="hidden" name="fornecedorId" value={f.id} />
                          <textarea name="texto" rows={4} placeholder={`Cole aqui o que ${primeiroNome(f.contato) || f.nome} respondeu`} style={{ paddingTop: 10 }} required />
                          <button className="btn peq">Ler os preços</button>
                        </form>
                      </details>
                      {l && whatsLigado() && l.status !== "completo" && <form action={acao}><input type="hidden" name="a" value="reenviar" /><input type="hidden" name="cf" value={l.id} /><button className="btn sec peq">Reenviar</button></form>}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}</tbody>
        </table>
        {comItens.length === 0 && <p className="suave" style={{ padding: 12 }}>Nenhum fornecedor com matéria-prima cadastrada. Cadastre o que cada um vende na aba Fornecedores.</p>}
      </div>
    </>
  );
}
