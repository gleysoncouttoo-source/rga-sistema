/** Mostra em qual processo as peças estão, no formato "2/5 Pintura" (2º processo de um total de 5). */
export type EtapaPos = { pos: number; total: number; nome: string; aguardando: number; rodando: number };

const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Selos curtos (cabem no celular): "2/5 · 30" */
export function SelosEtapa({ etapas }: { etapas: EtapaPos[] }) {
  if (!etapas.length) return null;
  return (
    <div className="selos-etapa">
      {etapas.map((e) => <span key={e.pos} className="selo-etapa" title={`${e.pos}º processo de ${e.total}: ${e.nome}`}>{e.pos}/{e.total}</span>)}
    </div>
  );
}

/** Texto completo: "2/5 Pintura espelho · 30 aguardando · ⏱ 5 rodando", e o processo todo com o atual destacado. */
export function DetalheEtapas({ etapas, processo }: { etapas: EtapaPos[]; processo: string[] }) {
  if (!processo.length) return <span className="suave">sem processo cadastrado</span>;
  const atuais = new Set(etapas.map((e) => e.pos));
  return (
    <>
      {etapas.map((e) => (
        <div key={e.pos} style={{ marginBottom: 4 }}>
          <span className="selo-etapa">{e.pos}/{e.total}</span> <b>{e.nome}</b>
          {e.aguardando > 0 && <> · <b>{n(e.aguardando)}</b> aguardando</>}
          {e.rodando > 0 && <> · ⏱ cronômetro ligado{e.rodando > 1 ? ` (${e.rodando})` : ""}</>}
        </div>
      ))}
      <div className="suave processo-linha">
        {etapas.length === 0 && <>{processo.length} processo(s): </>}
        {processo.map((p, k) => (
          <span key={k}>{k > 0 && " → "}<span className={atuais.has(k + 1) ? "atual" : undefined}>{k + 1}. {p}</span></span>
        ))}
      </div>
    </>
  );
}
