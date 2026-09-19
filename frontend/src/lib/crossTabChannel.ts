export type SyncMessage =
  | { type: "cart-changed" }
  | { type: "wishlist-changed" }
  | { type: "auth-logged-out" };

const CHANNEL_NAME = "samrat-client-sync";

let channel: BroadcastChannel | null = null;

/**
 * Get-or-create the shared channel lazily. Returns null when unsupported
 * (e.g. server-side rendering or older browsers).
 */
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!("BroadcastChannel" in window)) return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Subscribe a listener to the shared channel (no-op when unsupported). */
export function subscribeToSync(listener: (message: SyncMessage) => void): void {
  const bc = getChannel();
  if (bc) {
    bc.addEventListener("message", (event: MessageEvent<SyncMessage>) => listener(event.data));
  }
}

/** Publish a sync message to sibling tabs. Never throws (best-effort sync). */
export function publish(message: SyncMessage): void {
  const bc = getChannel();
  if (!bc) return;
  try {
    bc.postMessage(message);
  } catch {
    // Ignore transient channel failures; cross-tab sync is best-effort.
  }
}