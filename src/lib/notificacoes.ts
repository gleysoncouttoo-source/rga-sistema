import "server-only";
import webpush from "web-push";
import { db } from "./db";
import { abasDoUsuario, lerAbasLiberadas, lerPermissoes, limitarPermissoes, pode, type Modulo, type Acao, type Permissoes } from "./permissoes";

// Avisos no celular (notificação push). Cada tipo pertence a uma aba: só recebe quem tem essa aba liberada.
// O diretor tem todas as abas, então escolhe entre todos; os outros logins só veem os da própria área.
export const TIPOS_AVISO = [
  { id: "venda", nome: "Nova venda da Shopee ou do site", aba: "vendas" },
  { id: "compra", nome: "Compra lançada pelo sistema (falta material)", aba: "compras" },
  { id: "contas", nome: "Contas a pagar hoje e vencidas (todo dia de manhã)", aba: "financeiro" },
  { id: "materia-prima", nome: "Matéria-prima abaixo do mínimo (todo dia de manhã)", aba: "materia-prima" },
  { id: "estoque", nome: "Estoque final abaixo do mínimo (todo dia de manhã)", aba: "estoque" },
  { id: "recorde", nome: "Novo recorde de produção para confirmar", aba: "producao", acao: ["producao", "aprovar"] },
  { id: "cadastro", nome: "Pessoa pedindo acesso ao sistema", aba: "usuarios", acao: ["usuarios", "editar"] },
] as const;

export type TipoAviso = (typeof TIPOS_AVISO)[number]["id"];

/** Tipos de aviso que este login pode receber (pela área liberada). */
export function avisosDisponiveis(permissoes: Permissoes, liberadas: string[] | null) {
  const abas = new Set(abasDoUsuario(permissoes, null, liberadas).map((a) => a.id));
  return TIPOS_AVISO.filter((t) => abas.has(t.aba) && (!("acao" in t) || pode(permissoes, t.acao[0], t.acao[1])));
}

export function lerEscolhidos(json: string | null | undefined): string[] | null {
  if (!json) return null;
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : null; } catch { return null; }
}

/** Avisos que o login recebe: os que escolheu (nada escolhido ainda = todos), sempre dentro da área liberada. */
export function avisosRecebidos(permissoes: Permissoes, liberadas: string[] | null, escolhidosJson: string | null | undefined) {
  const esc = lerEscolhidos(escolhidosJson);
  return avisosDisponiveis(permissoes, liberadas).filter((t) => esc == null || esc.includes(t.id));
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
export async function avisar(tipo: TipoAviso, aviso: Aviso) {
  try {
    const usuarios = await db.usuario.findMany({
      where: { ativo: true, pendente: false, aparelhos: { some: {} } },
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
  return r;
}
