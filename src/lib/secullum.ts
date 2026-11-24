// Ligação com o relógio de ponto Secullum Ponto Web (integração externa oficial).
// Documentação: github.com/Secullum/PontoWebIntegracaoExternaExemplo (manual Integracao_Externa_Ponto_Web.pdf).
// O e-mail e a senha da Conta Secullum ficam SÓ nas variáveis da Vercel: SECULLUM_EMAIL e SECULLUM_SENHA
// (opcional SECULLUM_BANCO = id do banco, quando a conta tiver mais de um). Nunca no código.
import "server-only";
import { db } from "./db";
import { chave, dia, somaDias } from "./datas";

const AUTENTICADOR = "https://autenticador.secullum.com.br";
const API = "https://pontowebintegracaoexterna.secullum.com.br/IntegracaoExterna/";

export const secullumLigado = () => !!(process.env.SECULLUM_EMAIL && process.env.SECULLUM_SENHA);

type Sessao = { token: string; banco: string; nomeBanco: string };

async function entrar(): Promise<Sessao> {
  if (!secullumLigado()) throw new Error("Faltam SECULLUM_EMAIL e SECULLUM_SENHA nas variáveis da Vercel.");
  const r = await fetch(AUTENTICADOR + "/Token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username: process.env.SECULLUM_EMAIL!, password: process.env.SECULLUM_SENHA!, client_id: "3" }),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("O Secullum não aceitou o e-mail e a senha (" + (j.error_description || j.error || r.status) + ").");
  const token = String(j.access_token);
  const rb = await fetch(AUTENTICADOR + "/ContasSecullumExterno/ListarBancos/", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const bancos = ((await rb.json().catch(() => [])) as { id: number | string; nome?: string; clienteId?: string | number }[]) ?? [];
  const doPonto = bancos.filter((b) => String(b.clienteId) === "3");
  const escolhido = (process.env.SECULLUM_BANCO ? doPonto.find((b) => String(b.id) === process.env.SECULLUM_BANCO) : null) ?? doPonto[0];
  if (!escolhido) throw new Error("Essa conta Secullum não tem nenhum banco do Ponto Web liberado para integração.");
  return { token, banco: String(escolhido.id), nomeBanco: escolhido.nome ?? "" };
}

async function chamar<T>(s: Sessao, caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(API + caminho, {
    method: corpo ? "POST" : "GET",
    headers: { Authorization: `Bearer ${s.token}`, secullumidbancoselecionado: s.banco, "Accept-Language": "pt-BR", "Content-Type": "application/json; charset=utf-8" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: "no-store",
  });
  const txt = await r.text();
  if (r.status === 401) throw new Error("O Secullum recusou o acesso à integração. No Ponto Web, abra Manutenção → Integração com Sistemas e ative (precisa do plano PRO).");
  if (!r.ok) throw new Error(`Secullum respondeu ${r.status}: ${txt.slice(0, 200)}`);
  return (txt ? JSON.parse(txt) : null) as T;
}

// O Secullum devolve os campos com a primeira letra maiúscula; aceitamos as duas formas.
const campo = (o: Record<string, unknown>, nome: string) => o[nome] ?? o[nome[0].toLowerCase() + nome.slice(1)];
const so = (v: unknown) => (v == null ? "" : String(v).replace(/\D/g, ""));
const dataOuNull = (v: unknown) => (v ? dia(String(v).slice(0, 10)) : null);
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Tipo da batida: 0 original, 1 manual, 2 pré-assinalada, 3 desconsiderada (esta não conta).
const TIPOS: Record<string, number> = { original: 0, manual: 1, preassinalado: 2, desconsiderado: 3 };
const tipoNum = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : TIPOS[normal(String(v))] ?? null);
const ORIGENS: Record<string, number> = { desconhecido: 0, relogioponto: 1, incluidomanualmente: 2, preassinalado: 3, checkin: 4, centralfuncionarioweb: 5, centralfuncionarioapp: 6, centralfuncionarioappoffline: 7, integracaoexterna: 8 };
const origemNum = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : ORIGENS[normal(String(v))] ?? null);
export const NOME_ORIGEM: Record<number, string> = { 0: "—", 1: "Relógio", 2: "Incluída à mão", 3: "Pré-assinalada", 4: "Check-in", 5: "Central web", 6: "App", 7: "App offline", 8: "Integração" };

/** Traz os funcionários do Secullum e liga cada um ao colaborador do sistema (pelo CPF, depois pelo nome). */
async function importarFuncionarios(s: Sessao) {
  const lista = await chamar<Record<string, unknown>[]>(s, "Funcionarios");
  const nossos = await db.funcionario.findMany();
  let ligados = 0;
  for (const p of lista ?? []) {
    const id = Number(campo(p, "Id"));
    if (!Number.isFinite(id)) continue;
    const nome = String(campo(p, "Nome") ?? "").trim();
    const cpf = so(campo(p, "Cpf")) || null;
    const pis = so(campo(p, "NumeroPis")) || null;
    const dados = { nome, cpf, pis, numeroFolha: (campo(p, "NumeroFolha") as string) ?? null, admissao: dataOuNull(campo(p, "Admissao")), demissao: dataOuNull(campo(p, "Demissao")) };
    await db.pontoPessoa.upsert({ where: { secullumId: id }, create: { secullumId: id, ...dados }, update: dados });
    const jaLigado = nossos.find((f) => f.secullumId === id);
    const alvo = jaLigado ?? (cpf && nossos.find((f) => !f.secullumId && f.cpf === cpf)) ?? nossos.find((f) => !f.secullumId && normal(f.nome) === normal(nome));
    if (alvo) {
      await db.funcionario.update({ where: { id: alvo.id }, data: { secullumId: id, pis: alvo.pis ?? pis, cpf: alvo.cpf ?? cpf } });
      alvo.secullumId = id;
      ligados++;
    }
  }
  return { total: lista?.length ?? 0, ligados };
}

/** Traz as batidas do período (no máximo ~31 dias por chamada). */
async function importarBatidas(s: Sessao, inicio: Date, fim: Date) {
  const funcs = await db.funcionario.findMany({ where: { OR: [{ secullumId: { not: null } }, { cpf: { not: null } }, { pis: { not: null } }] } });
  const porSec = new Map(funcs.filter((f) => f.secullumId).map((f) => [f.secullumId!, f.id]));
  const porCpf = new Map(funcs.filter((f) => f.cpf).map((f) => [so(f.cpf), f.id]));
  const porPis = new Map(funcs.filter((f) => f.pis).map((f) => [so(f.pis), f.id]));
  let novas = 0, total = 0;
  for (let a = inicio; a <= fim; a = somaDias(a, 31)) {
    const b = somaDias(a, 30) < fim ? somaDias(a, 30) : fim;
    const lista = await chamar<Record<string, unknown>[]>(s, `FonteDados?dataInicio=${chave(a)}&dataFim=${chave(b)}`);
    for (const x of lista ?? []) {
      const sid = String(campo(x, "Id") ?? "");
      const data = String(campo(x, "Data") ?? "").slice(0, 10);
      const hora = String(campo(x, "Hora") ?? "").slice(0, 5);
      if (!sid || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{1,2}:\d{2}$/.test(hora)) continue;
      total++;
      const secF = Number(campo(x, "FuncionarioId")) || null;
      const cpf = so(campo(x, "FuncionarioCpf")) || null;
      const pis = so(campo(x, "FuncionarioPis")) || null;
      const funcionarioId = (secF && porSec.get(secF)) || (cpf && porCpf.get(cpf)) || (pis && porPis.get(pis)) || null;
      const dados = { funcionarioId, secullumFuncId: secF, cpf, pis, data: dia(data), hora: hora.padStart(5, "0"), origem: origemNum(campo(x, "Origem")), tipo: tipoNum(campo(x, "Tipo")) };
      const antes = await db.batidaPonto.findUnique({ where: { secullumId: sid }, select: { id: true } });
      await db.batidaPonto.upsert({ where: { secullumId: sid }, create: { secullumId: sid, ...dados }, update: dados });
      if (!antes) novas++;
    }
  }
  return { total, novas };
}

/** Totais do mês pelo cálculo do próprio Secullum (limite deles: 100 por hora). */
async function importarTotais(s: Sessao, mes: string) {
  const [ano, m] = mes.split("-").map(Number);
  const ini = `${mes}-01`, fim = chave(new Date(Date.UTC(ano, m, 0, 12)));
  const funcs = await db.funcionario.findMany({ where: { ativo: true, secullumId: { not: null }, OR: [{ cpf: { not: null } }, { pis: { not: null } }] } });
  let ok = 0;
  for (const f of funcs) {
    try {
      const r = await chamar<{ Colunas?: string[]; Totais?: string[]; colunas?: string[]; totais?: string[] }>(s, "Calcular/SomenteTotais", { FuncionarioCpf: f.cpf ?? "", FuncionarioPis: f.pis ?? "", DataInicial: ini, DataFinal: fim });
      const colunas = r?.Colunas ?? r?.colunas ?? [], totais = r?.Totais ?? r?.totais ?? [];
      await db.pontoTotal.upsert({ where: { funcionarioId_mes: { funcionarioId: f.id, mes } }, create: { funcionarioId: f.id, mes, colunas: JSON.stringify(colunas), totais: JSON.stringify(totais) }, update: { colunas: JSON.stringify(colunas), totais: JSON.stringify(totais) } });
      ok++;
    } catch { /* um funcionário com erro não para os outros */ }
  }
  return ok;
}

export type ResultadoSync = { ok: boolean; mensagem: string };

/** Busca tudo: funcionários, batidas dos últimos `dias` dias e os totais do mês atual (e do anterior nos 5 primeiros dias). */
export async function sincronizarPonto(dias = 7): Promise<ResultadoSync> {
  try {
    const s = await entrar();
    const f = await importarFuncionarios(s);
    const hoje = dia();
    const b = await importarBatidas(s, somaDias(hoje, -(dias - 1)), hoje);
    const mes = chave(hoje).slice(0, 7);
    let t = await importarTotais(s, mes);
    if (hoje.getUTCDate() <= 5) t += await importarTotais(s, chave(somaDias(hoje, -hoje.getUTCDate())).slice(0, 7));
    const msg = `${f.total} funcionário(s) no Secullum, ${f.ligados} ligado(s) aos colaboradores. ${b.total} batida(s) nos últimos ${dias} dias, ${b.novas} nova(s). Totais do mês de ${t} pessoa(s).`;
    await salvarStatus(true, msg);
    return { ok: true, mensagem: msg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await salvarStatus(false, msg);
    return { ok: false, mensagem: msg };
  }
}

async function salvarStatus(ok: boolean, msg: string) {
  const valor = JSON.stringify({ ok, msg, em: new Date().toISOString() });
  await db.configuracao.upsert({ where: { chave: "secullumStatus" }, create: { chave: "secullumStatus", valor }, update: { valor } });
}

export async function statusPonto(): Promise<{ ok: boolean; msg: string; em: Date } | null> {
  const c = await db.configuracao.findUnique({ where: { chave: "secullumStatus" } });
  if (!c) return null;
  try { const j = JSON.parse(c.valor); return { ok: !!j.ok, msg: String(j.msg), em: new Date(j.em) }; } catch { return null; }
}

// ───────────── Contas das horas ─────────────

const min = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
export const hhmm = (m: number) => `${m < 0 ? "-" : ""}${Math.floor(Math.abs(m) / 60)}:${String(Math.round(Math.abs(m) % 60)).padStart(2, "0")}`;

/** Minutos trabalhados num dia: soma dos pares entrada→saída. Número ímpar de batidas = dia incompleto (falta bater). */
export function minutosDoDia(horas: string[]) {
  const h = [...horas].sort();
  let total = 0;
  for (let i = 0; i + 1 < h.length; i += 2) total += Math.max(0, min(h[i + 1]) - min(h[i]));
  return { minutos: total, incompleto: h.length % 2 === 1 };
}

export type DiaPonto = { data: Date; horas: string[]; minutos: number; incompleto: boolean };

/** Cartão de ponto de cada colaborador num período, montado com as batidas que valem (desconsideradas ficam de fora). */
export async function cartoes(inicio: Date, fim: Date, funcionarioId?: number) {
  const bs = await db.batidaPonto.findMany({
    where: { data: { gte: inicio, lte: fim }, funcionarioId: funcionarioId ?? { not: null }, OR: [{ tipo: null }, { tipo: { not: 3 } }] },
    orderBy: [{ data: "asc" }, { hora: "asc" }],
  });
  const m = new Map<number, Map<string, string[]>>();
  for (const b of bs) {
    const porDia = m.get(b.funcionarioId!) ?? new Map<string, string[]>();
    const k = chave(b.data);
    const l = porDia.get(k) ?? [];
    if (!l.includes(b.hora)) l.push(b.hora);
    porDia.set(k, l);
    m.set(b.funcionarioId!, porDia);
  }
  const r = new Map<number, { dias: DiaPonto[]; minutos: number; incompletos: number }>();
  for (const [fid, porDia] of m) {
    const dias = [...porDia.entries()].map(([k, horas]) => ({ data: dia(k), horas: horas.sort(), ...minutosDoDia(horas) }));
    r.set(fid, { dias, minutos: dias.reduce((s, d) => s + d.minutos, 0), incompletos: dias.filter((d) => d.incompleto).length });
  }
  return r;
}

/** Totais do Secullum de um mês, por colaborador: { colunas, totais }. */
export async function totaisDoMes(mes: string) {
  const l = await db.pontoTotal.findMany({ where: { mes } });
  return new Map(l.map((t) => [t.funcionarioId, { colunas: JSON.parse(t.colunas) as string[], totais: JSON.parse(t.totais) as string[], em: t.atualizadoEm }]));
}
