import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Build assets and browser BFF calls beneath the same path Wilson mounts.
  // `/` preserves standalone behavior; `/space` produces `/space/...` URLs.
  base: `${(process.env.APP_BASE_PATH || "/").replace(/\/$/, "")}/`,
  plugins: [react()],
  /**
   * A SUITE THAT REPORTS THE CODE, NOT THE LOAD ON THE LAPTOP.
   *
   * With no config vitest takes a worker per core — eleven here — and many of
   * these tests boot a Fastify server each. On a laptop that is also running
   * two agents and a dev build, they queue, and tests start losing vitest's
   * FIVE SECOND default deadline. They then fail in a set that changes every
   * run: space-speech's warm tests one time, room-voice, space-showing and
   * transcribe-api the next, all at 5.3 to 5.8 seconds, none of them for a
   * reason in the code. Every one passes alone and at --maxWorkers=2.
   *
   * THIS IS NOT COSMETIC. release.sh runs the suite before it ships, so a
   * loaded machine refused a real deploy tonight — "tests failed; nothing was
   * deployed" — which is a correct refusal on a false premise, while Nikk sat
   * in a headset waiting for the fix. And a suite that cries wolf teaches
   * everyone here to re-run instead of read, which is how a real failure gets
   * waved through.
   *
   * Bounded rather than loosened: four workers is the fix, because the fault is
   * oversubscription and not a deadline that is too strict. The timeout goes to
   * fifteen seconds only because booting a server legitimately takes longer
   * than five on a busy machine — a genuine hang still fails, just not at the
   * moment somebody else starts a build.
   */
  test: {
    maxWorkers: 4,
    testTimeout: 15_000,
    // node:sqlite prints an ExperimentalWarning from every worker: forty-odd
    // identical lines a run, which buried any warning that meant something.
    execArgv: ["--disable-warning=ExperimentalWarning"],
  },
});
