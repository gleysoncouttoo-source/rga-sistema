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

export default async function Estoque({ searchParams }: { searchParams: Promise<{ tipo?: string; erro?: string; ok?: string; baixo?: string }> }) {
  const u = await exigir("estoque");
  const sp = await searchParams;
  const tipo = sp.tipo && ABAS.includes(sp.tipo) ? sp.tipo : sp.baixo ? undefined : "materia_prima";
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
      <h1>Estoque final</h1>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {abaixo.length > 0 && !sp.baixo && <div className="aviso alerta">{abaixo.length} item(ns) abaixo do estoque mínimo. <Link href="/estoque?baixo=1">Ver</Link></div>}
      <div className="abas">
        {ABAS.map((t) => <a key={t} href={`/estoque?tipo=${t}`} className={tipo === t ? "ativo" : ""}>{TIPOS[t]} ({todos.filter((i) => i.tipo === t).length})</a>)}
        {abaixo.length > 0 && <a href="/estoque?baixo=1" className={sp.baixo ? "ativo" : ""}>Abaixo do mínimo ({abaixo.length})</a>}
      </div>
      <p className="suave"><b>Disponível</b> = estoque físico menos o que já está separado para pedidos de venda. <b>A caminho</b> = compras lançadas ainda não recebidas.</p>
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
      {pode(u.permissoes, "estoque", "criar") && (
        <div className="card">
          <b>Novo item</b>
          <form action={novoItem} className="campos" style={{ marginTop: 12 }}>
            <label>Nome<input name="nome" required /></label>
            <label>Código<input name="codigo" /></label>
            <label>Tipo<select name="tipo" defaultValue={tipo ?? "insumo"}>{ABAS.map((t) => <option key={t} value={t}>{TIPOS[t]}</option>)}</select></label>
            <label>Origem<select name="origem"><option value="comprado">Comprado</option><option value="fabricado">Fabricado aqui</option></select></label>
            <label>Unidade<select name="unidade"><option>un</option><option>kg</option><option>m</option><option>L</option></select></label>
            <div className="inteiro"><button className="btn">Criar e configurar</button></div>
          </form>
        </div>
      )}
    </>
  );
}
