import { redirect } from "next/navigation";
import { sair, usuarioAtual } from "@/lib/auth";
import { MODULOS_FUTUROS, abasDoUsuario, menuDoUsuario } from "@/lib/permissoes";
import Nav, { SubMenu } from "@/components/Nav";

async function acaoSair() {
  "use server";
  await sair();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  const itens = abasDoUsuario(u.permissoes, u.abasOcultas, u.liberadas).filter((a) => !a.oculta);
  const menu = menuDoUsuario(itens.map((a) => ({ id: a.id, href: a.href, nome: a.nome })));
  return (
    <div className="app">
      <nav className="lateral">
        <a href="/" className="marca" aria-label="R.G.A — início">
          <img src="/marca/logo-claro.png" alt="R.G.A" />
          <small>Indústria e Ferramentaria de Precisão</small>
        </a>
        <Nav itens={menu} />
        <div className="rotulo">Em breve</div>
        {MODULOS_FUTUROS.map((m) => (
          <div key={m} className="futuro">{m}</div>
        ))}
      </nav>
      <main className="conteudo">
        <div className="topo">
          <span />
          <div className="acoes usuario">
            <span>
              {u.nome} · {u.perfil.nome}
            </span>
            <a href="/conta">Minha conta</a>
            <form action={acaoSair}>
              <button className="btn sec peq">Sair</button>
            </form>
          </div>
        </div>
        <SubMenu itens={menu} />
        {children}
      </main>
    </div>
  );
}
