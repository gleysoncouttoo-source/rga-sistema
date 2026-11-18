"use client";
import { useState } from "react";
import SelectFoto, { type OpcaoFoto } from "./SelectFoto";

export type DadosFornecedor = Partial<Record<
  "nome" | "razaoSocial" | "cnpj" | "inscricaoEstadual" | "categoria" | "contato" | "telefone" | "whatsapp" | "email" | "site" |
  "cep" | "endereco" | "bairro" | "cidade" | "uf" | "formaPagamento" | "prazoPagamento" | "frete" | "chavePix" | "banco" | "observacao", string | null>> & {
  id?: number; prazoEntregaDias?: number | null; valorFrete?: number | null; pedidoMinimo?: number | null;
};
export type OpcaoItem = OpcaoFoto & { unidade: string };

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const CATEGORIAS = ["Aço", "Zamac", "Latão", "Alumínio", "Insumos (molas, parafusos, pinos)", "Tintas e vernizes", "Banho / galvanização", "Embalagem", "Ferramentaria", "Serviços"];
const soNum = (s: string) => s.replace(/\D/g, "");
const mCnpj = (s: string) => { const d = soNum(s).slice(0, 14); return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2"); };
const mFone = (s: string) => { const d = soNum(s).slice(0, 11); return d.length <= 10 ? d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2") : d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2"); };
const mCep = (s: string) => soNum(s).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
const br = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

function Mascara({ name, mascara, inicial, ...p }: { name: string; mascara: (s: string) => string; inicial?: string | null } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [v, setV] = useState(inicial ?? "");
  return <input name={name} value={v} onChange={(e) => setV(mascara(e.target.value))} inputMode="numeric" {...p} />;
}

type Linha = { k: number; item: string; preco: string; pagamento: string; entrega: string; minima: string; codigo: string };
const nova = (k: number): Linha => ({ k, item: "", preco: "", pagamento: "", entrega: "", minima: "", codigo: "" });

