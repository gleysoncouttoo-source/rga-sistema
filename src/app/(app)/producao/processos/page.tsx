import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { num } from "@/lib/formato";
import EditorProcesso from "@/components/EditorProcesso";
import AbasProducao from "@/components/AbasProducao";

const TIPOS = [
  { id: "peca", nome: "Peças" },
  { id: "conjunto", nome: "Corpos (montagem)" },
  { id: "produto", nome: "Fechaduras (montagem final)" },
];

async function novaEtapa(form: FormData) {
  "use server";
  const u = await exigir("producao", "editar");
  const nome = String(form.get("nome") || "").trim();
  if (nome) {
    const ult = await db.etapa.findFirst({ orderBy: { ordem: "desc" } });
    await db.etapa.upsert({ where: { nome }, update: {}, create: { nome, ordem: (ult?.ordem ?? 0) + 1 } });
    await auditar(u.nome, "criou etapa", nome);
  }
  revalidatePath("/producao/processos");
}

/** Produção → Processos das peças: cada peça com o seu processo (passos), para adicionar, editar, tirar e mudar a ordem. */
export default async function ProcessosPecas({ searchParams }: { searchParams: Promise<{ tipo?: string; q?: string; erro?: string; ok?: string }> }) {
  const u = await exigir("producao");
  const sp = await searchParams;
  const tipo = TIPOS.some((t) => t.id === sp.tipo) ? sp.tipo! : "peca";
  const q = sp.q?.trim();
  const [itens, contagem, etapas, opsDb] = await Promise.all([
    db.item.findMany({
      where: { ativo: true, tipo, origem: "fabricado", ...(q ? { OR: [{ nome: { contains: q, mode: "insensitive" } }, { codigo: { contains: q, mode: "insensitive" } }] } : {}) },
      include: { passos: { orderBy: { ordem: "asc" }, include: { operacao: { include: { etapa: true } } } } },
      orderBy: [{ codigo: "asc" }, { nome: "asc" }],
    }),
    db.item.findMany({ where: { ativo: true, origem: "fabricado", tipo: { in: TIPOS.map((t) => t.id) } }, select: { tipo: true, _count: { select: { passos: true } } } }),
    db.etapa.findMany({ orderBy: { ordem: "asc" } }),
    db.operacao.findMany({ where: { ativo: true }, include: { etapa: true }, orderBy: { nome: "asc" } }),
  ]);
  const ops = opsDb.map((o) => ({ id: o.id, nome: o.nome, etapa: o.etapa.nome, etapaId: o.etapaId }));
  const edita = pode(u.permissoes, "producao", "editar") || pode(u.permissoes, "produtos", "editar");
  const volta = `/producao/processos?tipo=${tipo}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  // as que ainda não têm processo aparecem primeiro
  const lista = [...itens].sort((a, b) => Number(a.passos.length > 0) - Number(b.passos.length > 0));
  const sem = itens.filter((i) => !i.passos.length).length;

  return (
    <>
      <div className="topo">
        <h1 style={{ margin: 0 }}>Produção</h1>
        <div className="acoes">
          <a className="btn" href="/apontar">Apontar produção</a>
        </div>
      </div>
      <AbasProducao ativo="processos" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}

      <p className="suave">Cada peça passa por estes processos, na ordem, até ficar pronta. É isso que aparece em <b>Iniciar novo processo</b> e no celular. Use <b>Editar</b> para mudar o nome ou a etapa, <b>↑ ↓</b> para mudar a ordem e <b>Tirar</b> para remover.</p>

      <div className="topo" style={{ marginBottom: 6 }}>
        <div className="abas" style={{ marginBottom: 0 }}>
          {TIPOS.map((t) => {
            const doTipo = contagem.filter((c) => c.tipo === t.id);
            const faltam = doTipo.filter((c) => !c._count.passos).length;
            return <a key={t.id} href={`/producao/processos?tipo=${t.id}`} className={tipo === t.id ? "ativo" : ""}>{t.nome} ({doTipo.length}){faltam > 0 && ` · ${faltam} sem processo`}</a>;
          })}
        </div>
        <form className="acoes" action="/producao/processos"><input type="hidden" name="tipo" value={tipo} /><input name="q" placeholder="Buscar SKU ou nome" defaultValue={q} /><button className="btn sec">Buscar</button></form>
      </div>
      {sem > 0 && <p><span className="selo alerta">{sem} sem processo</span> <span className="suave">Sem processo a produção dessa peça não pode ser lançada.</span></p>}

      {lista.length === 0 ? <p className="suave">Nada encontrado.</p> : lista.map((it) => (
        <div className="card tabela" key={it.id} id={`item-${it.id}`}>
          <div className="topo" style={{ marginBottom: 4 }}>
            <div className="com-foto">
              <span className="mini">{it.foto ? <img src={it.foto} alt="" /> : "sem foto"}</span>
              <span className="t"><b>{it.nome}</b><small>{it.codigo} · estoque {num(it.estoque)}</small></span>
            </div>
            <Link className="btn sec peq" href={`/produtos/${it.id}`}>Cadastro da peça</Link>
          </div>
          <EditorProcesso itemId={it.id} pagina={it.id} passos={it.passos} ops={ops} etapas={etapas} edita={edita} volta={volta} />
        </div>
      ))}

      {edita && (
        <details className="editar card">
          <summary>Criar nova etapa (setor) de produção</summary>
          <form action={novaEtapa} className="linha-form"><label>Nome da etapa<input name="nome" placeholder="ex.: Rebarbação" /></label><button className="btn sec">Criar etapa</button></form>
        </details>
      )}
    </>
  );
}
