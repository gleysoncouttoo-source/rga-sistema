import { redirect } from "next/navigation";
import { db, comoOperador } from "@/lib/db";
import { registrarApontamento } from "@/lib/producao";
import { Erro, dadosNovoProcesso, finalizarCronometro, iniciarCronometro, lancarProducao, pausarCronometro } from "@/lib/fluxo";
import { dataHora, num } from "@/lib/formato";
import NovoProcesso from "@/components/NovoProcesso";
import Cronometro from "@/components/Cronometro";
import MarcaCentro from "@/components/MarcaCentro";

const nn = (v: FormDataEntryValue | null) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };

/** Confere se o colaborador escolhido existe e está ativo (basta o nome, sem PIN). */
async function conferirColaborador(funcionarioId: number, volta: string) {
  const f = await db.funcionario.findUnique({ where: { id: funcionarioId } });
  if (!f || !f.ativo) redirect(`${volta}${volta.includes("?") ? "&" : "?"}erro=` + encodeURIComponent("Escolha seu nome na lista."));
  return f!;
}

async function iniciar(form: FormData) {
  "use server";
  const funcionarioId = nn(form.get("funcionarioId"));
  const p = { itemId: nn(form.get("itemId")), passoId: nn(form.get("passoId")), loteId: nn(form.get("loteId")) || null, planejado: nn(form.get("planejado")) || null, funcionarioId };
  const volta = `/apontar?f=${funcionarioId}&item=${p.itemId}&passo=${p.passoId}`;
  if (!p.itemId || !p.passoId || !funcionarioId) redirect("/apontar?erro=" + encodeURIComponent("Escolha o produto, a parte, o processo e seu nome."));
  const f = await conferirColaborador(funcionarioId, volta);
  let msg = "";
  try {
    msg = await comoOperador(`${f.nome} (celular)`, async () => {
      if (form.get("modo") === "lancar") {
        const r = await lancarProducao({ ...p, quantidade: Math.round(nn(form.get("quantidade"))), refugo: Math.max(0, Math.round(nn(form.get("refugo")))), minutos: nn(form.get("minutos")), usuario: f.nome, logado: false });
        return r.novoRecorde ? `Novo recorde! ${num(r.pecasHora)} peças/hora. O gestor vai confirmar.` : `Produção registrada no lote ${r.lote}: ${num(r.pecasHora)} peças/hora${r.recordePecasHora ? ` (recorde ${num(r.recordePecasHora)})` : ""}.`;
      }
      const r = await iniciarCronometro({ ...p, usuario: f.nome });
      return `Cronômetro ligado (lote ${r.lote}). Quando terminar, finalize aqui embaixo.`;
    });
  } catch (e) {
    if (e instanceof Erro) redirect(`${volta}&erro=` + encodeURIComponent(e.message));
    throw e;
  }
  redirect(`/apontar?f=${funcionarioId}&msg=` + encodeURIComponent(msg));
}

async function finalizar(form: FormData) {
  "use server";
  const id = nn(form.get("id"));
  const pr = await db.processoProducao.findUniqueOrThrow({ where: { id } });
  const f = await conferirColaborador(pr.funcionarioId, `/apontar?f=${pr.funcionarioId}`);
  let msg = "";
  try {
    msg = await comoOperador(`${f.nome} (celular)`, async () => {
      if (form.get("acao") === "pausar") { await pausarCronometro(id); return pr.pausadoEm ? "Cronômetro retomado." : "Cronômetro pausado."; }
      const r = await finalizarCronometro(id, { quantidade: Math.round(nn(form.get("quantidade"))), refugo: Math.max(0, Math.round(nn(form.get("refugo")))), usuario: f.nome, logado: false });
      return r.novoRecorde ? `Novo recorde! ${num(r.pecasHora)} peças/hora. O gestor vai confirmar.` : `Produção registrada no lote ${r.lote}: ${num(r.pecasHora)} peças/hora.`;
    });
  } catch (e) {
    if (e instanceof Erro) redirect(`/apontar?f=${pr.funcionarioId}&erro=` + encodeURIComponent(e.message));
    throw e;
  }
  redirect(`/apontar?f=${pr.funcionarioId}&msg=` + encodeURIComponent(msg));
}

async function apontar(form: FormData) {
  "use server";
  const funcionarioId = Number(form.get("funcionario"));
  const operacaoId = Number(form.get("operacao"));
  const quantidade = Math.round(Number(form.get("quantidade")));
  const refugo = Math.max(0, Math.round(Number(form.get("refugo") || 0)));
  const minutos = Number(String(form.get("minutos") || "").replace(",", "."));
  const erro = (m: string) => redirect(`/apontar?f=${funcionarioId || ""}&erro=` + encodeURIComponent(m));

  if (!funcionarioId || !operacaoId) erro("Escolha seu nome e a operação.");
  if (!(quantidade > 0)) erro("Informe quantas peças boas você fez.");
  if (!(minutos > 0) || minutos > 16 * 60) erro("Informe o tempo trabalhado em minutos.");

  const f = await conferirColaborador(funcionarioId, `/apontar?f=${funcionarioId}`);

  const r = await comoOperador(`${f.nome} (celular)`, () => registrarApontamento({ funcionarioId, operacaoId, quantidade, refugo, minutos }));
  const q = new URLSearchParams({
    f: String(funcionarioId),
    ok: "1",
    ph: String(Math.round(r.pecasHora)),
    rec: r.recordePecasHora ? String(Math.round(r.recordePecasHora)) : "",
    novo: r.novoRecorde ? "1" : "",
    min: r.abaixoDoMinimo ? "1" : "",
  });
  redirect("/apontar?" + q.toString());
}

