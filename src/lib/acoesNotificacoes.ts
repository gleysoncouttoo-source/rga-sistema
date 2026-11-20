"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, usuarioAtual } from "@/lib/auth";
import { avisoTeste, avisosDisponiveis } from "@/lib/notificacoes";

type Inscricao = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Guarda o aparelho (celular/computador) que aceitou receber avisos deste login. */
export async function acaoGuardarAparelho(inscricao: Inscricao, nome: string) {
  const u = await usuarioAtual();
  if (!u) return { ok: false, erro: "Entre de novo no sistema." };
  const { endpoint, keys } = inscricao || ({} as Inscricao);
  if (!endpoint?.startsWith("https://") || !keys?.p256dh || !keys?.auth) return { ok: false, erro: "O aparelho não mandou os dados do aviso." };
  await db.aparelhoPush.upsert({
    where: { endpoint },
    update: { usuarioId: u.id, p256dh: keys.p256dh, auth: keys.auth, nome: nome.slice(0, 40) },
    create: { usuarioId: u.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, nome: nome.slice(0, 40) },
  });
  await auditar(u.nome, "ativou avisos no celular", nome);
  revalidatePath("/conta");
  return { ok: true };
}

export async function acaoTirarAparelho(endpoint: string) {
  const u = await usuarioAtual();
  if (!u) return { ok: false };
  await db.aparelhoPush.deleteMany({ where: { endpoint, usuarioId: u.id } });
  await auditar(u.nome, "desativou avisos neste aparelho");
  revalidatePath("/conta");
  return { ok: true };
}

export async function acaoAvisoTeste() {
  const u = await usuarioAtual();
  if (!u) return { ok: false, enviados: 0 };
  return { ok: true, enviados: await avisoTeste(u.id) };
}

/** Salva quais avisos o login quer receber. Só aceita os da área liberada dele. */
export async function acaoSalvarAvisos(form: FormData) {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  const escolhidos = avisosDisponiveis(u.permissoes, u.liberadas).filter((t) => form.get(`aviso:${t.id}`) === "on").map((t) => t.id);
  await db.usuario.update({ where: { id: u.id }, data: { notificacoes: JSON.stringify(escolhidos) } });
  await auditar(u.nome, "escolheu avisos no celular", escolhidos.join(", ") || "nenhum");
  redirect("/conta?ok=" + encodeURIComponent("Avisos salvos.") + "#avisos");
}
