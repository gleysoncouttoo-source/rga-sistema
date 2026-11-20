import "server-only";
import webpush from "web-push";
import { db } from "./db";
import { abasDoUsuario, lerAbasLiberadas, lerPermissoes, limitarPermissoes, pode, type Modulo, type Acao, type Permissoes } from "./permissoes";

// Avisos no celular (notificação push). Cada tipo pertence a uma aba: só recebe quem tem essa aba liberada.
// O diretor tem todas as abas, então escolhe entre todos; os outros logins só veem os da própria área.
// padrao = já vem ligado. Os que podem chegar muitas vezes por dia vêm desligados; a pessoa liga se quiser.
type DefAviso = { id: string; nome: string; aba: string; padrao: boolean; acao?: readonly [Modulo, Acao] };
export const TIPOS_AVISO = [
  { id: "resumo", nome: "Resumo do dia anterior (todo dia de manhã)", aba: "painel", padrao: true },
  { id: "produtos", nome: "Produto, peça ou processo criado ou alterado", aba: "produtos", padrao: false },
  { id: "recorde", nome: "Novo recorde de produção para confirmar", aba: "producao", padrao: true, acao: ["producao", "aprovar"] },
  { id: "lote", nome: "Lote de produção concluído", aba: "producao", padrao: true },
  { id: "apontamento", nome: "Cada produção lançada pelos operadores", aba: "producao", padrao: false },
  { id: "lembrete-apontar", nome: "Lembrete no fim do dia se você não lançou produção", aba: "apontar", padrao: true },
  { id: "materia-prima", nome: "Matéria-prima abaixo do mínimo (todo dia de manhã)", aba: "materia-prima", padrao: true },
  { id: "conjunto", nome: "Conjunto montado ou desfeito", aba: "estoque-parcial", padrao: false },
  { id: "estoque", nome: "Estoque final abaixo do mínimo (todo dia de manhã)", aba: "estoque", padrao: true },
  { id: "venda", nome: "Nova venda da Shopee ou do site", aba: "vendas", padrao: true },
  { id: "venda-status", nome: "Venda entregue, cancelada ou excluída", aba: "vendas", padrao: false },
  { id: "compra", nome: "Compra lançada pelo sistema (falta material)", aba: "compras", padrao: true },
  { id: "compra-status", nome: "Compra aprovada, recebida, cancelada ou remarcada", aba: "compras", padrao: true },
  { id: "contas", nome: "Contas a pagar hoje e vencidas (todo dia de manhã)", aba: "financeiro", padrao: true },
  { id: "pagamentos", nome: "Pagamento ou recebimento lançado", aba: "financeiro", padrao: false },
  { id: "preco", nome: "Preço de compra subiu", aba: "custos", padrao: true },
  { id: "custos", nome: "Parâmetros de custo alterados", aba: "custos", padrao: true },
  { id: "contas-custo", nome: "Fechar as contas do mês no custo (início do mês)", aba: "despesas-custo", padrao: true },
  { id: "lucros", nome: "Resumo de vendas da semana (segunda de manhã)", aba: "lucros", padrao: true },
  { id: "aniversario", nome: "Aniversário de colaborador (de manhã)", aba: "funcionarios", padrao: true },
  { id: "colaboradores", nome: "Colaborador cadastrado, alterado ou desligado", aba: "funcionarios", padrao: true },
  { id: "exclusao", nome: "Algo foi excluído no sistema", aba: "historico", padrao: true },
  { id: "cadastro", nome: "Pessoa pedindo acesso ao sistema", aba: "usuarios", padrao: true, acao: ["usuarios", "editar"] },
  { id: "acessos", nome: "Acesso de login liberado ou alterado", aba: "usuarios", padrao: true },
] as const satisfies readonly DefAviso[];

export type TipoAviso = (typeof TIPOS_AVISO)[number]["id"];

/** Tipos de aviso que este login pode receber (pela área liberada). */
export function avisosDisponiveis(permissoes: Permissoes, liberadas: string[] | null): DefAviso[] {
  const abas = new Set<string>(abasDoUsuario(permissoes, null, liberadas).map((a) => a.id));
  return (TIPOS_AVISO as readonly DefAviso[]).filter((t) => abas.has(t.aba) && (!t.acao || pode(permissoes, t.acao[0], t.acao[1])));
}

/** O que o login ligou e desligou. O resto segue o padrão de cada aviso (assim avisos novos já chegam ligados). */
export function lerEscolhidos(json: string | null | undefined): { on: string[]; off: string[] } {
  try {
    const v = JSON.parse(json || "{}");
    return { on: Array.isArray(v?.on) ? v.on.map(String) : [], off: Array.isArray(v?.off) ? v.off.map(String) : [] };
  } catch { return { on: [], off: [] }; }
}

