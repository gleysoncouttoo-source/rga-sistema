"use client";
import { useRouter } from "next/navigation";

/** Lista suspensa que abre o endereço da opção escolhida (filtros de tela sem botões grandes). */
export default function IrPara({ opcoes, valor, rotulo }: { opcoes: { href: string; nome: string }[]; valor: string; rotulo?: string }) {
  const r = useRouter();
  return (
    <label className="ir-para">
      {rotulo}
      <select value={valor} onChange={(e) => r.push(e.target.value)}>
        {opcoes.map((o) => <option key={o.href} value={o.href}>{o.nome}</option>)}
      </select>
    </label>
  );
}
