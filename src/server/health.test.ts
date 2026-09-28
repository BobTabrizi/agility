import { afterEach, describe, expect, it, vi } from "vitest";
import { healthResponse, runHealthChecks } from "@/server/health";

const workingStore = { getRoom: vi.fn(async () => undefined) };

describe("runHealthChecks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("liveness: only checks the realtime server, never the database", async () => {
    const store = { getRoom: vi.fn(async () => undefined) };
    expect(await runHealthChecks({ deep: false, store, realtimeReady: true })).toEqual({
      status: "ok",
      checks: { realtime: "ok" },
    });
    expect(store.getRoom).not.toHaveBeenCalled();
  });

  it("fails when Socket.IO isn't attached", async () => {
    const report = await runHealthChecks({ deep: false, store: workingStore, realtimeReady: false });
    expect(report).toEqual({ status: "error", checks: { realtime: "failed" } });
  });

  it("readiness: ok when the database answers", async () => {
    expect(await runHealthChecks({ deep: true, store: workingStore, realtimeReady: true })).toEqual({
      status: "ok",
      checks: { realtime: "ok", database: "ok" },
    });
  });

  it("readiness: fails (and logs why) when the database throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = { getRoom: vi.fn(async () => Promise.reject(new Error("ExpiredTokenException"))) };
    const report = await runHealthChecks({ deep: true, store, realtimeReady: true });
    expect(report).toEqual({ status: "error", checks: { realtime: "ok", database: "failed" } });
    expect(log).toHaveBeenCalledOnce();
  });

  it("readiness: fails when the database doesn't answer in time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = { getRoom: vi.fn(() => new Promise<undefined>(() => {})) }; // never settles
    const report = await runHealthChecks({ deep: true, store, realtimeReady: true, timeoutMs: 20 });
    expect(report.checks.database).toBe("failed");
  });
});

describe("healthResponse", () => {
  it("is 200 when healthy, 503 when not, and never cacheable", async () => {
    const ok = healthResponse({ status: "ok", checks: { realtime: "ok" } });
    const bad = healthResponse({ status: "error", checks: { realtime: "failed" } });
    expect(ok.status).toBe(200);
    expect(bad.status).toBe(503);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(await bad.json()).toEqual({ status: "error", checks: { realtime: "failed" } });
  });
});
