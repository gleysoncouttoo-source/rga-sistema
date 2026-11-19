"use client";
import { useEffect, useRef, useState } from "react";

const Camera = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" />
  </svg>
);
const Galeria = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-9 9" />
  </svg>
);
const Seta = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;

/**
 * Botão de anexar. No celular abre uma listinha: "Tirar foto com a câmera" ou "Galeria ou arquivos".
 * No computador (sem câmera de celular) abre direto a janela de arquivos.
 */
export default function EscolherArquivo({ rotulo, accept = "image/*", onArquivo, className = "btn sec peq" }: {
  rotulo: string; accept?: string; onArquivo: (f: File) => void; className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLSpanElement>(null), cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: Event) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  function clicar(e: React.MouseEvent) {
    e.preventDefault();
    const celular = window.matchMedia("(pointer: coarse)").matches;
    if (celular) setAberto((a) => !a); else gal.current?.click();
  }
  function pegar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // deixa escolher o mesmo arquivo de novo
    setAberto(false);
    if (f) onArquivo(f);
  }

  return (
    <span className="escolher-arq" ref={caixa}>
      <button type="button" className={className} onClick={clicar} aria-haspopup="menu" aria-expanded={aberto}>
        {rotulo} <Seta />
      </button>
      {aberto && (
        <span className="escolher-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => cam.current?.click()}><Camera /> Tirar foto com a câmera</button>
          <button type="button" role="menuitem" onClick={() => gal.current?.click()}><Galeria /> Galeria ou arquivos</button>
        </span>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" onChange={pegar} hidden />
      <input ref={gal} type="file" accept={accept} onChange={pegar} hidden />
    </span>
  );
}
