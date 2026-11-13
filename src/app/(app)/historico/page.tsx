import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { dataHora, num } from "@/lib/formato";

// nomes das tabelas e campos como aparecem na tela
const TABELAS: Record<string, string> = {
  Item: "Produtos / estoque", Componente: "Estrutura do produto", Passo: "Processo da peça", Lote: "Lote de produção", ProcessoProducao: "Cronômetro",
  Apontamento: "Lançamento de produção", Funcionario: "Colaborador", Usuario: "Login", Perfil: "Perfil de acesso", Operacao: "Operação", Etapa: "Etapa",
  Recorde: "Recorde", Configuracao: "Configuração", Fornecedor: "Fornecedor", PedidoVenda: "Pedido de venda", PedidoVendaItem: "Item do pedido",
  PedidoCompra: "Pedido de compra", PedidoCompraItem: "Item da compra", ContaPagar: "Conta a pagar", ContaReceber: "Conta a receber",
  ContaRecorrente: "Conta fixa", ContaBancaria: "Saldo do banco", AnuncioCanal: "Anúncio Shopee", ItemOperacao: "Peça × operação", AdsRelatorio: "Relatório de Ads",
};
const CAMPOS: Record<string, string> = {
  nome: "nome", codigo: "SKU/código", foto: "foto", precoVenda: "preço de venda", precoCompra: "preço de compra", estoque: "estoque", estoqueMinimo: "estoque mínimo",
  salario: "salário", ativo: "ativo", quantidade: "quantidade", ordem: "ordem", status: "situação", valor: "valor", vencimento: "vencimento", setor: "setor",
  cargo: "cargo", pinHash: "PIN", senhaHash: "senha", perfilId: "perfil", permissoes: "permissões", abasOcultas: "abas escondidas", operacaoId: "operação",
  material: "material", pesoUnitKg: "peso por unidade", dimensoes: "medidas", observacao: "observação", fornecedorId: "fornecedor", saldo: "saldo", minutos: "minutos",
};

export default async function Historico({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigir("historico");
  const sp = await searchParams;
  const aba = sp.aba === "atividades" ? "atividades" : "campos";
  const de = sp.de ? new Date(sp.de + "T00:00:00-03:00") : undefined;
  const ate = sp.ate ? new Date(sp.ate + "T23:59:59-03:00") : undefined;
  const periodo = de || ate ? { criadoEm: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } } : {};
  const busca = sp.q?.trim();
  const [linhas, usuarios, ativ] = await Promise.all([
    aba === "campos" ? db.alteracao.findMany({
      where: {
        ...periodo, ...(sp.tabela ? { tabela: sp.tabela } : {}), ...(sp.id ? { registroId: sp.id } : {}), ...(sp.usuario ? { usuario: sp.usuario } : {}),
        ...(busca ? { OR: [{ registro: { contains: busca, mode: "insensitive" } }, { antes: { contains: busca, mode: "insensitive" } }, { depois: { contains: busca, mode: "insensitive" } }] } : {}),
      },
      orderBy: { id: "desc" }, take: 300,
    }) : Promise.resolve([]),
    db.alteracao.findMany({ distinct: ["usuario"], select: { usuario: true }, orderBy: { usuario: "asc" } }),
    aba === "atividades" ? db.auditoria.findMany({
      where: { ...periodo, ...(sp.usuario ? { usuario: sp.usuario } : {}), ...(busca ? { OR: [{ acao: { contains: busca, mode: "insensitive" } }, { detalhe: { contains: busca, mode: "insensitive" } }] } : {}) },
      orderBy: { id: "desc" }, take: 300,
    }) : Promise.resolve([]),
  ]);
  const qs = (o: Record<string, string>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <h1>Histórico de alterações</h1>
      <div className="abas">
        <a href={qs({ aba: "campos" })} className={aba === "campos" ? "ativo" : ""}>Campos alterados</a>
        <a href={qs({ aba: "atividades" })} className={aba === "atividades" ? "ativo" : ""}>Atividades (login, aprovações…)</a>
      </div>
      <form className="card linha-form" action="/historico">
        <input type="hidden" name="aba" value={aba} />
        {aba === "campos" && <label>Onde<select name="tabela" defaultValue={sp.tabela ?? ""}><option value="">Tudo</option>{Object.entries(TABELAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
        <label>Login<select name="usuario" defaultValue={sp.usuario ?? ""}><option value="">Todos</option>{usuarios.map((u) => <option key={u.usuario}>{u.usuario}</option>)}</select></label>
        <label>De<input type="date" name="de" defaultValue={sp.de} /></label>
        <label>Até<input type="date" name="ate" defaultValue={sp.ate} /></label>
        <label>Buscar<input name="q" defaultValue={sp.q} placeholder="nome, valor…" /></label>
        {sp.id && <input type="hidden" name="id" value={sp.id} />}
        <button className="btn sec">Filtrar</button>
        {(sp.id || sp.tabela || sp.usuario || sp.q || sp.de) && <a className="btn sec" href={`/historico?aba=${aba}`}>Limpar</a>}
      </form>
      {aba === "campos" ? (
        <div className="card tabela">
          <p className="suave" style={{ marginTop: 0 }}>Cada campo criado, alterado ou excluído, com o login e o horário. {linhas.length === 300 && "Mostrando os 300 mais recentes; use os filtros para ver mais antigos."}</p>
          {linhas.length === 0 ? <p className="suave">Nenhuma alteração encontrada.</p> : (
            <table>
              <thead><tr><th>Quando</th><th>Login</th><th>O quê</th><th>Registro</th><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
              <tbody>{linhas.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{dataHora(l.criadoEm)}</td>
                  <td>{l.usuario}</td>
                  <td><span className={`selo ${l.acao === "criou" ? "ok" : l.acao === "excluiu" ? "erro" : ""}`}>{l.acao}</span> <span className="suave">{TABELAS[l.tabela] ?? l.tabela}</span></td>
                  <td><a href={`/historico?tabela=${l.tabela}&id=${l.registroId}`}>{l.registro ?? `#${l.registroId}`}</a></td>
                  <td>{l.campo ? CAMPOS[l.campo] ?? l.campo : ""}</td>
                  <td className="suave" style={{ maxWidth: 220, overflowWrap: "anywhere" }}>{l.antes ?? (l.campo ? "(vazio)" : "")}</td>
                  <td style={{ maxWidth: 220, overflowWrap: "anywhere" }}>{l.depois ?? (l.campo ? "(vazio)" : "")}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card tabela">
          {ativ.length === 0 ? <p className="suave">Nada encontrado.</p> : (
            <table>
              <thead><tr><th>Quando</th><th>Login</th><th>Atividade</th><th>Detalhe</th></tr></thead>
              <tbody>{ativ.map((a) => <tr key={a.id}><td style={{ whiteSpace: "nowrap" }}>{dataHora(a.criadoEm)}</td><td>{a.usuario}</td><td>{a.acao}</td><td className="suave">{a.detalhe}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
      <p className="suave">{num(linhas.length + ativ.length)} linha(s).</p>
    </>
  );
}
