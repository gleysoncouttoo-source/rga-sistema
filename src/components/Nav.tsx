"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { nome: string; abas: { href: string; nome: string }[] };

function casa(p: string, href: string) {
  return href === "/" ? p === "/" : p === href || p.startsWith(href + "/");
}

/** O grupo do menu a que o endereço pertence (pela aba de endereço mais comprido). */
export function grupoAtivo(itens: Item[], p: string) {
  let melhor: { g: Item; len: number } | null = null;
  for (const g of itens) for (const a of g.abas) if (casa(p, a.href) && (!melhor || a.href.length > melhor.len)) melhor = { g, len: a.href.length };
  return melhor?.g ?? null;
}

export default function Nav({ itens }: { itens: Item[] }) {
  const p = usePathname();
  const ativo = grupoAtivo(itens, p);
  return (
    <>
      {itens.map((g) => (
        <Link key={g.nome} href={g.abas[0].href} className={g === ativo ? "ativo" : ""}>
          {g.nome}
        </Link>
      ))}
    </>
  );
}

/** Abas do grupo aberto (ex.: Estoque → Matéria-prima · Estoque parcial · Estoque final). */
export function SubMenu({ itens }: { itens: Item[] }) {
  const p = usePathname();
  const g = grupoAtivo(itens, p);
  if (!g || g.abas.length < 2) return null;
  let atual = "";
  for (const a of g.abas) if (casa(p, a.href) && a.href.length > atual.length) atual = a.href;
  return (
    <div className="submenu sem-print">
      {g.abas.map((a) => (
        <Link key={a.href} href={a.href} className={a.href === atual ? "ativo" : ""}>
          {a.nome}
        </Link>
      ))}
    </div>
  );
}
