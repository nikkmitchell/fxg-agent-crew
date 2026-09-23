/**
 * One grab's claim on the thing it is moving, so nobody else moves it at once.
 *
 * Nikk: "if somebody's already grabbed it then it's not movable". The server
 * keeps who holds what (server/space/holds.ts); this is the client's half, and
 * both the panels and the Go table use it so the rule is the same everywhere.
 *
 * THE GRAB NEVER WAITS FOR IT. Nikk again: "allow me to change it first and
 * then it should update the server". So `take` starts the request and returns
 * at once; the thing is already moving in your hand. Only if the answer is
 * "somebody else has it" does `refused` fire, and the caller lets go and says
 * who. Any OTHER failure — a dropped connection, the server restarting for a
 * deploy — is ignored: the move carries on, and the save on release is refused
 * anyway if somebody else really had it, because the server checks there too.
 *
 * RENEWED WHILE HELD. A hold on the server expires by itself (TTL_MS there), so
 * a headset taken off mid-drag cannot lock a panel for good. The price is that
 * a long drag has to keep saying "still mine", every RENEW_MS.
 *
 * LET GO AFTER THE SAVE. Released straight away, the release could overtake the
 * save on its way to the server, somebody else could take hold in the gap, and
 * your own drop would then be refused as theirs.
 */

/** Well inside the server's eight-second hold, so one slow request never lets it lapse. */
export const RENEW_MS = 3_000;

/** POST /bff/space/holds — `space.hold` in the app, a fake in the tests. */
export type HoldApi = (thing: string, held: boolean) => Promise<unknown>;

export type GrabHold = {
  /** Claim it, in the background. Call at the moment of the grab. */
  take: () => void;
  /**
   * Let go — after `saved`, when there is a save, has landed either way. Does
   * nothing if the claim was already refused: there is nothing of ours to drop.
   */
  release: (saved?: Promise<unknown>) => void;
};

/** The server saying somebody else is holding it. */
export function isHeldByOther(error: unknown): error is Error & { code: "HELD" } {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "HELD";
}

export function grabHold(deps: {
  /** "panel:<id>" or "item:<id>" — what the server's holds are keyed by. */
  thing: string;
  api: HoldApi;
  /** Somebody else has it: let go, and show this sentence, which names them. */
  refused: (sentence: string) => void;
}): GrabHold {
  /**
   * Which grab is current. An answer to an EARLIER grab can arrive after a new
   * one has begun — press, release, press again inside one round trip — and
   * must not cancel the grab it was never about.
   */
  let grip = 0;
  let holding = false;
  let renew: ReturnType<typeof setInterval> | null = null;
  /** The newest claim in flight, so a release is never sent ahead of it. */
  let asked: Promise<unknown> = Promise.resolve();

  const stop = () => {
    holding = false;
    if (renew !== null) clearInterval(renew);
    renew = null;
  };

  const ask = (mine: number) => {
    asked = deps.api(deps.thing, true).catch((error: unknown) => {
      if (mine !== grip || !holding || !isHeldByOther(error)) return;
      stop();
      deps.refused(error instanceof Error ? error.message : "Somebody else is moving this right now.");
    });
  };

  return {
    take() {
      stop();
      const mine = ++grip;
      holding = true;
      ask(mine);
      renew = setInterval(() => ask(mine), RENEW_MS);
    },
    release(saved) {
      if (!holding) return;
      stop();
      const before = asked;
      void Promise.allSettled([before, saved]).then(() => deps.api(deps.thing, false).catch(() => undefined));
    },
  };
}
