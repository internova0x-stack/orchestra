// Display helpers shared by the tools and the screens.

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", NGN: "₦" };

/** "$4,200.00": currency symbol in front, two decimal places. */
export function money(amount: number | string, currency: string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  const s = n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = SYMBOL[currency];
  return sym ? `${sym}${s}` : `${s} ${currency}`;
}

/** Account and card numbers are masked to the last 4 characters before they reach the model or a screen. */
export function maskAccount(account: string): string {
  const clean = account.replace(/\s+/g, "");
  return `•••• ${clean.slice(-4)}`;
}

/** Title case for a stored status: "processing" -> "Processing". */
export function statusLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Parse an amount typed by a person: "$4,200", "4200.00", "₦1,200,000". */
export function parseAmount(s: string): number | null {
  const m = s.replace(/[,\s]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
