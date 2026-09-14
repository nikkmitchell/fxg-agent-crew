import { useCallback, useEffect, useState } from "react";
import { bff } from "./bff-client";
import { viewerFromFailure, type Session, type Viewer } from "./viewer";

export type { Session };

/**
 * Who is signed in, as one of four answers, plus a way to ask again.
 *
 * THIS USED TO RETURN `Session | null` AND SWALLOW EVERY ERROR, with a comment
 * arguing that null "is honest: we do not know who this is". It was honest for
 * the rail, which draws a signed-out mark and moves on. It is not enough for a
 * gate, because a gate has to act on the difference: `anonymous` sends somebody
 * to WebHarness for a password, and doing that because our own server was
 * briefly unreachable asks a signed-in person to fix our problem. The
 * distinction lives in `viewer.ts` so it can be tested without a browser.
 *
 * `recheck` exists because signing in is the one moment the answer is known to
 * have changed, and reloading the page to find out would throw away the tab the
 * person was trying to reach.
 */
export function useViewer(): Viewer & { recheck: () => void } {
  const [viewer, setViewer] = useState<Viewer>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  const recheck = useCallback(() => {
    setViewer({ status: "checking" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // `bff.me()` rather than a fetch of the same URL: one client, one
        // error type, and the response shape comes from shared/contracts.ts
        // instead of a cast written here.
        const body = await bff.me();
        if (!cancelled) setViewer({ status: "signed-in", session: body });
      } catch (error) {
        if (!cancelled) setViewer(viewerFromFailure(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { ...viewer, recheck };
}

/**
 * The old shape, for the places that only want a name and a kind to draw.
 *
 * Kept so the rail and the People panel are not made to care about the
 * difference between "signed out" and "could not tell" — they draw the same
 * thing either way, which is the case the original comment was right about.
 */
export function useSession(): Session | null {
  const viewer = useViewer();
  return viewer.status === "signed-in" ? viewer.session : null;
}
