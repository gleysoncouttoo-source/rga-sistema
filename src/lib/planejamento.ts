// O "cérebro" que liga Vendas → Estoque → Produção → Compras → Financeiro.
// Quando entra um pedido de venda, analisarPedido():
//   1. usa o produto pronto do estoque;
//   2. o que falta, monta/produz: desce na estrutura (conjunto → peças → matéria-prima) e usa o que tiver em estoque;
//   3. o que ainda falta e é comprado vira pedido de compra "sugerido", agrupado por fornecedor,
//      com a data de compra escolhida para o boleto cair num dia com poucos boletos e sem atrasar a entrega.
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { chave, dia, diaUtilAnterior, diasEntre, menosDiasUteis, proximoDiaUtil, somaDias } from "./datas";
import { dataCurta, dataDia } from "./formato";
import { registrarPreco } from "./precos";

type Tx = Prisma.TransactionClient;

export type CfgCompras = { folgaCompraDias: number; maxBoletosDia: number; prazoEntregaPadrao: number };
export async function lerCfgCompras(tx: Tx = db): Promise<CfgCompras> {
  const rows = await tx.configuracao.findMany();
  const m = Object.fromEntries(rows.map((r) => [r.chave, Number(r.valor)]));
  return {
    folgaCompraDias: m.folgaCompraDias ?? 2,
    maxBoletosDia: m.maxBoletosDia || 2,
    prazoEntregaPadrao: m.prazoEntregaPadrao || 10,
  };
}

/** "28/42/56", "28 42 56", "28,42" → [28, 42, 56]. "à vista" ou vazio → [0]. */
export function lerPrazos(s: string | null | undefined): number[] {
  const n = (s ?? "").split(/[^0-9]+/).filter(Boolean).map(Number).filter((x) => x >= 0 && x <= 365);
  return n.length ? n : [0];
}

// ───────── Saldos ─────────
export type Saldo = { estoque: number; reservado: number; aCaminho: number; disponivel: number };
export async function saldos(): Promise<Map<number, Saldo>> {
  const [itens, res, cam] = await Promise.all([
    db.item.findMany({ select: { id: true, estoque: true } }),
    db.reserva.groupBy({ by: ["itemId"], _sum: { quantidade: true } }),
    db.pedidoCompraItem.groupBy({ by: ["itemId"], where: { pedidoCompra: { status: { in: ["sugerido", "aprovado"] } } }, _sum: { quantidade: true } }),
  ]);
  const r = new Map(res.map((x) => [x.itemId, x._sum.quantidade ?? 0]));
  const c = new Map(cam.map((x) => [x.itemId, x._sum.quantidade ?? 0]));
  return new Map(itens.map((i) => {
    const reservado = r.get(i.id) ?? 0;
    return [i.id, { estoque: i.estoque, reservado, aCaminho: c.get(i.id) ?? 0, disponivel: i.estoque - reservado }];
  }));
}

/** Custo de material de 1 unidade (soma da estrutura; item sem estrutura usa o preço/custo cadastrado). */
export function custoMaterial(id: number, itens: Map<number, { precoCompra: number | null; componentes: { filhoId: number; quantidade: number }[] }>, prof = 0): number {
  const it = itens.get(id);
  if (!it || prof > 12) return 0;
  if (!it.componentes.length) return it.precoCompra ?? 0;
  return it.componentes.reduce((s, c) => s + c.quantidade * custoMaterial(c.filhoId, itens, prof + 1), 0);
}

// ───────── Melhor data de compra ─────────
export type Escolha = { data: Date; vencimentos: Date[]; urgente: boolean; lotado: boolean; motivo: string };

