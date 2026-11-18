import { redirect } from "next/navigation";
import { entrar, usuarioAtual } from "@/lib/auth";
import { db } from "@/lib/db";
import MarcaCentro from "@/components/MarcaCentro";

async function acaoEntrar(form: FormData) {
  "use server";
  const erro = await entrar(String(form.get("email") || ""), String(form.get("senha") || ""));
  if (erro) redirect("/login?erro=" + encodeURIComponent(erro));
  redirect("/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await usuarioAtual()) redirect("/");
  if ((await db.usuario.count()) === 0) redirect("/primeiro-acesso");
  const { erro } = await searchParams;
  return (
    <main className="centro">
      <MarcaCentro />
      <div className="caixa card">
        <h1>Sistema R.G.A</h1>
        <p className="suave">Entre com seu e-mail e senha.</p>
        {erro && <div className="aviso erro">{erro}</div>}
        <form action={acaoEntrar}>
          <label>E-mail<input name="email" type="email" required autoComplete="username" /></label>
          <label>Senha<input name="senha" type="password" required autoComplete="current-password" /></label>
          <button className="btn">Entrar</button>
        </form>
        <p className="suave" style={{ marginTop: 18 }}>
          Ainda não tem login? <a href="/cadastro">Criar conta</a>
        </p>
        <p className="suave">
          Operador da produção? <a href="/apontar">Registrar produção</a>
        </p>
      </div>
    </main>
  );
}
