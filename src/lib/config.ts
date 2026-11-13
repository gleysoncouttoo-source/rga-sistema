import { db } from "./db";

export type Config = { horasMes: number; encargosPct: number; minutosMinimoRecorde: number };

export async function lerConfig(): Promise<Config> {
  const rows = await db.configuracao.findMany();
  const m = Object.fromEntries(rows.map((r) => [r.chave, Number(r.valor)]));
  return {
    horasMes: m.horasMes || 220,
    encargosPct: m.encargosPct ?? 0,
    minutosMinimoRecorde: m.minutosMinimoRecorde ?? 30,
  };
}

/** Custo da hora = (salário × (1 + encargos do colaborador) + benefícios) ÷ horas/mês. Sem encargos próprios, usa o % padrão. */
export function custoHora(salario: number | null | undefined, c: Config, f?: { encargosPct?: number | null; beneficios?: number | null }) {
  if (!salario) return null;
  return (salario * (1 + (f?.encargosPct ?? c.encargosPct) / 100) + (f?.beneficios ?? 0)) / c.horasMes;
}
