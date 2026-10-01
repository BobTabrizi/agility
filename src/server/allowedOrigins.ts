/**
 * Which websites may open real-time connections, from CORS_ORIGIN: a
 * comma-separated list of origins (e.g. `https://agility.example`), or unset
 * for any — right for local dev, where the page is reached as localhost, a LAN
 * IP, or whatever port. Returns null for "any".
 */
export function allowedOrigins(setting: string | undefined): string[] | null {
  const origins = (setting ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  return origins.length > 0 ? origins : null;
}

/**
 * Whether a connection's Origin header is allowed. Browsers always send
 * Origin on WebSocket and cross-site requests, and a page can't change it, so
 * this is what stops another website from connecting to the server from its
 * visitors' browsers — CORS itself doesn't apply to WebSockets. A request with
 * no Origin isn't from a web page (a script, curl); those could send any
 * Origin they liked anyway, so refusing them would protect nothing.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: string[] | null): boolean {
  if (allowed === null || origin === undefined) return true;
  return allowed.includes(normalizeOrigin(origin));
}

// Origins compare case-insensitively and never end in a slash, but a setting
// might be typed either way.
function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}
