// Toca/mostra um áudio ou figurinha da biblioteca (só para quem está logado).
import { db } from "@/lib/db";
import { usuarioAtual } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await usuarioAtual())) return new Response("não autorizado", { status: 401 });
  const m = await db.whatsMidia.findUnique({ where: { id: Number((await params).id) } });
  if (!m) return new Response("não encontrado", { status: 404 });
  return new Response(Buffer.from(m.dados), { headers: { "Content-Type": m.mime, "Cache-Control": "private, max-age=3600" } });
}