export function avisoLigado(t: DefAviso, esc: { on: string[]; off: string[] }) {
  return esc.on.includes(t.id) ? true : esc.off.includes(t.id) ? false : t.padrao;
}

/** Avisos que o login recebe: dentro da área liberada, os ligados. */
export function avisosRecebidos(permissoes: Permissoes, liberadas: string[] | null, escolhidosJson: string | null | undefined) {
  const esc = lerEscolhidos(escolhidosJson);
  return avisosDisponiveis(permissoes, liberadas).filter((t) => avisoLigado(t, esc));
}

// ───────── Chaves (VAPID) ─────────
// Usa as chaves da Vercel se existirem; senão cria um par uma vez e guarda no banco.
let chaves: { publica: string; privada: string } | null = null;
export async function chavesPush() {
  if (chaves) return chaves;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    chaves = { publica: process.env.VAPID_PUBLIC_KEY, privada: process.env.VAPID_PRIVATE_KEY };
    return chaves;
  }
  const rows = await db.configuracao.findMany({ where: { chave: { in: ["pushChavePublica", "pushChavePrivada"] } } });
  const m = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  if (m.pushChavePublica && m.pushChavePrivada) {
    chaves = { publica: m.pushChavePublica, privada: m.pushChavePrivada };
    return chaves;
  }
  const novas = webpush.generateVAPIDKeys();
  // se duas telas criarem ao mesmo tempo, vale a primeira gravada
  await db.configuracao.createMany({ data: [{ chave: "pushChavePublica", valor: novas.publicKey }, { chave: "pushChavePrivada", valor: novas.privateKey }], skipDuplicates: true });
  const salvas = await db.configuracao.findMany({ where: { chave: { in: ["pushChavePublica", "pushChavePrivada"] } } });
  const s = Object.fromEntries(salvas.map((r) => [r.chave, r.valor]));
  chaves = { publica: s.pushChavePublica, privada: s.pushChavePrivada };
  return chaves;
}

export type Aviso = { titulo: string; texto: string; link?: string; tag?: string };

/** Manda o aviso para todos os aparelhos de um login. Aparelho que não existe mais é apagado. */
async function mandarParaAparelhos(aparelhos: { id: number; endpoint: string; p256dh: string; auth: string }[], aviso: Aviso) {
  if (!aparelhos.length) return 0;
  const k = await chavesPush();
  const corpo = JSON.stringify({ titulo: aviso.titulo, texto: aviso.texto, link: aviso.link || "/", tag: aviso.tag });
  let enviados = 0;
  await Promise.all(
    aparelhos.map(async (a) => {
      try {
        await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, corpo, {
          vapidDetails: { subject: "https://rga-sistema.vercel.app", publicKey: k.publica, privateKey: k.privada },
          TTL: 60 * 60 * 24,
          timeout: 8000,
        });
        enviados++;
      } catch (e) {
        const st = (e as { statusCode?: number }).statusCode;
        if (st === 404 || st === 410) await db.aparelhoPush.deleteMany({ where: { id: a.id } });
      }
    })
  );
  return enviados;
}

/** Aviso de um tipo: vai para todo login ativo que tem a área liberada e não desligou esse tipo. Nunca derruba quem chamou. */
export async function avisar(tipo: TipoAviso, aviso: Aviso, filtro: { exceto?: string | null; soIds?: number[] } = {}) {
  try {
    const usuarios = await db.usuario.findMany({
      where: { ativo: true, pendente: false, aparelhos: { some: {} }, ...(filtro.soIds ? { id: { in: filtro.soIds } } : {}), ...(filtro.exceto ? { nome: { not: filtro.exceto } } : {}) },
      include: { perfil: true, aparelhos: true },
    });
    let total = 0;
    for (const u of usuarios) {
      const liberadas = lerAbasLiberadas(u.abasLiberadas);
      const perms = limitarPermissoes(lerPermissoes(u.perfil.permissoes), liberadas);
      if (!avisosRecebidos(perms, liberadas, u.notificacoes).some((t) => t.id === tipo)) continue;
      total += await mandarParaAparelhos(u.aparelhos, aviso);
    }
    return total;
  } catch (e) {
    console.error("aviso push falhou", tipo, e);
    return 0;
  }
}

/** Manda depois de responder a tela (não deixa ninguém esperando). Fora de uma requisição, manda na hora. */
export async function avisarDepois(tipo: TipoAviso, aviso: Aviso, filtro: { exceto?: string | null } = {}) {
  try {
    const { after } = await import("next/server");
    after(() => avisar(tipo, aviso, filtro));
  } catch {
    await avisar(tipo, aviso, filtro);
  }
}

