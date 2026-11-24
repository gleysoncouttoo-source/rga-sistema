// Arquivos da folha para o contador (CSV que abre no Excel): movimento do mês e espelho de ponto.
import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { mesAtual, mesValido } from "@/lib/despesasCusto";
import { csvEspelho, csvMovimento, folhaDoMes } from "@/lib/folha";

export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || !pode(u.permissoes, "funcionarios", "ver_salario")) return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const mes = mesValido(sp.get("mes")) ?? mesAtual();
  const espelho = sp.get("tipo") === "espelho";
  const conteudo = espelho ? await csvEspelho(mes) : csvMovimento(mes, (await folhaDoMes(mes)).linhas);
  const nome = `${espelho ? "espelho-de-ponto" : "folha-movimento"}-${mes}.csv`;
  return new NextResponse(conteudo, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"` } });
}
