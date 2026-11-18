import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { ABAS, ACOES, MODULOS, lerAbasLiberadas, lerPermissoes, pode } from "@/lib/permissoes";
import { acaoExcluirLogin } from "@/lib/acoesConta";
import EscolherAcesso from "@/components/EscolherAcesso";
import Excluir from "@/components/Excluir";

const volta = (m: string, tipo = "erro") => redirect(`/usuarios?${tipo}=` + encodeURIComponent(m));

/** Lê as abas marcadas no formulário. null = todas. */
function abasDoForm(form: FormData): string | null {
  if (form.get("todas") === "on") return null;
  const ids = ABAS.filter((a) => form.get(`libera:${a.id}`) === "on").map((a) => a.id);
  if (!ids.length) volta("Marque pelo menos uma aba, ou Todas as abas.");
  return JSON.stringify(ids);
}

async function liberarCadastro(form: FormData) {
  "use server";
  const u = await exigir("usuarios", "editar");
  const id = Number(form.get("id"));
  const alvo = await db.usuario.findUniqueOrThrow({ where: { id } });
  if (!alvo.pendente) volta("Esse cadastro já foi resolvido.");
  if (form.get("decisao") === "recusar") {
    await db.usuario.delete({ where: { id } });
    await auditar(u.nome, "recusou cadastro", alvo.email);
    revalidatePath("/usuarios");
    volta(`Cadastro de ${alvo.nome} recusado.`, "ok");
  }
  const abasLiberadas = abasDoForm(form);
  const perfilId = Number(form.get("perfil"));
  const funcionarioId = Number(form.get("funcionario")) || null;
  await db.usuario.update({ where: { id }, data: { pendente: false, ativo: true, perfilId, abasLiberadas, funcionarioId } });
  const perfil = await db.perfil.findUniqueOrThrow({ where: { id: perfilId } });
  await auditar(u.nome, "liberou acesso", `${alvo.email} · ${perfil.nome}`);
  revalidatePath("/usuarios");
  volta(`Acesso de ${alvo.nome} liberado como ${perfil.nome}. Já pode entrar com o e-mail e a senha que criou.`, "ok");
}

async function salvarAcesso(form: FormData) {
  "use server";
  const u = await exigir("usuarios", "editar");
  const id = Number(form.get("id"));
  if (id === u.id) volta("Você não pode mudar o acesso do seu próprio login.");
  const alvo = await db.usuario.findUniqueOrThrow({ where: { id } });
  const abasLiberadas = abasDoForm(form);
  await db.usuario.update({ where: { id }, data: { perfilId: Number(form.get("perfil")), abasLiberadas } });
  await auditar(u.nome, "alterou acesso", alvo.email);
  revalidatePath("/usuarios");
  volta(`Acesso de ${alvo.nome} salvo.`, "ok");
}

