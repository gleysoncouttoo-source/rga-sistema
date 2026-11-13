import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { registrarPreco } from "@/lib/precos";
import { dia } from "@/lib/datas";
import { brl, num, qtd } from "@/lib/formato";
import Excluir from "@/components/Excluir";

const nn = (v: FormDataEntryValue | null) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const txt = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;
const volta = (k: "erro" | "ok", m: string) => redirect(`/materia-prima?${k}=` + encodeURIComponent(m));

/** Peso total em kg: unidade kg = o próprio estoque; chapa/barra/un = estoque × peso de 1 unidade. */
const pesoKg = (i: { unidade: string; estoque: number; pesoUnitKg: number | null }) => (i.unidade === "kg" ? i.estoque : i.pesoUnitKg ? i.estoque * i.pesoUnitKg : null);

async function nova(form: FormData) {
  "use server";
  const u = await exigir("estoque", "criar");
  const nome = txt(form.get("nome"));
  if (!nome) volta("erro", "Informe o nome.");
  const estoque = nn(form.get("estoque")), preco = form.get("precoCompra") ? nn(form.get("precoCompra")) : null;
  try {
    const it = await db.item.create({
      data: {
        nome: nome!, codigo: txt(form.get("codigo")), tipo: "materia_prima", origem: "comprado", unidade: String(form.get("unidade") || "kg"),
        material: txt(form.get("material")), dimensoes: txt(form.get("dimensoes")), pesoUnitKg: form.get("pesoUnitKg") ? nn(form.get("pesoUnitKg")) : null,
        precoCompra: preco, estoque, estoqueMinimo: nn(form.get("estoqueMinimo")), fornecedorId: nn(form.get("fornecedorId")) || null,
      },
    });
    if (estoque) await db.movimentoEstoque.create({ data: { itemId: it.id, quantidade: estoque, motivo: "Estoque inicial", usuario: u.nome } });
    if (preco) await db.$transaction((tx) => registrarPreco(tx, { itemId: it.id, preco, data: dia(), origem: "manual", fornecedorId: it.fornecedorId, usuario: u.nome }));
  } catch {
    volta("erro", "Já existe um item com esse código.");
  }
  await auditar(u.nome, "criou matéria-prima", nome!);
  revalidatePath("/materia-prima");
  volta("ok", `${nome} adicionada.`);
}

async function editar(form: FormData) {
  "use server";
  const u = await exigir("estoque", "editar");
  const id = nn(form.get("id"));
  const antes = await db.item.findUniqueOrThrow({ where: { id } });
  const preco = form.get("precoCompra") ? nn(form.get("precoCompra")) : null;
  await db.item.update({
    where: { id },
    data: { nome: String(form.get("nome")).trim(), material: txt(form.get("material")), dimensoes: txt(form.get("dimensoes")), unidade: String(form.get("unidade")),
      pesoUnitKg: form.get("pesoUnitKg") ? nn(form.get("pesoUnitKg")) : null, precoCompra: preco, estoqueMinimo: nn(form.get("estoqueMinimo")) },
  });
  if (preco && preco !== antes.precoCompra) await db.$transaction((tx) => registrarPreco(tx, { itemId: id, preco, data: dia(), origem: "manual", fornecedorId: antes.fornecedorId, usuario: u.nome }));
  revalidatePath("/materia-prima");
  volta("ok", "Salvo.");
}

async function entrada(form: FormData) {
  "use server";
  const u = await exigir("estoque", "editar");
  const id = nn(form.get("id")), q = nn(form.get("qtd")), tipo = String(form.get("tipo"));
  const it = await db.item.findUniqueOrThrow({ where: { id } });
  const delta = tipo === "contagem" ? q - it.estoque : tipo === "saida" ? -q : q;
  if (!delta) volta("erro", "Informe a quantidade.");
  await db.item.update({ where: { id }, data: { estoque: { increment: delta } } });
  await db.movimentoEstoque.create({ data: { itemId: id, quantidade: delta, usuario: u.nome, motivo: tipo === "contagem" ? "Contagem de estoque" : tipo === "saida" ? "Saída manual" : "Entrada de matéria-prima" } });
  revalidatePath("/materia-prima");
  volta("ok", `${it.nome}: ${delta > 0 ? "+" : ""}${qtd(delta, it.unidade)}.`);
}

