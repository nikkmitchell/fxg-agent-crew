import { describe, expect, it } from "vitest";
import { PROBE_DELAYS, SETTLE_MS, headsetSupported } from "./useHeadsetAvailable";

/**
 * The probe itself, without a React tree.
 *
 * The hook around it is timers and state and is not worth faking a DOM for;
 * what IS worth pinning is that a browser with no WebXR, and a browser whose
 * WebXR throws, both come back as a plain "no" rather than as an exception.
 * This runs inside an effect, so an escaping rejection would take the page's
 * error boundary with it — the whole front door, over a capability check.
 */
describe("asking whether there is a headset", () => {
  it("says no when the browser has no WebXR at all", async () => {
    expect(await headsetSupported({})).toBe(false);
  });

  it("says yes when the browser says the session is supported", async () => {
    expect(await headsetSupported({ xr: { isSessionSupported: async () => true } })).toBe(true);
  });

  it("asks specifically about an immersive session, not any session", async () => {
    let asked: string | null = null;
    await headsetSupported({
      xr: {
        isSessionSupported: async (mode: string) => {
          asked = mode;
          return true;
        },
      },
    });
    expect(asked).toBe("immersive-vr");
  });

  it("says no rather than throwing when the browser's own check throws", async () => {
    const throws = {
      xr: {
        isSessionSupported: async () => {
          throw new Error("SecurityError");
        },
      },
    };
    await expect(headsetSupported(throws)).resolves.toBe(false);
  });

  it("keeps asking for a full minute, because a Quest took twenty seconds", () => {
    // Measured, not guessed: on a Quest the answer arrived about twenty
    // seconds after load, long after the page looked settled. Three probes in
    // four seconds would have missed it entirely.
    expect(Math.max(...PROBE_DELAYS)).toBeGreaterThanOrEqual(60_000);
    expect(PROBE_DELAYS.some((delay) => delay > 20_000)).toBe(true);
    // And it settles on an answer long before it stops asking, so the page can
    // say something definite while the slow yes is still on its way.
    expect(SETTLE_MS).toBeLessThan(Math.max(...PROBE_DELAYS));
  });
});