async function criarUsuario(form: FormData) {
  "use server";
  const u = await exigir("usuarios", "criar");
  const nome = String(form.get("nome") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const senha = String(form.get("senha") || "");
  const perfilId = Number(form.get("perfil"));
  if (!nome || !email || !perfilId) volta("Preencha nome, e-mail e perfil.");
  if (senha.length < 8) volta("A senha inicial precisa ter pelo menos 8 caracteres.");
  if (await db.usuario.findUnique({ where: { email } })) volta("Já existe um login com esse e-mail.");
  const funcionarioId = Number(form.get("funcionario")) || null;
  await db.usuario.create({
    data: {
      nome, email, perfilId, senhaHash: await bcrypt.hash(senha, 10), abasLiberadas: abasDoForm(form),
      setor: String(form.get("setor") || "") || null,
      whatsapp: String(form.get("whatsapp") || "") || null,
      funcionarioId,
    },
  });
  await auditar(u.nome, "criou login", email);
  revalidatePath("/usuarios");
  volta("Login criado. Passe a senha inicial para a pessoa e peça para trocar em Minha conta.", "ok");
}

async function alterarUsuario(form: FormData) {
  "use server";
  const u = await exigir("usuarios", "editar");
  const id = Number(form.get("id"));
  const acao = String(form.get("acao"));
  if (id === u.id && acao !== "senha") volta("Você não pode desativar nem mudar o perfil do seu próprio login.");
  const alvo = await db.usuario.findUniqueOrThrow({ where: { id } });
  if (acao === "ativar") {
    await db.usuario.update({ where: { id }, data: { ativo: !alvo.ativo } });
    if (alvo.ativo) await db.sessao.deleteMany({ where: { usuarioId: id } });
    await auditar(u.nome, alvo.ativo ? "desativou login" : "reativou login", alvo.email);
  } else if (acao === "perfil") {
    await db.usuario.update({ where: { id }, data: { perfilId: Number(form.get("perfil")) } });
    await auditar(u.nome, "mudou perfil", alvo.email);
  } else if (acao === "senha") {
    const senha = String(form.get("senha") || "");
    if (senha.length < 8) volta("A nova senha precisa ter pelo menos 8 caracteres.");
    await db.usuario.update({ where: { id }, data: { senhaHash: await bcrypt.hash(senha, 10), tentativas: 0, bloqueadoAte: null } });
    await auditar(u.nome, "redefiniu senha", alvo.email);
  }
  revalidatePath("/usuarios");
  volta("Alteração salva.", "ok");
}

async function salvarPerfil(form: FormData) {
  "use server";
  const u = await exigir("usuarios", "editar");
  const id = Number(form.get("id"));
  const perfil = await db.perfil.findUniqueOrThrow({ where: { id } });
  const p: Record<string, string[]> = {};
  for (const m of MODULOS) {
    const acoes = ACOES.filter((a) => form.get(`${m.id}:${a.id}`) === "on").map((a) => a.id);
    if (acoes.length) p[m.id] = acoes.includes("ver") ? acoes : ["ver", ...acoes];
  }
  // proteção: o perfil Diretor nunca perde o acesso a Usuários
  if (perfil.nome === "Diretor") p.usuarios = ACOES.map((a) => a.id);
  await db.perfil.update({ where: { id }, data: { permissoes: JSON.stringify(p) } });
  await auditar(u.nome, "alterou permissões do perfil", perfil.nome);
  revalidatePath("/usuarios");
  volta(`Permissões do perfil ${perfil.nome} salvas.`, "ok");
}

export default async function Usuarios({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await exigir("usuarios");
  const { erro, ok } = await searchParams;
  const [todos, perfis, funcs, etapas, log] = await Promise.all([
    db.usuario.findMany({ include: { perfil: true, funcionario: true }, orderBy: { nome: "asc" } }),
    db.perfil.findMany({ orderBy: { id: "asc" } }),
    db.funcionario.findMany({ where: { ativo: true, usuario: null }, orderBy: { nome: "asc" } }),
    db.etapa.findMany({ orderBy: { ordem: "asc" } }),
    db.auditoria.findMany({ orderBy: { criadoEm: "desc" }, take: 20 }),
  ]);
  const usuarios = todos.filter((x) => !x.pendente);
  const pendentes = todos.filter((x) => x.pendente).sort((a, b) => +a.criadoEm - +b.criadoEm);
  const ativos = usuarios.filter((x) => x.ativo).length;
  const perfilPorNome = (nome: string | null) => perfis.find((p) => p.nome === nome)?.id ?? perfis.find((p) => p.nome === "Colaborador")?.id;
  const nomeAbas = (json: string | null) => { const l = lerAbasLiberadas(json); return l == null ? "Todas" : ABAS.filter((a) => l.includes(a.id)).map((a) => a.nome).join(", ") || "Nenhuma"; };
  const opcoesPerfil = perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>);
  return (
    <>
      <h1>Usuários e perfis</h1>
      {erro && <div className="aviso erro">{erro}</div>}
      {ok && <div className="aviso ok">{ok}</div>}

      <h2>Cadastros aguardando liberação ({pendentes.length})</h2>
      {pendentes.length === 0 ? (
        <p className="suave">Ninguém esperando. Quem precisar de acesso cria a conta pelo link <b>Criar conta</b> na tela de entrada (endereço do sistema seguido de <code>/cadastro</code>).</p>
      ) : pendentes.map((x) => (
        <div className="card" key={x.id}>
          <form action={liberarCadastro}>
            <input type="hidden" name="id" value={x.id} />
            <p style={{ marginTop: 0 }}>
              <b>{x.nome}</b> · {x.email}
              <span className="suave"> · {x.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</span>
            </p>
            <div className="campos">
              <label>Cargo (perfil)<select name="perfil" defaultValue={perfilPorNome("Colaborador")}>{opcoesPerfil}</select></label>
              <label>Funcionário ligado (opcional)
                <select name="funcionario"><option value="">—</option>{funcs.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
              </label>
            </div>
            <p style={{ marginBottom: 6 }}><b>Quais abas pode abrir</b></p>
            <EscolherAcesso abas={ABAS.map((a) => ({ id: a.id, nome: a.nome }))} marcadas={[]} />
            <div className="acoes" style={{ marginTop: 14 }}>
              <button className="btn" name="decisao" value="liberar">Liberar acesso</button>
              <button className="btn sec" name="decisao" value="recusar" formNoValidate>Recusar</button>
            </div>
          </form>
        </div>
      ))}

      <h2>Logins ({ativos} ativos)</h2>
      <div className="card tabela">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Abas liberadas</th><th>Setor (lembretes)</th><th>Situação</th><th>Redefinir senha</th><th></th></tr></thead>
          <tbody>{usuarios.map((x) => (
            <tr key={x.id}>
              <td>{x.nome}{x.id === u.id && <span className="suave"> (você)</span>}</td>
              <td>{x.email}</td>
              <td>{x.perfil.nome}</td>
              <td className="suave">{nomeAbas(x.abasLiberadas)}</td>
              <td>{x.setor ?? "—"}</td>
              <td>
                <form action={alterarUsuario}>
                  <input type="hidden" name="id" value={x.id} /><input type="hidden" name="acao" value="ativar" />
                  <span className={"selo " + (x.ativo ? "ok" : "")}>{x.ativo ? "ativo" : "desativado"}</span>{" "}
                  {x.id !== u.id && <button className="btn sec peq">{x.ativo ? "Desativar" : "Reativar"}</button>}
                </form>
              </td>
              <td>
                <form action={alterarUsuario} className="acoes">
                  <input type="hidden" name="id" value={x.id} /><input type="hidden" name="acao" value="senha" />
                  <input name="senha" type="password" placeholder="Nova senha" minLength={8} style={{ width: 130 }} />
                  <button className="btn sec peq">Salvar</button>
                </form>
              </td>
              <td>{x.id !== u.id && pode(u.permissoes, "usuarios", "excluir") && <Excluir acao={acaoExcluirLogin} campos={{ id: x.id }} pergunta={`Excluir o login ${x.email}? Para só bloquear, use Desativar.`} />}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="card">
        <b>Novo login</b>
        <form action={criarUsuario} className="campos" style={{ marginTop: 12 }}>
          <label>Nome<input name="nome" required /></label>
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Senha inicial (mínimo 8)<input name="senha" type="text" required minLength={8} /></label>
          <label>Perfil<select name="perfil">{opcoesPerfil}</select></label>
          <label>Setor (recebe lembretes dele)
            <select name="setor"><option value="">—</option><option>Geral</option><option>Produção</option><option>Financeiro</option><option>Compras</option><option>Vendas</option>{etapas.map((e) => <option key={e.id}>{e.nome}</option>)}</select>
          </label>
          <label>WhatsApp<input name="whatsapp" placeholder="(11) 90000-0000" /></label>
          <label>Funcionário ligado (opcional)
            <select name="funcionario"><option value="">—</option>{funcs.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
          </label>
          <div className="inteiro"><b>Quais abas pode abrir</b><div style={{ marginTop: 6 }}><EscolherAcesso abas={ABAS.map((a) => ({ id: a.id, nome: a.nome }))} marcadas={null} /></div></div>
          <div className="inteiro"><button className="btn">Criar login</button></div>
        </form>
      </div>

      <h2>Cargo e abas de cada login</h2>
      <p className="suave">Mude o cargo (perfil) e quais abas cada pessoa pode abrir. O perfil diz o que ela pode fazer dentro de cada aba (ver, criar, editar...).</p>
      {usuarios.filter((x) => x.ativo && x.id !== u.id).map((x) => (
        <details className="editar card" key={x.id}>
          <summary>{x.nome} · {x.perfil.nome} · abas: {nomeAbas(x.abasLiberadas)}</summary>
          <form action={salvarAcesso}>
            <input type="hidden" name="id" value={x.id} />
            <div className="campos"><label>Cargo (perfil)<select name="perfil" defaultValue={x.perfilId}>{opcoesPerfil}</select></label></div>
            <p style={{ marginBottom: 6 }}><b>Quais abas pode abrir</b></p>
            <EscolherAcesso abas={ABAS.map((a) => ({ id: a.id, nome: a.nome }))} marcadas={lerAbasLiberadas(x.abasLiberadas)} />
            <div style={{ marginTop: 12 }}><button className="btn sec peq">Salvar acesso</button></div>
          </form>
        </details>
      ))}

      <h2>Permissões por perfil</h2>
      {perfis.map((p) => {
        const perm = lerPermissoes(p.permissoes);
        return (
          <div className="card tabela" key={p.id}>
            <form action={salvarPerfil}>
              <input type="hidden" name="id" value={p.id} />
              <b>{p.nome}</b>
              <table className="matriz">
                <thead><tr><th>Módulo</th>{ACOES.map((a) => <th key={a.id}>{a.nome}</th>)}</tr></thead>
                <tbody>{MODULOS.map((m) => (
                  <tr key={m.id}>
                    <td>{m.nome}</td>
                    {ACOES.map((a) => (
                      <td key={a.id}>
                        <input type="checkbox" name={`${m.id}:${a.id}`} defaultChecked={!!perm[m.id]?.includes(a.id)}
                          disabled={p.nome === "Diretor" && m.id === "usuarios"} aria-label={`${p.nome} ${m.nome} ${a.nome}`} />
                      </td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
              <div style={{ marginTop: 10 }}><button className="btn sec">Salvar permissões de {p.nome}</button></div>
            </form>
          </div>
        );
      })}

      <h2>Registro de atividades</h2>
      <div className="card tabela">
        <table>
          <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead>
          <tbody>{log.map((l) => (
            <tr key={l.id}><td>{l.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td><td>{l.usuario}</td><td>{l.acao}</td><td className="suave">{l.detalhe}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
