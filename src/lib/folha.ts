// Folha do mês a partir do cartão de ponto (Secullum): eventos variáveis por colaborador, prévia do bruto,
// custo para a empresa e arquivos para o contador. INSS, IRRF, FGTS e descontos legais ficam com o contador.
import "server-only";
import { db } from "./db";
import { lerConfig } from "./config";
import { chave, dia, feriados, somaDias } from "./datas";
import { afastamentosDoPeriodo, cartoes, hhmm, totaisDoMes } from "./secullum";

export type Evento = { codigo: string; nome: string; referencia: string; provento: number; desconto: number };
export type HorasFolha = { normais: number; extras: { pct: number; nome: string; min: number }[]; noturno: number; faltas: number; atrasos: number; dsrDeb: number };
export type LinhaFolha = {
  funcionario: { id: number; nome: string; cpf: string | null; pis: string | null; matricula: string | null; setor: string | null; cargo: string; admissao: Date | null; chavePix: string | null };
  salario: number; minutosPonto: number; diasPonto: number; incompletos: number; temCalculo: boolean;
  horas: HorasFolha; eventos: Evento[]; proventos: number; descontos: number; bruto: number;
  encargos: number; beneficios: number; custoTotal: number; custoHoraReal: number | null; afastamentos: string[]; liquido: number | null;
};

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9%]/g, "");
/** "132:00" → minutos; vazio ou "-" → 0 */
export const paraMin = (v: string | undefined | null) => {
  const m = String(v ?? "").trim().match(/^(-)?(\d+):(\d{2})$/);
  return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
};

/** Lê as colunas do cálculo do Secullum (os nomes mudam conforme a configuração da empresa). */
export function lerHoras(colunas: string[], totais: string[]): HorasFolha {
  const h: HorasFolha = { normais: 0, extras: [], noturno: 0, faltas: 0, atrasos: 0, dsrDeb: 0 };
  colunas.forEach((c, i) => {
    const n = normal(c), min = paraMin(totais[i]);
    if (!min) return;
    if (/^normais/.test(n)) h.normais += min;
    else if (/^(ex|extra|he)/.test(n) && !/^exc/.test(n)) { const pct = Number(n.match(/(\d{2,3})/)?.[1] ?? 50); h.extras.push({ pct, nome: c, min }); }
    else if (/^(not|adnot|adicionalnot)/.test(n)) h.noturno += min;
    else if (/^falta/.test(n)) h.faltas += min;
    else if (/^atras/.test(n)) h.atrasos += min;
    else if (/dsrdeb|debdsr|dsrd/.test(n)) h.dsrDeb += min;
  });
  return h;
}

/** Dias de descanso (domingos e feriados) e dias úteis do mês, para o DSR. */
export function diasDsr(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const fer = feriados(a);
  let uteis = 0, descanso = 0;
  for (let d = dia(`${mes}-01`); d.getUTCMonth() === m - 1; d = somaDias(d, 1)) {
    if (d.getUTCDay() === 0 || fer.has(chave(d))) descanso++; else uteis++;
  }
  return { uteis, descanso };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function limitesMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return { inicio: dia(`${mes}-01`), fim: new Date(Date.UTC(a, m, 0, 12)) };
}

