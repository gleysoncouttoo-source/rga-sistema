import Link from "next/link";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { dataDia, qtd } from "@/lib/formato";
import { chave, dia } from "@/lib/datas";
import AbasCompras from "@/components/AbasCompras";

export default async function Receber({ searchParams }: { searchParams: Promise<{ ok?: string; recorde?: string }> }) {
  await exigir("compras");
  const sp = await searchParams;
  const lista = await db.pedidoCompra.findMany({
    where: { status: "aprovado" }, include: { fornecedor: true, itens: { include: { item: true } } }, orderBy: { chegadaPrevista: "asc" },
  });
  const hoje = chave(dia());
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="receber" />
      {sp.ok && <div className="aviso ok">Compra #{sp.ok} recebida. O material já entrou no estoque.{sp.recorde && <> <b>Novo recorde de menor preço: {sp.recorde}.</b></>}</div>}
      <p className="suave">Quando o material chegar na fábrica, toque na compra e confirme. Dá para fazer pelo celular.</p>
      {lista.length === 0 && <div className="card suave">Nenhuma compra aprovada esperando material.</div>}
      {lista.map((c) => {
        const atrasado = chave(c.chegadaPrevista) < hoje;
        return (
          <Link key={c.id} href={`/compras/receber/${c.id}`} className="card" style={{ display: "block", color: "inherit", fontWeight: 400 }}>
            <div className="topo" style={{ marginBottom: 4 }}>
              <b>#{c.id} · {c.fornecedor?.nome}</b>
              <span className={`selo ${atrasado ? "erro" : ""}`}>{atrasado ? `Atrasada desde ${dataDia(c.chegadaPrevista)}` : `Chega ${dataDia(c.chegadaPrevista)}`}</span>
            </div>
            <span className="suave">{c.itens.map((i) => `${i.item.nome} ${qtd(i.quantidade, i.item.unidade)}`).join(" · ")}</span>
          </Link>
        );
      })}
    </>
  );
}