async function contarBoletos(tx: Tx, de: Date, ate: Date, ignorarCompraId?: number) {
  const bs = await tx.contaPagar.findMany({
    where: { status: { in: ["previsto", "aberto"] }, vencimento: { gte: somaDias(de, -5), lte: somaDias(ate, 1) }, ...(ignorarCompraId ? { NOT: { pedidoCompraId: ignorarCompraId } } : {}) },
    select: { vencimento: true },
  });
  const m = new Map<string, number>();
  // boleto que vence em fim de semana/feriado conta no próximo dia útil (é quando sai o dinheiro)
  for (const b of bs) { const k = chave(proximoDiaUtil(dia(b.vencimento.toISOString()))); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

/**
 * Entre hoje e a data limite, escolhe o dia de compra cujo(s) boleto(s) — compra + prazo de pagamento do fornecedor,
 * jogado para o próximo dia útil — caem nos dias com MENOS boletos já lançados. Empate: compra mais cedo (mais segurança).
 */
export function escolherData(prazos: number[], limite: Date, contagem: Map<string, number>, cfg: CfgCompras, hoje = dia()): Escolha {
  const inicio = proximoDiaUtil(hoje);
  const venc = (d: Date) => prazos.map((p) => proximoDiaUtil(somaDias(d, p)));
  const cont = (v: Date[]) => v.map((x) => contagem.get(chave(x)) ?? 0);
  if (limite < inicio) {
    const v = venc(inicio), c = cont(v);
    const lotado = Math.max(...c) >= cfg.maxBoletosDia;
    // se o dia do boleto já está cheio, sugere pedir ao fornecedor outro vencimento próximo
    const dicas = v.map((x, i) => {
      if (c[i] < cfg.maxBoletosDia) return null;
      let melhor = x, mc = c[i];
      for (let k = -5; k <= 5; k++) {
        const y = somaDias(x, k);
        if (y <= hoje || proximoDiaUtil(y).getTime() !== y.getTime()) continue;
        const n = contagem.get(chave(y)) ?? 0;
        if (n < mc) { melhor = y; mc = n; }
      }
      return melhor.getTime() !== x.getTime() ? `pedir ao fornecedor para o boleto de ${dataCurta(x)} vencer em ${dataCurta(melhor)} (${mc === 0 ? "nenhum boleto" : `${mc} boleto${mc > 1 ? "s" : ""}`})` : null;
    }).filter(Boolean);
    return {
      data: inicio, vencimentos: v, urgente: true, lotado,
      motivo: `URGENTE: para não atrasar a entrega, a compra deveria ter sido feita até ${dataDia(limite)}. Comprar hoje e negociar prazo de entrega. ` +
        `Boleto${v.length > 1 ? "s" : ""} em ${v.map((x, i) => `${dataCurta(x)} (${c[i] === 0 ? "nenhum outro boleto" : `${c[i]} outro${c[i] > 1 ? "s" : ""}`})`).join(", ")}.` +
        (dicas.length ? ` Dia cheio: ${dicas.join("; ")}.` : ""),
    };
  }
  const fim = diasEntre(inicio, limite) > 60 ? somaDias(inicio, 60) : limite;
  let melhor: { d: Date; v: Date[]; c: number[] } | null = null;
  for (let d = inicio; d <= fim; d = somaDias(d, 1)) {
    if (proximoDiaUtil(d).getTime() !== d.getTime()) continue; // só compra em dia útil
    const v = venc(d), c = cont(v);
    if (!melhor) { melhor = { d, v, c }; continue; }
    const a = [Math.max(...c), c.reduce((s, x) => s + x, 0)], b = [Math.max(...melhor.c), melhor.c.reduce((s, x) => s + x, 0)];
    if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) melhor = { d, v, c };
  }
  const m = melhor!;
  const lotado = Math.max(...m.c) >= cfg.maxBoletosDia;
  const detalhe = m.v.map((x, i) => `${dataCurta(x)} (${m.c[i] === 0 ? "nenhum outro boleto" : `${m.c[i]} outro${m.c[i] > 1 ? "s" : ""}`})`).join(", ");
  return {
    data: m.d, vencimentos: m.v, urgente: false, lotado,
    motivo: `Comprar em ${dataDia(m.d)} (pode até ${dataDia(limite)}). Boleto${m.v.length > 1 ? "s" : ""} em ${detalhe}.` +
      (lotado ? ` Atenção: todos os dias possíveis já têm ${Math.max(...m.c)} ou mais boletos.` : ""),
  };
}

async function lancarBoletos(tx: Tx, compraId: number, fornecedorId: number | null, nomeForn: string, vencs: Date[], valor: number, status: string) {
  await tx.contaPagar.deleteMany({ where: { pedidoCompraId: compraId, status: { not: "pago" } } });
  if (valor <= 0) return;
  const parcela = Math.round((valor / vencs.length) * 100) / 100;
  for (const [i, v] of vencs.entries()) {
    await tx.contaPagar.create({
      data: {
        descricao: `Compra #${compraId} — ${nomeForn}`, fornecedorId, pedidoCompraId: compraId, vencimento: v, status, formaPagamento: "boleto", favorecido: nomeForn,
        valor: i === vencs.length - 1 ? Math.round((valor - parcela * (vencs.length - 1)) * 100) / 100 : parcela,
        parcela: vencs.length > 1 ? `${i + 1}/${vencs.length}` : null,
      },
    });
  }
}

// ───────── Análise do pedido de venda ─────────
type ItemCarregado = Prisma.ItemGetPayload<{ include: { componentes: true; fornecedor: true; ofertas: true } }>;

export async function analisarPedido(pedidoId: number, usuario = "Sistema") {
  return db.$transaction(async (tx) => {
    const pedido = await tx.pedidoVenda.findUniqueOrThrow({ where: { id: pedidoId }, include: { itens: true } });
    if (pedido.status !== "aberto") return;
    const cfg = await lerCfgCompras(tx);
    const hoje = dia();

    // refaz do zero: solta reservas e apaga sugestões ainda não aprovadas deste pedido
    await tx.reserva.deleteMany({ where: { pedidoVendaId: pedidoId } });
    await tx.necessidade.deleteMany({ where: { pedidoVendaId: pedidoId } });
    await tx.pedidoCompra.deleteMany({ where: { pedidoVendaId: pedidoId, status: "sugerido" } });

    const lista: ItemCarregado[] = await tx.item.findMany({ include: { componentes: true, fornecedor: true, ofertas: true } });
    const itens = new Map(lista.map((i) => [i.id, i]));
    const outras = await tx.reserva.groupBy({ by: ["itemId"], _sum: { quantidade: true } });
    const disp = new Map(lista.map((i) => [i.id, i.estoque]));
    for (const r of outras) disp.set(r.itemId, (disp.get(r.itemId) ?? 0) - (r._sum.quantidade ?? 0));
    // compras já aprovadas para este pedido (ainda não recebidas) cobrem parte da falta
    const aprovadas = await tx.pedidoCompraItem.groupBy({
      by: ["itemId"], where: { pedidoCompra: { pedidoVendaId: pedidoId, status: "aprovado" } }, _sum: { necessaria: true },
    });
    const coberto = new Map(aprovadas.map((a) => [a.itemId, a._sum.necessaria ?? 0]));

    const reservar = new Map<number, number>();
    const linhas: Prisma.NecessidadeCreateManyInput[] = [];
    const comprar = new Map<number, { qtd: number; precisaEm: Date }>();
    let ordem = 0, fabricar = false;

    const explodir = (itemId: number, qtd: number, nivel: number, precisaEm: Date) => {
      const it = itens.get(itemId);
      if (!it || nivel > 10) return;
      const livre = Math.max(0, disp.get(itemId) ?? 0);
      const usa = Math.min(livre, qtd);
      const usaR = arred(usa);
      if (usaR > 0) { disp.set(itemId, livre - usaR); reservar.set(itemId, arred((reservar.get(itemId) ?? 0) + usaR)); }
      const falta = arred(qtd - usaR);
      const linha: Prisma.NecessidadeCreateManyInput = {
        pedidoVendaId: pedidoId, itemId, nivel, ordem: ordem++, necessario: qtd, doEstoque: usaR, aFabricar: 0, aComprar: 0, precisaEm,
      };
      linhas.push(linha);
      if (falta <= 0) return;
      if (it.origem === "fabricado") {
        linha.aFabricar = falta;
        fabricar = true;
        const prazo = menosDiasUteis(precisaEm, it.diasFabricacao);
        if (prazo < hoje) linha.aviso = `Para entregar no prazo, a fabricação deveria começar em ${dataDia(prazo)}.`;
        if (!it.componentes.length) linha.aviso = [linha.aviso, "Sem estrutura cadastrada: não dá para conferir a matéria-prima."].filter(Boolean).join(" ");
        for (const c of it.componentes) explodir(c.filhoId, arred(falta * c.quantidade), nivel + 1, prazo);
      } else {
        const jaComprado = Math.min(coberto.get(itemId) ?? 0, falta);
        if (jaComprado > 0) { coberto.set(itemId, (coberto.get(itemId) ?? 0) - jaComprado); linha.aviso = `${fmt(jaComprado)} já em compra aprovada.`; }
        const compra = arred(falta - jaComprado);
        linha.aComprar = compra;
        if (compra > 0) {
          const atual = comprar.get(itemId);
          comprar.set(itemId, { qtd: (atual?.qtd ?? 0) + compra, precisaEm: atual && atual.precisaEm < precisaEm ? atual.precisaEm : precisaEm });
          if (!it.fornecedorId) linha.aviso = [linha.aviso, "Sem fornecedor cadastrado."].filter(Boolean).join(" ");
        }
      }
    };
    const entrega = dia(pedido.dataEntrega.toISOString());
    for (const pi of pedido.itens) explodir(pi.itemId, pi.quantidade, 0, entrega);

    for (const [itemId, quantidade] of reservar) await tx.reserva.create({ data: { itemId, pedidoVendaId: pedidoId, quantidade } });
    if (linhas.length) await tx.necessidade.createMany({ data: linhas });

    // agrupa por fornecedor e escolhe a melhor data para cada pedido de compra
    const grupos = new Map<number | null, { itemId: number; qtd: number; precisaEm: Date }[]>();
    for (const [itemId, v] of comprar) {
      const f = itens.get(itemId)!.fornecedorId ?? null;
      grupos.set(f, [...(grupos.get(f) ?? []), { itemId, ...v }]);
    }
    const contagem = await contarBoletos(tx, hoje, somaDias(hoje, 200));
    let urgente = false;
    const criadas: number[] = [];
    for (const [fornecedorId, its] of grupos) {
      const forn = fornecedorId ? itens.get(its[0].itemId)!.fornecedor! : null;
      // condições combinadas com o fornecedor para cada matéria-prima (aba Fornecedores); vazio = condição geral do fornecedor
      const oferta = (itemId: number) => (fornecedorId ? itens.get(itemId)!.ofertas.find((o) => o.fornecedorId === fornecedorId) : undefined);
      const lead = Math.max(...its.map((x) => oferta(x.itemId)?.prazoEntregaDias ?? forn?.prazoEntregaDias ?? 7));
      const precisa = its.reduce((m, x) => (x.precisaEm < m ? x.precisaEm : m), its[0].precisaEm);
      const limite = diaUtilAnterior(somaDias(precisa, -(lead + cfg.folgaCompraDias)));
      const prazos = lerPrazos(its.map((x) => oferta(x.itemId)?.prazoPagamento).find(Boolean) ?? forn?.prazoPagamento ?? "28");
      const esc = escolherData(prazos, limite, contagem, cfg, hoje);
      if (!forn) esc.motivo = "Item sem fornecedor cadastrado: escolha o fornecedor para o sistema calcular o melhor dia. " + esc.motivo;
      urgente ||= esc.urgente;
      const itensCompra = its.map((x) => {
        const it = itens.get(x.itemId)!;
        const of = oferta(x.itemId);
        const minimo = of?.compraMinima ?? it.loteMinimo;
        const q = minimo && x.qtd < minimo ? minimo : x.qtd;
        return { itemId: x.itemId, quantidade: arred(q), necessaria: x.qtd, precoUnitario: of?.preco ?? it.precoCompra };
      });
      const valor = itensCompra.reduce((s, x) => s + x.quantidade * (x.precoUnitario ?? 0), 0);
      const pc = await tx.pedidoCompra.create({
        data: {
          fornecedorId, pedidoVendaId: pedidoId, status: "sugerido", dataCompra: esc.data, dataLimite: limite,
          chegadaPrevista: somaDias(esc.data, lead), urgente: esc.urgente, motivo: esc.motivo, itens: { create: itensCompra },
        },
      });
      await lancarBoletos(tx, pc.id, fornecedorId, forn?.nome ?? "fornecedor a definir", esc.vencimentos, valor, "previsto");
      for (const v of esc.vencimentos) contagem.set(chave(v), (contagem.get(chave(v)) ?? 0) + 1);
      criadas.push(pc.id);
    }

    const situacao = urgente ? "urgente" : grupos.size ? "comprar" : fabricar ? "produzir" : "pronto";
    await tx.pedidoVenda.update({ where: { id: pedidoId }, data: { situacao } });
    await tx.auditoria.create({ data: { usuario, acao: "analisou pedido de venda", detalhe: `#${pedidoId}: ${situacao}${criadas.length ? `, compras sugeridas ${criadas.map((c) => "#" + c).join(", ")}` : ""}` } });
    return { situacao, compras: criadas };
  }, { timeout: 30_000 });
}

const arred = (x: number) => Math.round(x * 1e6) / 1e6;
const fmt = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

// ───────── Entrada de pedidos ─────────
export async function criarPedidoVenda(p: {
  cliente: string; dataEntrega?: Date; numero?: string; origem?: string; observacao?: string;
  itens: { itemId: number; quantidade: number; precoUnitario?: number | null }[];
}, usuario = "Sistema") {
  const cfg = await lerCfgCompras();
  const entrega = p.dataEntrega ?? proximoDiaUtil(somaDias(dia(), cfg.prazoEntregaPadrao));
  const pv = await db.pedidoVenda.create({
    data: {
      cliente: p.cliente, numero: p.numero, origem: p.origem ?? "manual", observacao: p.observacao, dataEntrega: entrega,
      itens: { create: p.itens.map((i) => ({ itemId: i.itemId, quantidade: i.quantidade, precoUnitario: i.precoUnitario ?? null })) },
    },
  });
  await analisarPedido(pv.id, usuario);
  return pv.id;
}

export async function entregarPedido(id: number, usuario: string) {
  await db.$transaction(async (tx) => {
    const p = await tx.pedidoVenda.findUniqueOrThrow({ where: { id }, include: { reservas: true } });
    if (p.status !== "aberto") return;
    for (const r of p.reservas) {
      await tx.item.update({ where: { id: r.itemId }, data: { estoque: { decrement: r.quantidade } } });
      await tx.movimentoEstoque.create({ data: { itemId: r.itemId, quantidade: -r.quantidade, motivo: `Pedido de venda #${id} entregue`, usuario } });
    }
    await tx.reserva.deleteMany({ where: { pedidoVendaId: id } });
    // sugestões de compra que ninguém aprovou deixam de fazer sentido
    await tx.pedidoCompra.deleteMany({ where: { pedidoVendaId: id, status: "sugerido" } });
    await tx.pedidoVenda.update({ where: { id }, data: { status: "entregue" } });
    await tx.auditoria.create({ data: { usuario, acao: "entregou pedido de venda", detalhe: `#${id}` } });
  });
}

export async function cancelarPedido(id: number, usuario: string) {
  await db.$transaction(async (tx) => {
    await tx.reserva.deleteMany({ where: { pedidoVendaId: id } });
    await tx.pedidoCompra.deleteMany({ where: { pedidoVendaId: id, status: "sugerido" } });
    await tx.pedidoVenda.update({ where: { id }, data: { status: "cancelado" } });
    await tx.auditoria.create({ data: { usuario, acao: "cancelou pedido de venda", detalhe: `#${id}` } });
  });
}

// ───────── Ações nos pedidos de compra ─────────
async function valorCompra(tx: Tx, id: number) {
  const its = await tx.pedidoCompraItem.findMany({ where: { pedidoCompraId: id } });
  return its.reduce((s, x) => s + x.quantidade * (x.precoUnitario ?? 0), 0);
}

/** Troca fornecedor e/ou data. Sem data, recalcula o melhor dia para o novo fornecedor. */
export async function reprogramarCompra(id: number, p: { fornecedorId?: number | null; data?: Date | null; prazoEntregaDias?: number | null }, usuario: string) {
  await db.$transaction(async (tx) => {
    const pc = await tx.pedidoCompra.findUniqueOrThrow({ where: { id }, include: { fornecedor: true } });
    if (pc.status !== "sugerido" && pc.status !== "aprovado") return;
    const novoF = p.fornecedorId !== undefined ? p.fornecedorId : pc.fornecedorId;
    const forn = novoF ? await tx.fornecedor.findUniqueOrThrow({ where: { id: novoF } }) : null;
    const itensPc = await tx.pedidoCompraItem.findMany({ where: { pedidoCompraId: id } });
    const ofertas = novoF ? await tx.fornecedorItem.findMany({ where: { fornecedorId: novoF, itemId: { in: itensPc.map((i) => i.itemId) } } }) : [];
    const leadOferta = ofertas.length ? Math.max(...itensPc.map((i) => ofertas.find((o) => o.itemId === i.itemId)?.prazoEntregaDias ?? forn?.prazoEntregaDias ?? 7)) : null;
    const leadAntigo = pc.prazoEntregaDias ?? pc.fornecedor?.prazoEntregaDias ?? 7;
    const prazoCompra = p.prazoEntregaDias !== undefined ? p.prazoEntregaDias : novoF === pc.fornecedorId ? pc.prazoEntregaDias : leadOferta;
    const lead = prazoCompra ?? forn?.prazoEntregaDias ?? 7;
    const limite = diaUtilAnterior(somaDias(dia(pc.dataLimite.toISOString()), leadAntigo - lead));
    const prazos = lerPrazos(ofertas.map((o) => o.prazoPagamento).find(Boolean) ?? forn?.prazoPagamento ?? "28");
    const cfg = await lerCfgCompras(tx);
    let esc: Escolha;
    if (p.data) {
      const v = prazos.map((x) => proximoDiaUtil(somaDias(p.data!, x)));
      esc = { data: p.data, vencimentos: v, urgente: p.data > limite, lotado: false,
        motivo: `Data escolhida por ${usuario}: ${dataDia(p.data)}. Boleto${v.length > 1 ? "s" : ""} em ${v.map(dataCurta).join(", ")}.` +
          (p.data > limite ? ` Atenção: depois do limite (${dataDia(limite)}), a entrega pode atrasar.` : "") };
    } else {
      const contagem = await contarBoletos(tx, dia(), somaDias(dia(), 200), id);
      esc = escolherData(prazos, limite, contagem, cfg);
    }
    // itens passam a ser deste fornecedor (preço atual dele fica no cadastro do item)
    if (novoF && novoF !== pc.fornecedorId) {
      for (const i of itensPc) {
        await tx.item.updateMany({ where: { id: i.itemId, fornecedorId: null }, data: { fornecedorId: novoF } });
        // o preço da compra passa a ser o que este fornecedor cobra pela matéria-prima (se estiver na aba Fornecedores)
        const of = ofertas.find((o) => o.itemId === i.itemId);
        if (of?.preco != null) await tx.pedidoCompraItem.update({ where: { id: i.id }, data: { precoUnitario: of.preco } });
      }
    }
    await tx.pedidoCompra.update({
      where: { id },
      data: { fornecedorId: novoF, prazoEntregaDias: prazoCompra, dataCompra: esc.data, dataLimite: limite, chegadaPrevista: somaDias(esc.data, lead), urgente: esc.urgente, motivo: esc.motivo },
    });
    await lancarBoletos(tx, id, novoF, forn?.nome ?? "fornecedor a definir", esc.vencimentos, await valorCompra(tx, id), pc.status === "aprovado" ? "aberto" : "previsto");
    await tx.auditoria.create({ data: { usuario, acao: "reprogramou compra", detalhe: `#${id} para ${dataDia(esc.data)}` } });
  });
}

export async function aprovarCompra(id: number, usuario: string) {
  await db.$transaction(async (tx) => {
    const pc = await tx.pedidoCompra.findUniqueOrThrow({ where: { id } });
    if (pc.status !== "sugerido") return;
    if (!pc.fornecedorId) throw new Error("Escolha o fornecedor antes de aprovar.");
    await tx.pedidoCompra.update({ where: { id }, data: { status: "aprovado", decididoPor: usuario } });
    await tx.contaPagar.updateMany({ where: { pedidoCompraId: id, status: "previsto" }, data: { status: "aberto" } });
    await tx.auditoria.create({ data: { usuario, acao: "aprovou compra", detalhe: `#${id}` } });
  });
}

export async function cancelarCompra(id: number, usuario: string) {
  await db.$transaction(async (tx) => {
    await tx.pedidoCompra.update({ where: { id }, data: { status: "cancelado", decididoPor: usuario } });
    await tx.contaPagar.deleteMany({ where: { pedidoCompraId: id, status: { not: "pago" } } });
    await tx.auditoria.create({ data: { usuario, acao: "cancelou compra", detalhe: `#${id}` } });
  });
}

/** Material chegou: entra no estoque (quantidade e preço da nota) e já fica reservado para o pedido de venda que gerou a compra. */
export async function receberCompra(id: number, usuario: string, r: {
  data?: Date; notaFiscal?: string; obs?: string; itens?: { id: number; quantidade?: number | null; preco?: number | null }[];
} = {}) {
  return db.$transaction(async (tx) => {
    const pc = await tx.pedidoCompra.findUniqueOrThrow({ where: { id }, include: { itens: { include: { item: true } }, pedidoVenda: true } });
    if (pc.status !== "aprovado") return { recordes: [] as string[] };
    const quando = r.data ?? dia();
    const recordes: string[] = [];
    let total = 0, parcial = false;
    for (const i of pc.itens) {
      const inf = r.itens?.find((x) => x.id === i.id);
      const q = inf?.quantidade != null && inf.quantidade >= 0 ? inf.quantidade : i.quantidade;
      const preco = inf?.preco != null && inf.preco > 0 ? inf.preco : i.precoUnitario;
      if (q < i.quantidade) parcial = true;
      total += q * (preco ?? 0);
      await tx.pedidoCompraItem.update({ where: { id: i.id }, data: { quantidadeRecebida: q, precoPago: preco } });
      if (q > 0) {
        await tx.item.update({ where: { id: i.itemId }, data: { estoque: { increment: q } } });
        await tx.movimentoEstoque.create({ data: { itemId: i.itemId, quantidade: q, motivo: `Compra #${id} recebida${r.notaFiscal ? ` (NF ${r.notaFiscal})` : ""}`, usuario } });
        if (pc.pedidoVenda?.status === "aberto") {
          await tx.reserva.create({ data: { itemId: i.itemId, pedidoVendaId: pc.pedidoVenda.id, quantidade: Math.min(i.necessaria, q) } });
        }
      }
      if (preco) {
        const { novoRecorde } = await registrarPreco(tx, { itemId: i.itemId, preco, data: quando, origem: "compra", fornecedorId: pc.fornecedorId, pedidoCompraId: id, usuario });
        if (novoRecorde) recordes.push(i.item.nome);
      }
    }
    // boletos em aberto passam a valer o total da nota
    const abertos = await tx.contaPagar.findMany({ where: { pedidoCompraId: id, status: "aberto" }, orderBy: { vencimento: "asc" } });
    const pagos = await tx.contaPagar.aggregate({ where: { pedidoCompraId: id, status: "pago" }, _sum: { valor: true } });
    const resta = Math.max(0, total - (pagos._sum.valor ?? 0));
    if (abertos.length && resta > 0) {
      const parcela = Math.round((resta / abertos.length) * 100) / 100;
      for (const [k, b] of abertos.entries()) {
        await tx.contaPagar.update({ where: { id: b.id }, data: { valor: k === abertos.length - 1 ? Math.round((resta - parcela * (abertos.length - 1)) * 100) / 100 : parcela } });
      }
    }
    await tx.pedidoCompra.update({
      where: { id },
      data: { status: "recebido", recebidoEm: quando, notaFiscal: r.notaFiscal || null, obsRecebimento: [parcial ? "Recebido com quantidade menor que a pedida." : "", r.obs ?? ""].filter(Boolean).join(" ") || null },
    });
    await tx.auditoria.create({ data: { usuario, acao: "recebeu compra", detalhe: `#${id}${recordes.length ? ` — recorde de preço: ${recordes.join(", ")}` : ""}` } });
    return { recordes };
  });
}
