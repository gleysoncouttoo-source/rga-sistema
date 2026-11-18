import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { DetalheEtapas, SelosEtapa, type EtapaPos } from "@/components/EtapasProcesso";
import PartesConjunto, { type LinhaParte } from "@/components/PartesConjunto";
import IrPara from "@/components/IrPara";
import { saldosLotes } from "@/lib/fluxo";
import { num } from "@/lib/formato";

const volta = (k: "ok" | "erro", m: string) => redirect(`/estoque-parcial?${k}=${encodeURIComponent(m)}`);

/** Criar conjunto: as partes marcadas saem do estoque e o conjunto entra (cadastrado ou novo). */
async function criarConjunto(form: FormData) {
  "use server";
  const u = await exigir("producao", "criar");
  const qtd = Math.round(Number(form.get("quantidade")));
  const ler = (k: string) => { try { return (JSON.parse(String(form.get(k) || "[]")) as { id: number; q: number }[]).filter((x) => Number.isFinite(x.id) && x.q > 0); } catch { return []; } };
  const partes = ler("partes"), porConj = ler("porConjunto");
  if (!partes.length) volta("erro", "Marque pelo menos uma parte.");
  if (!(qtd > 0)) volta("erro", "Informe quantos conjuntos.");
  let conjuntoId = Number(form.get("conjuntoId")) || 0;
  if (!conjuntoId) {
    const nome = String(form.get("novoNome") || "").trim();
    if (!nome) volta("erro", "Dê um nome ao conjunto novo.");
    const novo = await db.item.create({ data: { nome, tipo: "conjunto", origem: "fabricado", setor: "Montagem", componentes: { create: porConj.map((x) => ({ filhoId: x.id, quantidade: x.q })) } } });
    conjuntoId = novo.id;
    await auditar(u.nome, "criou conjunto", nome);
  }
  const conj = await db.item.findUnique({ where: { id: conjuntoId } });
  if (!conj) return volta("erro", "Conjunto não encontrado.");
  const motivo = `Montagem de ${qtd} ${conj.nome}`;
  await db.$transaction([
    ...partes.flatMap((x) => [
      db.item.update({ where: { id: x.id }, data: { estoque: { increment: -x.q } } }),
      db.movimentoEstoque.create({ data: { itemId: x.id, quantidade: -x.q, motivo, usuario: u.nome } }),
    ]),
    db.item.update({ where: { id: conjuntoId }, data: { estoque: { increment: qtd } } }),
    db.movimentoEstoque.create({ data: { itemId: conjuntoId, quantidade: qtd, motivo, usuario: u.nome } }),
  ]);
  await auditar(u.nome, "montou conjunto", `${qtd} × ${conj.nome} (${partes.length} parte(s))`);
  volta("ok", `${qtd} ${conj.nome} criado(s). As partes saíram do estoque.`);
}

/** Desfazer conjunto: o conjunto sai do estoque e as partes da estrutura voltam. */
async function desfazerConjunto(form: FormData) {
  "use server";
  const u = await exigir("producao", "criar");
  const id = Number(form.get("id")), qtd = Math.round(Number(form.get("quantidade")));
  const conj = await db.item.findUnique({ where: { id }, include: { componentes: true } });
  if (!conj || !(qtd > 0)) return volta("erro", "Informe quantos desfazer.");
  if (qtd > conj.estoque) return volta("erro", `Só tem ${conj.estoque} ${conj.nome} pronto(s).`);
  const motivo = `Desfeito ${qtd} ${conj.nome}`;
  await db.$transaction([
    db.item.update({ where: { id }, data: { estoque: { increment: -qtd } } }),
    db.movimentoEstoque.create({ data: { itemId: id, quantidade: -qtd, motivo, usuario: u.nome } }),
    ...conj.componentes.flatMap((c) => [
      db.item.update({ where: { id: c.filhoId }, data: { estoque: { increment: c.quantidade * qtd } } }),
      db.movimentoEstoque.create({ data: { itemId: c.filhoId, quantidade: c.quantidade * qtd, motivo, usuario: u.nome } }),
    ]),
  ]);
  await auditar(u.nome, "desfez conjunto", `${qtd} × ${conj.nome}`);
  volta("ok", `${qtd} ${conj.nome} desfeito(s). As partes voltaram para o estoque.`);
}

