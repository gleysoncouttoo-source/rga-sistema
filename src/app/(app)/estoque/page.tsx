import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { custoMaterial, saldos } from "@/lib/planejamento";
import { brl, qtd } from "@/lib/formato";
import { TIPOS } from "@/lib/rotulos";
import { acaoExcluirItem } from "@/lib/acoesProdutos";
import Excluir from "@/components/Excluir";
import IrPara from "@/components/IrPara";

async function novoItem(form: FormData) {
  "use server";
  const u = await exigir("estoque", "criar");
  const nome = String(form.get("nome") || "").trim();
  const tipo = String(form.get("tipo"));
  if (!nome) redirect("/estoque?erro=" + encodeURIComponent("Informe o nome."));
  let id = 0;
  try {
    const it = await db.item.create({
      data: {
        nome, tipo, codigo: String(form.get("codigo") || "").trim() || null, unidade: String(form.get("unidade") || "un"),
        origem: ["produto", "conjunto"].includes(tipo) ? "fabricado" : String(form.get("origem") || "comprado"),
      },
    });
    id = it.id;
  } catch {
    redirect("/estoque?erro=" + encodeURIComponent("Já existe um item com esse código."));
  }
  await auditar(u.nome, "criou item de estoque", nome);
  redirect(`/estoque/${id}`);
}

const ABAS = ["produto", "conjunto", "peca", "materia_prima", "insumo"];
const OUTROS = ["insumo", "conjunto", "peca", "materia_prima"];

