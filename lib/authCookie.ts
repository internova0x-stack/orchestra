import { SESSION_COOKIE } from "./auth.ts";

/** The session cookie: httpOnly (scripts can't read it), Secure on https, sent only to this site. */
export function sessionCookie(token: string, req: Request, maxAgeSeconds = 7 * 86_400) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}
export const clearCookie = (req: Request) => sessionCookie("", req, 0);