export default async function Apontar({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [funcs, etapas, dados, andamento] = await Promise.all([
    db.funcionario.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    db.etapa.findMany({ orderBy: { ordem: "asc" }, include: { operacoes: { where: { ativo: true }, orderBy: { nome: "asc" } } } }),
    dadosNovoProcesso(),
    db.processoProducao.findMany({ where: { status: "andamento" }, include: { item: true, passo: { include: { operacao: true } }, lote: true, funcionario: true }, orderBy: { inicio: "asc" } }),
  ]);
  const meus = sp.f ? andamento.filter((a) => String(a.funcionarioId) === sp.f) : andamento;
  const ph = Number(sp.ph), rec = Number(sp.rec);
  return (
    <main className="centro">
      <MarcaCentro />
      <div className="caixa card" style={{ maxWidth: 560 }}>
        <h1>Registrar produção</h1>
        {sp.erro && <div className="aviso erro">{sp.erro}</div>}
        {sp.msg && <div className="aviso ok">{sp.msg}</div>}
        {meus.length > 0 && (
          <>
            <h2 style={{ marginTop: 0 }}>Em andamento</h2>
            {meus.map((pr) => (
              <div className="card" key={pr.id} style={{ background: "var(--bg)" }}>
                <div className="com-foto">
                  <span className="mini media">{pr.item.foto ? <img src={pr.item.foto} alt="" /> : "sem foto"}</span>
                  <span className="t"><b>{pr.passo.operacao.nome}</b><small>{pr.item.nome}</small><small>Lote {pr.lote.numero} · {pr.funcionario.nome} · {dataHora(pr.inicio)}</small></span>
                </div>
                <div style={{ margin: "8px 0" }}><Cronometro inicio={pr.inicio.toISOString()} segPausado={pr.segPausado} pausadoEm={pr.pausadoEm?.toISOString() ?? null} /></div>
                <form action={finalizar}>
                  <input type="hidden" name="id" value={pr.id} />
                  <div className="apontar-campos tres" style={{ marginTop: 0 }}>
                    <label>Peças boas<input name="quantidade" type="number" inputMode="numeric" min={0} /></label>
                    <label>Refugo<input name="refugo" type="number" inputMode="numeric" min={0} defaultValue={0} /></label>
                  </div>
                  <div className="acoes">
                    <button className="btn" name="acao" value="finalizar">■ Finalizar</button>
                    <button className="btn sec" name="acao" value="pausar" formNoValidate={false}>{pr.pausadoEm ? "▶ Retomar" : "Ⅱ Pausar"}</button>
                  </div>
                </form>
              </div>
            ))}
          </>
        )}
        <h2>Iniciar novo processo</h2>
        <NovoProcesso dados={dados} acao={iniciar} inicial={{ itemId: Number(sp.item) || undefined, passoId: Number(sp.passo) || undefined, funcionarioId: Number(sp.f) || undefined }} />
        <details className="editar" style={{ marginTop: 24 }}>
          <summary>Lançamento avulso (operação sem peça cadastrada)</summary>
        {sp.ok && (
          <div className="aviso ok">
            {sp.novo ? (
              <><b>Novo recorde!</b> {num(ph)} peças/hora{rec ? ` (o recorde era ${num(rec)})` : ""}. O gestor vai confirmar.</>
            ) : (
              <>Produção registrada: {num(ph)} peças/hora{rec ? `. Recorde: ${num(rec)} peças/hora (${num((ph / rec) * 100)}% do recorde)` : ""}.
                {sp.min ? " Registros com menos tempo que o mínimo não contam para recorde." : ""}</>
            )}
          </div>
        )}
        {funcs.length === 0 ? (
          <p className="suave">Nenhum colaborador cadastrado. Peça ao gestor para cadastrar.</p>
        ) : (
          <form action={apontar}>
            <label>Seu nome
              <select name="funcionario" defaultValue={sp.f ?? ""} required>
                <option value="" disabled>Escolha</option>
                {funcs.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
            <label>Operação
              <select name="operacao" defaultValue="" required>
                <option value="" disabled>Escolha a etapa e a peça</option>
                {etapas.map((e) => (
                  <optgroup key={e.id} label={e.nome}>
                    {e.operacoes.map((o) => <option key={o.id} value={o.id}>{e.nome} — {o.nome}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>Peças boas<input name="quantidade" type="number" inputMode="numeric" min={1} required /></label>
            <label>Refugo (peças perdidas)<input name="refugo" type="number" inputMode="numeric" min={0} defaultValue={0} /></label>
            <label>Tempo trabalhado (minutos)<input name="minutos" type="number" inputMode="decimal" min={1} step="any" required /></label>
            <button className="btn">Registrar</button>
          </form>
        )}
        </details>
        <p className="suave" style={{ marginTop: 18 }}><a href="/producao">← Voltar para o sistema</a></p>
      </div>
    </main>
  );
}
