import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { auditar, usuarioAtual } from "@/lib/auth";
import { abasDoUsuario } from "@/lib/permissoes";
import EscolherAbas from "@/components/EscolherAbas";
import AtivarAvisos from "@/components/AtivarAvisos";
import { acaoSalvarAvisos } from "@/lib/acoesNotificacoes";
import { avisoLigado, avisosDisponiveis, chavesPush, lerEscolhidos } from "@/lib/notificacoes";
import { ABAS } from "@/lib/permissoes";

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
  const disponiveis = avisosDisponiveis(u.permissoes, u.liberadas);
  const escolhidos = lerEscolhidos(u.notificacoes);
  const [chaves, aparelhos] = await Promise.all([chavesPush(), db.aparelhoPush.count({ where: { usuarioId: u.id } })]);
  const diretor = u.perfil.nome === "Diretor";
  const areas = ABAS.map((a) => ({ nome: a.nome, avisos: disponiveis.filter((t) => t.aba === a.id) })).filter((a) => a.avisos.length);
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
      <div className="card" id="avisos">
        <h2 style={{ marginTop: 0 }}>Avisos no celular</h2>
        <p className="suave">
          O sistema manda um aviso para o celular (como mensagem do WhatsApp) quando acontece algo importante.{" "}
          {diretor ? "Escolha quais avisos você quer receber." : "Você só recebe avisos das áreas que o diretor liberou para você."}
        </p>
        <AtivarAvisos chavePublica={chaves.publica} aparelhos={aparelhos} />
        <h3 style={{ marginBottom: 8 }}>Quais avisos receber</h3>
        {disponiveis.length ? (
          <form action={acaoSalvarAvisos}>
            <div className="avisos-areas">
              {areas.map((a) => (
                <fieldset key={a.nome} className="avisos-area">
                  <legend>{a.nome}</legend>
                  {a.avisos.map((t) => (
                    <label key={t.id} className="chk"><input type="checkbox" name={`aviso:${t.id}`} defaultChecked={avisoLigado(t, escolhidos)} /> {t.nome}</label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div style={{ marginTop: 12 }}><button className="btn sec peq">Salvar avisos</button></div>
          </form>
        ) : (
          <p className="suave" style={{ margin: 0 }}>Nenhuma das suas áreas liberadas tem aviso no celular ainda.</p>
        )}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Abas do menu</h2>
        <p className="suave">Marque as abas que você quer ver no menu. Esconder uma aba não tira o acesso. Quais abas você pode abrir é o diretor quem libera, em Usuários e perfis.</p>
        <EscolherAbas id={u.id} abas={abasDoUsuario(u.permissoes, u.abasOcultas, u.liberadas)} volta="/conta" />
      </div>
    </>
  );
}
