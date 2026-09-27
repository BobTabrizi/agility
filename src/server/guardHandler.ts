/**
 * Catch-all for socket event handlers. Socket.IO calls handlers and ignores
 * what they return, so an async handler that throws (a DynamoDB network blip,
 * throttling that outlasted the SDK's retries, a bug) becomes an unhandled
 * rejection: the action silently doesn't happen, and an event waiting on an
 * ack — room:join — never gets its reply, leaving the client stuck.
 *
 * `guardHandler` wraps a handler so that anything it throws is passed to
 * `onError`, and if the client sent an ack callback the handler hadn't called
 * yet, it's answered with `failedAck` so the client isn't left waiting.
 */

export type AckFailure = { ok: false; error: string };

export interface GuardOptions {
  /**
   * Called with whatever the handler threw. `hadAck`: the client sent an ack
   * callback — it has now had a reply either way (the handler's own, or
   * `failedAck`), so there's no need to tell it about the failure separately.
   */
  onError: (err: unknown, info: { hadAck: boolean }) => void;
  /** Sent to a still-pending ack when the handler fails. */
  failedAck: AckFailure;
}

// Socket.IO handlers take any arguments; the client's ack callback, when it
// sent one, is always the last (payloads are JSON, so never functions).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => unknown;

export function guardHandler<H extends Handler>(handler: H, options: GuardOptions): (...args: Parameters<H>) => Promise<void> {
  return async (...args) => {
    const ack = args[args.length - 1];
    const hadAck = typeof ack === "function";
    let ackPending = hadAck;
    if (hadAck) {
      // Note when the handler answers the ack itself, so a failure after it
      // already replied doesn't send a second, contradictory reply.
      args[args.length - 1] = (...reply: unknown[]) => {
        ackPending = false;
        return (ack as Handler)(...reply);
      };
    }
    try {
      await handler(...args);
    } catch (err) {
      if (ackPending) {
        ackPending = false;
        (ack as Handler)(options.failedAck);
      }
      options.onError(err, { hadAck });
    }
  };
}