/** Prévia da folha do mês (muda conforme o ponto). Se a folha já foi fechada, devolve o que foi congelado. */
export async function folhaDoMes(mes: string): Promise<{ fechada: boolean; info: Awaited<ReturnType<typeof db.folhaMes.findUnique>>; linhas: LinhaFolha[] }> {
  const info = await db.folhaMes.findUnique({ where: { mes }, include: { pessoas: { include: { funcionario: true }, orderBy: { funcionario: { nome: "asc" } } } } });
  const { inicio, fim } = limitesMes(mes);
  if (info?.status === "fechada") {
    const cs = await cartoes(inicio, fim);
    return {
      fechada: true, info,
      linhas: info.pessoas.map((p) => {
        const salvo = JSON.parse(p.eventos) as { eventos: Evento[]; horas: HorasFolha };
        const eventos = salvo.eventos ?? [];
        const c = cs.get(p.funcionarioId);
        return {
          funcionario: p.funcionario, salario: p.salario, minutosPonto: p.minutosPonto, diasPonto: c?.dias.length ?? 0, incompletos: c?.incompletos ?? 0, temCalculo: true,
          horas: salvo.horas ?? { normais: 0, extras: [], noturno: 0, faltas: 0, atrasos: 0, dsrDeb: 0 },
          eventos, proventos: p.proventos, descontos: p.descontos, bruto: p.bruto, encargos: p.encargos, beneficios: p.beneficios, custoTotal: p.custoTotal,
          custoHoraReal: p.custoHoraReal, afastamentos: p.afastamentos ? p.afastamentos.split("\n") : [], liquido: p.liquido,
        };
      }),
    };
  }
  const [cfg, funcs, cs, tot, afs] = await Promise.all([
    lerConfig(),
    db.funcionario.findMany({ where: { OR: [{ ativo: true }, { desligamento: { gte: inicio } }], salario: { gt: 0 } }, orderBy: { nome: "asc" } }),
    cartoes(inicio, fim), totaisDoMes(mes), afastamentosDoPeriodo(inicio, fim),
  ]);
  const { uteis, descanso } = diasDsr(mes);
  const linhas = funcs.filter((f) => !f.admissao || f.admissao <= fim).map((f): LinhaFolha => {
    const salario = f.salario!, vh = salario / cfg.horasMes;
    const t = tot.get(f.id);
    const horas = t ? lerHoras(t.colunas, t.totais) : { normais: 0, extras: [], noturno: 0, faltas: 0, atrasos: 0, dsrDeb: 0 };
    const ev: Evento[] = [{ codigo: "001", nome: "Salário base", referencia: `${cfg.horasMes}h`, provento: salario, desconto: 0 }];
    let variaveis = 0;
    for (const x of horas.extras) {
      const v = r2((x.min / 60) * vh * (1 + x.pct / 100));
      ev.push({ codigo: `HE${x.pct}`, nome: `Horas extras ${x.pct}%`, referencia: hhmm(x.min), provento: v, desconto: 0 });
      variaveis += v;
    }
    if (horas.noturno) { const v = r2((horas.noturno / 60) * vh * 0.2); ev.push({ codigo: "ADN", nome: "Adicional noturno 20%", referencia: hhmm(horas.noturno), provento: v, desconto: 0 }); variaveis += v; }
    if (variaveis && uteis) ev.push({ codigo: "DSR", nome: "DSR sobre extras e noturno", referencia: `${descanso}/${uteis} dias`, provento: r2((variaveis / uteis) * descanso), desconto: 0 });
    if (horas.faltas) ev.push({ codigo: "FAL", nome: "Faltas", referencia: hhmm(horas.faltas), provento: 0, desconto: r2((horas.faltas / 60) * vh) });
    if (horas.atrasos) ev.push({ codigo: "ATR", nome: "Atrasos", referencia: hhmm(horas.atrasos), provento: 0, desconto: r2((horas.atrasos / 60) * vh) });
    if (horas.dsrDeb) ev.push({ codigo: "DSRD", nome: "DSR descontado (faltas)", referencia: hhmm(horas.dsrDeb), provento: 0, desconto: r2((horas.dsrDeb / 60) * vh) });
    const proventos = r2(ev.reduce((s, e) => s + e.provento, 0)), descontos = r2(ev.reduce((s, e) => s + e.desconto, 0));
    const bruto = r2(proventos - descontos);
    const encargos = r2(bruto * ((f.encargosPct ?? cfg.encargosPct) / 100)), beneficios = f.beneficios ?? 0;
    const custoTotal = r2(bruto + encargos + beneficios);
    const c = cs.get(f.id);
    const minutosPonto = c?.minutos ?? (horas.normais + horas.extras.reduce((s, x) => s + x.min, 0));
    const dm = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "UTC" }).slice(0, 5);
    const afast = (afs.get(f.id) ?? []).map((a) => `${a.justificativa ?? "Afastamento"} ${dm(a.inicio)}${a.fim > a.inicio ? ` a ${dm(a.fim)}` : ""}${a.motivo ? ` (${a.motivo})` : ""}`);
    return {
      funcionario: f, salario, minutosPonto, diasPonto: c?.dias.length ?? 0, incompletos: c?.incompletos ?? 0, temCalculo: !!t, horas, eventos: ev,
      proventos, descontos, bruto, encargos, beneficios, custoTotal, custoHoraReal: minutosPonto ? r2(custoTotal / (minutosPonto / 60)) : null, afastamentos: afast, liquido: null,
    };
  });
  return { fechada: false, info, linhas };
}

/** Congela a folha do mês (valores, eventos e custo real da hora). */
export async function fecharFolha(mes: string, quem: string) {
  const f = await folhaDoMes(mes);
  if (f.fechada) return f;
  await db.$transaction(async (tx) => {
    await tx.folhaMes.upsert({ where: { mes }, create: { mes, status: "fechada", fechadaEm: new Date(), fechadaPor: quem }, update: { status: "fechada", fechadaEm: new Date(), fechadaPor: quem } });
    await tx.folhaPessoa.deleteMany({ where: { mes } });
    await tx.folhaPessoa.createMany({
      data: f.linhas.map((l) => ({
        mes, funcionarioId: l.funcionario.id, salario: l.salario, minutosPonto: l.minutosPonto,
        eventos: JSON.stringify({ eventos: l.eventos, horas: l.horas }),
        proventos: l.proventos, descontos: l.descontos, bruto: l.bruto, encargos: l.encargos, beneficios: l.beneficios, custoTotal: l.custoTotal,
        custoHoraReal: l.custoHoraReal, afastamentos: l.afastamentos.join("\n") || null,
      })),
    });
  });
  return folhaDoMes(mes);
}

