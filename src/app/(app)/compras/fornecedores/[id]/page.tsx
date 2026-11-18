import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { lerPrazos } from "@/lib/planejamento";
import { registrarPreco } from "@/lib/precos";
import { dia } from "@/lib/datas";
import { brl, data, qtd } from "@/lib/formato";
import { TIPOS } from "@/lib/rotulos";
import AbasCompras from "@/components/AbasCompras";
import CampoFoto from "@/components/CampoFoto";
import Excluir from "@/components/Excluir";
import IrPara from "@/components/IrPara";

/** Número digitado do jeito brasileiro: "9,50", "1.000", "1.000,5" ou "9.5". */
const nn = (v: FormDataEntryValue | null) => {
  let s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 1.000 = mil
  const x = Number(s);
  return Number.isFinite(x) && x >= 0 ? x : null;
};
const txt = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;
const prazoPg = (v: FormDataEntryValue | null) => (txt(v) ? lerPrazos(String(v)).join("/") : null);
const prazoEnt = (v: FormDataEntryValue | null) => { const x = nn(v); return x == null ? null : Math.round(x); };
const volta = (id: number, k: "ok" | "erro", m: string): never => redirect(`/compras/fornecedores/${id}?${k}=` + encodeURIComponent(m));

/** O fornecedor principal do item é o que as compras usam: o preço e a compra mínima dele vão para o cadastro do item. */
async function sincronizarItem(fornecedorId: number, itemId: number, usuario: string) {
  const [of, it] = await Promise.all([
    db.fornecedorItem.findUnique({ where: { fornecedorId_itemId: { fornecedorId, itemId } } }),
    db.item.findUniqueOrThrow({ where: { id: itemId } }),
  ]);
  if (!of || it.fornecedorId !== fornecedorId) return;
  await db.item.update({ where: { id: itemId }, data: { loteMinimo: of.compraMinima } });
  if (of.preco != null && of.preco !== it.precoCompra) {
    await db.$transaction((tx) => registrarPreco(tx, { itemId, preco: of.preco!, data: dia(), origem: "manual", fornecedorId, usuario }));
  }
}

async function salvarDados(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const id = Number(form.get("id"));
  const nome = String(form.get("nome") || "").trim();
  if (!nome) volta(id, "erro", "Informe o nome.");
  await db.fornecedor.update({
    where: { id },
    data: {
      nome, cnpj: txt(form.get("cnpj")), contato: txt(form.get("contato")), telefone: txt(form.get("telefone")), email: txt(form.get("email")),
      chavePix: txt(form.get("chavePix")), banco: txt(form.get("bancoDados")), observacao: txt(form.get("obs")),
      prazoPagamento: lerPrazos(String(form.get("prazoPagamento"))).join("/"), prazoEntregaDias: prazoEnt(form.get("prazoEntregaDias")) ?? 0,
    },
  });
  await auditar(u.nome, "editou fornecedor", nome);
  revalidatePath("/compras/fornecedores");
  volta(id, "ok", "Dados salvos.");
}

async function excluir(form: FormData) {
  "use server";
  const u = await exigir("compras", "excluir");
  const id = Number(form.get("id"));
  const f = await db.fornecedor.findUniqueOrThrow({ where: { id }, include: { _count: { select: { pedidos: true, precos: true, boletos: true } } } });
  await db.item.updateMany({ where: { fornecedorId: id }, data: { fornecedorId: null } });
  await db.fornecedorItem.deleteMany({ where: { fornecedorId: id } });
  if (f._count.pedidos + f._count.precos + f._count.boletos === 0) await db.fornecedor.delete({ where: { id } });
  else await db.fornecedor.update({ where: { id }, data: { ativo: false } });
  await auditar(u.nome, "excluiu fornecedor", f.nome);
  revalidatePath("/compras/fornecedores");
  redirect("/compras/fornecedores?ok=" + encodeURIComponent(`${f.nome} excluído.`));
}

