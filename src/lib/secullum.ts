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
    const txt = (k: string) => { const v = campo(p, k); return v == null || v === "" ? null : String(typeof v === "object" ? (v as Record<string, unknown>).Descricao ?? "" : v) || null; };
    const { Foto: _foto, foto: _f2, ...semFoto } = p as Record<string, unknown>;
    const dados = {
      nome, cpf, pis, numeroFolha: txt("NumeroFolha"), admissao: dataOuNull(campo(p, "Admissao")), demissao: dataOuNull(campo(p, "Demissao")),
      departamento: txt("DepartamentoDescricao") ?? txt("Departamento"), funcao: txt("FuncaoDescricao") ?? txt("Funcao"),
      horario: [txt("HorarioNumero"), txt("HorarioDescricao")].filter(Boolean).join(" — ") || null, dados: JSON.stringify(semFoto),
    };
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
    const linhas = new Map<string, { secullumId: string; funcionarioId: number | null; secullumFuncId: number | null; cpf: string | null; pis: string | null; data: Date; hora: string; origem: number | null; tipo: number | null }>();
    for (const x of lista ?? []) {
      const sid = String(campo(x, "Id") ?? "");
      const data = String(campo(x, "Data") ?? "").slice(0, 10);
      const hora = String(campo(x, "Hora") ?? "").slice(0, 5);
      if (!sid || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{1,2}:\d{2}$/.test(hora)) continue;
      const secF = Number(campo(x, "FuncionarioId")) || null;
      const cpf = so(campo(x, "FuncionarioCpf")) || null;
      const pis = so(campo(x, "FuncionarioPis")) || null;
      const funcionarioId = (secF && porSec.get(secF)) || (cpf && porCpf.get(cpf)) || (pis && porPis.get(pis)) || null;
      linhas.set(sid, { secullumId: sid, funcionarioId, secullumFuncId: secF, cpf, pis, data: dia(data), hora: hora.padStart(5, "0"), origem: origemNum(campo(x, "Origem")), tipo: tipoNum(campo(x, "Tipo")) });
    }
    total += linhas.size;
    // tudo de uma vez (rápido): só grava as novas e corrige as que mudaram
    const ids = [...linhas.keys()];
    const existentes = new Map<string, { funcionarioId: number | null; tipo: number | null }>();
    for (let i = 0; i < ids.length; i += 1000) {
      for (const e of await db.batidaPonto.findMany({ where: { secullumId: { in: ids.slice(i, i + 1000) } }, select: { secullumId: true, funcionarioId: true, tipo: true } })) existentes.set(e.secullumId, e);
    }
    const criar = [...linhas.values()].filter((l) => !existentes.has(l.secullumId));
    for (let i = 0; i < criar.length; i += 1000) novas += (await db.batidaPonto.createMany({ data: criar.slice(i, i + 1000), skipDuplicates: true })).count;
    const mudou = [...linhas.values()].filter((l) => { const e = existentes.get(l.secullumId); return e && (e.funcionarioId !== l.funcionarioId || e.tipo !== l.tipo); });
    for (const l of mudou) await db.batidaPonto.update({ where: { secullumId: l.secullumId }, data: { funcionarioId: l.funcionarioId, tipo: l.tipo, origem: l.origem, hora: l.hora } });
  }
  return { total, novas };
}

/** Cálculo do mês pelo próprio Secullum, dia a dia e total (limite deles: 100 chamadas por hora). */
async function importarTotais(s: Sessao, mes: string) {
  const [ano, m] = mes.split("-").map(Number);
  const ini = `${mes}-01`, fim = chave(new Date(Date.UTC(ano, m, 0, 12)));
  const funcs = await db.funcionario.findMany({ where: { ativo: true, secullumId: { not: null }, OR: [{ cpf: { not: null } }, { pis: { not: null } }] } });
  let ok = 0;
  await Promise.all(funcs.map(async (f) => {
    try {
      const r = await chamar<{ Colunas?: string[]; Totais?: string[]; Linhas?: unknown[]; colunas?: string[]; totais?: string[]; linhas?: unknown[] }>(s, "Calcular", { FuncionarioCpf: f.cpf ?? "", FuncionarioPis: f.pis ?? "", DataInicial: ini, DataFinal: fim });
      const d = { colunas: JSON.stringify(r?.Colunas ?? r?.colunas ?? []), totais: JSON.stringify(r?.Totais ?? r?.totais ?? []), linhas: JSON.stringify(r?.Linhas ?? r?.linhas ?? []) };
      await db.pontoTotal.upsert({ where: { funcionarioId_mes: { funcionarioId: f.id, mes } }, create: { funcionarioId: f.id, mes, ...d }, update: d });
      ok++;
    } catch { /* um funcionário com erro não para os outros */ }
  }));
  return ok;
}

