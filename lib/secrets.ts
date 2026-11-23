// Secrets a customer types are masked before Alexis sees the message and before it is stored
// (Guardrails: "If a customer sends a secret anyway"). Alexis is told what kind of secret was
// removed, so it can say not to share it and to change it, but it never has the value to repeat.

export type SecretKind = "API key" | "card number" | "PIN" | "one-time code" | "password" | "CVV";

const placeholder = (kind: SecretKind) => `[${kind} removed by the app]`;

/** Luhn check, so ordinary long numbers (references, amounts) aren't mistaken for card numbers. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const LABELLED: { kind: SecretKind; re: RegExp }[] = [
  { kind: "PIN", re: /\b(pin(?:\s*(?:number|code))?)(\s*(?:is|:|=|-)?\s*)(\d{4,6})\b/gi },
  { kind: "one-time code", re: /\b(otp|one[-\s]?time\s*(?:pass)?code|verification\s*code|security\s*code|code)(\s*(?:is|:|=|-)?\s*)(\d{4,8})\b/gi },
  { kind: "CVV", re: /\b(cvv2?|cvc2?|security\s*number)(\s*(?:is|:|=|-)?\s*)(\d{3,4})\b/gi },
  { kind: "password", re: /\b(password|passcode|passphrase)(\s*(?:is|:|=|-)\s*|\s+)(\S{4,})/gi },
];

export function maskSecrets(text: string): { text: string; found: SecretKind[] } {
  const found = new Set<SecretKind>();
  let out = text;

  // API keys and similar credentials: sk_live_..., sk-ant-..., pk_live_..., long "key: ..." values.
  out = out.replace(/\b(?:sk|rk|pk)[-_](?:live|test|ant)[-_][A-Za-z0-9_\-]{6,}/gi, () => {
    found.add("API key");
    return placeholder("API key");
  });
  out = out.replace(/\b((?:api|secret|access)[\s_-]*(?:key|token|secret)\s*(?:is|:|=)?\s*)([A-Za-z0-9_\-]{16,})/gi, (_m, label: string) => {
    found.add("API key");
    return `${label}${placeholder("API key")}`;
  });

  // Full card numbers: 13 to 19 digits, spaces or dashes allowed, passing the Luhn check.
  out = out.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      found.add("card number");
      return placeholder("card number");
    }
    return m;
  });

  for (const { kind, re } of LABELLED) {
    out = out.replace(re, (_m, label: string, sep: string) => {
      found.add(kind);
      return `${label}${sep}${placeholder(kind)}`;
    });
  }
  return { text: out, found: [...found] };
}