export async function reabrirFolha(mes: string) {
  await db.folhaMes.update({ where: { mes }, data: { status: "aberta" } });
  await db.folhaPessoa.deleteMany({ where: { mes } });
}

/** Custo real da hora de cada colaborador na última folha fechada (usado no custo dos produtos). */
export async function custosHoraReais(): Promise<Map<number, number>> {
  const ultima = await db.folhaMes.findFirst({ where: { status: "fechada" }, orderBy: { mes: "desc" }, include: { pessoas: true } });
  return new Map((ultima?.pessoas ?? []).filter((p) => p.custoHoraReal && p.minutosPonto >= 60 * 40).map((p) => [p.funcionarioId, p.custoHoraReal!]));
}

// ───────────── Arquivos para o contador ─────────────

const csv = (linhas: (string | number | null | undefined)[][]) =>
  "﻿" + linhas.map((l) => l.map((v) => {
    const s = v == null ? "" : typeof v === "number" ? (Number.isInteger(v) && Math.abs(v) < 1000 ? String(v) : v.toFixed(2).replace(".", ",")) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(";")).join("\r\n");

/** Movimento do mês: uma linha por colaborador com as horas (para o contador lançar) e a prévia dos valores. */
export function csvMovimento(mes: string, linhas: LinhaFolha[]) {
  const pcts = [...new Set(linhas.flatMap((l) => l.horas.extras.map((x) => x.pct)))].sort((a, b) => a - b);
  const cab = ["Competência", "Nº folha/matrícula", "Nome", "CPF", "PIS", "Admissão", "Setor", "Cargo", "Salário", "Dias com batida", "Horas no ponto", "Horas normais",
    ...pcts.map((p) => `Horas extras ${p}%`), "Adicional noturno (h)", "Faltas (h)", "Atrasos (h)", "DSR descontado (h)", "Afastamentos",
    ...pcts.map((p) => `Valor extras ${p}%`), "Valor adic. noturno", "Valor DSR", "Desconto faltas", "Desconto atrasos", "Desconto DSR", "Bruto (prévia)", "Líquido informado"];
  const val = (l: LinhaFolha, cod: string, campo: "provento" | "desconto") => l.eventos.find((e) => e.codigo === cod)?.[campo] ?? 0;
  const corpo = linhas.map((l) => [
    `${mes.slice(5)}/${mes.slice(0, 4)}`, l.funcionario.matricula, l.funcionario.nome, l.funcionario.cpf, l.funcionario.pis, l.funcionario.admissao?.toLocaleDateString("pt-BR", { timeZone: "UTC" }),
    l.funcionario.setor, l.funcionario.cargo, l.salario, l.diasPonto, hhmm(l.minutosPonto), hhmm(l.horas.normais),
    ...pcts.map((p) => hhmm(l.horas.extras.filter((x) => x.pct === p).reduce((s, x) => s + x.min, 0))),
    hhmm(l.horas.noturno), hhmm(l.horas.faltas), hhmm(l.horas.atrasos), hhmm(l.horas.dsrDeb), l.afastamentos.join(" | "),
    ...pcts.map((p) => val(l, `HE${p}`, "provento")), val(l, "ADN", "provento"), val(l, "DSR", "provento"), val(l, "FAL", "desconto"), val(l, "ATR", "desconto"), val(l, "DSRD", "desconto"), l.bruto, l.liquido,
  ]);
  return csv([cab, ...corpo]);
}

/** Espelho de ponto: todas as batidas do mês, dia a dia, de cada colaborador. */
export async function csvEspelho(mes: string) {
  const { inicio, fim } = limitesMes(mes);
  const [cs, funcs] = await Promise.all([cartoes(inicio, fim), db.funcionario.findMany({ orderBy: { nome: "asc" } })]);
  const max = Math.max(4, ...[...cs.values()].flatMap((c) => c.dias.map((d) => d.horas.length)));
  const cab = ["Nome", "CPF", "Data", "Dia", ...Array.from({ length: max }, (_, i) => `${i % 2 ? "Saída" : "Entrada"} ${Math.floor(i / 2) + 1}`), "Horas", "Observação"];
  const SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const linhas: (string | number | null)[][] = [cab];
  for (const f of funcs) {
    const c = cs.get(f.id);
    if (!c) continue;
    for (const d of c.dias) linhas.push([f.nome, f.cpf, d.data.toLocaleDateString("pt-BR", { timeZone: "UTC" }), SEM[d.data.getUTCDay()], ...Array.from({ length: max }, (_, i) => d.horas[i] ?? ""), hhmm(d.minutos), d.incompleto ? "falta batida" : ""]);
    linhas.push([f.nome, f.cpf, "Total", "", ...Array(max).fill(""), hhmm(c.minutos), ""]);
  }
  return csv(linhas);
}

export async function emailContador() {
  return (await db.configuracao.findUnique({ where: { chave: "contadorEmail" } }))?.valor ?? "";
}
