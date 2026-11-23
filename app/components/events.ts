/** Fired by the Reset demo button so every screen reloads its data. */
export const RESET_EVENT = "orchestra:reset";

/** Reset demo also reaches the customer app when it's open in another tab or window. */
export const RESET_CHANNEL = "orchestra-demo";

export function announceReset() {
  window.dispatchEvent(new Event(RESET_EVENT));
  try {
    const ch = new BroadcastChannel(RESET_CHANNEL);
    ch.postMessage("reset");
    ch.close();
  } catch {}
}
