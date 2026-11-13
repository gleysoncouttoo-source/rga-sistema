import type { SaldoPasso } from "@/lib/fluxo";

const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const tempo = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}` : `${Math.round(min)} min`);

/** Caminho do lote pelos processos: quanto saiu de cada um, quanto espera o próximo e quem fez. */
export default function Trilha({ passos }: { passos: SaldoPasso[] }) {
  return (
    <div className="trilha">
      {passos.map((p, i) => {
        const ultimo = i === passos.length - 1;
        const cls = p.feito > 0 && (ultimo || p.aguardando <= 0) ? "feito" : p.aguardando > 0 ? "espera" : "";
        return (
          <div key={`${p.id}-${i}`} style={{ display: "contents" }}>
            {i > 0 && <span className="seta">→</span>}
            <div className={`p ${cls}`}>
              <b>{p.nome}</b>
              <span className="q">{n(p.feito)}</span> <span className="suave">feitas{p.refugo ? ` · ${n(p.refugo)} refugo` : ""}</span>
              {!ultimo && p.aguardando !== 0 && <div style={{ color: p.aguardando < 0 ? "var(--erro)" : "var(--alerta)", fontWeight: 600 }}>{n(p.aguardando)} esperando o próximo</div>}
              {ultimo && p.feito > 0 && <div style={{ color: "var(--ok)", fontWeight: 600 }}>prontas no estoque</div>}
              {p.emAndamento > 0 && <div className="suave">⏱ {p.emAndamento} em andamento</div>}
              {p.quem.map((q) => <div key={q.nome} className="suave" style={{ fontSize: ".8rem" }}>{q.nome}: {n(q.qtd)} em {tempo(q.minutos)}</div>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
