import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { dataHora } from "@/lib/formato";
import { receberMensagem } from "@/lib/cotacao";
import { numeroWhats, statusWhats, transcricaoLigada, whatsLigado } from "@/lib/whatsapp";
import { iaLigada } from "@/lib/ia";
import AbasSambot from "@/components/AbasSambot";
import MidiaInput from "@/components/MidiaInput";
import Excluir from "@/components/Excluir";

const USOS: Record<string, string> = {
  primeira_resposta: "Quando o fornecedor responde a cotação pela primeira vez (cumprimentar)",
  agradecer: "Depois que o fornecedor manda os preços (agradecer)",
  comprovante: "Quando alguém responde o comprovante de pagamento",
  livre: "O Sambot escolhe quando combinar",
};

const ir = (url: string, tipo: "ok" | "erro", msg: string) => redirect(`${url}${url.includes("?") ? "&" : "?"}${tipo}=${encodeURIComponent(msg)}`);

async function acao(form: FormData) {
  "use server";
  const u = await exigir("compras", "editar");
  const a = String(form.get("a")), volta = String(form.get("volta") || "/sambot/conversas");
  if (a === "midia") {
    const tipo = form.get("tipo") === "figurinha" ? "figurinha" : "audio";
    const m = String(form.get("arq") || "").match(/^data:([\w/.+-]+)(?:;[^,]*)?;base64,(.+)$/);
    const nome = String(form.get("nome") || "").trim() || String(form.get("arqNome") || tipo);
    if (!m) ir(volta, "erro", "Escolha o arquivo.");
    const dados = Buffer.from(m![2], "base64");
    if (dados.length > (tipo === "figurinha" ? 100 : 16 * 1024) * 1024) ir(volta, "erro", "Arquivo grande demais.");
    const uso = String(form.get("uso"));
    await db.whatsMidia.create({ data: { tipo, nome: nome.slice(0, 80), uso: USOS[uso] ? uso : "livre", descricao: String(form.get("descricao") || "").trim().slice(0, 300) || null, mime: String(form.get("arqMime") || m![1]), tamanho: dados.length, dados, usuario: u.nome } });
    await auditar(u.nome, `adicionou ${tipo === "audio" ? "áudio" : "figurinha"} do WhatsApp`, nome);
    revalidatePath("/sambot/conversas");
    ir(volta, "ok", `${tipo === "audio" ? "Áudio" : "Figurinha"} guardado. O Sambot já pode usar.`);
  }
  if (a === "midia-editar") {
    const uso = String(form.get("uso"));
    await db.whatsMidia.update({ where: { id: Number(form.get("id")) }, data: { uso: USOS[uso] ? uso : "livre", descricao: String(form.get("descricao") || "").trim().slice(0, 300) || null, ativo: form.get("ativo") === "1" } });
    revalidatePath("/sambot/conversas");
    ir(volta, "ok", "Salvo.");
  }
  if (a === "midia-excluir") {
    const m = await db.whatsMidia.delete({ where: { id: Number(form.get("id")) } });
    await auditar(u.nome, "excluiu mídia do WhatsApp", m.nome);
    revalidatePath("/sambot/conversas");
    ir(volta, "ok", "Excluído.");
  }
  if (a === "testar") {
    const quem = String(form.get("quem") || ""), texto = String(form.get("texto") || "").trim();
    if (!texto) ir(volta, "erro", "Escreva a mensagem de teste.");
    const [t, idStr] = quem.split(":"), id = Number(idStr);
    let telefone = "", fornecedorId: number | undefined;
    if (t === "f") { const f = await db.fornecedor.findUniqueOrThrow({ where: { id } }); telefone = numeroWhats(f.whatsapp || f.telefone) ?? `sem-numero-${f.id}`; fornecedorId = f.id; }
    else if (t === "c") { const c = await db.funcionario.findUniqueOrThrow({ where: { id } }); telefone = numeroWhats(c.telefone) ?? ""; if (!telefone) ir(volta, "erro", "Esse colaborador não tem telefone no cadastro."); }
    else telefone = "5500000000000";
    await receberMensagem({ telefone, texto, nomePerfil: t ? null : "Pessoa desconhecida" }, { responder: false, fornecedorId });
    revalidatePath("/sambot/conversas");
    redirect(`/sambot/conversas?tel=${telefone}#conversa`);
  }
  ir(volta, "erro", "Ação desconhecida.");
}