async function excluir(form: FormData) {
  "use server";
  const u = await exigir("estoque", "excluir");
  const id = nn(form.get("id"));
  const it = await db.item.findUniqueOrThrow({ where: { id }, include: { _count: { select: { usadoEm: true, compras: true, movimentos: true, precos: true } } } });
  if (it._count.usadoEm) volta("erro", `${it.nome} está na estrutura de ${it._count.usadoEm} peça(s). Tire de lá antes de excluir.`);
  if (it._count.compras + it._count.movimentos + it._count.precos === 0) await db.item.delete({ where: { id } });
  else await db.item.update({ where: { id }, data: { ativo: false, codigo: it.codigo ? `${it.codigo} (excluído ${id})` : null } });
  await auditar(u.nome, "excluiu matéria-prima", it.nome);
  revalidatePath("/materia-prima");
  volta("ok", `${it.nome} excluída.`);
}

export default async function MateriaPrima({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const u = await exigir("estoque");
  const sp = await searchParams;
  const [lista, fornecedores] = await Promise.all([
    db.item.findMany({ where: { ativo: true, tipo: "materia_prima" }, include: { fornecedor: true, _count: { select: { usadoEm: true } } }, orderBy: [{ material: "asc" }, { nome: "asc" }] }),
    db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
  ]);
  const cria = pode(u.permissoes, "estoque", "criar"), edita = pode(u.permissoes, "estoque", "editar"), exclui = pode(u.permissoes, "estoque", "excluir");
  const valor = (i: (typeof lista)[number]) => i.estoque * (i.precoCompra ?? 0);
  const porMaterial = new Map<string, { peso: number; valor: number }>();
  for (const i of lista) {
    const k = i.material || "Sem material";
    const m = porMaterial.get(k) ?? { peso: 0, valor: 0 };
    m.peso += pesoKg(i) ?? 0; m.valor += valor(i); porMaterial.set(k, m);
  }
  const totPeso = [...porMaterial.values()].reduce((s, m) => s + m.peso, 0), totValor = [...porMaterial.values()].reduce((s, m) => s + m.valor, 0);
  return (
    <>
      <h1>Matéria-prima</h1>
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <p className="suave">Chapas, metais e tudo o que entra cru no 1º processo. Quando a produção lança o 1º processo de uma peça, a matéria-prima da estrutura dela sai daqui sozinha.</p>
      <div className="grade">
        <div className="kpi"><div className="r">Peso em estoque</div><div className="v">{num(totPeso, 1)} kg</div></div>
        <div className="kpi"><div className="r">Valor em estoque</div><div className="v">{brl(totValor, 0)}</div></div>
        {[...porMaterial.entries()].map(([k, m]) => <div className="kpi" key={k}><div className="r">{k}</div><div className="v" style={{ fontSize: "1.3rem" }}>{num(m.peso, 1)} kg</div><div className="r">{brl(m.valor, 0)}</div></div>)}
      </div>
      <div className="card tabela">
        <table>
          <thead><tr><th>Matéria-prima</th><th>Material</th><th>Medidas</th><th className="n">Estoque</th><th className="n">Peso total</th><th className="n">Preço</th><th className="n">Valor</th><th className="n">Mínimo</th><th>Fornecedor</th>{(edita || exclui) && <th></th>}</tr></thead>
          <tbody>{lista.map((i) => {
            const pk = pesoKg(i);
            const baixo = i.estoqueMinimo > 0 && i.estoque < i.estoqueMinimo;
            return (
              <tr key={i.id} className={baixo ? "falta" : ""}>
                <td><Link href={`/estoque/${i.id}`}><b>{i.nome}</b></Link><br /><span className="suave">{i.codigo} · usada em {i._count.usadoEm} peça(s)</span></td>
                <td>{i.material ?? <span className="suave">—</span>}</td>
                <td>{i.dimensoes ?? <span className="suave">—</span>}</td>
                <td className="n"><b>{qtd(i.estoque, i.unidade)}</b>{i.unidade !== "kg" && i.pesoUnitKg ? <div className="suave">{num(i.pesoUnitKg, 3)} kg cada</div> : null}</td>
                <td className="n">{pk != null ? `${num(pk, 1)} kg` : <span className="selo alerta">falta peso</span>}</td>
                <td className="n">{brl(i.precoCompra)}<span className="suave">/{i.unidade}</span></td>
                <td className="n">{brl(valor(i))}</td>
                <td className="n">{i.estoqueMinimo ? qtd(i.estoqueMinimo, i.unidade) : "—"}{baixo && <div><span className="selo erro">abaixo</span></div>}</td>
                <td>{i.fornecedor?.nome ?? <span className="suave">—</span>}</td>
                {(edita || exclui) && (
                  <td style={{ minWidth: 220 }}>
                    {edita && (
                      <details className="editar">
                        <summary>Entrada / editar</summary>
                        <form action={entrada} className="linha-form">
                          <input type="hidden" name="id" value={i.id} />
                          <label>Tipo<select name="tipo"><option value="entrada">Entrada (+)</option><option value="saida">Saída (−)</option><option value="contagem">Contagem</option></select></label>
                          <label>Qtd ({i.unidade})<input name="qtd" inputMode="decimal" required /></label>
                          <button className="btn peq">Lançar</button>
                        </form>
                        <form action={editar} className="campos" style={{ marginTop: 10, gridTemplateColumns: "1fr 1fr" }}>
                          <input type="hidden" name="id" value={i.id} />
                          <label className="inteiro">Nome<input name="nome" defaultValue={i.nome} /></label>
                          <label>Material<input name="material" defaultValue={i.material ?? ""} list="materiais" /></label>
                          <label>Medidas<input name="dimensoes" defaultValue={i.dimensoes ?? ""} /></label>
                          <label>Unidade<select name="unidade" defaultValue={i.unidade}>{["kg", "chapa", "barra", "un", "m"].map((x) => <option key={x}>{x}</option>)}</select></label>
                          <label>Peso de 1 un. (kg)<input name="pesoUnitKg" inputMode="decimal" defaultValue={i.pesoUnitKg ?? ""} /></label>
                          <label>Preço (R$/{i.unidade})<input name="precoCompra" inputMode="decimal" defaultValue={i.precoCompra ?? ""} /></label>
                          <label>Mínimo<input name="estoqueMinimo" inputMode="decimal" defaultValue={i.estoqueMinimo} /></label>
                          <div className="inteiro"><button className="btn sec peq">Salvar</button></div>
                        </form>
                      </details>
                    )}
                    {exclui && <div style={{ marginTop: 6 }}><Excluir acao={excluir} campos={{ id: i.id }} pergunta={`Excluir ${i.nome}?`} /></div>}
                  </td>
                )}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <datalist id="materiais">{["Aço", "Aço inox", "Zamac", "Latão", "Alumínio", "Tinta", "Verniz"].map((m) => <option key={m} value={m} />)}</datalist>
      {cria && (
        <div className="card">
          <b>Adicionar matéria-prima</b>
          <form action={nova} className="campos" style={{ marginTop: 12 }}>
            <label>Nome<input name="nome" required placeholder="ex.: Chapa aço 1,2 mm 1000×2000" /></label>
            <label>Código<input name="codigo" placeholder="MP-…" /></label>
            <label>Material<input name="material" list="materiais" placeholder="Aço, Zamac, Latão…" /></label>
            <label>Medidas / espessura<input name="dimensoes" placeholder="1,2 mm · 1000×2000" /></label>
            <label>Unidade de controle<select name="unidade" defaultValue="kg">{["kg", "chapa", "barra", "un", "m"].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Peso de 1 unidade (kg) — chapa/barra<input name="pesoUnitKg" inputMode="decimal" /></label>
            <label>Preço (R$ por unidade de controle)<input name="precoCompra" inputMode="decimal" /></label>
            <label>Estoque inicial<input name="estoque" inputMode="decimal" /></label>
            <label>Estoque mínimo<input name="estoqueMinimo" inputMode="decimal" /></label>
            <label>Fornecedor<select name="fornecedorId" defaultValue=""><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
            <div className="inteiro"><button className="btn">Adicionar</button></div>
          </form>
        </div>
      )}
    </>
  );
}
