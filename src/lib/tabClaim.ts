/**
 * One connected room tab per browser. Every tab showing a room "claims" the
 * browser when it opens; whichever tab held it before is told it was taken
 * over, disconnects, and says so once it has — so the newest tab wins, and the
 * browser never holds more than one room connection. (A private window has
 * its own storage and can't hear this channel, so it counts separately.)
 *
 * Waiting for that "released" reply before connecting matters when both tabs
 * are in the same room: the old tab's disconnect then reaches the server
 * before the new tab's join, so the server can't process them the other way
 * round and mark the person Away while they're actually there.
 */

const CHANNEL_NAME = "agility-room-tab";
// How long a new tab waits for a previous one to let go. With no other tab
// open nobody replies, so this is also the delay before connecting then.
const RELEASE_WAIT_MS = 250;

type Message = { type: "claim"; from: string } | { type: "released"; from: string; to: string };

export interface TabClaim {
  /** Takes over from any other tab; resolves once it has let go (or nobody answered in time). */
  claim(): Promise<void>;
  /** Stops taking part (e.g. when leaving the room page). */
  close(): void;
}

export function createTabClaim(onTakenOver: () => void): TabClaim {
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  // Missing only in very old browsers — then every tab just connects, as before.
  let channel: BroadcastChannel | null = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  let holding = false;
  let onReleased: (() => void) | null = null;

  channel?.addEventListener("message", (event: MessageEvent<Message>) => {
    const message = event.data;
    if (message.type === "claim" && message.from !== id && holding) {
      holding = false;
      onTakenOver();
      channel?.postMessage({ type: "released", from: id, to: message.from } satisfies Message);
    } else if (message.type === "released" && message.to === id) {
      onReleased?.();
    }
  });

  return {
    claim() {
      holding = true;
      if (!channel) return Promise.resolve();
      channel.postMessage({ type: "claim", from: id } satisfies Message);
      return new Promise<void>((resolve) => {
        const timer = setTimeout(done, RELEASE_WAIT_MS);
        function done() {
          clearTimeout(timer);
          onReleased = null;
          resolve();
        }
        onReleased = done;
      });
    },
    close() {
      holding = false;
      onReleased = null;
      channel?.close();
      channel = null;
    },
  };
}