export default async function WhatsApp({ searchParams }: { searchParams: Promise<{ tel?: string; ok?: string; erro?: string }> }) {
  const u = await exigir("compras");
  const sp = await searchParams;
  const edita = pode(u.permissoes, "compras", "editar");
  const [ultimas, midias, forns, funcs] = await Promise.all([
    db.whatsMensagem.findMany({ orderBy: { id: "desc" }, take: 400, select: { telefone: true, nome: true, texto: true, criadoEm: true, direcao: true } }),
    db.whatsMidia.findMany({ orderBy: [{ tipo: "asc" }, { id: "asc" }], select: { id: true, tipo: true, nome: true, uso: true, descricao: true, ativo: true, vezes: true } }),
    db.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    db.funcionario.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const contatos = new Map<string, (typeof ultimas)[number]>();
  for (const m of ultimas) if (!contatos.has(m.telefone)) contatos.set(m.telefone, m);
  const nomeDe = (tel: string) => ultimas.find((m) => m.telefone === tel && m.nome)?.nome ?? tel;
  const tel = sp.tel ?? [...contatos.keys()][0];
  const conversa = tel ? await db.whatsMensagem.findMany({ where: { telefone: tel }, orderBy: { id: "asc" }, take: 200 }) : [];
  const status = statusWhats();
  const volta = `/sambot/conversas${sp.tel ? `?tel=${sp.tel}` : ""}`;

  return (
    <>
      <h1>Sambot</h1>
      <AbasSambot ativo="conversas" />
      {sp.erro && <div className="aviso erro">{sp.erro}</div>}
      {sp.ok && <div className="aviso ok">{sp.ok}</div>}
      <p className="suave">
        Todas as conversas do WhatsApp da R.G.A: cotações com fornecedores e comprovantes para fornecedores e colaboradores. O Sambot escreve como gente, entende áudio, foto e PDF, e pode mandar seus áudios gravados e figurinhas.
        Nas mensagens ele se apresenta com o seu nome (muda na aba Cotação de preços). Se alguém perguntar a sério se é robô, ele diz que é o assistente automático que responde pelo seu WhatsApp.
      </p>
      <div className="grade">
        <div className="kpi"><div className="suave">WhatsApp</div><div className="v" style={{ fontSize: "1.2rem" }}>{whatsLigado() ? "Ligado" : "Esperando o chip"}</div><div className="r">{status.filter((s) => s.ok).length} de {status.length} itens prontos</div></div>
        <div className="kpi"><div className="suave">Inteligência</div><div className="v" style={{ fontSize: "1.2rem" }}>{iaLigada() ? "Ligada" : "Leitura simples"}</div><div className="r">{iaLigada() ? "conversa e lê preços" : "falta a chave"}</div></div>
        <div className="kpi"><div className="suave">Entende áudio</div><div className="v" style={{ fontSize: "1.2rem" }}>{transcricaoLigada() ? "Sim" : "Ainda não"}</div><div className="r">{transcricaoLigada() ? "transforma em texto" : "falta a chave"}</div></div>
        <div className="kpi"><div className="suave">Biblioteca</div><div className="v">{midias.filter((m) => m.ativo).length}</div><div className="r">{midias.filter((m) => m.tipo === "audio").length} áudio(s), {midias.filter((m) => m.tipo === "figurinha").length} figurinha(s)</div></div>
      </div>

      <h2 id="conversa">Conversas</h2>
      <div className="card" style={{ display: "grid", gridTemplateColumns: "minmax(200px, 280px) 1fr", gap: 14 }}>
        <div className="contatos">
          {contatos.size === 0 && <p className="suave">Nenhuma conversa ainda. Teste o Sambot logo abaixo.</p>}
          {[...contatos.values()].map((m) => (
            <a key={m.telefone} href={`/sambot/conversas?tel=${m.telefone}#conversa`} className={m.telefone === tel ? "ativo" : ""}>
              <span><b>{nomeDe(m.telefone)}</b><br /><span className="suave" style={{ fontSize: ".82rem" }}>{m.direcao === "saida" ? "Você: " : ""}{m.texto.slice(0, 38)}{m.texto.length > 38 ? "…" : ""}</span></span>
              <span className="suave" style={{ fontSize: ".75rem", whiteSpace: "nowrap" }}>{dataHora(m.criadoEm).slice(0, 5)}</span>
            </a>
          ))}
        </div>
        <div className="conversa">
          {conversa.length === 0 && <span className="suave">Escolha uma conversa.</span>}
          {conversa.map((m) => (
            <div key={m.id} className={`bolha ${m.direcao === "saida" ? "saida" : ""} ${m.status === "simulada" || m.status === "não enviada" ? "simulada" : ""}`}>
              {m.texto}
              <span className="hora">{dataHora(m.criadoEm)}{m.direcao === "saida" && m.status !== "enviada" ? ` · ${m.status === "simulada" ? "teste (não enviada)" : m.status}` : ""}{m.status === "digitada" ? " · digitada no sistema" : ""}</span>
            </div>
          ))}
        </div>
      </div>

      {edita && (
        <div className="card">
          <b>Testar o Sambot</b>
          <p className="suave" style={{ margin: "4px 0 12px" }}>Escreva como se fosse o fornecedor ou o colaborador e veja o que o Sambot responderia. Nada é mandado no WhatsApp. Se for um fornecedor com cotação aberta, os preços lidos vão para “a conferir”.</p>
          <form action={acao} className="campos">
            <input type="hidden" name="a" value="testar" /><input type="hidden" name="volta" value={volta} />
            <label>Quem está escrevendo
              <select name="quem">
                <optgroup label="Fornecedores">{forns.map((f) => <option key={f.id} value={`f:${f.id}`}>{f.nome}</option>)}</optgroup>
                <optgroup label="Colaboradores">{funcs.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.nome}</option>)}</optgroup>
                <option value="">Número desconhecido</option>
              </select>
            </label>
            <label className="inteiro">Mensagem<textarea name="texto" rows={3} placeholder="Ex.: bom dia! o zamac ta 18,50 o kg, entrego em 5 dias. vc é robô?" style={{ paddingTop: 10 }} required /></label>
            <div className="inteiro"><button className="btn">Ver resposta do Sambot</button></div>
          </form>
        </div>
      )}

      <h2 id="biblioteca">Seus áudios e figurinhas</h2>
      <p className="suave">O Sambot escolhe um destes quando a situação combinar com o “quando usar” e com a descrição. Ele nunca manda mais de um por mensagem e não repete na mesma conversa. Áudio em <b>.ogg</b> ou <b>.opus</b> chega como mensagem de voz; <b>.mp3</b> e <b>.m4a</b> chegam como arquivo de áudio.</p>
      <div className="card tabela">
        <table>
          <thead><tr><th>Áudio / figurinha</th><th>Quando usar</th><th>O que diz / mostra</th><th className="n">Usado</th>{edita && <th></th>}</tr></thead>
          <tbody>{midias.map((m) => (
            <tr key={m.id} style={{ opacity: m.ativo ? 1 : 0.55 }}>
              <td>
                <b>{m.nome}</b>
                <div style={{ marginTop: 6 }}>{m.tipo === "audio" ? <audio controls preload="none" src={`/api/whatsapp/midia/${m.id}`} style={{ width: 220, height: 36 }} /> : <img src={`/api/whatsapp/midia/${m.id}`} alt="" width={72} height={72} />}</div>
              </td>
              {edita ? (
                <td colSpan={2}>
                  <form action={acao} className="acoes" id={`m${m.id}`}>
                    <input type="hidden" name="a" value="midia-editar" /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="volta" value={volta} />
                    <select name="uso" defaultValue={m.uso} style={{ maxWidth: 260 }}>{Object.entries(USOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="descricao" defaultValue={m.descricao ?? ""} placeholder="O que fala / mostra" style={{ minWidth: 200, flex: 1 }} />
                    <select name="ativo" defaultValue={m.ativo ? "1" : "0"}><option value="1">Ativo</option><option value="0">Pausado</option></select>
                    <button className="btn sec peq">Salvar</button>
                  </form>
                </td>
              ) : (<><td>{USOS[m.uso]}</td><td className="suave">{m.descricao}</td></>)}
              <td className="n">{m.vezes}x</td>
              {edita && <td><Excluir acao={acao} campos={{ a: "midia-excluir", id: String(m.id), volta }} pergunta={`Excluir ${m.nome}?`} /></td>}
            </tr>
          ))}</tbody>
        </table>
        {midias.length === 0 && <p className="suave" style={{ padding: 12 }}>Nenhum áudio ou figurinha ainda.</p>}
      </div>

      {edita && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
          {(["audio", "figurinha"] as const).map((tipo) => (
            <div className="card" key={tipo}>
              <b>{tipo === "audio" ? "🎤 Adicionar áudio gravado" : "😄 Adicionar figurinha"}</b>
              <p className="suave" style={{ margin: "4px 0 12px" }}>{tipo === "audio" ? "Grave no celular (gravador ou WhatsApp) e envie o arquivo aqui." : "Qualquer foto ou imagem vira figurinha do WhatsApp (quadrada, fundo transparente se a imagem tiver)."}</p>
              <form action={acao} className="form-midia" style={{ display: "grid", gap: 12 }}>
                <input type="hidden" name="a" value="midia" /><input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="volta" value={volta} />
                <MidiaInput tipo={tipo} />
                <label>Nome<input name="nome" placeholder={tipo === "audio" ? "Ex.: Bom dia do Gleyson" : "Ex.: Joinha R.G.A"} /></label>
                <label>Quando usar<select name="uso" defaultValue={tipo === "audio" ? "primeira_resposta" : "agradecer"}>{Object.entries(USOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>{tipo === "audio" ? "O que você fala no áudio" : "O que a figurinha mostra"}<input name="descricao" placeholder={tipo === "audio" ? "Ex.: Bom dia, tudo bem? Obrigado por sempre atender a gente rápido" : "Ex.: polegar para cima com a logo"} /></label>
                <button className="btn">Guardar</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