async function adicionar(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const fornecedorId = Number(form.get("id")), itemId = Number(form.get("itemId"));
  if (!itemId) volta(fornecedorId, "erro", "Escolha a matéria-prima na lista.");
  const it = await db.item.findUniqueOrThrow({ where: { id: itemId } });
  const dados = {
    preco: nn(form.get("preco")), prazoPagamento: prazoPg(form.get("prazoPagamento")), prazoEntregaDias: prazoEnt(form.get("prazoEntregaDias")),
    compraMinima: nn(form.get("compraMinima")), observacao: txt(form.get("obs")),
  };
  await db.fornecedorItem.upsert({ where: { fornecedorId_itemId: { fornecedorId, itemId } }, update: dados, create: { fornecedorId, itemId, ...dados } });
  // item sem fornecedor passa a comprar deste
  if (!it.fornecedorId) await db.item.update({ where: { id: itemId }, data: { fornecedorId } });
  await sincronizarItem(fornecedorId, itemId, u.nome);
  await auditar(u.nome, "ligou matéria-prima ao fornecedor", `${it.nome} → #${fornecedorId}`);
  revalidatePath(`/compras/fornecedores/${fornecedorId}`);
  volta(fornecedorId, "ok", `${it.nome} adicionada.`);
}

async function editar(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const of = await db.fornecedorItem.findUniqueOrThrow({ where: { id: Number(form.get("ofertaId")) }, include: { item: true } });
  await db.fornecedorItem.update({
    where: { id: of.id },
    data: { preco: nn(form.get("preco")), prazoPagamento: prazoPg(form.get("prazoPagamento")), prazoEntregaDias: prazoEnt(form.get("prazoEntregaDias")), compraMinima: nn(form.get("compraMinima")), observacao: txt(form.get("obs")) },
  });
  await sincronizarItem(of.fornecedorId, of.itemId, u.nome);
  revalidatePath(`/compras/fornecedores/${of.fornecedorId}`);
  volta(of.fornecedorId, "ok", `${of.item.nome} salva.`);
}

async function principal(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const of = await db.fornecedorItem.findUniqueOrThrow({ where: { id: Number(form.get("ofertaId")) }, include: { item: true, fornecedor: true } });
  await db.item.update({ where: { id: of.itemId }, data: { fornecedorId: of.fornecedorId } });
  await sincronizarItem(of.fornecedorId, of.itemId, u.nome);
  await auditar(u.nome, "trocou fornecedor principal", `${of.item.nome} → ${of.fornecedor.nome}`);
  revalidatePath(`/compras/fornecedores/${of.fornecedorId}`);
  volta(of.fornecedorId, "ok", `As próximas compras de ${of.item.nome} saem de ${of.fornecedor.nome}.`);
}

async function remover(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const of = await db.fornecedorItem.findUniqueOrThrow({ where: { id: Number(form.get("ofertaId")) }, include: { item: true } });
  await db.fornecedorItem.delete({ where: { id: of.id } });
  if (of.item.fornecedorId === of.fornecedorId) await db.item.update({ where: { id: of.itemId }, data: { fornecedorId: null } });
  await auditar(u.nome, "tirou matéria-prima do fornecedor", `${of.item.nome} ← #${of.fornecedorId}`);
  revalidatePath(`/compras/fornecedores/${of.fornecedorId}`);
  volta(of.fornecedorId, "ok", `${of.item.nome} tirada da lista.`);
}

const ORDEM_TIPO = ["materia_prima", "insumo", "peca", "conjunto", "produto"];

