import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { brl, dataDia } from "@/lib/formato";
import { chave, dia, diaUtil, proximoDiaUtil, somaDias, semana } from "@/lib/datas";
import { lerCfgCompras } from "@/lib/planejamento";
import AbasCompras from "@/components/AbasCompras";

async function novo(form: FormData) {
  "use server";
  const u = await exigir("compras", "criar");
  const descricao = String(form.get("descricao") || "").trim(), venc = String(form.get("vencimento") || "");
  const valor = Number(String(form.get("valor") || "").replace(/\./g, "").replace(",", "."));
  if (!descricao || !venc || !(valor > 0)) redirect("/compras/boletos?erro=" + encodeURIComponent("Informe descrição, vencimento e valor."));
  await db.contaPagar.create({ data: { descricao, vencimento: dia(venc), valor, banco: String(form.get("banco") || "") || null, fornecedorId: Number(form.get("fornecedorId")) || null } });
  await auditar(u.nome, "lançou boleto", descricao);
  revalidatePath("/compras/boletos");
}
async function pagar(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const id = Number(form.get("id"));
  await db.contaPagar.update({ where: { id }, data: { status: "pago", pagoEm: new Date() } });
  await auditar(u.nome, "marcou boleto pago", `#${id}`);
  revalidatePath("/compras/boletos");
}

export default async function Boletos({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const u = await exigir("compras");
  const sp = await searchParams;
  const hoje = dia();
  // começa na segunda-feira desta semana, 8 semanas
  const inicio = somaDias(hoje, -((hoje.getUTCDay() + 6) % 7));
  const fim = somaDias(inicio, 7 * 8);
  const [bs, fornecedores, cfg, vencidos] = await Promise.all([
    db.contaPagar.findMany({ where: { status: { in: ["previsto", "aberto"] }, vencimento: { gte: somaDias(inicio, -5), lte: somaDias(fim, 1) } }, include: { fornecedor: true }, orderBy: { vencimento: "asc" } }),
    db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    lerCfgCompras(),
    db.contaPagar.count({ where: { status: "aberto", vencimento: { lt: hoje } } }),
  ]);
  const porDia = new Map<string, typeof bs>();
  // vencimento em fim de semana/feriado é pago no próximo dia útil
  for (const b of bs) { const k = chave(proximoDiaUtil(dia(b.vencimento.toISOString()))); porDia.set(k, [...(porDia.get(k) ?? []), b]); }
  const dias: Date[] = [];
  for (let d = inicio; d < fim; d = somaDias(d, 1)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dias.push(d);
  const proximos = bs.filter((b) => b.vencimento >= somaDias(hoje, -1)).slice(0, 40);
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="boletos" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {vencidos > 0 && <div className="aviso erro">{vencidos} boleto(s) vencido(s) ainda não marcados como pagos.</div>}
      <p className="suave">O sistema usa este calendário para escolher o dia da compra: o boleto vai para o dia com menos boletos. Cor mais forte = mais boletos no dia (alerta a partir de {cfg.maxBoletosDia}). Lance aqui também os boletos que não vieram do sistema, para a conta ficar certa.</p>
      <div className="card">
        <div className="cal">
          {["seg", "ter", "qua", "qui", "sex"].map((s) => <div key={s} className="suave" style={{ fontSize: ".78rem", fontWeight: 700 }}>{s}</div>)}
          {dias.map((d) => {
            const l = porDia.get(chave(d)) ?? [];
            const fer = !diaUtil(d);
            const cls = fer ? "fer" : l.length >= cfg.maxBoletosDia + 1 ? "c3" : l.length >= cfg.maxBoletosDia ? "c2" : l.length ? "c1" : "";
            return (
              <div key={chave(d)} className={`d ${cls} ${chave(d) === chave(hoje) ? "hoje" : ""}`} title={l.map((b) => `${b.descricao} ${brl(b.valor)}`).join("\n")}>
                <b>{d.getUTCDate()}/{d.getUTCMonth() + 1}{fer ? " · feriado" : ""}</b>
                {l.length > 0 && <>{l.length} boleto{l.length > 1 ? "s" : ""}<br />{brl(l.reduce((t, b) => t + b.valor, 0), 0)}</>}
              </div>
            );
          })}
        </div>
      </div>
      <h2>Próximos boletos</h2>
      <div className="card tabela">
        {proximos.length === 0 ? <p className="suave">Nenhum boleto lançado.</p> : (
          <table>
            <thead><tr><th>Vencimento</th><th>Descrição</th><th>Fornecedor</th><th className="n">Valor</th><th>Situação</th><th></th></tr></thead>
            <tbody>{proximos.map((b) => (
              <tr key={b.id}>
                <td>{semana(dia(b.vencimento.toISOString()))} {dataDia(b.vencimento)}{!diaUtil(dia(b.vencimento.toISOString())) && <div className="suave">paga {dataDia(proximoDiaUtil(dia(b.vencimento.toISOString())))}</div>}</td>
                <td>{b.pedidoCompraId ? <Link href={`/compras#c${b.pedidoCompraId}`}>{b.descricao}</Link> : b.descricao}{b.parcela && <span className="suave"> · {b.parcela}</span>}</td>
                <td>{b.fornecedor?.nome ?? "—"}</td>
                <td className="n">{brl(b.valor)}</td>
                <td>{b.status === "previsto" ? <span className="selo alerta">previsto (compra não aprovada)</span> : <span className="selo">a pagar</span>}</td>
                <td>{b.status === "aberto" && pode(u.permissoes, "compras", "editar") && <form action={pagar}><input type="hidden" name="id" value={b.id} /><button className="btn sec peq">Pago</button></form>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {pode(u.permissoes, "compras", "criar") && (
        <div className="card">
          <b>Lançar boleto</b>
          <form action={novo} className="campos" style={{ marginTop: 12 }}>
            <label>Descrição<input name="descricao" required /></label>
            <label>Vencimento<input name="vencimento" type="date" required /></label>
            <label>Valor (R$)<input name="valor" inputMode="decimal" required /></label>
            <label>Fornecedor<select name="fornecedorId"><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
            <label>Banco<select name="banco"><option value="">—</option><option>Santander</option><option>Bradesco</option></select></label>
            <div className="inteiro"><button className="btn">Lançar</button></div>
          </form>
        </div>
      )}
    </>
  );
}
