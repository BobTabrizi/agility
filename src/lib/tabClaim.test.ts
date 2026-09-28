import { afterEach, describe, expect, it, vi } from "vitest";
import { createTabClaim, type TabClaim } from "@/lib/tabClaim";

// Node has BroadcastChannel too, and delivers between instances in the same
// process — standing in for two browser tabs here.
describe("createTabClaim", () => {
  const open: TabClaim[] = [];
  function tab(onTakenOver = vi.fn()) {
    const claim = createTabClaim(onTakenOver);
    open.push(claim);
    return { claim, onTakenOver };
  }
  afterEach(() => open.splice(0).forEach((c) => c.close()));

  it("tells the tab holding the claim that a newer tab took over", async () => {
    const first = tab();
    await first.claim.claim();
    const second = tab();
    await second.claim.claim();
    expect(first.onTakenOver).toHaveBeenCalledOnce();
    expect(second.onTakenOver).not.toHaveBeenCalled();
  });

  it("finishes claiming as soon as the previous tab lets go, not after the timeout", async () => {
    const first = tab();
    await first.claim.claim();
    const second = tab();
    const started = Date.now();
    await second.claim.claim();
    expect(Date.now() - started).toBeLessThan(200); // the timeout is 250ms
  });

  it("lets a tab that was taken over take it back", async () => {
    const first = tab();
    const second = tab();
    await first.claim.claim();
    await second.claim.claim();
    await first.claim.claim();
    expect(second.onTakenOver).toHaveBeenCalledOnce();
    expect(first.onTakenOver).toHaveBeenCalledOnce();
  });

  it("doesn't bother a tab that isn't holding the claim", async () => {
    const first = tab();
    await first.claim.claim();
    const second = tab();
    await second.claim.claim(); // first is taken over here…
    const third = tab();
    await third.claim.claim(); // …so only second is told about this one
    expect(first.onTakenOver).toHaveBeenCalledOnce();
    expect(second.onTakenOver).toHaveBeenCalledOnce();
  });

  it("ignores a tab that has closed", async () => {
    const first = tab();
    await first.claim.claim();
    first.claim.close();
    await tab().claim.claim();
    expect(first.onTakenOver).not.toHaveBeenCalled();
  });
});
