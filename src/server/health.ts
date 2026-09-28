import type { RoomStore } from "@/server/roomStore";

/**
 * Health checks, served by two routes:
 *
 * - GET /api/health — liveness: is this process up and wired together? For
 *   whatever restarts the server (Docker's HEALTHCHECK, systemd…), so it only
 *   checks things a restart can fix: that Socket.IO is attached. It never
 *   touches the database — restarting because DynamoDB had a bad minute would
 *   just disconnect everyone for nothing.
 * - GET /api/health/ready — readiness: can this server actually do its job?
 *   Also does one tiny database read. For an uptime monitor to alert on, not
 *   to restart on.
 *
 * Responses say only which check failed (e.g. `"database": "failed"`), never
 * why: they're public. The actual error goes to the server log.
 */

export type CheckStatus = "ok" | "failed";

export interface HealthReport {
  status: "ok" | "error";
  checks: Record<string, CheckStatus>;
}

// Set by initSocketServer once Socket.IO is attached. On globalThis because
// API routes are bundled separately from server.ts's module graph, so they'd
// see a different copy of any module-level variable.
declare global {
  var __agilityRealtimeReady: boolean | undefined;
}

export function markRealtimeReady() {
  globalThis.__agilityRealtimeReady = true;
}

// A room code that can never exist (real ones are 6 characters): reading it
// exercises credentials, network and table without touching real data.
const PROBE_ROOM_CODE = "HEALTHCHECK";
// Long enough for a slow cross-region hop, short enough for a monitor's timeout.
const DATABASE_TIMEOUT_MS = 3_000;

export async function runHealthChecks(options: {
  deep: boolean;
  store: Pick<RoomStore, "getRoom">;
  realtimeReady?: boolean;
  timeoutMs?: number;
}): Promise<HealthReport> {
  const { deep, store, realtimeReady = globalThis.__agilityRealtimeReady === true, timeoutMs = DATABASE_TIMEOUT_MS } =
    options;
  const checks: Record<string, CheckStatus> = { realtime: realtimeReady ? "ok" : "failed" };
  if (deep) checks.database = await checkDatabase(store, timeoutMs);
  const healthy = Object.values(checks).every((c) => c === "ok");
  return { status: healthy ? "ok" : "error", checks };
}

async function checkDatabase(store: Pick<RoomStore, "getRoom">, timeoutMs: number): Promise<CheckStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      store.getRoom(PROBE_ROOM_CODE),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no response within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return "ok";
  } catch (err) {
    console.error("[health] database check failed", err);
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

/** The HTTP response for a report: 503 when unhealthy (what monitors look at), and never cached. */
export function healthResponse(report: HealthReport): Response {
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
