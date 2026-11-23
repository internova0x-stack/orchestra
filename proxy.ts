import { NextResponse, type NextRequest } from "next/server";
import { PASS_COOKIE, passToken } from "./lib/sitePassword";

// The whole site (console and customer app) asks for the shared password once per device, when
// SITE_PASSWORD is set in Vercel. Without it the site stays open (a local copy, or before it's set).
// Console screens need a signed-in member of the team (lib/auth.ts); without the session cookie they go straight to
// the sign-in page. The cookie itself is checked on the server by every console request.
const CONSOLE_PAGES = ["/", "/staff", "/rules", "/dashboard", "/billing", "/developers", "/team", "/account"];

function needsSignIn(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  if (!CONSOLE_PAGES.includes(pathname) || request.cookies.get("orc_session")?.value) return null;
  const url = new URL("/signin", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return needsSignIn(request) ?? NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  // The integration APIs check their own API keys (banks and systems have no browser cookie).
  if (pathname.startsWith("/api/bank/v1/") || pathname.startsWith("/api/v1/")) return NextResponse.next();
  const cookie = request.cookies.get(PASS_COOKIE)?.value;
  if (cookie && cookie === (await passToken(password))) return needsSignIn(request) ?? NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "password_required" }, { status: 401 });
  const url = new URL("/login", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own files and the icons.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)"],
};
