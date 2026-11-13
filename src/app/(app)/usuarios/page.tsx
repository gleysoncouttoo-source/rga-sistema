import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { ACOES, MODULOS, abasDoUsuario, lerPermissoes, pode } from "@/lib/permissoes";
import { acaoExcluirLogin } from "@/lib/acoesConta";
import EscolherAbas from "@/components/EscolherAbas";
import Excluir from "@/components/Excluir";

const MAX_LOGINS = 4; // combinado: 3 diretores + 1 gestor (ajustável)
const volta = (m: string, tipo = "erro") => redirect(`/usuarios?${tipo}=` + encodeURIComponent(m));

async function criarUsuario(form: FormData) {
  "use server";
  const u = await exigir("usuarios", "criar");
  const nome = String(form.get("nome") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const senha = String(form.get("senha") || "");
  const perfilId = Number(form.get("perfil"));
  if (!nome || !email || !perfilId) volta("Preencha nome, e-mail e perfil.");
  if (senha.length < 8) volta("A senha inicial precisa ter pelo menos 8 caracteres.");
  const ativos = await db.usuario.count({ where: { ativo: true } });
  if (ativos >= MAX_LOGINS) volta(`O limite combinado é de ${MAX_LOGINS} logins ativos. Desative um antes de criar outro.`);
  if (await db.usuario.findUnique({ where: { email } })) volta("Já existe um login com esse e-mail.");
  const funcionarioId = Number(form.get("funcionario")) || null;
  await db.usuario.create({
    data: {
      nome, email, perfilId, senhaHash: await bcrypt.hash(senha, 10),
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
    if (!alvo.ativo && (await db.usuario.count({ where: { ativo: true } })) >= MAX_LOGINS) volta(`Limite de ${MAX_LOGINS} logins ativos.`);
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
  const [usuarios, perfis, funcs, etapas, log] = await Promise.all([
    db.usuario.findMany({ include: { perfil: true, funcionario: true }, orderBy: { nome: "asc" } }),
    db.perfil.findMany({ orderBy: { id: "asc" } }),
    db.funcionario.findMany({ where: { ativo: true, usuario: null }, orderBy: { nome: "asc" } }),
    db.etapa.findMany({ orderBy: { ordem: "asc" } }),
    db.auditoria.findMany({ orderBy: { criadoEm: "desc" }, take: 20 }),
  ]);
  const ativos = usuarios.filter((x) => x.ativo).length;
  return (
    <>
      <h1>Usuários e perfis</h1>
      {erro && <div className="aviso erro">{erro}</div>}
      {ok && <div className="aviso ok">{ok}</div>}

      <h2>Logins ({ativos} de {MAX_LOGINS} ativos)</h2>
      <div className="card tabela">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Setor (lembretes)</th><th>Situação</th><th>Redefinir senha</th><th></th></tr></thead>
          <tbody>{usuarios.map((x) => (
            <tr key={x.id}>
              <td>{x.nome}{x.id === u.id && <span className="suave"> (você)</span>}</td>
              <td>{x.email}</td>
              <td>
                <form action={alterarUsuario} className="acoes">
                  <input type="hidden" name="id" value={x.id} /><input type="hidden" name="acao" value="perfil" />
                  <select name="perfil" defaultValue={x.perfilId} disabled={x.id === u.id}>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
                  {x.id !== u.id && <button className="btn sec peq">Salvar</button>}
                </form>
              </td>
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
          <label>Perfil<select name="perfil">{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
          <label>Setor (recebe lembretes dele)
            <select name="setor"><option value="">—</option><option>Geral</option><option>Produção</option><option>Financeiro</option><option>Compras</option><option>Vendas</option>{etapas.map((e) => <option key={e.id}>{e.nome}</option>)}</select>
          </label>
          <label>WhatsApp<input name="whatsapp" placeholder="(11) 90000-0000" /></label>
          <label>Funcionário ligado (opcional)
            <select name="funcionario"><option value="">—</option>{funcs.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
          </label>
          <div className="inteiro"><button className="btn">Criar login</button></div>
        </form>
      </div>

      <h2>Abas do menu de cada login</h2>
      <p className="suave">Escolha quais abas aparecem para cada pessoa. Cada um também pode mudar as suas em Minha conta. Só aparecem as abas que o perfil permite.</p>
      {usuarios.filter((x) => x.ativo).map((x) => (
        <details className="editar card" key={x.id}>
          <summary>{x.nome} · {x.perfil.nome}</summary>
          <EscolherAbas id={x.id} abas={abasDoUsuario(lerPermissoes(x.perfil.permissoes), x.abasOcultas)} volta="/usuarios" />
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
