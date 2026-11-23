import { NextResponse, type NextRequest } from "next/server";
import { PASS_COOKIE, passToken } from "./lib/sitePassword";

// The whole site (console and customer app) asks for the shared password once per device, when
// SITE_PASSWORD is set in Vercel. Without it the site stays open (a local copy, or before it's set).
export async function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  // The integration APIs check their own API keys (banks and systems have no browser cookie).
  if (pathname.startsWith("/api/bank/v1/") || pathname.startsWith("/api/v1/")) return NextResponse.next();
  const cookie = request.cookies.get(PASS_COOKIE)?.value;
  if (cookie && cookie === (await passToken(password))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "password_required" }, { status: 401 });
  const url = new URL("/login", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own files and the icons.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)"],
};
