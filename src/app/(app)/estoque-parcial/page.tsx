import Link from "next/link";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { saldosLotes } from "@/lib/fluxo";
import { num } from "@/lib/formato";
import { TIPOS } from "@/lib/rotulos";

/** Estoque parcial: peças que já passaram por parte do processo e o que ainda falta para ficarem prontas. */
export default async function EstoqueParcial({ searchParams }: { searchParams: Promise<{ produto?: string; todos?: string }> }) {
  await exigir("producao");
  const sp = await searchParams;
  const produtoId = Number(sp.produto) || null;
  const [itens, lotes, produtos] = await Promise.all([
    db.item.findMany({ where: { ativo: true, passos: { some: {} } }, include: { passos: { orderBy: { ordem: "asc" }, include: { operacao: true } }, componentes: true }, orderBy: [{ tipo: "asc" }, { codigo: "asc" }] }),
    saldosLotes({ status: "aberto" }),
    db.item.findMany({ where: { ativo: true, tipo: "produto" }, select: { id: true, codigo: true, nome: true }, orderBy: { codigo: "asc" } }),
  ]);
  // filtro por produto: só as partes que vão nele
  let filtro: Set<number> | null = null;
  if (produtoId) {
    const todos = await db.componente.findMany();
    const filhos = new Map<number, number[]>();
    for (const c of todos) filhos.set(c.paiId, [...(filhos.get(c.paiId) ?? []), c.filhoId]);
    filtro = new Set();
    const visita = (id: number) => { if (filtro!.has(id)) return; filtro!.add(id); (filhos.get(id) ?? []).forEach(visita); };
    visita(produtoId);
  }
  const linhas = itens.filter((i) => !filtro || filtro.has(i.id)).map((i) => {
    const ls = lotes.filter((l) => l.itemId === i.id);
    // por passo: quanto saiu dele e espera o próximo (somando os lotes abertos)
    const espera = i.passos.map((p, k) => ({
      passo: p, k,
      qtd: ls.reduce((s, l) => s + Math.max(0, l.passos.find((x) => x.id === p.id)?.aguardando ?? 0), 0) + (k === 0 ? 0 : 0),
      andamento: ls.reduce((s, l) => s + (l.passos.find((x) => x.id === p.id)?.emAndamento ?? 0), 0),
    }));
    // peças que entraram "no meio" (já estavam prontas) sem passo real: entram no passo anterior ao seguinte
    for (const l of ls) for (const x of l.passos) if (x.id === 0 && x.aguardando > 0) {
      const prox = i.passos.findIndex((p) => p.ordem > x.ordem);
      if (prox > 0) espera[prox - 1].qtd += x.aguardando;
    }
    const total = espera.slice(0, -1).reduce((s, e) => s + e.qtd, 0);
    return { i, espera, total, lotes: ls.length, andamento: espera.reduce((s, e) => s + e.andamento, 0) };
  });
  const mostrar = sp.todos ? linhas : linhas.filter((l) => l.total > 0 || l.andamento > 0 || l.lotes > 0);
  const totalPecas = linhas.reduce((s, l) => s + l.total, 0);
  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Estoque parcial</h1>
        <form className="acoes" action="/estoque-parcial">
          <select name="produto" defaultValue={produtoId ?? ""}><option value="">Todos os produtos</option>{produtos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}</select>
          <label className="chk"><input type="checkbox" name="todos" value="1" defaultChecked={!!sp.todos} /> mostrar peças paradas</label>
          <button className="btn sec">Filtrar</button>
        </form>
      </div>
      <p className="suave">Peças que já passaram por parte do processo e estão esperando o próximo. <b>{num(totalPecas)}</b> peça(s) em processo no total. <b>Pronta</b> = já passou pelo último processo (estoque da peça).</p>
      <div className="card tabela">
        {mostrar.length === 0 ? <p className="suave">Nenhuma peça parada entre processos. Marque “mostrar peças paradas” para ver todas.</p> : (
          <table>
            <thead><tr><th>Peça</th><th className="n">Pronta</th><th className="n">Em processo</th><th>Onde estão e o que falta</th></tr></thead>
            <tbody>{mostrar.map(({ i, espera, total, andamento }) => (
              <tr key={i.id}>
                <td><Link href={`/produtos/${i.id}`} className="com-foto" style={{ color: "inherit" }}><span className="mini">{i.foto ? <img src={i.foto} alt="" /> : "sem foto"}</span><span className="t"><b>{i.nome}</b><small>{i.codigo} · {TIPOS[i.tipo]}</small></span></Link></td>
                <td className="n"><b>{num(i.estoque)}</b></td>
                <td className="n"><b style={{ color: total ? "var(--alerta)" : undefined }}>{num(total)}</b>{andamento > 0 && <div className="suave">⏱ {andamento} rodando</div>}</td>
                <td>
                  {espera.slice(0, -1).filter((e) => e.qtd > 0).map((e) => (
                    <div key={e.passo.id} style={{ marginBottom: 4 }}>
                      <b>{num(e.qtd)}</b> prontas de <b>{e.passo.operacao.nome}</b> · <span className="suave">faltam {i.passos.slice(e.k + 1).map((p) => p.operacao.nome).join(", ")}</span>
                    </div>
                  ))}
                  {total === 0 && <span className="suave">Processo: {i.passos.map((p) => p.operacao.nome).join(" → ")}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p className="suave">Detalhes de cada lote (quem fez cada processo e o tempo) em <Link href="/producao">Produção</Link>.</p>
    </>
  );
}
