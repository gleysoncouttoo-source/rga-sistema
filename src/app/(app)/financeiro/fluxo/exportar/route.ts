// Baixa o fluxo de caixa (semana ou mês) em CSV para abrir no Excel
import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { db } from "@/lib/db";
import { chave, dia } from "@/lib/datas";
import { linhasFluxo, periodoFluxo } from "@/lib/financeiro";

export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || !pode(u.permissoes, "financeiro")) return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const modo = sp.get("modo") === "mes" ? "mes" : "semana";
  const r = sp.get("ref");
  const { de, ate } = periodoFluxo(modo, r && /^\d{4}-\d{2}-\d{2}$/.test(r) ? dia(r) : dia());
  const [linhas, bancos] = await Promise.all([linhasFluxo(de, ate, !!sp.get("previstos")), db.contaBancaria.findMany({ orderBy: { nome: "asc" } })]);
  const br = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const v = (x: number) => x.toFixed(2).replace(".", ",");
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const out = [`Fluxo de Caixa ${modo === "mes" ? "Mensal" : "Semanal"} - ${br(de)} a ${br(ate)}`, "", "Data;Cliente/Fornecedor;Categoria;Recebimentos;Pagamentos;Forma;Linha digitável;Chave Pix;Situação"];
  for (const b of bancos) out.push(`;${esc("Conta " + b.nome)};;${v(b.saldo)};;;;;saldo hoje`);
  for (const l of linhas) {
    out.push([br(l.data), esc(l.nome + (l.parcela ? ` ${l.parcela}` : "")), l.categoria, l.tipo === "receber" ? v(l.valor) : "", l.tipo === "pagar" ? v(l.valor) : "",
      l.forma ?? "", l.codigoBarras ? `="${l.codigoBarras}"` : "", esc(l.chavePix ?? ""), l.status].join(";"));
  }
  const ent = linhas.filter((l) => l.tipo === "receber").reduce((t, l) => t + l.valor, 0), sai = linhas.filter((l) => l.tipo === "pagar").reduce((t, l) => t + l.valor, 0);
  out.push(`;Total;;${v(ent)};${v(sai)};;;;`);
  return new NextResponse("﻿" + out.join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fluxo-${modo}-${chave(de)}.csv"` },
  });
}
