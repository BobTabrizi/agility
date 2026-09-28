import type { IncomingHttpHeaders } from "http";

/**
 * The header server.ts stamps on every page/API request with the client's IP
 * (always overwriting whatever the client sent), for code that only sees the
 * request — e.g. the room-creation route's rate limit.
 */
export const CLIENT_IP_HEADER = "x-agility-client-ip";

/**
 * The client's IP, for per-IP limits. Our own reverse proxies (as many as
 * TRUSTED_PROXY_HOPS says, e.g. 1 for Caddy) each append the address they
 * received the request from to X-Forwarded-For, so the client is that many
 * entries from the end; anything further left came from the client and can't
 * be trusted. With 0 (the default, and right for local dev) the connection's
 * own address is used and X-Forwarded-For is ignored.
 */
export function clientIp(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string {
  // Read on each call, not at import: server.ts imports this before Next has
  // loaded .env.local.
  const hops = Number(process.env.TRUSTED_PROXY_HOPS || 0);
  if (hops > 0) {
    const forwarded = String(headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const fromProxy = forwarded[forwarded.length - hops];
    if (fromProxy) return fromProxy;
  }
  return remoteAddress ?? "unknown";
}