// Ações gravadas no Histórico que viram aviso: [começo da ação, tipo, título, link]. Quem fez a ação não recebe.
const DA_AUDITORIA: [RegExp, TipoAviso, string, string][] = [
  [/^(criou item$|editou produto|alterou processo|criou operação|excluiu operação|criou etapa|sugeriu ligações)/, "produtos", "Produtos", "/produtos"],
  [/^(criou conjunto|montou conjunto|desfez conjunto)/, "conjunto", "Estoque parcial", "/estoque-parcial"],
  [/^(entregou|cancelou|excluiu) pedido de venda/, "venda-status", "Vendas", "/vendas"],
  [/^(aprovou|recebeu|cancelou|reprogramou) compra/, "compra-status", "Compras", "/compras"],
  [/^(lançou pagamento feito|lançou recebimento|conta a pagar: pag|recebimento: recebido|conferiu extrato)/, "pagamentos", "Financeiro", "/financeiro"],
  [/^(alterou parâmetros de custo|alterou parâmetros do lucro)/, "custos", "Custos", "/custos"],
  [/^mudou o mês das contas no custo/, "contas-custo", "Contas no custo", "/custos/despesas"],
  [/^(cadastrou funcionário|editou funcionário|desligou colaborador|excluiu colaborador)/, "colaboradores", "Colaboradores", "/funcionarios"],
  [/^(liberou acesso|alterou acesso|mudou perfil|criou login|excluiu login|recusou cadastro|alterou permissões)/, "acessos", "Usuários e perfis", "/usuarios"],
];

/** Chamado a cada registro do Histórico: vira aviso para as áreas certas. */
export async function avisarDaAuditoria(usuario: string, acao: string, detalhe?: string | null) {
  const texto = `${usuario} ${acao}${detalhe ? `: ${detalhe}` : ""}`.slice(0, 180);
  for (const [re, tipo, titulo, link] of DA_AUDITORIA) if (re.test(acao)) await avisarDepois(tipo, { titulo, texto, link, tag: tipo }, { exceto: usuario });
  if (/^(excluiu|apagou)/.test(acao)) await avisarDepois("exclusao", { titulo: "Exclusão no sistema", texto, link: "/historico", tag: "exclusao" }, { exceto: usuario });
}

/** Aviso de teste para os aparelhos de um login. */
export async function avisoTeste(usuarioId: number) {
  const aparelhos = await db.aparelhoPush.findMany({ where: { usuarioId } });
  return mandarParaAparelhos(aparelhos, { titulo: "R.G.A — teste", texto: "Pronto! Os avisos do sistema vão chegar assim neste aparelho.", link: "/conta", tag: "teste" });
}

// ───────── Resumo da manhã (Vercel Cron, 1 vez por dia) ─────────
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const nomes = (l: { nome: string }[]) => l.slice(0, 3).map((i) => i.nome).join(", ") + (l.length > 3 ? ` e mais ${l.length - 3}` : "");

