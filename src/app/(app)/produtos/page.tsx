import Link from "next/link";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, num } from "@/lib/formato";
import { acaoExcluirItem, acaoNovoItem } from "@/lib/acoesProdutos";
import FotoInput from "@/components/FotoInput";
import Excluir from "@/components/Excluir";

const ABAS = [
  { id: "produto", nome: "Produtos" },
  { id: "conjunto", nome: "Conjuntos (corpos)" },
  { id: "peca", nome: "Peças" },
];

export default async function Produtos({ searchParams }: { searchParams: Promise<{ aba?: string; q?: string; erro?: string; ok?: string }> }) {
  const u = await exigir("produtos");
  const sp = await searchParams;
  const aba = ABAS.some((a) => a.id === sp.aba) ? sp.aba! : "produto";
  const q = sp.q?.trim();
  const [lista, contagem] = await Promise.all([
    db.item.findMany({
      where: { ativo: true, tipo: aba, ...(q ? { OR: [{ nome: { contains: q, mode: "insensitive" } }, { codigo: { contains: q, mode: "insensitive" } }] } : {}) },
      include: { passos: { orderBy: { ordem: "asc" }, include: { operacao: true } }, _count: { select: { componentes: true, usadoEm: true } } },
      orderBy: [{ codigo: "asc" }, { nome: "asc" }],
    }),
    db.item.groupBy({ by: ["tipo"], where: { ativo: true }, _count: true }),
  ]);
  const cont = new Map(contagem.map((c) => [c.tipo, c._count]));
  const cria = pode(u.permissoes, "produtos", "criar"), exclui = pode(u.permissoes, "produtos", "excluir");
  const semProcesso = lista.filter((i) => !i.passos.length).length;
  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Produtos e processos</h1>
        <form className="acoes" action="/produtos"><input type="hidden" name="aba" value={aba} /><input name="q" placeholder="Buscar SKU ou nome" defaultValue={q} /><button className="btn sec">Buscar</button></form>
      </div>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <div className="abas">{ABAS.map((a) => <a key={a.id} href={`/produtos?aba=${a.id}`} className={aba === a.id ? "ativo" : ""}>{a.nome} ({cont.get(a.id) ?? 0})</a>)}</div>
      <p className="suave">Cada produto tem as peças que vão nele e cada peça tem o seu processo até ficar pronta para a montagem (ex.: Espelho L.O: estampa → pintura → lixa → verniz). A Produção segue esse processo.{semProcesso > 0 && <> <b>{semProcesso}</b> nesta aba ainda sem processo.</>}</p>
      <div className="card tabela">
        <table>
          <thead><tr><th>Produto</th><th>SKU</th>{aba === "produto" && <th className="n">Preço</th>}<th className="n">{aba === "peca" ? "Usada em" : "Peças"}</th><th className="n">Estoque</th><th>Processo</th>{exclui && <th></th>}</tr></thead>
          <tbody>{lista.map((i) => (
            <tr key={i.id}>
              <td><Link href={`/produtos/${i.id}`} className="com-foto" style={{ color: "inherit" }}><span className="mini">{i.foto ? <img src={i.foto} alt="" /> : "sem foto"}</span><span className="t"><b>{i.nome}</b>{i.setor && <small>{i.setor}</small>}</span></Link></td>
              <td>{i.codigo}</td>
              {aba === "produto" && <td className="n">{brl(i.precoVenda)}</td>}
              <td className="n">{num(aba === "peca" ? i._count.usadoEm : i._count.componentes)}</td>
              <td className="n">{num(i.estoque)}</td>
              <td>{i.passos.length ? <span className="suave">{i.passos.map((p) => p.operacao.nome).join(" → ")}</span> : <span className="selo alerta">sem processo</span>}</td>
              {exclui && <td><Excluir acao={acaoExcluirItem} campos={{ id: i.id, volta: `/produtos?aba=${aba}` }} pergunta={`Excluir ${i.nome}? Se já foi vendido, comprado ou produzido, ele só sai das listas (o histórico fica).`} /></td>}
            </tr>
          ))}</tbody>
        </table>
        {lista.length === 0 && <p className="suave">Nada aqui ainda.</p>}
      </div>
      {cria && (
        <div className="card">
          <b>Adicionar</b>
          <form action={acaoNovoItem} className="campos" style={{ marginTop: 12 }}>
            <div className="inteiro"><FotoInput /></div>
            <label>Tipo<select name="tipo" defaultValue={aba}>{ABAS.map((a) => <option key={a.id} value={a.id}>{a.nome.replace(/s( \(.*\))?$/, "")}</option>)}</select></label>
            <label>Nome<input name="nome" required /></label>
            <label>SKU / código<input name="codigo" /></label>
            <label>Preço de venda (produto)<input name="precoVenda" inputMode="decimal" /></label>
            <label>Setor (peça)<input name="setor" placeholder="Estamparia, Injeção…" /></label>
            <div className="inteiro"><button className="btn">Adicionar e cadastrar peças e processo</button></div>
          </form>
        </div>
      )}
    </>
  );
}
