"use client";
import { useMemo, useState } from "react";
import type { DadosNovoProcesso } from "@/lib/fluxo";

type It = DadosNovoProcesso["itens"][number];
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

function Mini({ foto }: { foto: string | null }) {
  return <span className="mini">{foto ? <img src={foto} alt="" /> : "sem foto"}</span>;
}

/** Iniciar novo processo: escolhe o produto (com foto), a parte, o processo, o lote e o colaborador.
 *  Depois liga o cronômetro ou lança tempo + quantidade direto. */
export default function NovoProcesso({ dados, acao, comPin = false, inicial }: {
  dados: DadosNovoProcesso; acao: (f: FormData) => void | Promise<void>; comPin?: boolean; inicial?: { itemId?: number; passoId?: number; loteId?: number; funcionarioId?: number };
}) {
  const mapa = useMemo(() => new Map(dados.itens.map((i) => [i.id, i])), [dados.itens]);
  const ini = inicial?.itemId ? mapa.get(inicial.itemId) : undefined;
  const [produtoId, setProdutoId] = useState<number | null>(ini && ini.tipo === "produto" ? ini.id : null);
  const [itemId, setItemId] = useState<number | null>(ini ? ini.id : null);
  const [passoId, setPassoId] = useState<number | null>(inicial?.passoId ?? null);
  const [loteId, setLoteId] = useState<string>(inicial?.loteId ? String(inicial.loteId) : "");
  const [func, setFunc] = useState<string>(inicial?.funcionarioId ? String(inicial.funcionarioId) : "");
  const [modo, setModo] = useState<"cronometro" | "lancar">("cronometro");

  const produtos = dados.itens.filter((i) => i.tipo === "produto");
  const pecasSoltas = dados.itens.filter((i) => i.tipo !== "produto" && i.passos.length > 0);

  // partes do produto: ele mesmo (montagem final) e tudo o que vai dentro dele que tem processo ou é fabricado
  const partes = useMemo(() => {
    if (!produtoId) return [] as It[];
    const vis = new Set<number>(); const out: It[] = [];
    const visita = (id: number) => {
      if (vis.has(id)) return; vis.add(id);
      const i = mapa.get(id); if (!i) return;
      out.push(i); i.filhos.forEach(visita);
    };
    visita(produtoId);
    return out;
  }, [produtoId, mapa]);

  const item = itemId ? mapa.get(itemId) : undefined;
  const idx = item && passoId ? item.passos.findIndex((p) => p.id === passoId) : -1;
  const passo = idx >= 0 ? item!.passos[idx] : undefined;
  const lotesItem = dados.lotes.filter((l) => l.itemId === itemId);
  const esperando = (pid: number) => {
    if (!item) return 0;
    const k = item.passos.findIndex((p) => p.id === pid);
    if (k <= 0) return 0;
    return lotesItem.reduce((s, l) => s + Math.max(0, l.passos.find((x) => x.id === item.passos[k - 1].id)?.aguardando ?? 0), 0);
  };
  const lotesPasso = idx < 0 ? [] : idx === 0 ? lotesItem : lotesItem.filter((l) => (l.passos.find((x) => x.id === item!.passos[idx - 1].id)?.aguardando ?? 0) > 0);
  const escolherItem = (i: It) => { setItemId(i.id); setPassoId(i.passos.length === 1 ? i.passos[0].id : null); setLoteId(""); };
  const pronto = item && passo && func;
  const escolhido = produtoId ? mapa.get(produtoId) : item;

  return (
    <form action={acao} className="etapas-wizard">
      <input type="hidden" name="itemId" value={itemId ?? ""} />
      <input type="hidden" name="passoId" value={passoId ?? ""} />
      <input type="hidden" name="loteId" value={loteId} />

      <div className="apontar-campos">
        <label>1. Produto ou peça (SKU)
          <span className="com-mini">
            {escolhido && <Mini foto={escolhido.foto} />}
            <select value={produtoId ? `p${produtoId}` : itemId ? `i${itemId}` : ""} required
              onChange={(e) => {
                const v = e.target.value; const id = Number(v.slice(1)); const i = mapa.get(id);
                if (!i) return;
                if (v[0] === "p") { setProdutoId(id); setItemId(null); setPassoId(null); setLoteId(""); } else { setProdutoId(null); escolherItem(i); }
              }}>
              <option value="" disabled>Escolha o produto</option>
              <optgroup label="Produtos">
                {produtos.map((i) => <option key={i.id} value={`p${i.id}`}>{i.codigo ? `${i.codigo} · ` : ""}{i.nome}</option>)}
              </optgroup>
              {pecasSoltas.length > 0 && (
                <optgroup label="Peças">
                  {pecasSoltas.map((i) => <option key={i.id} value={`i${i.id}`}>{i.codigo ? `${i.codigo} · ` : ""}{i.nome}</option>)}
                </optgroup>
              )}
            </select>
          </span>
        </label>

        {produtoId && (
          <label>2. Parte do produto
            <select value={itemId ?? ""} required onChange={(e) => { const i = mapa.get(Number(e.target.value)); if (i) escolherItem(i); }}>
              <option value="" disabled>Escolha a parte</option>
              {partes.map((i) => (
                <option key={i.id} value={i.id} disabled={!i.passos.length}>
                  {i.id === produtoId ? "Montagem final" : i.nome}{i.codigo ? ` · ${i.codigo}` : ""}{!i.passos.length ? " (sem processo)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {item && (
          <label>3. Processo
            <select value={passoId ?? ""} required onChange={(e) => { setPassoId(Number(e.target.value)); setLoteId(""); }}>
              <option value="" disabled>Escolha o processo</option>
              {item.passos.map((p, k) => (
                <option key={p.id} value={p.id}>{k + 1}. {p.nome} ({p.etapa}){k > 0 ? ` · ${n(esperando(p.id))} esperando` : ""}</option>
              ))}
            </select>
            {passo && <small className="suave">{idx === 0 ? "Começa aqui (consome a matéria-prima)." : `Peças prontas de ${item.passos[idx - 1].nome} esperando: ${n(esperando(passo.id))}.`}</small>}
          </label>
        )}

        {passo && (
          <label>4. Lote
            <select value={loteId} onChange={(e) => setLoteId(e.target.value)}>
              <option value="">{idx === 0 ? "Novo lote" : "Sem lote (peças de antes do sistema)"}</option>
              {lotesPasso.map((l) => {
                const ant = idx > 0 ? l.passos.find((x) => x.id === item!.passos[idx - 1].id) : undefined;
                const aqui = l.passos.find((x) => x.id === passo.id);
                return (
                  <option key={l.id} value={l.id}>
                    {l.numero} · {idx > 0 ? `${n(ant?.aguardando ?? 0)} esperando` : `${n(aqui?.feito ?? 0)} feitas${l.planejado ? ` de ${n(l.planejado)}` : ""}`}{aqui?.emAndamento ? ` · ${aqui.emAndamento} em andamento` : ""}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        {passo && idx === 0 && loteId === "" && <label>Quantidade planejada no lote (opcional)<input name="planejado" type="number" inputMode="numeric" min={1} /></label>}
      </div>

      {passo && (
        <>
          <div className="apontar-campos">
            <label>5. Colaborador
              <select name="funcionarioId" value={func} onChange={(e) => setFunc(e.target.value)} required>
                <option value="" disabled>Escolha quem vai fazer</option>
                {dados.funcs.filter((f) => !comPin || f.temPin).map((f) => <option key={f.id} value={f.id}>{f.nome}{f.setor ? ` · ${f.setor}` : ""}</option>)}
              </select>
            </label>
            <label>6. Tempo
              <select value={modo} onChange={(e) => setModo(e.target.value as "cronometro" | "lancar")}>
                <option value="cronometro">Cronometrar agora</option>
                <option value="lancar">Já terminei: lançar tempo e quantidade</option>
              </select>
            </label>
          </div>
          {modo === "lancar" ? (
            <div className="apontar-campos tres">
              <label>Peças boas<input name="quantidade" type="number" inputMode="numeric" min={0} required /></label>
              <label>Refugo<input name="refugo" type="number" inputMode="numeric" min={0} defaultValue={0} /></label>
              <label>Tempo (minutos)<input name="minutos" type="number" inputMode="decimal" min={0.1} step="any" required /></label>
            </div>
          ) : (
            <p className="suave" style={{ margin: "10px 0 0", fontSize: ".9rem" }}>O relógio começa agora. No fim, toque em <b>Finalizar</b> e informe quantas peças saíram.</p>
          )}
          {comPin && <label style={{ marginTop: 12, maxWidth: 220 }}>PIN do colaborador<input name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" required autoComplete="off" /></label>}
          <div className="acoes" style={{ marginTop: 16 }}>
            <button className="btn" name="modo" value={modo} disabled={!pronto}>{modo === "cronometro" ? "▶ Iniciar cronômetro" : "Lançar produção"}</button>
          </div>
        </>
      )}
    </form>
  );
}
