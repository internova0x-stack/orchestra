/** Alexis's opening message (Behaviour Guide, "Opening"), shown before the customer types. */
export const GREETING =
  "Hi, I'm Alexis, the AI support assistant. I'm happy to help, and a member of the team is available any time you'd prefer. What can I look into for you?";

/** Suggested openers on an empty conversation (Design System, "Empty conversation"). */
export const OPENERS = ["Where is my payout?", "A payment to us hasn't arrived", "I need proof of payment"];

/**
 * The greeting and openers in the languages the customer app offers (Nov 23). Alexis replies in the
 * language chosen. English, French and Nigerian Pidgin only (Tomi, Nov 23).
 */
export const GREETINGS: Record<string, string> = {
  en: GREETING,
  fr: "Bonjour, je suis Alexis, l'assistante IA du service client. Je suis là pour vous aider, et un membre de l'équipe est disponible à tout moment si vous le préférez. Que puis-je vérifier pour vous ?",
  pcm: "Hello, na me be Alexis, the AI support assistant. I dey here to help you, and if you prefer, person from our team dey available anytime. Wetin you wan make I check for you?",
};

export const OPENERS_BY_LANGUAGE: Record<string, string[]> = {
  en: OPENERS,
  fr: ["Où en est mon virement ?", "Un paiement attendu n'est pas arrivé", "J'ai besoin d'une preuve de paiement"],
  pcm: ["Where my payout dey?", "Payment wey dem send us never land", "I need proof of payment"],
};

/**
 * Openers by who is chatting (Tomi, Nov 27: they didn't change between a merchant and a personal account): a business
 * account (the ones above), a personal account, and someone who paid a merchant and has no account (a payer).
 */
export type CustomerKind = "business" | "personal" | "payer";
export const OPENERS_BY_KIND: Record<CustomerKind, Record<string, string[]>> = {
  business: OPENERS_BY_LANGUAGE,
  personal: {
    en: ["My card payment failed but I was debited", "I was charged twice", "Where is my transfer?", "Why was my verification rejected?"],
    fr: ["Mon paiement par carte a échoué mais j'ai été débité", "J'ai été débité deux fois", "Où en est mon virement ?", "Pourquoi ma vérification a-t-elle été refusée ?"],
    pcm: ["My card payment fail but dem still remove money", "Dem charge me two times", "Where my transfer dey?", "Why dem reject my verification?"],
  },
  payer: {
    en: ["I paid by transfer but the merchant says nothing arrived", "I was charged but my order failed", "Where is my refund?"],
    fr: ["J'ai payé par virement mais le marchand n'a rien reçu", "J'ai été débité mais ma commande a échoué", "Où en est mon remboursement ?"],
    pcm: ["I don pay with transfer but the merchant talk say e never land", "Dem remove my money but my order fail", "Where my refund dey?"],
  },
};

export function openersFor(kind: CustomerKind, language: string): string[] {
  return OPENERS_BY_KIND[kind][language] ?? OPENERS_BY_KIND[kind].en;
}

export const LANGUAGE_NAMES: [string, string][] = [["en", "English"], ["fr", "Français"], ["pcm", "Naijá (Pidgin)"]];
