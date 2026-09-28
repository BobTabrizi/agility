import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "@/server/clientIp";

describe("clientIp", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the connection's address and ignores X-Forwarded-For by default", () => {
    expect(clientIp({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.5")).toBe("10.0.0.5");
  });

  it("behind one trusted proxy, takes the entry that proxy added (the last)", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    // "6.6.6.6" was sent by the client itself; "203.0.113.7" is what the proxy saw.
    expect(clientIp({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }, "127.0.0.1")).toBe("203.0.113.7");
  });

  it("counts back one entry per trusted proxy", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIp({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 172.16.0.2" }, "127.0.0.1")).toBe("203.0.113.7");
  });

  it("falls back to the connection's address if the header is missing", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIp({}, "10.0.0.5")).toBe("10.0.0.5");
  });
});
