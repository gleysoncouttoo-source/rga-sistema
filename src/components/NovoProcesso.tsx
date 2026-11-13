"use client";
import { useMemo, useState } from "react";
import type { DadosNovoProcesso } from "@/lib/fluxo";

type It = DadosNovoProcesso["itens"][number];
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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
  const [busca, setBusca] = useState("");
  const [produtoId, setProdutoId] = useState<number | null>(ini ? ini.id : null);
  const [itemId, setItemId] = useState<number | null>(ini ? ini.id : null);
  const [passoId, setPassoId] = useState<number | null>(inicial?.passoId ?? null);
  const [loteId, setLoteId] = useState<string>(inicial?.loteId ? String(inicial.loteId) : "");
  const [func, setFunc] = useState<string>(inicial?.funcionarioId ? String(inicial.funcionarioId) : "");
  const [modo, setModo] = useState<"cronometro" | "lancar">("cronometro");

  const produtos = dados.itens.filter((i) => i.tipo === "produto");
  const achados = busca.trim()
    ? dados.itens.filter((i) => norm(`${i.codigo ?? ""} ${i.nome}`).includes(norm(busca.trim()))).slice(0, 40)
    : produtos;

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

  return (
    <form action={acao} className="etapas-wizard">
      <input type="hidden" name="itemId" value={itemId ?? ""} />
      <input type="hidden" name="passoId" value={passoId ?? ""} />
      <input type="hidden" name="loteId" value={loteId} />

      <h3><span className="passo-n">1</span> Produto (SKU)</h3>
      <input placeholder="Buscar por SKU, produto ou peça…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
      <div className="escolha">
        {achados.map((i) => (
          <button type="button" key={i.id} className={(produtoId === i.id || (!produtoId && itemId === i.id)) ? "sel" : ""}
            onClick={() => { if (i.tipo === "produto") { setProdutoId(i.id); setItemId(null); setPassoId(null); } else { setProdutoId(null); escolherItem(i); } setBusca(""); }}>
            <Mini foto={i.foto} />
            <b style={{ fontSize: ".9rem" }}>{i.codigo}</b>
            <small>{i.nome}</small>
          </button>
        ))}
        {achados.length === 0 && <p className="suave">Nada encontrado.</p>}
      </div>

      {produtoId && (
        <>
          <h3><span className="passo-n">2</span> Parte do produto</h3>
          <div className="escolha lista">
            {partes.map((i) => (
              <button type="button" key={i.id} className={itemId === i.id ? "sel" : ""} disabled={!i.passos.length} style={!i.passos.length ? { opacity: 0.5 } : undefined} onClick={() => escolherItem(i)}>
                <Mini foto={i.foto} />
                <span><b>{i.id === produtoId ? "Montagem final" : i.nome}</b> <small>· {i.codigo}</small><br />
                  <small>{i.passos.length ? i.passos.map((p) => `${p.nome} (${p.etapa})`).join(" → ") : "sem processo cadastrado (cadastre em Produtos)"}</small></span>
              </button>
            ))}
          </div>
        </>
      )}

      {item && (
        <>
          <h3><span className="passo-n">3</span> Processo de {item.nome}</h3>
          <div className="escolha lista">
            {item.passos.map((p, k) => (
              <button type="button" key={p.id} className={passoId === p.id ? "sel" : ""} onClick={() => { setPassoId(p.id); setLoteId(""); }}>
                <span className="passo-n">{k + 1}</span>
                <span><b>{p.nome}</b> <small>· {p.etapa}</small><br />
                  <small>{k === 0 ? "Começa aqui (consome a matéria-prima)" : `${n(esperando(p.id))} peça(s) esperando, prontas de ${item.passos[k - 1].nome}`}</small></span>
              </button>
            ))}
          </div>
        </>
      )}

      {passo && (
        <>
          <h3><span className="passo-n">4</span> Lote</h3>
          <div className="escolha lista">
            <button type="button" className={loteId === "" ? "sel" : ""} onClick={() => setLoteId("")}>
              <span><b>{idx === 0 ? "Novo lote" : "Sem lote"}</b><br /><small>{idx === 0 ? "Abre um lote novo com as peças que você vai fazer agora" : "Peças que já estavam prontas antes (fora do sistema)"}</small></span>
            </button>
            {lotesPasso.map((l) => {
              const ant = idx > 0 ? l.passos.find((x) => x.id === item!.passos[idx - 1].id) : undefined;
              const aqui = l.passos.find((x) => x.id === passo.id);
              return (
                <button type="button" key={l.id} className={loteId === String(l.id) ? "sel" : ""} onClick={() => setLoteId(String(l.id))}>
                  <span><b>{l.numero}</b><br /><small>{idx > 0 ? `${n(ant?.aguardando ?? 0)} esperando` : `${n(aqui?.feito ?? 0)} feitas${l.planejado ? ` de ${n(l.planejado)} planejadas` : ""}`}{aqui?.emAndamento ? ` · ${aqui.emAndamento} em andamento` : ""}</small></span>
                </button>
              );
            })}
          </div>
          {idx === 0 && loteId === "" && <label style={{ marginTop: 10, maxWidth: 260 }}>Quantidade planejada no lote (opcional)<input name="planejado" type="number" inputMode="numeric" min={1} /></label>}

          <h3><span className="passo-n">5</span> Colaborador</h3>
          <select name="funcionarioId" value={func} onChange={(e) => setFunc(e.target.value)} required style={{ width: "100%", maxWidth: 420 }}>
            <option value="" disabled>Escolha quem vai fazer</option>
            {dados.funcs.filter((f) => !comPin || f.temPin).map((f) => <option key={f.id} value={f.id}>{f.nome}{f.setor ? ` · ${f.setor}` : ""}</option>)}
          </select>

          <h3><span className="passo-n">6</span> Tempo</h3>
          <div className="abas">
            <a href="#" className={modo === "cronometro" ? "ativo" : ""} onClick={(e) => { e.preventDefault(); setModo("cronometro"); }}>Cronometrar</a>
            <a href="#" className={modo === "lancar" ? "ativo" : ""} onClick={(e) => { e.preventDefault(); setModo("lancar"); }}>Já terminei: lançar tempo e quantidade</a>
          </div>
          {modo === "lancar" ? (
            <div className="campos" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <label>Peças boas<input name="quantidade" type="number" inputMode="numeric" min={0} required /></label>
              <label>Refugo<input name="refugo" type="number" inputMode="numeric" min={0} defaultValue={0} /></label>
              <label>Tempo (minutos)<input name="minutos" type="number" inputMode="decimal" min={0.1} step="any" required /></label>
            </div>
          ) : (
            <p className="suave" style={{ margin: "0 0 8px" }}>O relógio começa agora. No fim, toque em <b>Finalizar</b> e informe quantas peças saíram.</p>
          )}
          {comPin && <label style={{ marginTop: 12, maxWidth: 260 }}>PIN do colaborador<input name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" required autoComplete="off" /></label>}
          <div className="acoes" style={{ marginTop: 16 }}>
            <button className="btn" name="modo" value={modo} disabled={!pronto}>{modo === "cronometro" ? "▶ Iniciar cronômetro" : "Lançar produção"}</button>
          </div>
        </>
      )}
    </form>
  );
}
