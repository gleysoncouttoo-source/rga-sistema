// Baixa a planilha de pagamentos (CSV com ; e vírgula decimal, abre direto no Excel)
import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { db } from "@/lib/db";
import { chave, dia, somaDias } from "@/lib/datas";
import { diaDoPagamento } from "@/lib/financeiro";

export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || !pode(u.permissoes, "financeiro")) return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const hoje = dia();
  const per = sp.get("p") ?? "30";
  let de = hoje, ate = somaDias(hoje, Number(per) || 30);
  if (per === "mes") { de = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1, 12)); ate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0, 12)); }
  if (per === "prox") { de = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 1, 12)); ate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 2, 0, 12)); }
  const status = ["aberto", ...(sp.get("previstos") ? ["previsto"] : []), ...(sp.get("pagas") ? ["pago"] : [])];
  const contas = await db.contaPagar.findMany({
    where: { status: { in: status }, vencimento: { gte: somaDias(de, -3), lte: somaDias(ate, 1) }, ...(sp.get("cat") ? { categoria: sp.get("cat")! } : {}), ...(sp.get("banco") ? { banco: sp.get("banco")! } : {}) },
    include: { fornecedor: true }, orderBy: { vencimento: "asc" },
  });
  const br = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const linhas = [["Dia do pagamento", "Vencimento", "Categoria", "Descrição", "Parcela", "Fornecedor", "Banco", "Valor", "Situação"].join(";")];
  for (const c of contas) {
    const d = diaDoPagamento(c.vencimento);
    if (d < de || d > ate) continue;
    linhas.push([br(d), br(c.vencimento), c.categoria, esc(c.descricao), c.parcela ?? "", esc(c.fornecedor?.nome ?? ""), c.banco ?? "", c.valor.toFixed(2).replace(".", ","),
      c.status === "pago" ? "pago" : c.status === "previsto" ? "previsto" : "a pagar"].join(";"));
  }
  return new NextResponse("﻿" + linhas.join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="pagamentos-${chave(de)}-a-${chave(ate)}.csv"` },
  });
}
