import { NextResponse, type NextRequest } from "next/server";
import { PASS_COOKIE, passToken } from "./lib/sitePassword";

// The whole site (console and customer app) asks for the shared password once per device, when
// SITE_PASSWORD is set in Vercel. Without it the site stays open (a local copy, or before it's set).
// Console screens need a signed-in member of the team (lib/auth.ts); without the session cookie they go straight to
// the sign-in page. The cookie itself is checked on the server by every console request.
const CONSOLE_PAGES = ["/", "/messages", "/cases", "/staff", "/rules", "/dashboard", "/billing", "/developers", "/team", "/account", "/try-widget"];

// The website chat's frame (/w/{key}) may be shown only inside the widget's listed websites (and Orchestra's own
// try-it page): browsers refuse it anywhere else. The list comes from the widget's settings, cached for 30 seconds.
const frameCache = new Map<string, { at: number; value: string }>();
async function frameAncestors(request: NextRequest, key: string): Promise<string> {
  const hit = frameCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  let origins: string[] = [];
  try {
    const r = await fetch(new URL(`/api/w/${encodeURIComponent(key)}/frame`, request.url), { cache: "no-store" });
    if (r.ok) origins = ((await r.json()) as { origins?: string[] }).origins ?? [];
  } catch {}
  const value = ["'self'", ...origins.filter((o) => /^https?:\/\/[a-z0-9.\-:]+$/i.test(o))].join(" ");
  frameCache.set(key, { at: Date.now(), value });
  return value;
}

async function widgetFrame(request: NextRequest): Promise<NextResponse> {
  const key = request.nextUrl.pathname.split("/")[2] ?? "";
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", `frame-ancestors ${await frameAncestors(request, key)}`);
  return res;
}

function needsSignIn(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  if (!CONSOLE_PAGES.includes(pathname) || request.cookies.get("orc_session")?.value) return null;
  const url = new URL("/signin", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  // The website chat widget is public: its frame, its script and its routes check the widget's own key.
  if (request.nextUrl.pathname.startsWith("/w/")) return widgetFrame(request);
  if (request.nextUrl.pathname.startsWith("/api/w/") || request.nextUrl.pathname === "/widget.js") return NextResponse.next();
  const password = process.env.SITE_PASSWORD;
  if (!password) return needsSignIn(request) ?? NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  // The integration APIs check their own API keys (banks and systems have no browser cookie).
  if (pathname.startsWith("/api/bank/v1/") || pathname.startsWith("/api/v1/")) return NextResponse.next();
  // The private form page a customer opens from an email (it checks its own link token).
  if (pathname.startsWith("/e/") || pathname.startsWith("/api/e/")) return NextResponse.next();
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
