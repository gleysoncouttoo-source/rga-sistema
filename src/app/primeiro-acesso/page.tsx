import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { auditar, entrar } from "@/lib/auth";

// Cria o primeiro login (perfil Diretor). Só funciona enquanto não existe nenhum login no sistema.
async function criar(form: FormData) {
  "use server";
  if ((await db.usuario.count()) > 0) redirect("/login");
  const nome = String(form.get("nome") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const senha = String(form.get("senha") || "");
  if (!nome || !email) redirect("/primeiro-acesso?erro=" + encodeURIComponent("Preencha nome e e-mail."));
  if (senha.length < 8) redirect("/primeiro-acesso?erro=" + encodeURIComponent("A senha precisa ter pelo menos 8 caracteres."));
  const diretor = await db.perfil.findUniqueOrThrow({ where: { nome: "Diretor" } });
  await db.usuario.create({ data: { nome, email, senhaHash: await bcrypt.hash(senha, 10), perfilId: diretor.id } });
  await auditar(nome, "criou o primeiro acesso");
  await entrar(email, senha);
  redirect("/");
}

export default async function PrimeiroAcesso({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if ((await db.usuario.count()) > 0) redirect("/login");
  const { erro } = await searchParams;
  return (
    <main className="centro">
      <div className="caixa card">
        <h1>Primeiro acesso</h1>
        <p className="suave">Crie o login do primeiro diretor. Depois, os outros logins são criados em Usuários e perfis.</p>
        {erro && <div className="aviso erro">{erro}</div>}
        <form action={criar}>
          <label>Seu nome<input name="nome" required /></label>
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Senha (mínimo 8)<input name="senha" type="password" minLength={8} required /></label>
          <button className="btn">Criar e entrar</button>
        </form>
      </div>
    </main>
  );
}
