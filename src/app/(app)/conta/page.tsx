import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { auditar, usuarioAtual } from "@/lib/auth";
import { abasDoUsuario } from "@/lib/permissoes";
import EscolherAbas from "@/components/EscolherAbas";

async function trocarSenha(form: FormData) {
  "use server";
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  const atual = String(form.get("atual") || "");
  const nova = String(form.get("nova") || "");
  if (!(await bcrypt.compare(atual, u.senhaHash))) redirect("/conta?erro=" + encodeURIComponent("Senha atual incorreta."));
  if (nova.length < 8) redirect("/conta?erro=" + encodeURIComponent("A nova senha precisa ter pelo menos 8 caracteres."));
  await db.usuario.update({ where: { id: u.id }, data: { senhaHash: await bcrypt.hash(nova, 10) } });
  await auditar(u.nome, "trocou a própria senha");
  redirect("/conta?ok=1");
}

export default async function Conta({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  const { erro, ok } = await searchParams;
  return (
    <>
      <h1>Minha conta</h1>
      {erro && <div className="aviso erro">{erro}</div>}
      {ok && <div className="aviso ok">{ok === "1" ? "Senha alterada." : ok}</div>}
      <div className="card">
        <p>
          <b>{u.nome}</b> · {u.email} · perfil {u.perfil.nome}
        </p>
        <h2>Trocar senha</h2>
        <form action={trocarSenha} className="campos">
          <label>Senha atual<input name="atual" type="password" required /></label>
          <label>Nova senha (mínimo 8)<input name="nova" type="password" required minLength={8} /></label>
          <div className="inteiro"><button className="btn">Salvar nova senha</button></div>
        </form>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Abas do menu</h2>
        <p className="suave">Marque as abas que você quer ver no menu. Esconder uma aba não tira o acesso: o que cada login pode fazer continua sendo definido pelo perfil.</p>
        <EscolherAbas id={u.id} abas={abasDoUsuario(u.permissoes, u.abasOcultas)} volta="/conta" />
      </div>
    </>
  );
}
