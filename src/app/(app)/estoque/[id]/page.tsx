import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { custoMaterial, saldos } from "@/lib/planejamento";
import { registrarPreco } from "@/lib/precos";
import { dia } from "@/lib/datas";
import { brl, dataDia, dataHora, qtd } from "@/lib/formato";
import { TIPOS } from "@/lib/rotulos";

const n = (v: FormDataEntryValue | null) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };

async function salvar(form: FormData) {
  "use server";
  const u = await exigir("estoque", "editar");
  const id = Number(form.get("id"));
  const fornecedorId = Number(form.get("fornecedorId")) || null;
  const antes = await db.item.findUniqueOrThrow({ where: { id } });
  const novoPreco = form.get("precoCompra") ? n(form.get("precoCompra")) : null;
  await db.item.update({
    where: { id },
    data: {
      nome: String(form.get("nome")).trim(), unidade: String(form.get("unidade")), origem: String(form.get("origem")),
      estoqueMinimo: n(form.get("estoqueMinimo")), diasFabricacao: Math.max(0, Math.round(n(form.get("diasFabricacao")))),
      precoCompra: form.get("precoCompra") ? n(form.get("precoCompra")) : null, precoVenda: form.get("precoVenda") ? n(form.get("precoVenda")) : null,
      loteMinimo: form.get("loteMinimo") ? n(form.get("loteMinimo")) : null, fornecedorId, setor: String(form.get("setor") || "") || null, observacao: String(form.get("obs") || "") || null,
    },
  });
  // preço de compra alterado à mão entra no histórico de preços
  if (antes.origem === "comprado" && novoPreco && novoPreco !== antes.precoCompra) {
    await db.$transaction((tx) => registrarPreco(tx, { itemId: id, preco: novoPreco, data: dia(), origem: "manual", fornecedorId, usuario: u.nome }));
  }
  await auditar(u.nome, "editou item", `#${id}`);
  revalidatePath(`/estoque/${id}`);
}

async function movimentar(form: FormData) {
  "use server";
  const u = await exigir("estoque", "editar");
  const id = Number(form.get("id")), tipo = String(form.get("tipo")), q = n(form.get("qtd"));
  const motivo = String(form.get("motivo") || "").trim();
  const it = await db.item.findUniqueOrThrow({ where: { id } });
  const delta = tipo === "contagem" ? q - it.estoque : tipo === "saida" ? -q : q;
  if (delta === 0) redirect(`/estoque/${id}`);
  await db.$transaction([
    db.item.update({ where: { id }, data: { estoque: { increment: delta } } }),
    db.movimentoEstoque.create({ data: { itemId: id, quantidade: delta, usuario: u.nome, motivo: motivo || (tipo === "contagem" ? "Contagem de estoque" : tipo === "saida" ? "Saída manual" : "Entrada manual") } }),
  ]);
  revalidatePath(`/estoque/${id}`);
}

