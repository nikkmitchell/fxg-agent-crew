import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The options a session STARTS with must be the options it can be changed to.
 *
 * `applyHandOptions` restates every hand and controller option whenever one
 * changes, because `setHand` REPLACES the implementation. The store's initial
 * options are a second copy of that list, and a field left out of the first
 * copy takes the library's default instead of ours. That is what happened with
 * the hand models: they default to off here, `applyHandOptions` said so, and
 * `createXRStore` did not — so on load the settings row read "hidden" while the
 * hands were drawn, and only pressing it twice made the two agree. Nikk: "it
 * says in the UI that hands are hidden on load but they're actually being
 * shown".
 *
 * Asserted on the source because this suite has no WebXR to start a session
 * in, and the failure is a missing line rather than wrong behaviour in a
 * function that could be called.
 */
const source = readFileSync(new URL("./xr-store.ts", import.meta.url), "utf8");
const block = (from: string): string => {
  const at = source.indexOf(from);
  expect(at, `${from} is gone from xr-store.ts`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf("\n}", at));
};

describe("the XR store's hand and controller options", () => {
  it("states the hand model setting for every input source it starts with", () => {
    const created = block("store ??= createXRStore({");
    for (const source of ["hand:", "controller:"]) expect(created).toContain(source);
    // Two hands and two controllers, plus the defaults for each kind.
    expect(created.match(/model: handOptions\.model/g) ?? []).toHaveLength(6);
  });

  it("states it again wherever the options are replaced", () => {
    const applied = block("function applyHandOptions()");
    expect(applied.match(/model: handOptions\.model/g) ?? []).toHaveLength(4);
  });

  it("reads the setting rather than hard-coding it on", () => {
    expect(source).toContain("const handOptions = { model: readHandModels()");
    expect(source).not.toMatch(/const handOptions = \{ model: true/);
  });
});

/**
 * TELEPORT OFF HAS TO MEAN THE TARGET IS NOT THERE.
 *
 * `teleportPointer: false` on both left inputs was supposed to be enough, and I
 * shipped it as the fix for Nikk being thrown across the room. He was thrown
 * three more times on that build, and the log recorded the setting as off while
 * it happened. `TeleportTarget` adds a `pointerup` listener to its group the
 * moment it mounts and moves the player for whatever delivers one; while it is
 * in the tree, "off" is a request rather than a fact.
 *
 * So the scene mounts it only while teleport is really on, and this test is
 * here because the conditional looks like a tidy-up somebody would remove.
 */
const scene = readFileSync(new URL("./Immersive.tsx", import.meta.url), "utf8");

describe("the floor you can teleport onto", () => {
  it("is mounted only while teleport is on", () => {
    expect(scene).toContain("{teleportAllowed ? (");
    expect(scene).toMatch(/teleportAllowed[\s\S]{0,200}<TeleportTarget/);
  });

  it("follows the switch while a session is running, rather than reading it once", () => {
    // Somebody turning teleport on in the headset menu must get a floor without
    // leaving the room to fetch one.
    expect(scene).toContain("watchTeleport(setTeleportAllowed)");
  });

  it("works out where the arc landed from the headset's camera, not the flat view's", () => {
    // The library subtracts R3F's default camera, which inside a session is not
    // the head and is not parented to the origin. Every teleport it computed
    // landed within 12 cm of the room's origin.
    expect(scene).toContain("state.gl.xr.getCamera()");
    expect(scene).toContain("xrCamera.getWorldPosition(scratchHead)");
  });
});