/** Férias, atestados e licenças lançados no Secullum que tocam o período. */
async function importarAfastamentos(s: Sessao, inicio: Date, fim: Date) {
  const lista = await chamar<Record<string, unknown>[]>(s, `FuncionariosAfastamentos?dataInicio=${chave(inicio)}&dataFim=${chave(fim)}`);
  const funcs = await db.funcionario.findMany({ where: { OR: [{ cpf: { not: null } }, { pis: { not: null } }] } });
  let n = 0;
  for (const a of lista ?? []) {
    const ini = String(campo(a, "Inicio") ?? "").slice(0, 10), fi = String(campo(a, "Fim") ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fi)) continue;
    const cpf = so(campo(a, "Cpf")) || null, pis = so(campo(a, "NumeroPis")) || null;
    const justificativa = (campo(a, "JustificativaNome") as string) ?? null;
    const f = funcs.find((x) => (cpf && so(x.cpf) === cpf) || (pis && so(x.pis) === pis));
    const k = `${cpf ?? pis}|${ini}|${fi}|${justificativa ?? ""}`;
    const dados = { funcionarioId: f?.id ?? null, cpf, pis, inicio: dia(ini), fim: dia(fi), motivo: (campo(a, "Motivo") as string) || null, justificativa };
    await db.pontoAfastamento.upsert({ where: { chave: k }, create: { chave: k, ...dados }, update: dados });
    n++;
  }
  return n;
}

export type ResultadoSync = { ok: boolean; mensagem: string };

/** Busca tudo: funcionários, batidas dos últimos `dias` dias e os totais do mês atual (e do anterior nos 5 primeiros dias). */
export async function sincronizarPonto(dias = 7): Promise<ResultadoSync> {
  let etapa = "entrar no Secullum";
  await salvarStatus(false, "Buscando agora… se esta mensagem ficar, a busca parou no meio (tempo esgotado). Tente de novo com um período menor.");
  try {
    const s = await entrar();
    etapa = "trazer os funcionários";
    const f = await importarFuncionarios(s);
    const hoje = dia();
    etapa = "trazer as batidas";
    const b = await importarBatidas(s, somaDias(hoje, -(dias - 1)), hoje);
    const mes = chave(hoje).slice(0, 7);
    const inicioAnterior = dia(chave(somaDias(dia(`${mes}-01`), -1)).slice(0, 7) + "-01");
    let af = 0;
    try { af = await importarAfastamentos(s, inicioAnterior, somaDias(hoje, 60)); } catch { /* sem afastamentos não para o resto */ }
    etapa = "trazer o cálculo do mês";
    let t = await importarTotais(s, mes);
    if (hoje.getUTCDate() <= 10 || dias > 31) t += await importarTotais(s, chave(inicioAnterior).slice(0, 7));
    const msg = `${f.total} funcionário(s) no Secullum, ${f.ligados} ligado(s) aos colaboradores. ${b.total} batida(s) nos últimos ${dias} dias, ${b.novas} nova(s). ${af} afastamento(s). Cálculo do mês de ${t} pessoa(s).`;
    await salvarStatus(true, msg);
    return { ok: true, mensagem: msg };
  } catch (e) {
    const msg = `Erro ao ${etapa}: ${e instanceof Error ? e.message : String(e)}`;
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
  return new Map(l.map((t) => [t.funcionarioId, {
    colunas: JSON.parse(t.colunas) as string[], totais: JSON.parse(t.totais) as string[], em: t.atualizadoEm,
    linhas: (JSON.parse(t.linhas || "[]") as { Key?: string; Value?: string[]; key?: string; value?: string[] }[]).map((x) => ({ data: String(x.Key ?? x.key ?? "").slice(0, 10), valores: x.Value ?? x.value ?? [] })),
  }]));
}

/** Afastamentos que tocam o período, por colaborador. */
export async function afastamentosDoPeriodo(inicio: Date, fim: Date) {
  const l = await db.pontoAfastamento.findMany({ where: { funcionarioId: { not: null }, inicio: { lte: fim }, fim: { gte: inicio } }, orderBy: { inicio: "asc" } });
  const m = new Map<number, typeof l>();
  for (const a of l) m.set(a.funcionarioId!, [...(m.get(a.funcionarioId!) ?? []), a]);
  return m;
}
