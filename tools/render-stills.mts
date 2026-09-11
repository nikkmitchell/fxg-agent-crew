/**
 * Photograph the real pages, for the headset to hang on a wall.
 *
 * A SEPARATE PROCESS, deliberately. A headless browser on a 1.6GB box is the
 * largest thing running by a wide margin, and the one most likely to leak,
 * hang, or be chosen by the OOM killer. Inside the app it would take the site
 * with it; out here, systemd caps its memory and restarts it and nobody
 * notices. See deploy/fxg-stills.service.
 *
 *   STILLS_TOKEN=... node tools/render-stills.mts
 *
 * It renders NOTHING unless somebody has asked for a still in the last two
 * minutes, and it only launches a browser for the seconds it is actually
 * rendering. An idle box runs no Chrome at all.
 */
import { chromium, type Browser } from "playwright-core";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { STILL_TABS, stillsAreWanted } from "../server/space/stills.js";

const APP = process.env.APP_ORIGIN ?? "http://127.0.0.1:8787";
const ROOT = process.env.STILLS_ROOT ?? "./data/stills";
const TOKEN = process.env.STILLS_TOKEN ?? "";
/** How often to take a fresh set while anybody is looking. */
const EVERY_MS = Number(process.env.STILLS_INTERVAL_MS ?? 15_000);

/**
 * The size the pages are photographed at.
 *
 * A desktop width, so the tabs lay out the way they do on a laptop rather than
 * collapsing into their mobile breakpoint — the same reasoning as the live
 * panels, which are laid out at 1344 CSS pixels and scaled down.
 */
const VIEWPORT = { width: 1344, height: 832 };

if (!TOKEN) {
  console.error("STILLS_TOKEN is not set; the app will refuse to mint a render session. Refusing to start.");
  process.exit(1);
}

/**
 * Ask the app for a session.
 *
 * Fetched fresh on every cycle rather than held: a session outlives this
 * process by days, and a renderer that clung to one would keep working long
 * after the secret was rotated — which is exactly when you want it to stop.
 */
async function renderSession(): Promise<string> {
  const response = await fetch(`${APP}/bff/space/render-session`, {
    method: "POST",
    headers: { "x-stills-token": TOKEN },
  });
  if (!response.ok) {
    throw new Error(`the app refused a render session (${response.status}) — is STILLS_TOKEN the same on both sides?`);
  }
  return ((await response.json()) as { cookie: string }).cookie;
}

/** One pass over every panel. Returns how many were written. */
async function photograph(browser: Browser, cookie: string): Promise<number> {
  const [name, value] = cookie.split("=");
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addCookies([{ name, value, url: APP }]);
  let written = 0;
  try {
    for (const tab of STILL_TABS) {
      const page = await context.newPage();
      try {
        await page.goto(`${APP}/${tab}?embed=1`, { waitUntil: "networkidle", timeout: 20_000 });
        // The pages poll; `networkidle` can fire before the first payload has
        // been painted. A short settle beats photographing a spinner.
        await page.waitForTimeout(600);
        const shot = await page.screenshot({ type: "png" });
        // Written beside the target and renamed, because the app may be reading
        // the file at this instant and a half-written PNG is a broken panel.
        // rename(2) within a directory is atomic.
        const target = resolve(ROOT, `${tab}.png`);
        const temporary = `${target}.tmp`;
        writeFileSync(temporary, shot);
        renameSync(temporary, target);
        written += 1;
      } catch (error) {
        // One bad page must not cost the other two.
        console.error(`could not photograph ${tab}:`, (error as Error).message);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }
  return written;
}

async function main(): Promise<void> {
  mkdirSync(ROOT, { recursive: true });
  console.log(`watching ${ROOT}; rendering every ${EVERY_MS}ms while anybody is looking`);

  for (;;) {
    if (!stillsAreWanted(ROOT)) {
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }

    let browser: Browser | undefined;
    try {
      const cookie = await renderSession();
      // Launched per cycle and closed again. Holding one costs ~200MB on a box
      // with 1.6GB, permanently, for something used in bursts.
      browser = await chromium.launch({
        // playwright-core ships no browser. The server installs one and names
        // it here; on a developer machine CHROME_PATH points at whatever is
        // already installed, so nobody downloads 170MB to change a caption.
        executablePath: process.env.CHROME_PATH || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      const written = await photograph(browser, cookie);
      console.log(`rendered ${written}/${STILL_TABS.length} panels`);
    } catch (error) {
      console.error("render cycle failed:", (error as Error).message);
    } finally {
      await browser?.close().catch(() => {});
    }

    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}

void main();
