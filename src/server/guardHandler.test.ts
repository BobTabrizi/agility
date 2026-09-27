import { describe, expect, it, vi } from "vitest";
import { guardHandler, type GuardOptions } from "@/server/guardHandler";

const failedAck = { ok: false as const, error: "Something went wrong" };

function setup() {
  const onError = vi.fn<GuardOptions["onError"]>();
  return { onError, options: { onError, failedAck } };
}

describe("guardHandler", () => {
  it("passes arguments through and stays quiet when the handler succeeds", async () => {
    const { onError, options } = setup();
    const handler = vi.fn(async (payload: { value: number }) => {
      expect(payload).toEqual({ value: 1 });
    });
    await guardHandler(handler, options)({ value: 1 });
    expect(handler).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("forwards the handler's own ack reply", async () => {
    const { onError, options } = setup();
    const ack = vi.fn();
    await guardHandler(async (_payload: unknown, reply: (r: unknown) => void) => reply({ ok: true }), options)({}, ack);
    expect(ack).toHaveBeenCalledExactlyOnceWith({ ok: true });
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a failure without an ack (fire-and-forget events)", async () => {
    const { onError, options } = setup();
    const boom = new Error("DynamoDB unavailable");
    const handler: (payload: { value: number }) => Promise<void> = async () => {
      throw boom;
    };
    await guardHandler(handler, options)({ value: 1 });
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom, { hadAck: false });
  });

  it("answers a pending ack when the handler fails before replying", async () => {
    const { onError, options } = setup();
    const ack = vi.fn();
    const boom = new Error("network blip");
    const handler: (payload: unknown, reply: (r: unknown) => void) => Promise<void> = async () => {
      throw boom;
    };
    await guardHandler(handler, options)({}, ack);
    expect(ack).toHaveBeenCalledExactlyOnceWith(failedAck);
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom, { hadAck: true });
  });

  it("doesn't send a second reply when the handler fails after acking", async () => {
    const { onError, options } = setup();
    const ack = vi.fn();
    await guardHandler(async (_payload: unknown, reply: (r: unknown) => void) => {
      reply({ ok: true });
      throw new Error("broadcast failed");
    }, options)({}, ack);
    expect(ack).toHaveBeenCalledExactlyOnceWith({ ok: true });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("catches synchronous throws too", async () => {
    const { onError, options } = setup();
    await guardHandler(() => {
      throw new Error("bug");
    }, options)();
    expect(onError).toHaveBeenCalledOnce();
  });
});
