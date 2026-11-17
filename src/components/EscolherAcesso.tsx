"use client";
import { useState } from "react";

/** Caixas das abas que o login pode abrir, com a opção "Todas". Vai dentro de um formulário. */
export default function EscolherAcesso({ abas, marcadas }: { abas: { id: string; nome: string }[]; marcadas: string[] | null }) {
  const [todas, setTodas] = useState(marcadas == null);
  const [sel, setSel] = useState<string[]>(marcadas ?? []);
  return (
    <div>
      <label className="chk" style={{ marginBottom: 8 }}>
        <input type="checkbox" name="todas" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> <b>Todas as abas</b>
      </label>
      <div className="chk-grade" style={{ opacity: todas ? 0.5 : 1 }}>
        {abas.map((a) => (
          <label key={a.id} className="chk">
            <input type="checkbox" name={`libera:${a.id}`} disabled={todas} checked={todas || sel.includes(a.id)}
              onChange={(e) => setSel((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))} /> {a.nome}
          </label>
        ))}
      </div>
    </div>
  );
}
