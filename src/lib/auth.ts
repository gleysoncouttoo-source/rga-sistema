import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { lerPermissoes, pode, type Acao, type Modulo } from "./permissoes";

const COOKIE = "rga_sessao";
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;

export async function entrar(email: string, senha: string): Promise<string | null> {
  const u = await db.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!u || !u.ativo) return "E-mail ou senha incorretos.";
  if (u.bloqueadoAte && u.bloqueadoAte > new Date()) {
    return "Login bloqueado por excesso de tentativas. Tente de novo em alguns minutos.";
  }
  const ok = await bcrypt.compare(senha, u.senhaHash);
  if (!ok) {
    const t = u.tentativas + 1;
    await db.usuario.update({
      where: { id: u.id },
      data: {
        tentativas: t >= MAX_TENTATIVAS ? 0 : t,
        bloqueadoAte: t >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MIN * 60_000) : null,
      },
    });
    return "E-mail ou senha incorretos.";
  }
  await db.usuario.update({ where: { id: u.id }, data: { tentativas: 0, bloqueadoAte: null } });
  const id = randomBytes(32).toString("hex");
  const dias = Number(process.env.SESSION_DAYS || 7);
  const expiraEm = new Date(Date.now() + dias * 86_400_000);
  await db.sessao.create({ data: { id, usuarioId: u.id, expiraEm } });
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiraEm,
    path: "/",
  });
  await auditar(u.nome, "login");
  return null;
}

export async function sair() {
  const c = await cookies();
  const id = c.get(COOKIE)?.value;
  if (id) await db.sessao.deleteMany({ where: { id } });
  c.delete(COOKIE);
}

export async function usuarioAtual() {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const s = await db.sessao.findUnique({ where: { id }, include: { usuario: { include: { perfil: true } } } });
  if (!s || s.expiraEm < new Date() || !s.usuario.ativo) return null;
  const permissoes = lerPermissoes(s.usuario.perfil.permissoes);
  return { ...s.usuario, permissoes };
}

export type UsuarioAtual = NonNullable<Awaited<ReturnType<typeof usuarioAtual>>>;

/** Garante login e permissão; senão redireciona. */
export async function exigir(modulo: Modulo, acao: Acao = "ver"): Promise<UsuarioAtual> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (!pode(u.permissoes, modulo, acao)) redirect("/?sem-permissao=1");
  return u;
}

export async function auditar(usuario: string, acao: string, detalhe?: string) {
  await db.auditoria.create({ data: { usuario, acao, detalhe } });
}
