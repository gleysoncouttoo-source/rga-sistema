export const brl = (v: number | null | undefined, casas = 2) =>
  v == null || Number.isNaN(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });

export const num = (v: number | null | undefined, casas = 0) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const data = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
export const dataHora = (d: Date | null | undefined) =>
  d ? d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";

/** segundos por peça → peças por hora */
export const pecasHora = (seg: number | null | undefined) => (seg ? 3600 / seg : null);

/** Data de calendário (guardada ao meio-dia UTC) → dd/mm/aaaa */
export const dataDia = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
export const dataCurta = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" }) : "—";
export const qtd = (v: number | null | undefined, unidade = "un") =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: unidade === "un" ? 0 : 3 })}${unidade === "un" ? "" : " " + unidade}`;
