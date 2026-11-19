import Link from "next/link";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { brl, num } from "@/lib/formato";
import { custosUnitarios, tempoTxt } from "@/lib/custoProduto";
import AbasProducao from "@/components/AbasProducao";

export default async function TempoPorProduto() {
  await exigir("producao");
  const [custo, produtos] = await Promise.all([
    custosUnitarios(),
    db.item.findMany({ where: { ativo: true, tipo: "produto" }, select: { id: true, codigo: true, nome: true, foto: true }, orderBy: { codigo: "asc" } }),
  ]);
  const linhas = produtos.map((p) => ({ ...p, c: custo(p.id) }));
  const comTempo = linhas.filter((l) => l.c.seg > 0);
  const media = comTempo.length ? comTempo.reduce((s, l) => s + l.c.seg, 0) / comTempo.length : null;

  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Produção</h1>
        <div className="acoes"><a className="btn" href="/apontar">Apontar produção</a></div>
      </div>
      <AbasProducao ativo="tempos" />
      <p className="suave">
        Quanto tempo de trabalho leva para fazer 1 fechadura: soma do tempo de todas as peças e da montagem, pelo processo de cada peça.
        O tempo de cada operação vem do cronômetro dos lotes dos últimos 30 dias; sem lançamento, usa o recorde da operação.
        É esse tempo que divide as contas pagas no custo (<Link href="/custos/despesas">Contas no custo</Link>): quem leva mais tempo leva mais despesa.
      </p>
      <div className="grade">
        <div className="kpi"><div className="r">Tempo médio por fechadura</div><div className="v">{tempoTxt(media)}</div><div className="r">{num(comTempo.length)} de {num(linhas.length)} produtos com tempo</div></div>
        {custo.rateio.modo === "tempo" && <div className="kpi"><div className="r">Despesa por hora de produção</div><div className="v">{brl(custo.rateio.porHora)}</div><div className="r">contas marcadas ÷ horas do mês</div></div>}
      </div>
      <div className="card tabela">
        <table>
          <thead><tr><th>Produto</th><th className="n">Tempo por fechadura</th><th className="n">Fechaduras por hora</th><th className="n">Mão de obra</th><th className="n">Despesas</th><th>Operações sem tempo</th></tr></thead>
          <tbody>{linhas.map((l) => (
            <tr key={l.id}>
              <td><a href={`/produtos/${l.id}`} className="com-foto" style={{ color: "inherit" }}><span className="mini">{l.foto ? <img src={l.foto} alt="" /> : "sem foto"}</span><span className="t"><b>{l.codigo}</b><small>{l.nome}</small></span></a></td>
              <td className="n"><b>{tempoTxt(l.c.seg)}</b></td>
              <td className="n">{l.c.seg > 0 ? num(3600 / l.c.seg, 1) : "—"}</td>
              <td className="n">{brl(l.c.mo)}</td>
              <td className="n">{brl(l.c.despesas + l.c.extra)}</td>
              <td className="suave" title={[...l.c.semTempo, ...l.c.pecasSemMo.map((x) => `${x} (sem operação ligada)`)].join("\n")}>{l.c.semTempo.length + l.c.pecasSemMo.length ? `${l.c.semTempo.length + l.c.pecasSemMo.length} sem tempo` : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="suave">“Sem tempo” = operação ainda sem recorde nem lançamento no cronômetro: fica fora da conta até ser medida. Veja quais na tela de cada produto.</p>
    </>
  );
}
