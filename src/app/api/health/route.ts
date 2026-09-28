import { roomStore } from "@/server/roomStore";
import { healthResponse, runHealthChecks } from "@/server/health";

// Liveness — for whatever restarts the server (the Dockerfile's HEALTHCHECK,
// systemd…). Deliberately shallow: see src/server/health.ts.
export async function GET() {
  return healthResponse(await runHealthChecks({ deep: false, store: roomStore }));
}
