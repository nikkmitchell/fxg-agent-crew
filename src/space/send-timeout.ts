/**
 * A SEND THAT CANNOT HANG. Nikk, 2026-09-26, in the headset: "there is a bug
 * in your audio send ... I am stuck on ... ready to send". The talk button
 * shows "…" while a send is in flight, and the send awaited a fetch with no
 * deadline: one request that never came back left the button on "…" for good,
 * with nothing to press but the headset's own exit.
 *
 * So every part of a send runs under a deadline, and under the sender's own
 * abort (✕ while sending). Either one ends it with an error the caller already
 * knows how to report, part by part.
 */

/** Long enough for a slow network and a long transcript, short enough to wait for. A headset held chat posts ~22 s before sending them (2026-09-26), so 20 s reported arrivals as failures. */
export const SEND_DEADLINE_MS = 30_000;

export class SendTimedOut extends Error {
  constructor() {
    super("timed out");
  }
}

export class SendStopped extends Error {
  constructor() {
    super("stopped");
  }
}

/**
 * Run `send` with a signal that fires on the deadline or when `stop` fires,
 * and reject straight away when either happens, whether or not `send` honours
 * its signal.
 */
export function withDeadline<T>(
  send: (signal: AbortSignal) => Promise<T>,
  stop: AbortSignal,
  ms: number = SEND_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const finish = (error: Error) => {
      clearTimeout(timer);
      stop.removeEventListener("abort", onStop);
      controller.abort();
      reject(error);
    };
    const onStop = () => finish(new SendStopped());
    const timer = setTimeout(() => finish(new SendTimedOut()), ms);
    if (stop.aborted) return onStop();
    stop.addEventListener("abort", onStop);
    send(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        stop.removeEventListener("abort", onStop);
        resolve(value);
      },
      (error) => finish(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
