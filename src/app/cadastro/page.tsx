import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { auditar, usuarioAtual } from "@/lib/auth";
import MarcaCentro from "@/components/MarcaCentro";

const MAX_PENDENTES = 30; // evita que alguém encha a lista de pedidos
const volta = (m: string) => redirect("/cadastro?erro=" + encodeURIComponent(m));

// Qualquer pessoa cria a conta aqui; ela só entra depois que um diretor liberar em Usuários e perfis.
// O cargo NÃO vem do formulário: a conta nasce como Colaborador e só o diretor define o cargo ao liberar.
async function criarConta(form: FormData) {
  "use server";
  const nome = String(form.get("nome") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const senha = String(form.get("senha") || "");
  const senha2 = String(form.get("senha2") || "");
  if (!nome || !email) volta("Preencha seu nome e e-mail.");
  if (senha.length < 8) volta("A senha precisa ter pelo menos 8 caracteres.");
  if (senha !== senha2) volta("As duas senhas não são iguais.");
  if (await db.usuario.findUnique({ where: { email } })) volta("Já existe uma conta com esse e-mail. Se esqueceu a senha, fale com um diretor.");
  if ((await db.usuario.count({ where: { pendente: true } })) >= MAX_PENDENTES) volta("Há muitos cadastros esperando liberação. Fale com um diretor.");
  const perfil = await db.perfil.findUniqueOrThrow({ where: { nome: "Colaborador" } });
  await db.usuario.create({
    data: { nome, email, senhaHash: await bcrypt.hash(senha, 10), perfilId: perfil.id, ativo: false, pendente: true, abasLiberadas: "[]" },
  });
  await auditar(nome, "criou conta (aguardando liberação)", email);
  redirect("/cadastro?ok=1");
}

export default async function Cadastro({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  if (await usuarioAtual()) redirect("/");
  if ((await db.usuario.count()) === 0) redirect("/primeiro-acesso");
  const { erro, ok } = await searchParams;
  return (
    <main className="centro">
      <MarcaCentro />
      <div className="caixa card">
        <h1>Criar conta</h1>
        {ok ? (
          <>
            <div className="aviso ok">Conta criada! Agora é só esperar um diretor liberar o seu acesso. Depois disso, entre com o seu e-mail e senha.</div>
            <a className="btn" href="/login">Ir para a tela de entrada</a>
          </>
        ) : (
          <>
            <p className="suave">Preencha seus dados. Um diretor vai liberar o seu acesso e definir o seu cargo e as áreas que você vai usar.</p>
            {erro && <div className="aviso erro">{erro}</div>}
            <form action={criarConta}>
              <label>Seu nome<input name="nome" required autoComplete="name" /></label>
              <label>E-mail (será o seu login)<input name="email" type="email" required autoComplete="username" /></label>
              <label>Senha (mínimo 8)<input name="senha" type="password" minLength={8} required autoComplete="new-password" /></label>
              <label>Repita a senha<input name="senha2" type="password" minLength={8} required autoComplete="new-password" /></label>
              <button className="btn">Criar conta</button>
            </form>
            <p className="suave" style={{ marginTop: 18 }}>Já tem conta? <a href="/login">Entrar</a></p>
          </>
        )}
      </div>
    </main>
  );
}
