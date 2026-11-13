import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { registrarPreco, tabelaPrecos } from "@/lib/precos";
import { brl, dataDia } from "@/lib/formato";
import { chave, dia } from "@/lib/datas";
import { TIPOS } from "@/lib/rotulos";
import AbasCompras from "@/components/AbasCompras";

async function novoPreco(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const itemId = Number(form.get("itemId"));
  const preco = Number(String(form.get("preco") || "").replace(",", "."));
  const data = String(form.get("data") || "");
  if (!itemId || !(preco > 0) || !data) redirect("/compras/precos?erro=" + encodeURIComponent("Informe item, preço e data."));
  const r = await db.$transaction((tx) => registrarPreco(tx, {
    itemId, preco, data: dia(data), origem: String(form.get("origem") || "cotação"), fornecedorId: Number(form.get("fornecedorId")) || null, usuario: u.nome,
  }));
  revalidatePath("/compras/precos");
  redirect(`/compras/precos?ok=1${r.novoRecorde ? "&recorde=1" : ""}`);
}

const Variacao = ({ v }: { v: number | null }) => {
  if (v == null) return <span className="suave">—</span>;
  const p = v * 100;
  if (Math.abs(p) < 0.05) return <span className="suave">0%</span>;
  return <b style={{ color: p > 0 ? "var(--erro)" : "var(--ok)" }}>{p > 0 ? "▲ +" : "▼ "}{p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b>;
};

export default async function Precos({ searchParams }: { searchParams: Promise<{ ok?: string; recorde?: string; erro?: string; tipo?: string }> }) {
  const u = await exigir("compras");
  const sp = await searchParams;
  const [linhas, fornecedores] = await Promise.all([tabelaPrecos(), db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } })]);
  const tipo = sp.tipo === "insumo" || sp.tipo === "materia_prima" ? sp.tipo : null;
  const lista = (tipo ? linhas.filter((l) => l.tipo === tipo) : linhas).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "materia_prima" ? -1 : 1));
  const subiram = linhas.filter((l) => (l.periodos[0].variacao ?? 0) > 0.0005).length;
  const temHistorico = linhas.some((l) => l.periodos.some((p) => p.preco != null));
  return (
    <>
      <h1>Compras</h1>
      <AbasCompras ativo="precos" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">Preço registrado.{sp.recorde && <b> Novo recorde de menor preço!</b>}</div>}
      <p className="suave">
        <b>Pago hoje</b> é o último preço registrado (compra recebida, nota lançada à mão ou planilha). <b>Recorde</b> é o menor preço já pago. As colunas 30, 60 e 90 dias mostram quanto o preço de hoje subiu (▲ vermelho) ou caiu (▼ verde) em relação ao preço daquela época.
        {subiram > 0 && <> Em 30 dias, {subiram} item(ns) subiram.</>}
      </p>
      {!temHistorico && <div className="aviso alerta">O histórico começa com os preços da planilha de custos, registrados em {dataDia(dia())}. As comparações de 30, 60 e 90 dias aparecem conforme as compras forem recebidas. Se tiver notas antigas, lance abaixo com a data delas.</div>}
      <div className="abas">
        <a href="/compras/precos" className={!tipo ? "ativo" : ""}>Todos</a>
        <a href="/compras/precos?tipo=materia_prima" className={tipo === "materia_prima" ? "ativo" : ""}>Matéria-prima</a>
        <a href="/compras/precos?tipo=insumo" className={tipo === "insumo" ? "ativo" : ""}>Insumos</a>
      </div>
      <div className="card tabela">
        <table>
          <thead><tr><th>Item</th><th>Fornecedor</th><th className="n">Pago hoje</th><th className="n">Recorde (menor)</th><th className="n">vs 30 dias</th><th className="n">vs 60 dias</th><th className="n">vs 90 dias</th></tr></thead>
          <tbody>{lista.map((l) => {
            const noRecorde = l.recorde && l.atual != null && l.atual <= l.recorde.preco + 1e-9 && l.registros > 1;
            return (
              <tr key={l.id}>
                <td><Link href={`/estoque/${l.id}`}>{l.nome}</Link> <span className="suave">· {TIPOS[l.tipo]}</span></td>
                <td>{l.fornecedor ?? <span className="selo alerta">sem fornecedor</span>}</td>
                <td className="n"><b>{brl(l.atual, l.atual != null && l.atual < 1 ? 3 : 2)}</b>/{l.unidade}{l.atualData && <div className="suave" style={{ fontSize: ".8rem" }}>{dataDia(l.atualData)}</div>}</td>
                <td className="n">{l.recorde ? <>{brl(l.recorde.preco, l.recorde.preco < 1 ? 3 : 2)}{noRecorde && <span className="selo ok" style={{ marginLeft: 6 }}>no recorde</span>}<div className="suave" style={{ fontSize: ".8rem" }}>{dataDia(l.recorde.data)}{l.recorde.fornecedor ? ` · ${l.recorde.fornecedor}` : ""}</div></> : "—"}</td>
                {l.periodos.map((p) => (
                  <td className="n" key={p.dias}><Variacao v={p.variacao} />{p.preco != null && <div className="suave" style={{ fontSize: ".8rem" }}>era {brl(p.preco, p.preco < 1 ? 3 : 2)}</div>}</td>
                ))}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {pode(u.permissoes, "compras", "editar") && (
        <div className="card">
          <b>Registrar preço pago (nota antiga ou compra feita fora do sistema)</b>
          <form action={novoPreco} className="campos" style={{ marginTop: 12 }}>
            <label>Item<select name="itemId" required>{linhas.map((l) => <option key={l.id} value={l.id}>{l.nome} ({l.unidade})</option>)}</select></label>
            <label>Fornecedor<select name="fornecedorId"><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
            <label>Preço (R$ por unidade)<input name="preco" inputMode="decimal" required /></label>
            <label>Data<input name="data" type="date" defaultValue={chave(dia())} required /></label>
            <input type="hidden" name="origem" value="compra" />
            <div className="inteiro"><button className="btn">Registrar</button></div>
          </form>
        </div>
      )}
    </>
  );
}