async function componente(form: FormData) {
  "use server";
  await exigir("estoque", "editar");
  const paiId = Number(form.get("id")), filhoId = Number(form.get("filhoId")), q = n(form.get("quantidade"));
  if (form.get("remover")) await db.componente.delete({ where: { paiId_filhoId: { paiId, filhoId } } });
  else if (filhoId && q > 0 && filhoId !== paiId) await db.componente.upsert({ where: { paiId_filhoId: { paiId, filhoId } }, update: { quantidade: q }, create: { paiId, filhoId, quantidade: q } });
  revalidatePath(`/estoque/${paiId}`);
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigir("estoque");
  const id = Number((await params).id);
  const [it, todos, fornecedores, sal] = await Promise.all([
    db.item.findUnique({
      where: { id },
      include: {
        componentes: { include: { filho: true }, orderBy: { filho: { nome: "asc" } } },
        usadoEm: { include: { pai: true } },
        movimentos: { orderBy: { criadoEm: "desc" }, take: 15 },
        precos: { include: { fornecedor: true }, orderBy: { data: "desc" }, take: 20 },
        reservas: { include: { pedidoVenda: true } },
      },
    }),
    db.item.findMany({ where: { ativo: true }, include: { componentes: true }, orderBy: [{ tipo: "asc" }, { nome: "asc" }] }),
    db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    saldos(),
  ]);
  if (!it) notFound();
  const mapa = new Map(todos.map((i) => [i.id, i]));
  const s = sal.get(id)!;
  const edita = pode(u.permissoes, "estoque", "editar");
  return (
    <>
      <div className="topo">
        <div>
          <h1 style={{ margin: 0 }}>{it.nome}</h1>
          <span className="suave">{it.codigo} · {TIPOS[it.tipo]} · {it.origem === "fabricado" ? `fabricado aqui${it.setor ? ` (${it.setor})` : ""}` : "comprado"}</span>
        </div>
        <Link className="btn sec" href={`/estoque?tipo=${it.tipo}`}>Voltar</Link>
      </div>
      <div className="grade">
        <div className="kpi"><div className="r">Estoque</div><div className="v">{qtd(s.estoque, it.unidade)}</div></div>
        <div className="kpi"><div className="r">Reservado p/ pedidos</div><div className="v">{qtd(s.reservado, it.unidade)}</div></div>
        <div className="kpi"><div className="r">Disponível</div><div className="v">{qtd(s.disponivel, it.unidade)}</div></div>
        <div className="kpi"><div className="r">A caminho</div><div className="v">{qtd(s.aCaminho, it.unidade)}</div></div>
        <div className="kpi"><div className="r">Custo de material</div><div className="v">{brl(custoMaterial(id, mapa), it.unidade === "kg" ? 2 : 3)}</div><div className="r">por {it.unidade}</div></div>
      </div>
      {it.observacao && <div className="aviso alerta">{it.observacao}</div>}

      {edita && (
        <div className="card">
          <b>Entrada, saída ou contagem</b>
          <form action={movimentar} className="linha-form" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={id} />
            <label>Tipo<select name="tipo"><option value="entrada">Entrada (+)</option><option value="saida">Saída (−)</option><option value="contagem">Contagem (fica igual a)</option></select></label>
            <label>Quantidade ({it.unidade})<input name="qtd" inputMode="decimal" required /></label>
            <label>Motivo<input name="motivo" placeholder="opcional" /></label>
            <button className="btn">Lançar</button>
          </form>
        </div>
      )}

      {(it.origem === "fabricado" || it.componentes.length > 0) && (
        <>
          <h2>Estrutura: o que vai em 1 {it.unidade}</h2>
          <div className="card tabela">
            {it.componentes.length === 0 && <p className="suave">Sem estrutura cadastrada. Adicione as peças ou matérias-primas para o sistema conferir o estoque delas nos pedidos.</p>}
            {it.componentes.length > 0 && (
              <table>
                <thead><tr><th>Componente</th><th>Tipo</th><th className="n">Quantidade</th><th className="n">Custo</th><th className="n">Disponível</th>{edita && <th></th>}</tr></thead>
                <tbody>{it.componentes.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/estoque/${c.filhoId}`}>{c.filho.nome}</Link></td>
                    <td className="suave">{TIPOS[c.filho.tipo]}</td>
                    <td className="n">{qtd(c.quantidade, c.filho.unidade)}</td>
                    <td className="n">{brl(c.quantidade * custoMaterial(c.filhoId, mapa), 3)}</td>
                    <td className="n">{qtd(sal.get(c.filhoId)?.disponivel, c.filho.unidade)}</td>
                    {edita && <td><form action={componente}><input type="hidden" name="id" value={id} /><input type="hidden" name="filhoId" value={c.filhoId} /><input type="hidden" name="remover" value="1" /><button className="btn sec peq">Remover</button></form></td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
            {edita && (
              <form action={componente} className="linha-form" style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={id} />
                <label>Adicionar componente<select name="filhoId">{todos.filter((x) => x.id !== id && x.tipo !== "produto").map((x) => <option key={x.id} value={x.id}>{TIPOS[x.tipo]} — {x.nome} ({x.unidade})</option>)}</select></label>
                <label style={{ flex: "0 1 140px" }}>Quantidade<input name="quantidade" inputMode="decimal" required /></label>
                <button className="btn sec">Adicionar</button>
              </form>
            )}
          </div>
        </>
      )}

      {edita && (
        <>
          <h2>Cadastro</h2>
          <div className="card">
            <form action={salvar} className="campos">
              <input type="hidden" name="id" value={id} />
              <label>Nome<input name="nome" defaultValue={it.nome} required /></label>
              <label>Origem<select name="origem" defaultValue={it.origem}><option value="comprado">Comprado</option><option value="fabricado">Fabricado aqui</option></select></label>
              <label>Unidade<select name="unidade" defaultValue={it.unidade}><option>un</option><option>kg</option><option>m</option><option>L</option></select></label>
              <label>Estoque mínimo<input name="estoqueMinimo" inputMode="decimal" defaultValue={it.estoqueMinimo || ""} /></label>
              <label>Setor que produz<select name="setor" defaultValue={it.setor ?? ""}><option value="">—</option>{["Estamparia", "Solda", "Injeção", "Usinagem", "Polimento", "Banho de zinco", "Montagem"].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label>Dias para fabricar/montar<input name="diasFabricacao" type="number" min={0} defaultValue={it.diasFabricacao} /></label>
              <label>{it.origem === "comprado" ? "Preço de compra atual (R$)" : "Custo informado (R$, se não tiver estrutura)"}<input name="precoCompra" inputMode="decimal" defaultValue={it.precoCompra ?? ""} /></label>
              {it.tipo === "produto" && <label>Valor de venda (R$)<input name="precoVenda" inputMode="decimal" defaultValue={it.precoVenda ?? ""} /></label>}
              <label>Fornecedor<select name="fornecedorId" defaultValue={it.fornecedorId ?? ""}><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
              <label>Lote mínimo de compra<input name="loteMinimo" inputMode="decimal" defaultValue={it.loteMinimo ?? ""} /></label>
              <label className="inteiro">Observação<input name="obs" defaultValue={it.observacao ?? ""} /></label>
              <div className="inteiro"><button className="btn">Salvar</button></div>
            </form>
          </div>
        </>
      )}

      {it.reservas.length > 0 && (
        <>
          <h2>Reservado para</h2>
          <div className="card tabela"><table><tbody>{it.reservas.map((r) => (
            <tr key={r.id}><td><Link href={`/vendas/${r.pedidoVendaId}`}>Pedido #{r.pedidoVendaId}</Link> — {r.pedidoVenda.cliente}</td><td className="n">{qtd(r.quantidade, it.unidade)}</td></tr>
          ))}</tbody></table></div>
        </>
      )}
      {it.usadoEm.length > 0 && (
        <p className="suave">Usado em: {it.usadoEm.slice(0, 12).map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/estoque/${c.paiId}`}>{c.pai.nome}</Link></span>)}{it.usadoEm.length > 12 && ` e mais ${it.usadoEm.length - 12}`}</p>
      )}
      {it.precos.length > 0 && (
        <>
          <h2>Histórico de preços</h2>
          <div className="card tabela"><table>
            <thead><tr><th>Data</th><th>Fornecedor</th><th>Origem</th><th className="n">Preço</th></tr></thead>
            <tbody>{it.precos.map((h) => (
              <tr key={h.id}><td>{dataDia(h.data)}</td><td>{h.fornecedor?.nome ?? "—"}</td><td className="suave">{h.origem}{h.pedidoCompraId ? ` #${h.pedidoCompraId}` : ""}</td><td className="n"><b>{brl(h.preco, h.preco < 1 ? 3 : 2)}</b></td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
      <h2>Movimentações</h2>
      <div className="card tabela">
        {it.movimentos.length === 0 ? <p className="suave">Nenhuma movimentação.</p> : (
          <table><tbody>{it.movimentos.map((m) => (
            <tr key={m.id}><td>{dataHora(m.criadoEm)}</td><td>{m.motivo}</td><td className="suave">{m.usuario}</td><td className="n"><b>{m.quantidade > 0 ? "+" : ""}{qtd(m.quantidade, it.unidade)}</b></td></tr>
          ))}</tbody></table>
        )}
      </div>
    </>
  );
}
