import Link from "next/link";
import { db } from "@/lib/db";
import { usuarioAtual } from "@/lib/auth";
import { abaLiberada, abasDoUsuario, pode } from "@/lib/permissoes";
import { brl, num } from "@/lib/formato";
import { gerarContasMensais, diaDoPagamento } from "@/lib/financeiro";
import { chave, dia, somaDias } from "@/lib/datas";
import { redirect } from "next/navigation";

export default async function Painel({ searchParams }: { searchParams: Promise<{ "sem-permissao"?: string }> }) {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  const sp = await searchParams;
  const semPermissao = sp["sem-permissao"] && <div className="aviso erro">Seu login não tem acesso a essa parte do sistema. Se precisar, peça para um diretor liberar.</div>;
  if (!abaLiberada(u.liberadas, "painel")) {
    const abas = abasDoUsuario(u.permissoes, u.abasOcultas, u.liberadas).filter((a) => !a.oculta);
    return (
      <>
        <h1>Olá, {u.nome.split(" ")[0]}</h1>
        {semPermissao}
        <div className="card">
          <b>Suas áreas</b>
          <p className="acoes" style={{ marginTop: 12, marginBottom: 0 }}>{abas.map((a) => <Link key={a.id} href={a.href} className="btn sec">{a.nome}</Link>)}</p>
        </div>
      </>
    );
  }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const veFin = pode(u.permissoes, "financeiro");
  if (veFin) await gerarContasMensais();
  const hojeD = dia();
  const [funcs, apsHoje, pendentes, semPin, comprasSug, comprasUrg, vendasAbertas, boletosVencidos, contasHoje] = await Promise.all([
    db.funcionario.count({ where: { ativo: true } }),
    db.apontamento.findMany({ where: { data: { gte: hoje } } }),
    db.recorde.count({ where: { status: "pendente" } }),
    db.funcionario.count({ where: { ativo: true, pinHash: null, cargo: "Funcionário" } }),
    db.pedidoCompra.count({ where: { status: "sugerido" } }),
    db.pedidoCompra.count({ where: { status: "sugerido", urgente: true } }),
    db.pedidoVenda.count({ where: { status: "aberto" } }),
    db.contaPagar.count({ where: { status: "aberto", vencimento: { lt: somaDias(hojeD, -3) } } }),
    db.contaPagar.findMany({ where: { status: "aberto", vencimento: { gte: somaDias(hojeD, -3), lte: somaDias(hojeD, 1) } } }),
  ]);
  const [rodando, lotesAbertos] = await Promise.all([db.processoProducao.count({ where: { status: "andamento" } }), db.lote.count({ where: { status: "aberto" } })]);
  const cadastrosPendentes = pode(u.permissoes, "usuarios", "editar") ? await db.usuario.count({ where: { pendente: true } }) : 0;
  const pagarHoje = contasHoje.filter((c) => chave(diaDoPagamento(c.vencimento)) === chave(hojeD));
  const pecas = apsHoje.reduce((s, a) => s + a.quantidade, 0);
  const refugo = apsHoje.reduce((s, a) => s + a.refugo, 0);
  return (
    <>
      <h1>Olá, {u.nome.split(" ")[0]}</h1>
      {semPermissao}
      {cadastrosPendentes > 0 && (
        <div className="aviso alerta">{cadastrosPendentes} pessoa(s) criaram conta e estão esperando liberação. <Link href="/usuarios">Liberar acesso</Link></div>
      )}
      <div className="grade">
        <div className="kpi"><div className="r">Funcionários ativos</div><div className="v">{num(funcs)}</div></div>
        <div className="kpi"><div className="r">Peças boas hoje</div><div className="v">{num(pecas)}</div><div className="r">{num(apsHoje.length)} apontamento(s)</div></div>
        <div className="kpi"><div className="r">Refugo hoje</div><div className="v">{num(refugo)}</div><div className="r">{pecas + refugo ? `${num((refugo / (pecas + refugo)) * 100, 1)}% do total` : "—"}</div></div>
        {pode(u.permissoes, "producao") && <a href="/producao" className="kpi" style={{ color: "inherit", fontWeight: 400 }}><div className="r">Processos em andamento</div><div className="v">{num(rodando)}</div><div className="r">{num(lotesAbertos)} lote(s) aberto(s)</div></a>}
        <div className="kpi"><div className="r">Recordes a confirmar</div><div className="v">{num(pendentes)}</div></div>
        {pode(u.permissoes, "vendas") && <div className="kpi"><div className="r">Pedidos de venda em aberto</div><div className="v">{num(vendasAbertas)}</div></div>}
        {veFin && <a href="/financeiro" className="kpi" style={{ color: "inherit", fontWeight: 400 }}><div className="r">Pagar hoje</div><div className="v">{brl(pagarHoje.reduce((t, c) => t + c.valor, 0), 0)}</div><div className="r">{pagarHoje.length} conta(s)</div></a>}
        {pode(u.permissoes, "compras") && <div className="kpi"><div className="r">Compras para aprovar</div><div className="v">{num(comprasSug)}</div>{comprasUrg > 0 && <div className="r" style={{ color: "var(--erro)" }}>{comprasUrg} urgente(s)</div>}</div>}
      </div>
      {comprasSug > 0 && pode(u.permissoes, "compras") && (
        <div className={`aviso ${comprasUrg ? "erro" : "alerta"}`}>O sistema lançou {comprasSug} pedido(s) de compra a partir das vendas{comprasUrg ? `, ${comprasUrg} urgente(s)` : ""}. <Link href="/compras">Ver em Compras</Link></div>
      )}
      {boletosVencidos > 0 && veFin && (
        <div className="aviso erro">{boletosVencidos} conta(s) vencida(s) sem baixa. <Link href="/financeiro">Ver pagamentos</Link></div>
      )}
      {pendentes > 0 && pode(u.permissoes, "producao", "aprovar") && (
        <div className="aviso alerta">Há {pendentes} recorde(s) novo(s) esperando confirmação. <Link href="/producao">Ver em Produção</Link></div>
      )}
      {semPin > 0 && pode(u.permissoes, "funcionarios", "editar") && (
        <div className="aviso alerta">{semPin} funcionário(s) ainda sem PIN para registrar produção. <Link href="/funcionarios">Cadastrar PIN</Link></div>
      )}
      <div className="card">
        <b>Para os operadores</b>
        <p className="suave" style={{ marginBottom: 0 }}>
          No celular, abra o endereço do sistema seguido de <code>/apontar</code>. O operador escolhe o produto pela foto, a peça, o processo e o lote, liga o cronômetro (ou lança tempo e quantidade) e confirma com o PIN.
        </p>
      </div>
    </>
  );
}
