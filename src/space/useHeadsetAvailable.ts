import { useEffect, useState } from "react";

/**
 * Is there a headset to enter?
 *
 * ASKED, NOT ASSUMED: a browser with no WebXR has no `navigator.xr` at all, and
 * an Enter button that can only fail is worse than no button — "nothing
 * happened" is the least debuggable outcome there is.
 *
 * LIFTED OUT OF SpacePanel because the home page needs the same answer. The
 * front door offers a headset when there is one and offers the window when
 * there is not, and the room panel makes the same decision about its own
 * button. Two copies of this would be two answers that can disagree, which is
 * precisely the bug shape this codebase has been removing all week: one copy of
 * the facing formula, one copy of the overlap maths, one copy of the room
 * bound. This is the same rule applied to a question rather than a number.
 *
 * WHAT MAKES IT MORE THAN A ONE-LINER, and none of it is guesswork:
 *
 *   - IT KEEPS ASKING FOR A FULL MINUTE. On a Quest, `isSessionSupported` took
 *     about twenty seconds to answer yes. The button turned up long after the
 *     page looked settled, and before that it could have been missed entirely.
 *   - IT ONLY EVER PROMOTES TO YES. A later "no" would take the button away
 *     from somebody already holding a controller.
 *   - IT SETTLES ON "NO" AFTER FIVE SECONDS rather than staying unknown, so the
 *     page can say something definite instead of rendering neither the button
 *     nor the explanation. The later probes can still promote it.
 *
 * `null` means not yet known, and callers must render a third thing for it —
 * showing "no headset" while the answer is still coming is how a Quest user
 * ends up believing there is no immersive mode.
 */
export function useHeadsetAvailable(reprobeWhen: unknown = null): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    const check = async () => {
      const supported = await headsetSupported();
      if (!cancelled && supported) setAvailable(true);
    };
    void check();

    for (const delay of PROBE_DELAYS) {
      timers.push(window.setTimeout(() => void check(), delay));
    }
    timers.push(
      window.setTimeout(() => {
        if (!cancelled) setAvailable((current) => current ?? false);
      }, SETTLE_MS),
    );

    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
    // The caller passes whatever should restart the probing. In the room that
    // is `entered`, because entering loads the chunk that can conjure an
    // emulated device on localhost.
  }, [reprobeWhen]);

  return available;
}

/** When to ask again, in milliseconds. Spread across a minute — see above. */
export const PROBE_DELAYS = [1_000, 3_000, 6_000, 10_000, 15_000, 22_000, 30_000, 45_000, 60_000];

/** When to stop saying "not sure yet" and say "no" for now. */
export const SETTLE_MS = 5_000;

/**
 * One probe. Exported so it can be tested without a React tree, and so
 * anything that needs the answer once — rather than as it changes — can ask.
 */
export async function headsetSupported(
  scope: { xr?: { isSessionSupported(mode: string): Promise<boolean> } } = navigator as never,
): Promise<boolean> {
  const xrSystem = scope?.xr;
  if (!xrSystem) return false;
  try {
    return await xrSystem.isSessionSupported("immersive-vr");
  } catch {
    // A browser that throws here has no usable session either. Treated as a
    // no rather than allowed to escape: this runs in an effect, and an
    // unhandled rejection would take the page's error boundary with it.
    return false;
  }
}
