// Fixed settings for the demo. Everything a business can change lives in the `rules` table instead.

/** Claude Sonnet, as the Build Plan asks: the current Sonnet model id. */
export const MODEL = "claude-sonnet-5-5";

/** Effort for Alexis's turns: multistep tool use, kept quick for the under-10-seconds target. */
export const EFFORT = "medium" as const;

/** Output cap per model call. Replies are short; streaming keeps long ones safe. */
export const MAX_TOKENS = 16000;

/** Safety stop for one customer message: model calls before giving up and escalating. */
export const MAX_STEPS = 10;

/** A verified session expires after this much inactivity (Guardrails). */
export const SESSION_IDLE_MINUTES = 15;

/** The demo's time zone: Lagos (WAT, UTC+1, no daylight saving). */
export const TZ_OFFSET_HOURS = 1;
export const TZ_LABEL = "Lagos time (WAT)";
