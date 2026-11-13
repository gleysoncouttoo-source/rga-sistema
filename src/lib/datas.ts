// Datas "de calendário" (sem hora). Guardamos sempre ao meio-dia UTC para não trocar de dia no fuso de Brasília.
const DIA = 86_400_000;

export function dia(d: Date | string = new Date()): Date {
  if (typeof d === "string") {
    const [a, m, x] = d.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, x, 12));
  }
  // "hoje" no horário de Brasília
  const s = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return dia(s);
}
export const somaDias = (d: Date, n: number) => new Date(d.getTime() + n * DIA);
export const chave = (d: Date) => d.toISOString().slice(0, 10);
export const diasEntre = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DIA);

function pascoa(ano: number) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), diaM = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, diaM, 12));
}

const cacheFeriados = new Map<number, Set<string>>();
/** Feriados nacionais (bancos fechados). Feriados municipais podem ser lançados como dias sem expediente depois. */
export function feriados(ano: number): Set<string> {
  let s = cacheFeriados.get(ano);
  if (s) return s;
  const p = pascoa(ano);
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"].map((x) => `${ano}-${x}`);
  const moveis = [-48, -47, -2, 60].map((n) => chave(somaDias(p, n))); // carnaval (seg e ter), sexta santa, Corpus Christi
  s = new Set([...fixos, ...moveis]);
  cacheFeriados.set(ano, s);
  return s;
}

export function diaUtil(d: Date) {
  const w = d.getUTCDay();
  return w !== 0 && w !== 6 && !feriados(d.getUTCFullYear()).has(chave(d));
}
/** Boleto que vence em fim de semana ou feriado é pago no próximo dia útil. */
export function proximoDiaUtil(d: Date) {
  let x = d;
  while (!diaUtil(x)) x = somaDias(x, 1);
  return x;
}
export function diaUtilAnterior(d: Date) {
  let x = d;
  while (!diaUtil(x)) x = somaDias(x, -1);
  return x;
}
/** Volta n dias úteis (tempo de fabricação). */
export function menosDiasUteis(d: Date, n: number) {
  let x = d;
  for (let i = 0; i < n; i++) x = diaUtilAnterior(somaDias(x, -1));
  return x;
}
export function maisDiasUteis(d: Date, n: number) {
  let x = d;
  for (let i = 0; i < n; i++) x = proximoDiaUtil(somaDias(x, 1));
  return x;
}
export const semana = (d: Date) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getUTCDay()];
