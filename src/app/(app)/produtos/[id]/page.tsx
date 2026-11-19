import { custosUnitarios, tempoTxt } from "@/lib/custoProduto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, num, qtd } from "@/lib/formato";
import { TIPOS } from "@/lib/rotulos";
import { acaoComponente, acaoExcluirItem, acaoSalvarItem } from "@/lib/acoesProdutos";
import FotoInput from "@/components/FotoInput";
import Excluir from "@/components/Excluir";
import EditorProcesso from "@/components/EditorProcesso";

async function novaEtapa(form: FormData) {
  "use server";
  const u = await exigir("produtos", "editar");
  const nome = String(form.get("nome") || "").trim();
  if (nome) {
    const ult = await db.etapa.findFirst({ orderBy: { ordem: "desc" } });
    await db.etapa.upsert({ where: { nome }, update: {}, create: { nome, ordem: (ult?.ordem ?? 0) + 1 } });
    await auditar(u.nome, "criou etapa", nome);
  }
  revalidatePath(`/produtos/${form.get("id")}`);
}

export default async function ProdutoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await exigir("produtos");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [todos, etapas, opsDb] = await Promise.all([
    db.item.findMany({
      where: { ativo: true },
      include: { componentes: { include: { filho: true } }, passos: { orderBy: { ordem: "asc" }, include: { operacao: { include: { etapa: true } } } }, usadoEm: { include: { pai: true } } },
      orderBy: [{ tipo: "asc" }, { codigo: "asc" }],
    }),
    db.etapa.findMany({ orderBy: { ordem: "asc" } }),
    db.operacao.findMany({ where: { ativo: true }, include: { etapa: true }, orderBy: { nome: "asc" } }),
  ]);
  const mapa = new Map(todos.map((i) => [i.id, i]));
  const it = mapa.get(id);
  if (!it) notFound();
  const ops = opsDb.map((o) => ({ id: o.id, nome: o.nome, etapa: o.etapa.nome, etapaId: o.etapaId }));
  const edita = pode(u.permissoes, "produtos", "editar"), exclui = pode(u.permissoes, "produtos", "excluir");

  // todas as partes fabricadas aqui que vão dentro deste item (desce a estrutura)
  const partes: typeof todos = [];
  const vis = new Set<number>([id]);
  const desce = (x: typeof it) => { for (const c of x.componentes) { const f = mapa.get(c.filhoId); if (!f || vis.has(f.id)) continue; vis.add(f.id); if (f.origem === "fabricado" || f.passos.length) partes.push(f); desce(f); } };
  desce(it);
  // tempo de produção de 1 unidade (cronômetro dos lotes ou recorde), por parte
  const custo = await custosUnitarios();
  const cu = custo(id);
  const tempoPartes = it.componentes.map((c) => ({ c, seg: custo(c.filhoId).seg * c.quantidade })).filter((x) => x.seg > 0);
  const tempoProprio = Math.max(0, cu.seg - tempoPartes.reduce((s, x) => s + x.seg, 0));
  const candidatos = todos.filter((i) => i.id !== id && i.tipo !== "produto");

  return (
    <>
      <div className="topo">
        <div className="com-foto">
          <span className="mini media">{it.foto ? <img src={it.foto} alt="" /> : "sem foto"}</span>
          <span className="t"><h1 style={{ margin: 0 }}>{it.nome}</h1><small>{it.codigo} · {TIPOS[it.tipo]} · estoque {qtd(it.estoque, it.unidade)}</small></span>
        </div>
        <div className="acoes">
          <a className="btn sec" href={`/historico?tabela=Item&id=${id}`}>Histórico</a>
          <Link className="btn sec" href={`/produtos?aba=${it.tipo}`}>Voltar</Link>
        </div>
      </div>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      {it.usadoEm.length > 0 && <p className="suave">Vai em: {it.usadoEm.filter((c) => c.pai.ativo).slice(0, 8).map((c, i) => <span key={c.paiId}>{i > 0 && ", "}<Link href={`/produtos/${c.paiId}`}>{c.pai.codigo ?? c.pai.nome}</Link></span>)}{it.usadoEm.length > 8 && ` e mais ${it.usadoEm.length - 8}`}</p>}

      <div className="card">
        <b>Cadastro</b>
        <form action={acaoSalvarItem} className="campos" style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={id} />
          <div className="inteiro"><FotoInput atual={it.foto} /></div>
          <label>Nome<input name="nome" defaultValue={it.nome} required disabled={!edita} /></label>
          <label>SKU / código<input name="codigo" defaultValue={it.codigo ?? ""} disabled={!edita} /></label>
          {it.tipo === "produto" && <label>Preço de venda<input name="precoVenda" inputMode="decimal" defaultValue={it.precoVenda ?? ""} disabled={!edita} /></label>}
          <label>Setor<input name="setor" defaultValue={it.setor ?? ""} disabled={!edita} /></label>
          <label>Dias para fabricar<input name="diasFabricacao" type="number" min={0} defaultValue={it.diasFabricacao} disabled={!edita} /></label>
          <label className="inteiro">Observação<input name="obs" defaultValue={it.observacao ?? ""} disabled={!edita} /></label>
          {edita && <div className="inteiro acoes"><button className="btn">Salvar</button></div>}
        </form>
      </div>

      {it.tipo !== "materia_prima" && it.tipo !== "insumo" && (
        <div className="card tabela">
          <div className="linha-form" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <b>Tempo para produzir 1 {it.tipo === "produto" ? "fechadura" : "unidade"}</b>
            <span style={{ fontSize: "1.4rem", fontWeight: 800 }}>{tempoTxt(cu.seg)}</span>
          </div>
          {cu.seg > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>Parte</th><th className="n">Qtd</th><th className="n">Tempo</th></tr></thead>
              <tbody>
                {tempoPartes.map(({ c, seg }) => <tr key={c.filhoId}><td><Link href={`/produtos/${c.filhoId}`}>{c.filho.codigo ?? c.filho.nome}</Link> <small className="suave">{c.filho.nome}</small></td><td className="n">{num(c.quantidade, 2)}</td><td className="n">{tempoTxt(seg)}</td></tr>)}
                {tempoProprio > 0 && <tr><td>{it.tipo === "peca" ? "Processo desta peça" : "Montagem"}</td><td className="n">1</td><td className="n">{tempoTxt(tempoProprio)}</td></tr>}
              </tbody>
            </table>
          )}
          <p className="suave" style={{ marginBottom: 0 }}>
            Soma do tempo das operações de cada peça: cronômetro dos lotes dos últimos 30 dias ou, sem lançamento, o recorde.
            {cu.semTempo.length > 0 && ` Sem tempo ainda: ${cu.semTempo.slice(0, 4).join(", ")}${cu.semTempo.length > 4 ? "…" : "."}`}
            {cu.pecasSemMo.length > 0 && ` Peças sem operação ligada (fora da conta): ${cu.pecasSemMo.slice(0, 4).join(", ")}${cu.pecasSemMo.length > 4 ? "…" : "."}`}
          </p>
        </div>
      )}

      <h2>Processo {it.tipo === "produto" ? "de montagem final" : it.tipo === "conjunto" ? "de montagem" : "desta peça"}</h2>
      <div className="card tabela">
        <EditorProcesso itemId={id} pagina={id} passos={it.passos} ops={ops} etapas={etapas} edita={edita} />
      </div>

      <h2>Peças e materiais que compõem {it.tipo === "peca" ? "a peça" : "o produto"} (em 1 unidade)</h2>
      <div className="card tabela">
        {it.componentes.length === 0 ? <p className="suave">Nada cadastrado.</p> : (
          <table>
            <thead><tr><th>Parte</th><th>Código</th><th className="n">Quantidade</th><th>Processo</th>{edita && <th></th>}</tr></thead>
            <tbody>{it.componentes.sort((a, b) => (a.filho.codigo ?? "").localeCompare(b.filho.codigo ?? "")).map((c) => {
              const f = mapa.get(c.filhoId);
              return (
                <tr key={c.id}>
                  <td><Link href={c.filho.tipo === "materia_prima" || c.filho.tipo === "insumo" ? `/estoque/${c.filhoId}` : `/produtos/${c.filhoId}`} className="com-foto" style={{ color: "inherit" }}><span className="mini">{c.filho.foto ? <img src={c.filho.foto} alt="" /> : TIPOS[c.filho.tipo]}</span><b>{c.filho.nome}</b></Link></td>
                  <td className="suave">{c.filho.codigo}</td>
                  <td className="n">{qtd(c.quantidade, c.filho.unidade)}</td>
                  <td className="suave">{f?.passos.length ? f.passos.map((p) => p.operacao.nome).join(" → ") : c.filho.origem === "fabricado" ? <span className="selo alerta">sem processo</span> : "comprado"}</td>
                  {edita && <td><form action={acaoComponente}><input type="hidden" name="id" value={id} /><input type="hidden" name="filhoId" value={c.filhoId} /><input type="hidden" name="remover" value="1" /><button className="btn sec peq perigo-txt">Excluir</button></form></td>}
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {edita && (
          <form action={acaoComponente} className="linha-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={id} />
            <label>Adicionar parte<select name="filhoId" required defaultValue="">
              <option value="" disabled>Escolha</option>
              {["conjunto", "peca", "materia_prima", "insumo"].map((t) => (
                <optgroup key={t} label={TIPOS[t]}>{candidatos.filter((c) => c.tipo === t).map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} — ` : ""}{c.nome}</option>)}</optgroup>
              ))}
            </select></label>
            <label>Quantidade<input name="quantidade" inputMode="decimal" required defaultValue="1" /></label>
            <button className="btn sec">Adicionar</button>
          </form>
        )}
        <p className="suave" style={{ marginBottom: 0 }}>Peça nova? Crie em <Link href="/produtos?aba=peca">Produtos → Peças</Link> e depois adicione aqui. Matéria-prima nova: <Link href="/materia-prima">Matéria-prima</Link>.</p>
      </div>

      {partes.length > 0 && (
        <>
          <h2>Processo de cada peça até a montagem</h2>
          {partes.map((p) => (
            <div className="card tabela" key={p.id}>
              <div className="topo" style={{ marginBottom: 4 }}>
                <Link href={`/produtos/${p.id}`} className="com-foto" style={{ color: "inherit" }}><span className="mini">{p.foto ? <img src={p.foto} alt="" /> : "sem foto"}</span><span className="t"><b>{p.nome}</b><small>{p.codigo} · {TIPOS[p.tipo]} · estoque {num(p.estoque)}</small></span></Link>
              </div>
              <EditorProcesso itemId={p.id} pagina={id} passos={p.passos} ops={ops} etapas={etapas} edita={edita} />
            </div>
          ))}
        </>
      )}

      {edita && (
        <details className="editar card">
          <summary>Criar nova etapa (setor) de produção</summary>
          <form action={novaEtapa} className="linha-form"><input type="hidden" name="id" value={id} /><label>Nome da etapa<input name="nome" placeholder="ex.: Pintura" /></label><button className="btn sec">Criar etapa</button></form>
        </details>
      )}
      {exclui && <div style={{ marginTop: 18 }}><Excluir acao={acaoExcluirItem} campos={{ id, volta: `/produtos/${id}` }} texto={`Excluir ${TIPOS[it.tipo].toLowerCase()}`} peq={false} pergunta={`Excluir ${it.nome}?`} /></div>}
      <p className="suave">Preço de venda: {brl(it.precoVenda)} · custo completo em <Link href="/custos">Custos</Link>.</p>
    </>
  );
}
