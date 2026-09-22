/** Real mesh-click regression against the LOOPBACK, in-memory Go fixture only. */
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { goBowl, goDeckWidth, goPoint, goWorld, GO_SURFACE } from "../shared/go-layout.js";
import type { GoRoomItem } from "../shared/room-items.js";

const origin = process.argv[2] ?? "http://127.0.0.1:5179";
if (new URL(origin).hostname !== "127.0.0.1") throw new Error("Local in-memory harness only");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await mkdir("output/playwright", { recursive: true });
try {
  await page.request.get(`${origin}/dev/as/nikk`);
  await page.goto(`${origin}/tools/go-preview.html`);
  const read = async (): Promise<GoRoomItem> => page.evaluate(async () => (await (await fetch("/bff/space/items")).json()).items[0]);
  const configure = async (body: object) => {
    const item = await read();
    const status = await page.evaluate(async ({ id, body }) => (await fetch(`/bff/space/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, { id: item.id, body });
    assert.equal(status, 200); await page.waitForTimeout(350);
  };
  await page.waitForFunction(() => typeof (window as any).goPreviewProject === "function");
  await configure({ size: 5 });
  await configure({ size: 9, position: { x: -1.15, y: 0, z: 1.8, rotationY: 0 }, scale: 1 });
  await page.waitForTimeout(1500);
  const clickLocal = async (point: { x: number; y: number; z: number }) => {
    const world = goWorld(point, await read());
    const [x, y] = await page.evaluate((p) => (window as any).goPreviewProject([p.x, p.y, p.z]), world);
    assert(x > 0 && x < 1440 && y > 0 && y < 1050, "target must be visible");
    await page.mouse.click(x, y); await page.waitForTimeout(500);
  };
  for (const [x, y] of [[4, 3], [4, 4], [3, 4], [8, 8], [4, 5], [8, 7], [5, 4]]) {
    const before = await read();
    await clickLocal({ ...goBowl(before.activeColour, before.colours.length, before.size), y: GO_SURFACE });
    const lifted = await read(); assert.equal(lifted.liftedColour, before.activeColour, "mesh bowl click lifts");
    if (before.stones.length === 0) await page.screenshot({ path: "output/playwright/go-9-lifted-final.png" });
    await clickLocal({ x: goPoint(x, before.size), y: GO_SURFACE + 0.003, z: goPoint(y, before.size) });
    const placed = await read();
    assert.equal(placed.liftedColour, null, "mesh intersection click places");
    assert.equal(placed.activeColour, (before.activeColour + 1) % 2);
    assert(placed.stones.some((s) => s.x === x && s.y === y && s.colour === before.activeColour));
  }
  const captured = await read();
  assert.equal(captured.captures.length, 1); assert.equal(captured.captures[0].by, 0);
  assert(!captured.stones.some((s) => s.x === 4 && s.y === 4));
  await page.screenshot({ path: "output/playwright/go-capture-final.png" });
  const signature = JSON.stringify({ stones: captured.stones, captures: captured.captures, activeColour: captured.activeColour });
  const edge = goDeckWidth(captured.size, captured.colours.length) / 2;
  await clickLocal({ x: 0, y: 0.754, z: -edge + 0.09 });
  // The dock is rotated60 degrees aroundX, with buttons on its localXZ plane.
  const dock = (x: number, z: number) => ({ x, y: 0.59 - Math.sin(Math.PI / 3) * z, z: edge + 0.11 + Math.cos(Math.PI / 3) * z });
  for (const [axis, x, z] of [["x", -0.14, -0.09], ["y", 0.42, -0.09], ["z", -0.14, 0.055]] as const) {
    const before = await read(); await clickLocal(dock(x, z)); const after = await read();
    assert(Math.abs(after.position[axis] - before.position[axis] - 0.1) < 1e-8, `${axis} button moves10cm`);
  }
  await clickLocal(dock(0.42, 0.055)); assert.equal((await read()).scale, 1.1);
  await clickLocal(dock(0.14, 0.055)); assert.equal((await read()).scale, 1);
  const moved = await read();
  assert.equal(JSON.stringify({ stones: moved.stones, captures: moved.captures, activeColour: moved.activeColour }), signature);
  await page.screenshot({ path: "output/playwright/go-transform-final.png" });
  await page.reload(); await page.waitForTimeout(1000);
  assert.equal((await read()).position.y, 0.1, "transform survives reload");
  await configure({ position: { x: -1.15, y: 0, z: 1.8, rotationY: 0 } });
  for (const size of [5, 9, 19, 25]) {
    await page.getByRole("button", { name: `${size}×${size}`, exact: true }).click();
    await page.waitForTimeout(600); assert.equal((await read()).size, size);
    await page.screenshot({ path: `output/playwright/go-${size}-final.png` });
  }
  await page.getByRole("button", { name: "Motion on", exact: true }).click();
  await page.screenshot({ path: "output/playwright/go-reduced-final.png" });
  assert.deepEqual(errors, [], "no browser errors");
  console.log("PASS: real mesh lift/place, seven-move capture, XYZ + scale, game preservation, reload,5/9/19/25 and reduced motion");
} finally { await browser.close(); }
