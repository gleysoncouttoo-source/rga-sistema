import { NextResponse, type NextRequest } from "next/server";

// Passa o endereço aberto para as páginas, para conferir se a aba está liberada para o login.
export function middleware(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-caminho", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
}

export const config = { matcher: ["/((?!_next/|favicon|api/).*)"] };
