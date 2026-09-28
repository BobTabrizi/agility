import { roomStore } from "@/server/roomStore";
import { healthResponse, runHealthChecks } from "@/server/health";

// Readiness — liveness plus one tiny database read. Point an uptime monitor
// here (alert on it; don't restart on it): see src/server/health.ts.
export async function GET() {
  return healthResponse(await runHealthChecks({ deep: true, store: roomStore }));
}
