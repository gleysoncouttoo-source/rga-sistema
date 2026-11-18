"use client";
import { useMemo, useState } from "react";
import SelectFoto from "@/components/SelectFoto";

type Peca = { id: number; codigo: string | null; nome: string; foto: string | null; estoque: number };
type Conj = Peca & { estrutura: { filhoId: number; quantidade: number }[] };

const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Montar conjunto: escolhe o conjunto e as partes que vão nele. As partes saem do estoque e o conjunto entra. */
export default function MontarConjunto({ conjuntos, pecas, acao }: { conjuntos: Conj[]; pecas: Peca[]; acao: (f: FormData) => void | Promise<void> }) {
  const mapa = useMemo(() => new Map(pecas.map((p) => [p.id, p])), [pecas]);
  const [cid, setCid] = useState("");
  const [qtd, setQtd] = useState(1);
  const [linhas, setLinhas] = useState<{ id: number; porConj: number; usar: boolean }[]>([]);
  const [extra, setExtra] = useState("");
  const conj = conjuntos.find((c) => String(c.id) === cid);
  const escolher = (v: string) => {
    setCid(v);
    const c = conjuntos.find((x) => String(x.id) === v);
    setLinhas(c ? c.estrutura.filter((e) => mapa.has(e.filhoId)).map((e) => ({ id: e.filhoId, porConj: e.quantidade, usar: true })) : []);
  };
  const muda = (id: number, d: Partial<{ porConj: number; usar: boolean }>) => setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...d } : l)));
  const faltando = linhas.filter((l) => l.usar && (mapa.get(l.id)?.estoque ?? 0) < l.porConj * qtd);
  const opPeca = (p: Peca) => ({ valor: String(p.id), titulo: p.codigo ?? p.nome, sub: `${p.codigo ? p.nome + " · " : ""}${n(p.estoque)} pronta(s)`, foto: p.foto });

  return (
    <form action={acao}>
      <input type="hidden" name="conjuntoId" value={cid} />
      <input type="hidden" name="partes" value={JSON.stringify(linhas.filter((l) => l.usar && l.porConj > 0).map((l) => ({ id: l.id, q: l.porConj * qtd })))} />
      <div className="apontar-campos">
        <label>Conjunto
          <SelectFoto placeholder="Escolha o conjunto" valor={cid} onChange={escolher}
            opcoes={conjuntos.map((c) => ({ valor: String(c.id), titulo: c.codigo ?? c.nome, sub: `${c.codigo ? c.nome + " · " : ""}${n(c.estoque)} pronto(s)`, foto: c.foto }))} />
        </label>
        <label>Quantos conjuntos<input name="quantidade" type="number" inputMode="numeric" min={1} value={qtd} onChange={(e) => setQtd(Math.max(1, Number(e.target.value) || 1))} /></label>
      </div>
      {conj && (
        <>
          <div className="tabela" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Usar</th><th>Parte</th><th className="n">Por conjunto</th><th className="n">Vai sair</th><th className="n">Pronta(s)</th></tr></thead>
              <tbody>{linhas.map((l) => {
                const p = mapa.get(l.id)!; const sai = l.porConj * qtd; const falta = l.usar && p.estoque < sai;
                return (
                  <tr key={l.id} style={l.usar ? undefined : { opacity: 0.45 }}>
                    <td><input type="checkbox" checked={l.usar} onChange={(e) => muda(l.id, { usar: e.target.checked })} aria-label={`Usar ${p.nome}`} /></td>
                    <td><span className="com-foto"><span className="mini" style={{ width: 32, height: 32 }}>{p.foto ? <img src={p.foto} alt="" /> : null}</span><span className="t"><b>{p.nome}</b><small>{p.codigo}</small></span></span></td>
                    <td className="n"><input type="number" min={0} step="any" value={l.porConj} onChange={(e) => muda(l.id, { porConj: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 80, minHeight: 34, textAlign: "right" }} /></td>
                    <td className="n"><b>{n(sai)}</b></td>
                    <td className="n" style={{ color: falta ? "var(--erro)" : undefined }}>{n(p.estoque)}{falta && " ⚠"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="linha-form" style={{ marginTop: 10 }}>
            <label style={{ flex: "1 1 260px" }}>Acrescentar outra parte
              <SelectFoto busca placeholder="Escolha a parte" valor={extra} onChange={setExtra}
                opcoes={pecas.filter((p) => !linhas.some((l) => l.id === p.id)).map(opPeca)} />
            </label>
            <button type="button" className="btn sec" disabled={!extra} onClick={() => { setLinhas((ls) => [...ls, { id: Number(extra), porConj: 1, usar: true }]); setExtra(""); }}>Acrescentar</button>
          </div>
          {faltando.length > 0 && <div className="aviso alerta" style={{ marginTop: 12 }}>Falta peça pronta no sistema: {faltando.map((l) => mapa.get(l.id)!.nome).join(", ")}. Se as peças existem de verdade, pode montar mesmo assim: o estoque delas fica negativo até alguém acertar a contagem.</div>}
          <div className="acoes" style={{ marginTop: 14 }}>
            <button className="btn">Montar {n(qtd)} {conj.nome}</button>
          </div>
        </>
      )}
    </form>
  );
}
