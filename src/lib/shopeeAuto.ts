// Sincronização "de carona": quando alguém abre as telas de vendas e faz mais de 10 minutos da última conferência.
import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { configShopee, sincronizar } from "@/lib/shopeeApi";

export async function sincronizarSeAntigo() {
  if (!configShopee()) return;
  const con = await db.shopeeConexao.findUnique({ where: { id: 1 }, select: { ultimaSync: true } });
  if (!con || (con.ultimaSync && Date.now() - con.ultimaSync.getTime() < 10 * 60_000)) return;
  after(() => sincronizar().catch(() => undefined));
}
