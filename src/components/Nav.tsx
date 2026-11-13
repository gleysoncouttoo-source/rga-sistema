"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav({ itens }: { itens: { href: string; nome: string }[] }) {
  const p = usePathname();
  return (
    <>
      {itens.map((i) => {
        const ativo = i.href === "/" ? p === "/" : p === i.href || p.startsWith(i.href + "/");
        return (
          <Link key={i.href} href={i.href} className={ativo ? "ativo" : ""}>
            {i.nome}
          </Link>
        );
      })}
    </>
  );
}