export default async function Fornecedor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigir("compras");
  const id = Number((await params).id);
  const sp = await searchParams;
  const f = await db.fornecedor.findUnique({
    where: { id },
    include: { ofertas: { where: { item: { ativo: true } }, include: { item: { include: { fornecedor: { select: { nome: true } } } } } } },
  });
  if (!f || !f.ativo) notFound();
  const [todos, compraveis, outras] = await Promise.all([
    db.fornecedor.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    db.item.findMany({ where: { ativo: true, origem: "comprado", tipo: { not: "produto" } }, include: { fornecedor: { select: { nome: true } } }, orderBy: { nome: "asc" } }),
    db.fornecedorItem.findMany({ where: { itemId: { in: f.ofertas.map((o) => o.itemId) }, fornecedorId: { not: id }, preco: { not: null }, fornecedor: { ativo: true } }, include: { fornecedor: { select: { nome: true } } } }),
  ]);
  const edita = pode(u.permissoes, "compras", "editar"), exclui = pode(u.permissoes, "compras", "excluir");
  const ofertas = [...f.ofertas].sort((a, b) => (ORDEM_TIPO.indexOf(a.item.tipo) - ORDEM_TIPO.indexOf(b.item.tipo)) || a.item.nome.localeCompare(b.item.nome));
  const jaTem = new Set(ofertas.map((o) => o.itemId));
  const opcoes = [...compraveis]
    .sort((a, b) => (ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo)) || a.nome.localeCompare(b.nome))
    .map((i) => ({
      valor: String(i.id), titulo: i.nome, foto: i.foto, grupo: TIPOS[i.tipo] ?? i.tipo, desativada: jaTem.has(i.id),
      sub: [i.codigo, i.unidade, jaTem.has(i.id) ? "já está na lista" : i.fornecedor ? `hoje compra de ${i.fornecedor.nome}` : "sem fornecedor"].filter(Boolean).join(" · "),
    }));
  const melhorOutro = (itemId: number) => outras.filter((o) => o.itemId === itemId).sort((a, b) => a.preco! - b.preco!)[0];

  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="fornecedores" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <div className="acoes" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <Link href="/compras/fornecedores" className="suave">← Todos os fornecedores</Link>
          <h2 style={{ margin: "4px 0 0" }}>{f.nome}</h2>
          <div className="suave">{[f.contato, f.telefone, f.email].filter(Boolean).join(" · ") || "sem contato cadastrado"}</div>
        </div>
        <IrPara rotulo="Fornecedor" valor={`/compras/fornecedores/${f.id}`} opcoes={todos.map((x) => ({ href: `/compras/fornecedores/${x.id}`, nome: x.nome }))} />
      </div>

      <div className="card tabela">
        <b>Matérias-primas que {f.nome} vende</b>
        <p className="suave" style={{ margin: "4px 0 10px" }}>Prazo em branco usa a condição geral do fornecedor ({f.prazoPagamento} dias para pagar, entrega em {f.prazoEntregaDias} dias). <b>Principal</b> = é deste fornecedor que o sistema sugere a compra.</p>
        {ofertas.length === 0 ? <p className="suave">Nenhuma matéria-prima ligada ainda. Adicione abaixo.</p> : (
          <>
          <div className="so-cel lista-cel">{ofertas.map((o) => {
            const it = o.item, outro = melhorOutro(it.id);
            return (
              <Link key={o.id} href={`/estoque/${it.id}`} className="cel-item">
                <span className="com-foto"><span className="mini">{it.foto ? <img src={it.foto} alt="" /> : "sem foto"}</span>
                  <span className="t"><b>{it.nome}</b><small>{it.fornecedorId === f.id ? "Principal" : it.fornecedor ? `hoje compra de ${it.fornecedor.nome}` : "sem principal"}</small></span></span>
                <span className="cel-dados">
                  <span><small>Preço</small>{o.preco != null ? `${brl(o.preco)}/${it.unidade}` : "—"}</span>
                  <span><small>Pagamento</small>{o.prazoPagamento ?? f.prazoPagamento} dias</span>
                  <span><small>Entrega</small>{o.prazoEntregaDias ?? f.prazoEntregaDias} dias</span>
                  <span><small>Mínima</small>{o.compraMinima ? qtd(o.compraMinima, it.unidade) : "—"}</span>
                </span>
                {outro && o.preco != null && outro.preco! < o.preco - 1e-9 && <small className="selo alerta">{outro.fornecedor.nome}: {brl(outro.preco)}</small>}
              </Link>
            );
          })}</div>
          <table className="so-pc">
            <thead><tr><th>Matéria-prima</th><th className="n">Preço</th><th>Pagamento</th><th>Entrega</th><th className="n">Compra mínima</th><th>Compras</th>{edita && <th></th>}</tr></thead>
            <tbody>{ofertas.map((o) => {
              const it = o.item, ehPrincipal = it.fornecedorId === f.id, outro = melhorOutro(it.id);
              return (
                <tr key={o.id}>
                  <td style={{ minWidth: 240 }}>
                    <Link href={`/estoque/${it.id}`} className="com-foto"><span className="mini">{it.foto ? <img src={it.foto} alt="" /> : "sem foto"}</span>
                      <span className="t"><b>{it.nome}</b><small>{[it.codigo, TIPOS[it.tipo]].filter(Boolean).join(" · ")}</small></span></Link>
                  </td>
                  <td className="n" style={{ whiteSpace: "nowrap" }}>
                    {o.preco != null ? <><b>{brl(o.preco)}</b><span className="suave">/{it.unidade}</span></> : <span className="suave">—</span>}
                    {outro && o.preco != null && (outro.preco! < o.preco - 1e-9
                      ? <div><small className="selo alerta">{outro.fornecedor.nome}: {brl(outro.preco)}</small></div>
                      : <div><small className="selo ok">menor preço</small></div>)}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{o.prazoPagamento ? `${o.prazoPagamento} dias` : <span className="suave">{f.prazoPagamento} dias (geral)</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{o.prazoEntregaDias != null ? `${o.prazoEntregaDias} dias` : <span className="suave">{f.prazoEntregaDias} dias (geral)</span>}</td>
                  <td className="n" style={{ whiteSpace: "nowrap" }}>{o.compraMinima ? qtd(o.compraMinima, it.unidade) : <span className="suave">—</span>}</td>
                  <td>
                    {ehPrincipal ? <span className="selo ok">Principal</span> : (
                      <>
                        <div className="suave" style={{ fontSize: ".8rem" }}>{it.fornecedor ? `hoje: ${it.fornecedor.nome}` : "sem principal"}</div>
                        {edita && <form action={principal}><input type="hidden" name="ofertaId" value={o.id} /><button className="btn sec peq" style={{ marginTop: 4, whiteSpace: "nowrap" }}>Comprar daqui</button></form>}
                      </>
                    )}
                  </td>
                  {edita && (
                    <td style={{ minWidth: 150 }}>
                      <details className="editar">
                        <summary>Editar</summary>
                        <form action={editar} className="campos" style={{ gridTemplateColumns: "1fr 1fr", minWidth: 280 }}>
                          <input type="hidden" name="ofertaId" value={o.id} />
                          <label>Preço (R$/{it.unidade})<input name="preco" inputMode="decimal" defaultValue={o.preco ?? ""} /></label>
                          <label>Compra mínima ({it.unidade})<input name="compraMinima" inputMode="decimal" defaultValue={o.compraMinima ?? ""} /></label>
                          <label>Pagamento (dias)<input name="prazoPagamento" defaultValue={o.prazoPagamento ?? ""} placeholder={`${f.prazoPagamento} (geral)`} /></label>
                          <label>Entrega (dias)<input name="prazoEntregaDias" type="number" min={0} defaultValue={o.prazoEntregaDias ?? ""} placeholder={`${f.prazoEntregaDias} (geral)`} /></label>
                          <label className="inteiro">Observação<input name="obs" defaultValue={o.observacao ?? ""} /></label>
                          <div className="inteiro"><button className="btn peq">Salvar</button></div>
                        </form>
                        <div style={{ marginTop: 6 }}><Excluir acao={remover} campos={{ ofertaId: o.id }} texto="Tirar da lista" pergunta={`Tirar ${it.nome} da lista de ${f.nome}?${ehPrincipal ? " Ele é o fornecedor principal: o item fica sem fornecedor." : ""}`} /></div>
                      </details>
                      <div className="suave" style={{ fontSize: ".75rem", marginTop: 4 }}>atualizado {data(o.atualizadoEm)}</div>
                    </td>
                  )}
                </tr>
              );
            })}</tbody>
          </table>
          </>
        )}
      </div>

      {edita && (
        <div className="card">
          <b>Adicionar matéria-prima</b>
          <form action={adicionar} className="campos" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={f.id} />
            <div className="inteiro"><label>Matéria-prima</label><CampoFoto name="itemId" opcoes={opcoes} placeholder="Escolha a matéria-prima" /></div>
            <label>Preço (R$ por unidade)<input name="preco" inputMode="decimal" placeholder="ex.: 9,50" /></label>
            <label>Prazo de pagamento (dias)<input name="prazoPagamento" placeholder={`${f.prazoPagamento} ou 28/42/56`} /></label>
            <label>Prazo de entrega (dias)<input name="prazoEntregaDias" type="number" min={0} placeholder={`${f.prazoEntregaDias}`} /></label>
            <label>Compra mínima<input name="compraMinima" inputMode="decimal" placeholder="ex.: 500 (na unidade do item)" /></label>
            <label className="inteiro">Observação<input name="obs" placeholder="ex.: frete grátis acima de 1 tonelada" /></label>
            <div className="inteiro"><button className="btn">Adicionar</button></div>
          </form>
          <p className="suave" style={{ marginBottom: 0 }}>Não achou na lista? Cadastre antes em <Link href="/materia-prima">Matéria-prima</Link>.</p>
        </div>
      )}

      <details className="card editar">
        <summary>Dados do fornecedor</summary>
        <form action={salvarDados} className="campos" style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={f.id} />
          <label>Nome<input name="nome" defaultValue={f.nome} required disabled={!edita} /></label>
          <label>CNPJ<input name="cnpj" defaultValue={f.cnpj ?? ""} disabled={!edita} /></label>
          <label>Contato<input name="contato" defaultValue={f.contato ?? ""} disabled={!edita} /></label>
          <label>Telefone / WhatsApp<input name="telefone" defaultValue={f.telefone ?? ""} disabled={!edita} /></label>
          <label>E-mail<input name="email" defaultValue={f.email ?? ""} disabled={!edita} /></label>
          <label>Chave Pix<input name="chavePix" defaultValue={f.chavePix ?? ""} disabled={!edita} /></label>
          <label>Banco / agência / conta<input name="bancoDados" defaultValue={f.banco ?? ""} disabled={!edita} /></label>
          <label>Prazo de pagamento geral (dias)<input name="prazoPagamento" defaultValue={f.prazoPagamento} placeholder="28 ou 28/42/56" disabled={!edita} /></label>
          <label>Prazo de entrega geral (dias)<input name="prazoEntregaDias" type="number" min={0} defaultValue={f.prazoEntregaDias} disabled={!edita} /></label>
          <label>Observação<input name="obs" defaultValue={f.observacao ?? ""} disabled={!edita} /></label>
          {edita && <div className="inteiro acoes"><button className="btn">Salvar dados</button></div>}
        </form>
        {exclui && <div style={{ marginTop: 10 }}><Excluir acao={excluir} campos={{ id: f.id }} texto="Excluir fornecedor" pergunta={`Excluir ${f.nome}? Os itens ligados ficam sem fornecedor.`} /></div>}
      </details>
    </>
  );
}
