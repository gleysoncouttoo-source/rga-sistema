"use client";
import { useEffect, useRef, useState } from "react";

export type OpcaoFoto = { valor: string; titulo: string; sub?: string; foto?: string | null; grupo?: string; desativada?: boolean };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lista suspensa com seta e miniatura da foto em cada opção (o select do navegador não mostra imagem). */
export default function SelectFoto({ opcoes, valor, onChange, placeholder = "Escolha", busca = false }: {
  opcoes: OpcaoFoto[]; valor: string; onChange: (v: string) => void; placeholder?: string; busca?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  const sel = opcoes.find((o) => o.valor === valor);
  const lista = q.trim() ? opcoes.filter((o) => norm(`${o.titulo} ${o.sub ?? ""}`).includes(norm(q.trim()))) : opcoes;
  let grupoAnt: string | undefined;
  const Mini = ({ foto }: { foto?: string | null }) => <span className="sf-mini">{foto ? <img src={foto} alt="" /> : null}</span>;
  return (
    <div className="sf" ref={caixa}>
      <button type="button" className="sf-botao" aria-haspopup="listbox" aria-expanded={aberto} onClick={() => { setAberto(!aberto); setQ(""); }}>
        {sel ? <><Mini foto={sel.foto} /><span className="sf-txt"><b>{sel.titulo}</b>{sel.sub && <small>{sel.sub}</small>}</span></> : <span className="sf-txt sf-vazio">{placeholder}</span>}
        <span className="sf-seta" aria-hidden>▾</span>
      </button>
      {aberto && (
        <div className="sf-lista" role="listbox">
          {busca && <input className="sf-busca" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />}
          {lista.map((o) => {
            const cab = o.grupo && o.grupo !== grupoAnt ? o.grupo : null; grupoAnt = o.grupo;
            return (
              <div key={o.valor}>
                {cab && <div className="sf-grupo">{cab}</div>}
                <button type="button" role="option" aria-selected={o.valor === valor} disabled={o.desativada}
                  className={"sf-op" + (o.valor === valor ? " sel" : "")} onClick={() => { onChange(o.valor); setAberto(false); }}>
                  <Mini foto={o.foto} /><span className="sf-txt"><b>{o.titulo}</b>{o.sub && <small>{o.sub}</small>}</span>
                </button>
              </div>
            );
          })}
          {lista.length === 0 && <div className="sf-grupo">Nada encontrado.</div>}
        </div>
      )}
    </div>
  );
}
