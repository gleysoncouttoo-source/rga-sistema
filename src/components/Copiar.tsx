"use client";
import { useState } from "react";

/** Botão que copia a linha digitável ou a chave Pix para colar no app do banco. */
export default function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn sec peq"
      title={texto}
      onClick={async () => {
        try { await navigator.clipboard.writeText(texto); } catch {
          const t = document.createElement("textarea"); t.value = texto; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
        }
        setOk(true); setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? "Copiado ✓" : rotulo}
    </button>
  );
}
