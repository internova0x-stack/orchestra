// One shared password for the whole prototype (Tomi, Nov 23), set as SITE_PASSWORD in Vercel. The cookie
// holds a hash of it, never the password, so changing the password signs everyone out.

export const PASS_COOKIE = "orchestra_pass";

export async function passToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`orchestra-site:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only a path on this site: never another site, so the sign-in page can't be used to send people elsewhere. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
