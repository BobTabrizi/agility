/**
 * Per-key "send now, then at most once per window" throttle, used to group
 * room broadcasts: a lone change goes out immediately, but a burst (everyone
 * voting at once) collapses into one send per window carrying the newest
 * snapshot, instead of one full-room broadcast per change.
 *
 * Snapshots are compared by `version` (see StoredRoom): within a window only
 * the highest version is kept, so a snapshot that arrives late from a
 * concurrent write can't replace a newer one.
 */
export function createVersionedThrottle<T extends { version: number }>(
  windowMs: number,
  send: (key: string, snapshot: T) => void
) {
  // A key is in here while its window is open; `latest` is what to send when
  // the window closes (undefined if nothing new arrived during it).
  const windows = new Map<string, { latest?: T }>();

  function schedule(key: string, snapshot: T) {
    const open = windows.get(key);
    if (open) {
      if (!open.latest || snapshot.version > open.latest.version) open.latest = snapshot;
      return;
    }

    send(key, snapshot);
    const window: { latest?: T } = {};
    windows.set(key, window);
    const timer = setTimeout(() => {
      windows.delete(key);
      // Sending the trailing snapshot opens a new window, so a sustained
      // burst keeps going out at one send per window rather than all at once.
      if (window.latest && window.latest.version > snapshot.version) schedule(key, window.latest);
    }, windowMs);
    timer.unref?.();
  }

  return schedule;
}
