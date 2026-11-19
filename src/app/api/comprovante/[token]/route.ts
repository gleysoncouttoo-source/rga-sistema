// Abre o comprovante pelo link enviado (o token longo e aleatório funciona como senha do arquivo).
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return new Response("Não encontrado", { status: 404 });
  const c = await db.comprovante.findUnique({ where: { token } });
  if (!c) return new Response("Não encontrado", { status: 404 });
  return new Response(Buffer.from(c.dados), {
    headers: {
      "Content-Type": c.tipo,
      "Content-Disposition": `inline; filename="${encodeURIComponent(c.nome)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
