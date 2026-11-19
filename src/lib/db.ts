// Banco + histórico de alterações automático: toda criação, alteração e exclusão feita por um login
// grava em Alteracao cada campo que mudou (antes → depois), com o login e o horário.
import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis as unknown as { prismaBase?: PrismaClient; prismaDb?: PrismaClient };
const base = g.prismaBase ?? new PrismaClient();

// tabelas que não entram no histórico (geradas pelo sistema ou já são um registro)
const FORA = new Set(["Sessao", "Auditoria", "Alteracao", "ImportacaoVenda", "ImportacaoExtrato", "MovimentoBanco", "Comprovante", "ShopeeConexao", "AdsLinha", "Necessidade", "Reserva", "MovimentoEstoque", "PrecoHistorico", "RecordeVenda"]);
const IGNORAR = new Set(["criadoEm", "atualizadoEm", "tentativas", "bloqueadoAte", "dados"]);
const SIGILO = new Set(["senhaHash", "pinHash", "accessToken", "refreshToken"]);

const COOKIE = "rga_sessao";
const nomes = new Map<string, { nome: string; ate: number }>();
async function quem(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const id = (await cookies()).get(COOKIE)?.value;
    if (!id) return null;
    const c = nomes.get(id);
    if (c && c.ate > Date.now()) return c.nome;
    const s = await base.sessao.findUnique({ where: { id }, include: { usuario: true } });
    if (!s) return null;
    nomes.set(id, { nome: s.usuario.nome, ate: Date.now() + 5 * 60_000 });
    return s.usuario.nome;
  } catch {
    return null; // fora de uma requisição (carga inicial, tarefas automáticas)
  }
}

// operador pelo celular (sem login): a tela informa o nome antes de gravar
const operador = new AsyncLocalStorage<string>();
export function comoOperador<T>(nome: string, fn: () => Promise<T>): Promise<T> {
  return operador.run(nome, fn);
}

const chaveDe = (model: string) => (model === "Configuracao" ? "chave" : "id");
const nomeDe = (r: Record<string, unknown> | null | undefined) =>
  r ? String(r.nome ?? r.descricao ?? r.numero ?? r.codigo ?? r.chave ?? r.cliente ?? `#${r.id}`) : null;
const texto = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  if (typeof v === "number") return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 300);
  const s = String(v);
  return s.startsWith("data:image") ? "(foto)" : s.slice(0, 500);
};
const igual = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b));

type Linha = { usuario: string; acao: string; tabela: string; registroId: string; registro: string | null; campo?: string | null; antes?: string | null; depois?: string | null };

function diff(usuario: string, tabela: string, antes: Record<string, unknown>, depois: Record<string, unknown>, pk: string): Linha[] {
  const out: Linha[] = [];
  for (const k of Object.keys(depois)) {
    if (IGNORAR.has(k) || igual(antes[k], depois[k])) continue;
    const sig = SIGILO.has(k);
    out.push({ usuario, acao: "alterou", tabela, registroId: String(depois[pk]), registro: nomeDe(depois), campo: k,
      antes: sig ? (antes[k] ? "•••" : null) : texto(antes[k]), depois: sig ? "(alterado)" : texto(depois[k]) });
  }
  return out;
}

async function gravar(linhas: Linha[]) {
  if (linhas.length) await base.alteracao.createMany({ data: linhas.slice(0, 500) }).catch(() => {});
}

function criar() {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const escrita = ["create", "update", "upsert", "delete", "updateMany", "deleteMany", "createMany"].includes(operation);
          if (!escrita || FORA.has(model)) return query(args);
          const usuario = operador.getStore() ?? (await quem());
          if (!usuario) return query(args);
          const pk = chaveDe(model);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = (base as any)[model[0].toLowerCase() + model.slice(1)];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = args as any;
          {
            if (operation === "create") {
              const r = await query(args) as Record<string, unknown>;
              await gravar([{ usuario, acao: "criou", tabela: model, registroId: String(r[pk]), registro: nomeDe(r) }]);
              return r;
            }
            if (operation === "createMany") {
              const r = await query(args) as { count: number };
              await gravar([{ usuario, acao: "criou", tabela: model, registroId: "-", registro: `${r.count} registro(s)` }]);
              return r;
            }
            if (operation === "update" || operation === "upsert") {
              const antes = await m.findUnique({ where: a.where });
              const r = await query(args) as Record<string, unknown>;
              await gravar(antes ? diff(usuario, model, antes, r, pk) : [{ usuario, acao: "criou", tabela: model, registroId: String(r[pk]), registro: nomeDe(r) }]);
              return r;
            }
            if (operation === "delete") {
              const antes = await m.findUnique({ where: a.where });
              const r = await query(args);
              if (antes) await gravar([{ usuario, acao: "excluiu", tabela: model, registroId: String(antes[pk]), registro: nomeDe(antes) }]);
              return r;
            }
            if (operation === "updateMany") {
              const antes: Record<string, unknown>[] = await m.findMany({ where: a.where, take: 201 });
              const r = await query(args);
              if (antes.length > 200) await gravar([{ usuario, acao: "alterou", tabela: model, registroId: "-", registro: `vários registros`, campo: Object.keys(a.data ?? {}).join(", ") }]);
              else if (antes.length) {
                const depois: Record<string, unknown>[] = await m.findMany({ where: { [pk]: { in: antes.map((x) => x[pk]) } } });
                const mp = new Map(antes.map((x) => [x[pk], x]));
                await gravar(depois.flatMap((d) => diff(usuario, model, mp.get(d[pk]) ?? {}, d, pk)));
              }
              return r;
            }
            if (operation === "deleteMany") {
              const antes: Record<string, unknown>[] = await m.findMany({ where: a.where, take: 200 });
              const r = await query(args);
              await gravar(antes.map((x) => ({ usuario, acao: "excluiu", tabela: model, registroId: String(x[pk]), registro: nomeDe(x) })));
              return r;
            }
          }
          return query(args);
        },
      },
    },
  });
}

// o tipo continua o do PrismaClient normal (a extensão só acrescenta o histórico)
export const db: PrismaClient = g.prismaDb ?? (criar() as unknown as PrismaClient);
if (process.env.NODE_ENV !== "production") { g.prismaBase = base; g.prismaDb = db; }
