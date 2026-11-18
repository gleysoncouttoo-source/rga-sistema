"use client";
import { useMemo, useState } from "react";
import { DetalheEtapas, SelosEtapa, type EtapaPos } from "@/components/EtapasProcesso";

export type LinhaParte = { id: number; codigo: string | null; nome: string; foto: string | null; estoque: number; emProcesso: number; andamento: number; etapas: EtapaPos[]; processo: string[] };
type Conj = { id: number; nome: string; estrutura: { filhoId: number; quantidade: number }[] };

const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Lista de partes com caixas de marcar: marca as partes e clica em Montar conjunto.
 *  Se as partes marcadas são de um conjunto cadastrado, usa ele (e as quantidades da estrutura); senão cria um conjunto novo. */
export default function PartesConjunto({ linhas, conjuntos, acao, podeMontar }: { linhas: LinhaParte[]; conjuntos: Conj[]; acao: (f: FormData) => void | Promise<void>; podeMontar: boolean }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [qtd, setQtd] = useState(1);
  const [nome, setNome] = useState("");
  const mapa = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas]);
  const troca = (id: number) => setSel((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  // conjuntos que usam todas as partes marcadas (o mais parecido primeiro); dá para trocar ou escolher "conjunto novo"
  const ids = [...sel];
  const candidatos = !ids.length ? [] : conjuntos
    .filter((c) => ids.every((i) => c.estrutura.some((e) => e.filhoId === i)))
    .sort((a, b) => a.estrutura.length - b.estrutura.length);
  const [escolha, setEscolha] = useState<string>("");
  const conj = escolha === "novo" ? undefined : candidatos.find((c) => String(c.id) === escolha) ?? candidatos[0];
  const porConj = (id: number) => conj?.estrutura.find((e) => e.filhoId === id)?.quantidade ?? 1;
  const saidas = ids.map((id) => ({ id, q: porConj(id) * qtd }));
  const falta = saidas.filter((s) => (mapa.get(s.id)?.estoque ?? 0) < s.q);

  return (
    <form action={acao}>
      <input type="hidden" name="partes" value={JSON.stringify(saidas)} />
      <input type="hidden" name="porConjunto" value={JSON.stringify(ids.map((id) => ({ id, q: porConj(id) })))} />
      <input type="hidden" name="conjuntoId" value={conj?.id ?? ""} />
      <div className="card tabela">
        {linhas.length === 0 ? <p className="suave">Nada aqui.</p> : (
          <table>
            <thead><tr>{podeMontar && <th style={{ width: 36 }}></th>}<th>Parte</th><th className="n">Pronta(s)</th><th className="n">Em processo</th><th className="so-pc">Em qual processo está</th></tr></thead>
            <tbody>{linhas.map((l) => (
              <tr key={l.id} onClick={podeMontar ? () => troca(l.id) : undefined} style={podeMontar ? { cursor: "pointer", background: sel.has(l.id) ? "var(--acento-claro)" : undefined } : undefined}>
                {podeMontar && <td><input type="checkbox" checked={sel.has(l.id)} onChange={() => troca(l.id)} onClick={(e) => e.stopPropagation()} aria-label={`Marcar ${l.nome}`} /></td>}
                <td><span className="com-foto"><span className="mini">{l.foto ? <img src={l.foto} alt="" /> : "sem foto"}</span><span className="t"><b>{l.nome}</b><small>{l.codigo}</small></span></span></td>
                <td className="n"><b style={{ color: l.estoque < 0 ? "var(--erro)" : undefined }}>{n(l.estoque)}</b></td>
                <td className="n"><b style={{ color: l.emProcesso ? "var(--alerta)" : undefined }}>{l.emProcesso ? n(l.emProcesso) : "—"}</b>{l.andamento > 0 && <div className="suave">⏱ {l.andamento} rodando</div>}<SelosEtapa etapas={l.etapas} /></td>
                <td className="so-pc"><DetalheEtapas etapas={l.etapas} processo={l.processo} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {podeMontar && linhas.length > 0 && (
        <div className={sel.size ? "barra-conjunto fixa" : "barra-conjunto"}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>{sel.size ? `${sel.size} parte(s) marcada(s)` : "Montar conjunto"}</b>
            {sel.size === 0 ? <div className="suave" style={{ fontSize: ".85rem" }}>Marque as partes na lista acima e clique em Montar conjunto.</div> : <div className="suave" style={{ fontSize: ".85rem" }}>
              {conj ? <>Sai: {saidas.map((s) => `${mapa.get(s.id)!.nome} ${n(s.q)}`).join(", ")}.</>
                : <>{candidatos.length ? "Conjunto novo" : "Não é um conjunto cadastrado: vai criar um conjunto novo"} com essas partes (1 de cada).</>}
              {falta.length > 0 && <span style={{ color: "var(--erro)" }}> Falta peça pronta: {falta.map((s) => mapa.get(s.id)!.nome).join(", ")}.</span>}
            </div>}
          </div>
          {sel.size > 0 && candidatos.length > 0 && (
            <label style={{ minWidth: 220 }}>Conjunto
              <select value={conj ? String(conj.id) : "novo"} onChange={(e) => setEscolha(e.target.value)}>
                {candidatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                <option value="novo">Conjunto novo…</option>
              </select>
            </label>
          )}
          {sel.size > 0 && !conj && <label style={{ minWidth: 200 }}>Nome do conjunto novo<input name="novoNome" value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="ex.: Corpo fechadura WC" /></label>}
          {sel.size > 0 && <label style={{ width: 110 }}>Quantos<input name="quantidade" type="number" min={1} inputMode="numeric" value={qtd} onChange={(e) => setQtd(Math.max(1, Number(e.target.value) || 1))} /></label>}
          <button className="btn" disabled={sel.size === 0}>Montar conjunto</button>
          {sel.size > 0 && <button type="button" className="btn sec" onClick={() => setSel(new Set())}>Limpar</button>}
        </div>
      )}
    </form>
  );
}