export async function avisosDaManha() {
  const { gerarContasMensais, diaDoPagamento } = await import("./financeiro");
  const { chave, dia, somaDias } = await import("./datas");
  const { saldos } = await import("./planejamento");
  const r: Record<string, number> = {};

  await gerarContasMensais();
  const hoje = dia();
  const contas = await db.contaPagar.findMany({ where: { status: "aberto", vencimento: { lte: somaDias(hoje, 1) } } });
  const pagarHoje = contas.filter((c) => chave(diaDoPagamento(c.vencimento)) === chave(hoje));
  const vencidas = contas.filter((c) => c.vencimento < somaDias(hoje, -3));
  if (pagarHoje.length || vencidas.length) {
    const partes = [];
    if (pagarHoje.length) partes.push(`${pagarHoje.length} conta(s) para pagar hoje: ${brl(pagarHoje.reduce((s, c) => s + c.valor, 0))}`);
    if (vencidas.length) partes.push(`${vencidas.length} vencida(s) sem baixa`);
    r.contas = await avisar("contas", { titulo: "Contas a pagar", texto: partes.join(" · "), link: "/financeiro", tag: "contas" });
  }

  const [itens, sal] = await Promise.all([db.item.findMany({ where: { ativo: true, estoqueMinimo: { gt: 0 } } }), saldos()]);
  const mp = itens.filter((i) => i.tipo === "materia_prima" && i.estoque < i.estoqueMinimo);
  if (mp.length) r.mp = await avisar("materia-prima", { titulo: "Matéria-prima acabando", texto: `${mp.length} abaixo do mínimo: ${nomes(mp)}`, link: "/materia-prima", tag: "materia-prima" });
  const fin = itens.filter((i) => i.tipo === "produto" && (sal.get(i.id)?.disponivel ?? 0) + (sal.get(i.id)?.aCaminho ?? 0) < i.estoqueMinimo);
  if (fin.length) r.estoque = await avisar("estoque", { titulo: "Estoque final baixo", texto: `${fin.length} produto(s) abaixo do mínimo: ${nomes(fin)}`, link: "/estoque?baixo=1", tag: "estoque" });

  // Painel: resumo de ontem (produção, refugo, vendas)
  const inicioHoje = new Date(chave(hoje) + "T03:00:00Z"), inicioOntem = new Date(inicioHoje.getTime() - 86_400_000);
  const [aps, vendasOntem, abertas] = await Promise.all([
    db.apontamento.aggregate({ where: { data: { gte: inicioOntem, lt: inicioHoje } }, _sum: { quantidade: true, refugo: true }, _count: true }),
    db.pedidoVenda.count({ where: { dataPedido: { gte: inicioOntem, lt: inicioHoje }, status: { not: "cancelado" } } }),
    db.pedidoVenda.count({ where: { status: "aberto" } }),
  ]);
  const boas = aps._sum.quantidade ?? 0, refugo = aps._sum.refugo ?? 0;
  if (aps._count || vendasOntem || abertas) {
    r.resumo = await avisar("resumo", {
      titulo: "Bom dia! Resumo de ontem",
      texto: `Produção: ${boas.toLocaleString("pt-BR")} peça(s) boa(s)${refugo ? `, ${refugo.toLocaleString("pt-BR")} refugo` : ""} · Vendas: ${vendasOntem} · Pedidos em aberto: ${abertas}`,
      link: "/", tag: "resumo",
    });
  }

  // Colaboradores: aniversário de hoje
  const mmdd = chave(hoje).slice(5);
  const aniv = (await db.funcionario.findMany({ where: { ativo: true, nascimento: { not: null } }, select: { nome: true, nascimento: true } })).filter((f) => f.nascimento!.toISOString().slice(5, 10) === mmdd);
  if (aniv.length) r.aniversario = await avisar("aniversario", { titulo: "Aniversário hoje 🎉", texto: `${nomes(aniv)} faz(em) aniversário hoje.`, link: "/funcionarios", tag: "aniversario" });

  // Lucros: toda segunda, as vendas dos últimos 7 dias
  if (hoje.getUTCDay() === 1) {
    const semana = await db.pedidoVendaItem.findMany({ where: { pedidoVenda: { dataPedido: { gte: new Date(inicioHoje.getTime() - 7 * 86_400_000), lt: inicioHoje }, status: { not: "cancelado" } } }, select: { quantidade: true, precoUnitario: true, pedidoVendaId: true } });
    const pedidos = new Set(semana.map((x) => x.pedidoVendaId)).size;
    const valor = semana.reduce((t, x) => t + x.quantidade * (x.precoUnitario ?? 0), 0);
    const pecas = semana.reduce((t, x) => t + x.quantidade, 0);
    r.lucros = await avisar("lucros", { titulo: "Vendas da semana", texto: `${pedidos} venda(s), ${pecas.toLocaleString("pt-BR")} peça(s), ${brl(valor)}. Veja o lucro em Lucros.`, link: "/lucros", tag: "lucros" });
  }

  // Contas no custo: no 1º dia útil do mês, lembrar de conferir as contas do mês que passou
  const { diaUtil, diaUtilAnterior } = await import("./datas");
  if (diaUtil(hoje) && diaUtilAnterior(somaDias(hoje, -1)).getUTCMonth() !== hoje.getUTCMonth()) {
    r.contasCusto = await avisar("contas-custo", { titulo: "Contas no custo", texto: "Mês novo: confira as contas pagas do mês passado que entram no custo das fechaduras.", link: "/custos/despesas", tag: "contas-custo" });
  }
  return r;
}

// ───────── Fim do dia (Vercel Cron): lembrete para quem não lançou produção ─────────
export async function avisosDoFimDoDia() {
  const { chave, dia } = await import("./datas");
  const hoje = dia();
  if (hoje.getUTCDay() === 0 || hoje.getUTCDay() === 6) return { lembrete: 0 };
  const inicioHoje = new Date(chave(hoje) + "T03:00:00Z");
  const logins = await db.usuario.findMany({ where: { ativo: true, funcionarioId: { not: null }, aparelhos: { some: {} } }, select: { id: true, funcionarioId: true } });
  const comProducao = new Set((await db.apontamento.findMany({ where: { data: { gte: inicioHoje }, funcionarioId: { in: logins.map((l) => l.funcionarioId!) } }, select: { funcionarioId: true } })).map((a) => a.funcionarioId));
  const sem = logins.filter((l) => !comProducao.has(l.funcionarioId!)).map((l) => l.id);
  if (!sem.length) return { lembrete: 0 };
  return { lembrete: await avisar("lembrete-apontar", { titulo: "Lançar a produção de hoje", texto: "Você ainda não lançou a produção de hoje. Toque aqui para lançar.", link: "/apontar", tag: "lembrete-apontar" }, { soIds: sem }) };
}