/** Estoque parcial: peças que já passaram por parte do processo e o que ainda falta para ficarem prontas. */
export default async function EstoqueParcial({ searchParams }: { searchParams: Promise<{ produto?: string; ver?: string; erro?: string; ok?: string }> }) {
  const u = await exigir("producao");
  const sp = await searchParams;
  const produtoId = Number(sp.produto) || null;
  const [itens, lotes, produtos] = await Promise.all([
    db.item.findMany({ where: { ativo: true, tipo: { in: ["conjunto", "peca"] } }, include: { passos: { orderBy: { ordem: "asc" }, include: { operacao: true } }, componentes: true }, orderBy: [{ tipo: "asc" }, { codigo: "asc" }] }),
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
    // em qual processo estão: as que saíram do processo k esperam o k+1; as rodando estão no próprio processo
    const N = i.passos.length;
    const etapas: EtapaPos[] = i.passos.map((p, k) => ({
      pos: k + 1, total: N, nome: p.operacao.nome,
      aguardando: k > 0 ? espera[k - 1].qtd : 0, rodando: espera[k].andamento,
    })).filter((e) => e.aguardando > 0 || e.rodando > 0);
    const processo = i.passos.map((p) => p.operacao.nome);
    return { i, espera, total, etapas, processo, lotes: ls.length, andamento: espera.reduce((s, e) => s + e.andamento, 0) };
  });
  const ver = sp.ver === "partes" || sp.ver === "conjuntos" ? sp.ver : "tudo";
  const totalPecas = linhas.reduce((s, l) => s + l.total, 0);
  const monta = pode(u.permissoes, "producao", "criar");
  const conjMontar = itens.filter((i) => i.tipo === "conjunto").map((i) => ({ id: i.id, nome: i.nome, estrutura: i.componentes.map((c) => ({ filhoId: c.filhoId, quantidade: c.quantidade })) }));
  const partesLinhas: LinhaParte[] = linhas.filter((l) => l.i.tipo === "peca").map(({ i, total, andamento, etapas, processo }) => ({
    id: i.id, codigo: i.codigo, nome: i.nome, foto: i.foto, estoque: i.estoque, emProcesso: total, andamento, etapas, processo,
  }));
  const qs = (v: string, prod = produtoId) => `/estoque-parcial?ver=${v}${prod ? `&produto=${prod}` : ""}`;
  const Tabela = ({ titulo, ls }: { titulo: string; ls: typeof linhas }) => (
    <>
      <h2>{titulo} ({ls.length})</h2>
      <div className="card tabela">
        {ls.length === 0 ? <p className="suave">Nada aqui.</p> : (
          <table>
            <thead><tr><th>{titulo === "Conjuntos" ? "Conjunto" : "Parte"}</th><th className="n">Pronta(s)</th><th className="n">Em processo</th><th className="so-pc">Em qual processo está</th>{monta && <th></th>}</tr></thead>
            <tbody>{ls.map(({ i, total, andamento, etapas, processo }) => (
              <tr key={i.id}>
                <td><Link href={`/produtos/${i.id}`} className="com-foto" style={{ color: "inherit", textDecoration: "none" }}><span className="mini">{i.foto ? <img src={i.foto} alt="" /> : "sem foto"}</span><span className="t"><b>{i.nome}</b><small>{i.codigo}</small></span></Link></td>
                <td className="n"><b style={{ color: i.estoque < 0 ? "var(--erro)" : undefined }}>{num(i.estoque)}</b></td>
                <td className="n"><b style={{ color: total ? "var(--alerta)" : undefined }}>{total ? num(total) : "—"}</b>{andamento > 0 && <div className="suave">⏱ {andamento} rodando</div>}<SelosEtapa etapas={etapas} /></td>
                <td className="so-pc"><DetalheEtapas etapas={etapas} processo={processo} />
                </td>
                {monta && (
                  <td>
                    {i.estoque > 0 && i.componentes.length > 0 && (
                      <form action={desfazerConjunto} className="linha-form" style={{ flexWrap: "nowrap", gap: 6 }}>
                        <input type="hidden" name="id" value={i.id} />
                        <input name="quantidade" type="number" min={1} max={i.estoque} defaultValue={1} aria-label="Quantos desfazer" style={{ width: 64, minHeight: 34 }} />
                        <button className="btn sec peq">Desfazer</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
  return (
    <>
      <h1>Estoque parcial</h1>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <div className="topo" style={{ alignItems: "flex-end" }}>
        <p className="suave" style={{ margin: 0, maxWidth: 620 }}>Conjuntos e partes prontos e o que ainda está no meio do processo. <b>Desfazer</b> um conjunto devolve as partes ao estoque. <b>{num(totalPecas)}</b> peça(s) em processo no total.</p>
        <div className="acoes">
          <IrPara rotulo="Mostrar" valor={qs(ver)} opcoes={[{ href: qs("tudo"), nome: "Conjuntos e partes" }, { href: qs("conjuntos"), nome: "Só conjuntos" }, { href: qs("partes"), nome: "Só partes" }]} />
          <IrPara rotulo="Produto" valor={qs(ver)} opcoes={[{ href: qs(ver, null), nome: "Todos os produtos" }, ...produtos.map((p) => ({ href: qs(ver, p.id), nome: `${p.codigo ?? ""} — ${p.nome}` }))]} />
        </div>
      </div>
      {ver !== "partes" && <Tabela titulo="Conjuntos" ls={linhas.filter((l) => l.i.tipo === "conjunto")} />}
      {ver !== "conjuntos" && (
        <>
          <h2>Partes ({partesLinhas.length})</h2>
          {monta && <p className="suave" style={{ marginTop: -4 }}>Para formar um conjunto, marque as partes e clique em <b>Montar conjunto</b> no fim da lista.</p>}
          <PartesConjunto linhas={partesLinhas} conjuntos={conjMontar} acao={criarConjunto} podeMontar={monta} />
        </>
      )}
      <p className="suave">Detalhes de cada lote (quem fez cada processo e o tempo) em <Link href="/producao">Produção</Link>.</p>
    </>
  );
}
