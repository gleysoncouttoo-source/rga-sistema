import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { receberCompra } from "@/lib/planejamento";
import { brl, dataDia } from "@/lib/formato";
import { chave, dia } from "@/lib/datas";

const n = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); if (!s) return null; const x = Number(s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return Number.isFinite(x) ? x : null; };

async function confirmar(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const id = Number(form.get("id"));
  const itens = String(form.get("itens")).split(",").map(Number).map((iid) => ({ id: iid, quantidade: n(form.get(`q${iid}`)), preco: n(form.get(`p${iid}`)) }));
  const data = String(form.get("data") || "");
  const { recordes } = await receberCompra(id, u.nome, {
    data: data ? dia(data) : undefined, notaFiscal: String(form.get("nf") || "").trim() || undefined, obs: String(form.get("obs") || "").trim() || undefined, itens,
  });
  redirect(`/compras/receber?ok=${id}${recordes.length ? `&recorde=${encodeURIComponent(recordes.join(", "))}` : ""}`);
}

export default async function ReceberCompra({ params }: { params: Promise<{ id: string }> }) {
  await exigir("compras", "editar");
  const id = Number((await params).id);
  const c = await db.pedidoCompra.findUnique({ where: { id }, include: { fornecedor: true, itens: { include: { item: true } } } });
  if (!c) notFound();
  if (c.status !== "aprovado") redirect("/compras/receber");
  return (
    <div className="caixa" style={{ maxWidth: 560 }}>
      <Link href="/compras/receber">← Voltar</Link>
      <h1 style={{ marginTop: 12 }}>Material chegou</h1>
      <p className="suave">Compra #{c.id} · {c.fornecedor?.nome} · comprada em {dataDia(c.dataCompra)}. Confira o que veio na nota. Se veio tudo certo, só confirme.</p>
      <form action={confirmar} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input type="hidden" name="id" value={c.id} />
        <input type="hidden" name="itens" value={c.itens.map((i) => i.id).join(",")} />
        <label>Data da chegada<input type="date" name="data" defaultValue={chave(dia())} required /></label>
        <label>Nota fiscal<input name="nf" inputMode="numeric" placeholder="número (opcional)" /></label>
        {c.itens.map((i) => (
          <div className="card" key={i.id} style={{ marginBottom: 0 }}>
            <b>{i.item.nome}</b>
            <div className="campos" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
              <label>Quantidade que chegou ({i.item.unidade})<input name={`q${i.id}`} inputMode="decimal" defaultValue={String(i.quantidade).replace(".", ",")} /></label>
              <label>Preço pago por {i.item.unidade} (R$)<input name={`p${i.id}`} inputMode="decimal" defaultValue={i.precoUnitario != null ? String(i.precoUnitario).replace(".", ",") : ""} /></label>
            </div>
            <span className="suave" style={{ fontSize: ".85rem" }}>Pedido: {String(i.quantidade).replace(".", ",")} {i.item.unidade} a {brl(i.precoUnitario, 2)}</span>
          </div>
        ))}
        <label>Observação<input name="obs" placeholder="ex.: veio uma caixa amassada" /></label>
        <button className="btn">Confirmar chegada</button>
      </form>
    </div>
  );
}
