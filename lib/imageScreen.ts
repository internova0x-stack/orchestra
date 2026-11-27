import Anthropic from "@anthropic-ai/sdk";
import type { Sql } from "./db.ts";
import { IMAGE_SCREEN_MODEL } from "./config.ts";
import { Rules } from "./rules.ts";
import { recordUsage } from "./usage.ts";

// Photos of ID documents and payment cards (Tomi, Nov 27: data protection). Before a customer's image reaches Alexis or
// is stored, a small, fast model looks at it once and says only what kind of picture it is. An ID document (passport,
// ID card, driving licence, residence permit) or a payment card is removed: never stored, never shown to Alexis or the
// team. Customers are told to upload documents where the bank asks for them. Rule `block_id_photos` (Data protection).
// If the check itself fails, the image is removed too (it fails closed).

export type ImageKind = "id_document" | "payment_card" | "other";
export type Classify = (img: { media_type: string; data: string }) => Promise<{ kind: ImageKind; usage?: unknown; model?: string }>;

const PROMPT =
  "You check images sent to a bank's support chat. Reply with exactly one word.\n" +
  "ID: the image shows an identity document (passport, national ID card, driving licence, residence permit, visa), front or back, whole or in part.\n" +
  "CARD: it shows a physical or virtual payment card with its number.\n" +
  "OTHER: anything else, including screenshots of a banking app, a statement, a receipt or an error message.";

export const claudeClassify: Classify = async (img) => {
  const msg = await new Anthropic({ maxRetries: 2 }).messages.create({
    model: IMAGE_SCREEN_MODEL,
    max_tokens: 5,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: img.media_type as "image/png", data: img.data } },
      { type: "text", text: PROMPT },
    ] }],
  });
  const word = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim().toUpperCase();
  return { kind: word.startsWith("ID") ? "id_document" : word.startsWith("CARD") ? "payment_card" : "other", usage: msg.usage, model: msg.model };
};

export interface ScreenResult { keep: boolean; kind: ImageKind | "unchecked"; notice?: string }

/** Whether a customer's image may go to Alexis. Off on the Rules screen: every image goes through, as before. */
export async function screenImage(sql: Sql, conversationId: string, img: { media_type: string; data: string }, classify: Classify = claudeClassify): Promise<ScreenResult> {
  const rules = await Rules.load(sql);
  if (!rules.on("block_id_photos")) return { keep: true, kind: "unchecked" };
  try {
    const out = await classify(img);
    if (out.usage) await recordUsage(sql, { conversationId, purpose: "image_screen", model: out.model ?? IMAGE_SCREEN_MODEL, usage: out.usage as never });
    if (out.kind === "other") return { keep: true, kind: "other" };
    return {
      keep: false, kind: out.kind,
      notice: out.kind === "id_document"
        ? "Your photo was removed: it looked like an ID document. For your safety, documents aren't accepted in chat. Upload them where the app asks for them."
        : "Your photo was removed: it looked like a payment card. Never share a photo of your card in chat.",
    };
  } catch (err) {
    console.error("image screen failed", err);
    return { keep: false, kind: "unchecked", notice: "Your photo couldn't be checked, so it wasn't sent. Please describe what it shows instead." };
  }
}
