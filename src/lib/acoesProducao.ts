"use server";
// Ações da Produção usadas pela tela do escritório (com login)
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditar, exigir } from "@/lib/auth";
import { Erro, cancelarCronometro, excluirApontamento, finalizarCronometro, iniciarCronometro, lancarProducao, pausarCronometro } from "@/lib/fluxo";
import { num } from "@/lib/formato";

const nn = (v: FormDataEntryValue | null) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const voltar = (base: string, k: "erro" | "ok", m: string) => redirect(`${base}${base.includes("?") ? "&" : "?"}${k}=` + encodeURIComponent(m));

function msgLancamento(r: { lote: string; pecasHora: number; novoRecorde: boolean; recordePecasHora: number | null }) {
  return r.novoRecorde
    ? `Produção lançada no lote ${r.lote}. Novo recorde: ${num(r.pecasHora)} peças/hora${r.recordePecasHora ? ` (antes ${num(r.recordePecasHora)})` : ""}. Falta confirmar.`
    : `Produção lançada no lote ${r.lote}: ${num(r.pecasHora)} peças/hora${r.recordePecasHora ? ` (recorde ${num(r.recordePecasHora)})` : ""}.`;
}

export async function acaoIniciarProcesso(form: FormData) {
  const u = await exigir("producao", "criar");
  const p = {
    itemId: nn(form.get("itemId")), passoId: nn(form.get("passoId")), loteId: nn(form.get("loteId")) || null,
    planejado: nn(form.get("planejado")) || null, funcionarioId: nn(form.get("funcionarioId")), usuario: u.nome,
  };
  if (!p.itemId || !p.passoId || !p.funcionarioId) voltar("/producao/novo", "erro", "Escolha o produto, a parte, o processo e o colaborador.");
  let msg = "";
  try {
    if (form.get("modo") === "lancar") {
      const r = await lancarProducao({ ...p, quantidade: Math.round(nn(form.get("quantidade"))), refugo: Math.max(0, Math.round(nn(form.get("refugo")))), minutos: nn(form.get("minutos")), logado: true });
      msg = msgLancamento(r);
    } else {
      const r = await iniciarCronometro(p);
      msg = `Cronômetro ligado (lote ${r.lote}).`;
    }
  } catch (e) {
    if (e instanceof Erro) voltar(`/producao/novo?item=${p.itemId}&passo=${p.passoId}`, "erro", e.message);
    throw e;
  }
  await auditar(u.nome, "produção", msg);
  revalidatePath("/producao");
  voltar("/producao", "ok", msg);
}

export async function acaoPausar(form: FormData) {
  await exigir("producao", "criar");
  await pausarCronometro(nn(form.get("id")));
  revalidatePath("/producao");
}

export async function acaoFinalizar(form: FormData) {
  const u = await exigir("producao", "criar");
  let msg = "";
  try {
    const r = await finalizarCronometro(nn(form.get("id")), { quantidade: Math.round(nn(form.get("quantidade"))), refugo: Math.max(0, Math.round(nn(form.get("refugo")))), usuario: u.nome, logado: true });
    msg = msgLancamento(r);
  } catch (e) {
    if (e instanceof Erro) voltar("/producao", "erro", e.message);
    throw e;
  }
  revalidatePath("/producao");
  voltar("/producao", "ok", msg);
}

export async function acaoCancelarCronometro(form: FormData) {
  await exigir("producao", "excluir");
  await cancelarCronometro(nn(form.get("id")));
  revalidatePath("/producao");
}

export async function acaoExcluirApontamento(form: FormData) {
  const u = await exigir("producao", "excluir");
  const volta = String(form.get("volta") || "/producao");
  try {
    await excluirApontamento(nn(form.get("id")), u.nome);
  } catch (e) {
    if (e instanceof Erro) voltar(volta, "erro", e.message);
    throw e;
  }
  revalidatePath("/producao");
  voltar(volta, "ok", "Lançamento excluído e estoque desfeito.");
}
