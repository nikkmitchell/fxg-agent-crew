import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanJsx, type Tag } from "./jsx-scan";

/**
 * EVERY GRAB HANDLE STEERS AND LETS GO WITHOUT THE WINDOW.
 *
 * A mouse drag is steered by listeners on `window`, because a fast pointer
 * leaves a small handle behind within a few pixels. That is right for a mouse
 * and useless in a headset: a controller never produces a window pointer event
 * at all — it only ever reaches R3F's own handlers. So a handle that took hold
 * in `onPointerDown` and then relied on the window could be picked up in a
 * headset and never moved or put down again.
 *
 * I shipped exactly that on the Go table's grab bar and found it by thinking
 * about why a drag's release arrived twice with a mouse: two roads, and a
 * headset only has one of them. This holds every handle to having both.
 */

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
const has = (tag: Tag, handler: string) => new RegExp(`\\b${handler}\\s*=`).test(tag.attrs);

/** Elements that start a drag: their press handler takes hold of something. */
const grabHandles = (source: string, takes: RegExp) =>
  scanJsx(source).filter((tag) => takes.test(tag.attrs.match(/onPointerDown=\{([^}]*)\}/)?.[1] ?? ""));

describe("grab handles work in a headset", () => {
  const cases = [
    { file: "Movable.tsx", takes: /\btake\(/, what: "panels" },
    { file: "RoomItems.tsx", takes: /\btakeTable\b/, what: "the Go table" },
  ];

  for (const { file, takes, what } of cases) {
    it(`${what}: every handle that takes hold can also steer and let go`, () => {
      const handles = grabHandles(read(file), takes);
      // Found something — an empty list would pass for the wrong reason.
      expect(handles.length, `no grab handles found in ${file}`).toBeGreaterThan(0);
      for (const handle of handles) {
        expect(has(handle, "onPointerMove"), `${file}:${handle.line} <${handle.name}> cannot be steered in a headset`).toBe(true);
        expect(has(handle, "onPointerUp"), `${file}:${handle.line} <${handle.name}> cannot be let go of in a headset`).toBe(true);
      }
    });
  }

  it("the rule catches a handle that only listens to the window", () => {
    const windowOnly = `function T() { return <group><mesh onPointerDown={takeTable} /></group>; }`;
    const handles = grabHandles(windowOnly, /\btakeTable\b/);
    expect(handles).toHaveLength(1);
    expect(has(handles[0], "onPointerMove")).toBe(false);
  });
});
