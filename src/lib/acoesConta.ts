"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir, usuarioAtual } from "@/lib/auth";
import { ABAS } from "@/lib/permissoes";

/** Salva quais abas aparecem no menu de um login (marcadas = aparecem). O próprio login ou quem edita Usuários. */
export async function acaoSalvarAbas(form: FormData) {
  const eu = await usuarioAtual();
  if (!eu) redirect("/login");
  const id = Number(form.get("id")) || eu.id;
  if (id !== eu.id) await exigir("usuarios", "editar");
  const ocultas = ABAS.filter((a) => a.id !== "painel" && form.get(`aba:${a.id}`) !== "on").map((a) => a.id);
  await db.usuario.update({ where: { id }, data: { abasOcultas: JSON.stringify(ocultas) } });
  await auditar(eu.nome, "alterou abas do menu", `login #${id}`);
  revalidatePath("/", "layout");
  const volta = String(form.get("volta") || "/conta");
  redirect(`${volta}?ok=` + encodeURIComponent("Abas do menu salvas."));
}

export async function acaoExcluirLogin(form: FormData) {
  const u = await exigir("usuarios", "excluir");
  const id = Number(form.get("id"));
  if (id === u.id) redirect("/usuarios?erro=" + encodeURIComponent("Você não pode excluir o seu próprio login."));
  const alvo = await db.usuario.findUniqueOrThrow({ where: { id } });
  await db.usuario.delete({ where: { id } });
  await auditar(u.nome, "excluiu login", alvo.email);
  redirect("/usuarios?ok=" + encodeURIComponent(`Login ${alvo.email} excluído.`));
}
