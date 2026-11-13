export const MODULOS = [
  { id: "painel", nome: "Painel", href: "/" },
  { id: "produtos", nome: "Produtos e processos", href: "/produtos" },
  { id: "funcionarios", nome: "Colaboradores", href: "/funcionarios" },
  { id: "vendas", nome: "Vendas", href: "/vendas" },
  { id: "estoque", nome: "Estoque", href: "/estoque" },
  { id: "producao", nome: "Produção", href: "/producao" },
  { id: "compras", nome: "Compras", href: "/compras" },
  { id: "financeiro", nome: "Financeiro", href: "/financeiro" },
  { id: "custos", nome: "Custos", href: "/custos" },
  { id: "usuarios", nome: "Usuários e perfis", href: "/usuarios" },
  { id: "historico", nome: "Histórico de alterações", href: "/historico" },
] as const;

// Abas do menu. Cada login pode esconder as que não usa (Minha conta → Abas do menu); o perfil continua mandando no acesso.
export const ABAS = [
  { id: "painel", nome: "Painel", href: "/", modulo: "painel" },
  { id: "produtos", nome: "Produtos", href: "/produtos", modulo: "produtos" },
  { id: "materia-prima", nome: "Matéria-prima", href: "/materia-prima", modulo: "estoque" },
  { id: "producao", nome: "Produção", href: "/producao", modulo: "producao" },
  { id: "estoque-parcial", nome: "Estoque parcial", href: "/estoque-parcial", modulo: "producao" },
  { id: "estoque", nome: "Estoque", href: "/estoque", modulo: "estoque" },
  { id: "vendas", nome: "Vendas", href: "/vendas", modulo: "vendas" },
  { id: "compras", nome: "Compras", href: "/compras", modulo: "compras" },
  { id: "financeiro", nome: "Financeiro", href: "/financeiro", modulo: "financeiro" },
  { id: "custos", nome: "Custos", href: "/custos", modulo: "custos" },
  { id: "lucros", nome: "Lucros", href: "/lucros", modulo: "custos" },
  { id: "funcionarios", nome: "Colaboradores", href: "/funcionarios", modulo: "funcionarios" },
  { id: "historico", nome: "Histórico", href: "/historico", modulo: "historico" },
  { id: "usuarios", nome: "Usuários e perfis", href: "/usuarios", modulo: "usuarios" },
  { id: "apontar", nome: "Apontar produção", href: "/apontar", modulo: null },
] as const;

export function lerAbasOcultas(json: string | null | undefined): string[] {
  try { const v = JSON.parse(json || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

/** Abas que o login pode ver (pelo perfil), marcando as que ele escondeu. */
export function abasDoUsuario(p: Permissoes, ocultasJson: string | null | undefined) {
  const ocultas = lerAbasOcultas(ocultasJson);
  return ABAS.filter((a) => a.modulo == null || pode(p, a.modulo as Modulo)).map((a) => ({ ...a, oculta: ocultas.includes(a.id) }));
}

// Módulos previstos no plano, ainda não construídos
export const MODULOS_FUTUROS = ["Folha", "Ferramentaria", "WhatsApp"];

export const ACOES = [
  { id: "ver", nome: "Ver" },
  { id: "criar", nome: "Criar" },
  { id: "editar", nome: "Editar" },
  { id: "excluir", nome: "Excluir" },
  { id: "aprovar", nome: "Aprovar" },
  { id: "exportar", nome: "Exportar" },
  { id: "ver_salario", nome: "Ver salários" },
] as const;

export type Modulo = (typeof MODULOS)[number]["id"];
export type Acao = (typeof ACOES)[number]["id"];
export type Permissoes = Partial<Record<string, string[]>>;

export function lerPermissoes(json: string): Permissoes {
  try {
    return JSON.parse(json) as Permissoes;
  } catch {
    return {};
  }
}

export function pode(p: Permissoes, modulo: Modulo, acao: Acao = "ver") {
  return !!p[modulo]?.includes(acao);
}