/** Cadastro completo do fornecedor: empresa, contato, endereço, pagamento e frete e (no cadastro novo) as matérias-primas que ele vende. */
export default function FormFornecedor({ acao, inicial = {}, itens, comItens = false, textoBotao = "Salvar", desabilitado = false }: {
  acao: (f: FormData) => void | Promise<void>; inicial?: DadosFornecedor; itens?: OpcaoItem[]; comItens?: boolean; textoBotao?: string; desabilitado?: boolean;
}) {
  const f = inicial;
  const [linhas, setLinhas] = useState<Linha[]>([nova(1)]);
  const [frete, setFrete] = useState(f.frete ?? "");
  const muda = (k: number, campo: keyof Linha, v: string) => setLinhas((ls) => ls.map((l) => (l.k === k ? { ...l, [campo]: v } : l)));
  const usados = new Set(linhas.map((l) => l.item).filter(Boolean));
  return (
    <form action={acao} className="form-forn">
      {f.id && <input type="hidden" name="id" value={f.id} />}
      <fieldset disabled={desabilitado}>
        <section>
          <h3><span>1</span> Empresa</h3>
          <div className="campos">
            <label>Nome do fornecedor *<input name="nome" defaultValue={f.nome ?? ""} required placeholder="como vocês chamam (nome fantasia)" /></label>
            <label>Razão social<input name="razaoSocial" defaultValue={f.razaoSocial ?? ""} placeholder="como está na nota fiscal" /></label>
            <label>CNPJ<Mascara name="cnpj" mascara={mCnpj} inicial={f.cnpj} placeholder="00.000.000/0000-00" /></label>
            <label>Inscrição estadual<input name="inscricaoEstadual" defaultValue={f.inscricaoEstadual ?? ""} /></label>
            <label>O que fornece<input name="categoria" list="categorias-forn" defaultValue={f.categoria ?? ""} placeholder="Aço, Zamac, Insumos…" /></label>
            <datalist id="categorias-forn">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        </section>
        <section>
          <h3><span>2</span> Contato</h3>
          <div className="campos">
            <label>Vendedor / contato<input name="contato" defaultValue={f.contato ?? ""} placeholder="com quem vocês falam" /></label>
            <label>Telefone<Mascara name="telefone" mascara={mFone} inicial={f.telefone} placeholder="(11) 0000-0000" /></label>
            <label>WhatsApp<Mascara name="whatsapp" mascara={mFone} inicial={f.whatsapp} placeholder="(11) 90000-0000" /></label>
            <label>E-mail<input name="email" type="email" defaultValue={f.email ?? ""} placeholder="vendas@fornecedor.com.br" /></label>
            <label>Site<input name="site" defaultValue={f.site ?? ""} placeholder="www.fornecedor.com.br" /></label>
          </div>
        </section>
        <section>
          <h3><span>3</span> Endereço</h3>
          <div className="campos">
            <label>CEP<Mascara name="cep" mascara={mCep} inicial={f.cep} placeholder="00000-000" /></label>
            <label className="largo">Rua e número<input name="endereco" defaultValue={f.endereco ?? ""} /></label>
            <label>Bairro<input name="bairro" defaultValue={f.bairro ?? ""} /></label>
            <label>Cidade<input name="cidade" defaultValue={f.cidade ?? ""} /></label>
            <label>Estado<select name="uf" defaultValue={f.uf ?? ""}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
          </div>
        </section>
        <section>
          <h3><span>4</span> Pagamento e entrega</h3>
          <div className="campos">
            <label>Forma de pagamento<select name="formaPagamento" defaultValue={f.formaPagamento ?? ""}><option value="">—</option>{["Boleto", "Pix", "Transferência", "Cartão", "Dinheiro", "Boleto ou Pix"].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Prazo de pagamento (dias)<input name="prazoPagamento" defaultValue={f.prazoPagamento ?? "28"} placeholder="28 ou 28/42/56" /><small>parcelado: separe com /</small></label>
            <label>Prazo de entrega (dias)<input name="prazoEntregaDias" type="number" min={0} defaultValue={f.prazoEntregaDias ?? 7} /></label>
            <label>Pedido mínimo (R$)<input name="pedidoMinimo" inputMode="decimal" defaultValue={br(f.pedidoMinimo)} placeholder="ex.: 1.500,00" /></label>
            <label>Frete<select name="frete" value={frete} onChange={(e) => setFrete(e.target.value)}><option value="">—</option><option value="CIF">CIF — fornecedor paga e entrega</option><option value="FOB">FOB — nós pagamos / buscamos</option></select></label>
            {frete === "FOB" && <label>Valor do frete (R$)<input name="valorFrete" inputMode="decimal" defaultValue={br(f.valorFrete)} placeholder="por pedido" /></label>}
            <label>Chave Pix<input name="chavePix" defaultValue={f.chavePix ?? ""} /></label>
            <label>Banco / agência / conta<input name="bancoDados" defaultValue={f.banco ?? ""} /></label>
          </div>
        </section>
        {comItens && itens && (
          <section>
            <h3><span>5</span> Matérias-primas que ele vende</h3>
            <p className="suave" style={{ margin: "-4px 0 10px" }}>Prazo em branco = o prazo geral acima. Pode adicionar mais depois.</p>
            <div className="linhas-mp">
              {linhas.map((l, i) => {
                const it = itens.find((o) => o.valor === l.item);
                const un = it?.unidade ?? "un";
                return (
                  <div className="linha-mp" key={l.k}>
                    <input type="hidden" name="mp_item" value={l.item} />
                    <div className="mp-item">
                      <small>Matéria-prima {i + 1}</small>
                      <SelectFoto busca opcoes={itens.map((o) => ({ ...o, desativada: o.desativada || (usados.has(o.valor) && o.valor !== l.item) }))} valor={l.item} onChange={(v) => muda(l.k, "item", v)} placeholder="Escolha a matéria-prima" />
                    </div>
                    <label>Preço (R$/{un})<input name="mp_preco" inputMode="decimal" value={l.preco} onChange={(e) => muda(l.k, "preco", e.target.value)} placeholder="ex. 9,50" /></label>
                    <label>Compra mínima ({un})<input name="mp_minima" inputMode="decimal" value={l.minima} onChange={(e) => muda(l.k, "minima", e.target.value)} placeholder="ex. 500" /></label>
                    <label>Pagamento (dias)<input name="mp_pagamento" value={l.pagamento} onChange={(e) => muda(l.k, "pagamento", e.target.value)} placeholder="geral" /></label>
                    <label>Entrega (dias)<input name="mp_entrega" inputMode="numeric" value={l.entrega} onChange={(e) => muda(l.k, "entrega", e.target.value)} placeholder="geral" /></label>
                    <label>Código no fornecedor<input name="mp_codigo" value={l.codigo} onChange={(e) => muda(l.k, "codigo", e.target.value)} placeholder="opcional" /></label>
                    {linhas.length > 1 && <button type="button" className="mp-tirar" title="Tirar esta linha" onClick={() => setLinhas((ls) => ls.filter((x) => x.k !== l.k))}>×</button>}
                  </div>
                );
              })}
            </div>
            <button type="button" className="link-mais" onClick={() => setLinhas((ls) => [...ls, nova(Math.max(...ls.map((x) => x.k)) + 1)])}>+ Adicionar outra matéria-prima</button>
          </section>
        )}
        <section>
          <h3><span>{comItens ? 6 : 5}</span> Observações</h3>
          <textarea name="obs" defaultValue={f.observacao ?? ""} rows={3} placeholder="ex.: desconto de 3% à vista, entrega só às terças, pedir nota com o código do item…" />
        </section>
        {!desabilitado && <div className="acoes"><button className="btn">{textoBotao}</button></div>}
      </fieldset>
    </form>
  );
}