export default async function Estoque({ searchParams }: { searchParams: Promise<{ tipo?: string; erro?: string; ok?: string; baixo?: string }> }) {
  const u = await exigir("estoque");
  const sp = await searchParams;
  // Estoque final = produtos prontos para venda (na caixa, só enviar). Os outros itens ficam na lista "Mostrar".
  const tipo = sp.tipo && ABAS.includes(sp.tipo) ? sp.tipo : sp.baixo ? undefined : "produto";
  const final = tipo === "produto";
  const [todos, sal] = await Promise.all([
    db.item.findMany({ where: { ativo: true }, include: { componentes: true, fornecedor: true }, orderBy: [{ codigo: "asc" }, { nome: "asc" }] }),
    saldos(),
  ]);
  const mapa = new Map(todos.map((i) => [i.id, i]));
  const abaixo = todos.filter((i) => i.estoqueMinimo > 0 && (sal.get(i.id)?.disponivel ?? 0) + (sal.get(i.id)?.aCaminho ?? 0) < i.estoqueMinimo);
  const lista = sp.baixo ? abaixo : todos.filter((i) => i.tipo === tipo);
  const exclui = pode(u.permissoes, "estoque", "excluir");
  return (
    <>
      <h1>{final ? "Estoque final" : sp.baixo ? "Itens abaixo do mínimo" : `Outros itens · ${TIPOS[tipo!]}`}</h1>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <div className="topo" style={{ alignItems: "flex-end" }}>
        <p className="suave" style={{ margin: 0, maxWidth: 640 }}>
          {final ? <>Produtos prontos para a venda, já na caixa, só enviar. <b>Disponível</b> = estoque menos o que já está separado para pedidos.</> : <><b>Disponível</b> = estoque físico menos o que já está separado para pedidos de venda. <b>A caminho</b> = compras lançadas ainda não recebidas.</>}
        </p>
        <IrPara rotulo="Mostrar" valor={sp.baixo ? "/estoque?baixo=1" : `/estoque?tipo=${tipo}`} opcoes={[
          { href: "/estoque?tipo=produto", nome: `Produtos prontos (${todos.filter((i) => i.tipo === "produto").length})` },
          ...OUTROS.map((t) => ({ href: `/estoque?tipo=${t}`, nome: `${TIPOS[t]} (${todos.filter((i) => i.tipo === t).length})` })),
          ...(abaixo.length ? [{ href: "/estoque?baixo=1", nome: `Abaixo do mínimo (${abaixo.length})` }] : []),
        ]} />
      </div>
      {abaixo.length > 0 && !sp.baixo && <div className="aviso alerta">{abaixo.length} item(ns) abaixo do estoque mínimo. <Link href="/estoque?baixo=1">Ver</Link></div>}
      {final ? (
        <div className="card tabela">
          <table>
            <thead><tr><th>Produto</th><th className="n">Na caixa</th><th className="n so-pc">Separado p/ pedidos</th><th className="n">Disponível p/ enviar</th><th className="n so-pc">Mínimo</th><th className="n so-pc">Custo un.</th>{exclui && <th className="so-pc"></th>}</tr></thead>
            <tbody>{lista.map((i) => {
              const s = sal.get(i.id)!;
              return (
                <tr key={i.id}>
                  <td><Link href={`/estoque/${i.id}`} className="com-foto" style={{ color: "inherit", textDecoration: "none" }}><span className="mini">{i.foto ? <img src={i.foto} alt="" /> : "sem foto"}</span><span className="t"><b style={{ whiteSpace: "nowrap" }}>{i.codigo ?? "sem SKU"}</b><small>{i.nome}</small></span></Link></td>
                  <td className="n">{qtd(s.estoque, i.unidade)}</td>
                  <td className="n so-pc">{s.reservado ? qtd(s.reservado, i.unidade) : "—"}</td>
                  <td className="n"><b style={{ color: s.disponivel < 0 ? "var(--erro)" : undefined }}>{qtd(s.disponivel, i.unidade)}</b></td>
                  <td className="n so-pc">{i.estoqueMinimo ? qtd(i.estoqueMinimo, i.unidade) : "—"}</td>
                  <td className="n so-pc">{brl(custoMaterial(i.id, mapa), 2)}</td>
                  {exclui && <td className="so-pc"><Excluir acao={acaoExcluirItem} campos={{ id: i.id, volta: `/estoque?tipo=produto` }} pergunta={`Excluir ${i.nome}?`} /></td>}
                </tr>
              );
            })}</tbody>
          </table>
          {lista.length === 0 && <p className="suave">Nenhum produto cadastrado. Cadastre em Produtos.</p>}
        </div>
      ) : (
      <div className="card tabela">
        <table>
          <thead><tr><th>Código</th><th>Item</th><th className="n">Estoque</th><th className="n">Reservado</th><th className="n">Disponível</th><th className="n">A caminho</th><th className="n">Mínimo</th><th className="n">Custo un.</th><th>Fornecedor</th>{exclui && <th></th>}</tr></thead>
          <tbody>{lista.map((i) => {
            const s = sal.get(i.id)!;
            return (
              <tr key={i.id}>
                <td className="suave">{i.codigo}</td>
                <td><Link href={`/estoque/${i.id}`}>{i.nome}</Link>{i.origem === "fabricado" && <span className="suave"> · {i.setor ?? "fabricado"}</span>}</td>
                <td className="n">{qtd(s.estoque, i.unidade)}</td>
                <td className="n">{s.reservado ? qtd(s.reservado, i.unidade) : "—"}</td>
                <td className="n"><b style={{ color: s.disponivel < 0 ? "var(--erro)" : undefined }}>{qtd(s.disponivel, i.unidade)}</b></td>
                <td className="n">{s.aCaminho ? qtd(s.aCaminho, i.unidade) : "—"}</td>
                <td className="n">{i.estoqueMinimo ? qtd(i.estoqueMinimo, i.unidade) : "—"}</td>
                <td className="n">{brl(custoMaterial(i.id, mapa), i.unidade === "un" && !i.componentes.length ? 2 : 2)}</td>
                <td>{i.origem === "comprado" ? (i.fornecedor?.nome ?? <span className="selo alerta">sem fornecedor</span>) : <span className="suave">—</span>}</td>
                {exclui && <td><Excluir acao={acaoExcluirItem} campos={{ id: i.id, volta: `/estoque?tipo=${i.tipo}` }} pergunta={`Excluir ${i.nome}?`} /></td>}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      )}
      {pode(u.permissoes, "estoque", "criar") && !final && (
        <div className="card">
          <b>Novo item</b>
          <form action={novoItem} className="campos" style={{ marginTop: 12 }}>
            <label>Nome<input name="nome" required /></label>
            <label>Código<input name="codigo" /></label>
            <label>Tipo<select name="tipo" defaultValue={final ? "insumo" : tipo ?? "insumo"}>{ABAS.map((t) => <option key={t} value={t}>{TIPOS[t]}</option>)}</select></label>
            <label>Origem<select name="origem"><option value="comprado">Comprado</option><option value="fabricado">Fabricado aqui</option></select></label>
            <label>Unidade<select name="unidade"><option>un</option><option>kg</option><option>m</option><option>L</option></select></label>
            <div className="inteiro"><button className="btn">Criar e configurar</button></div>
          </form>
        </div>
      )}
    </>
  );
}
