// Entrada de pedidos vindos do site de vendas.
// POST /api/pedidos  com cabeçalho  Authorization: Bearer <SITE_API_TOKEN>
// { "numero": "1234", "cliente": "Loja X", "entrega": "2026-11-20", "itens": [{ "codigo": "FM-EXT400LO900", "quantidade": 50, "preco": 44.23 }] }
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { criarPedidoVenda } from "@/lib/planejamento";
import { dia } from "@/lib/datas";

type Entrada = { numero?: string; cliente?: string; entrega?: string; observacao?: string; itens?: { codigo?: string; quantidade?: number; preco?: number }[] };

function autorizado(req: Request) {
  const token = process.env.SITE_API_TOKEN;
  const enviado = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || enviado.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(enviado), Buffer.from(token));
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  let b: Entrada;
  try { b = await req.json(); } catch { return NextResponse.json({ erro: "JSON inválido" }, { status: 400 }); }
  if (!b.cliente || !b.itens?.length) return NextResponse.json({ erro: "informe cliente e itens" }, { status: 400 });
  if (b.numero) {
    const ja = await db.pedidoVenda.findFirst({ where: { numero: b.numero, origem: "site" } });
    if (ja) return NextResponse.json({ id: ja.id, situacao: ja.situacao, repetido: true });
  }
  const codigos = b.itens.map((i) => String(i.codigo ?? ""));
  const cad = await db.item.findMany({ where: { codigo: { in: codigos } } });
  const faltando = codigos.filter((c) => !cad.some((x) => x.codigo === c));
  if (faltando.length) return NextResponse.json({ erro: "produto não cadastrado", codigos: faltando }, { status: 422 });
  const id = await criarPedidoVenda({
    cliente: b.cliente, numero: b.numero, origem: "site", observacao: b.observacao,
    dataEntrega: b.entrega && /^\d{4}-\d{2}-\d{2}/.test(b.entrega) ? dia(b.entrega) : undefined,
    itens: b.itens.map((i) => {
      const it = cad.find((x) => x.codigo === i.codigo)!;
      return { itemId: it.id, quantidade: Number(i.quantidade) || 0, precoUnitario: i.preco ?? it.precoVenda };
    }).filter((i) => i.quantidade > 0),
  }, "Site");
  const p = await db.pedidoVenda.findUniqueOrThrow({ where: { id } });
  return NextResponse.json({ id, situacao: p.situacao }, { status: 201 });
}
