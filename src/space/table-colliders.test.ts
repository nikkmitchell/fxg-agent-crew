import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanJsx } from "./jsx-scan";

/**
 * NOTHING ON THE GO TABLE CATCHES A POINTER UNLESS IT DOES SOMETHING.
 *
 * Nikk, in a headset: "there seems to be loads of colliders all over the model,
 * seems to be in weird places and it's kind of confusing for me, like if my
 * hand is above the board it just hits colliders and the pointer is blocked".
 *
 * WHY IT HAPPENED, which is not obvious from reading the component. R3F only
 * raycasts objects that carry a handler — but it raycasts them RECURSIVELY
 * (`intersectObject(obj, true)` in @react-three/fiber's events module). The
 * room wraps every table in a group whose `onPointerDown` claims the pointer
 * and stops it, so every mesh inside every table became a target: the desk,
 * the legs, the board's rim, the playing surface. None of them does anything
 * when pressed. All of them stopped the ray, so a hand held over the board,
 * pointing at a panel behind it, pointed at the table instead.
 *
 * THE RULE, checked on the source rather than on pixels: every mesh-like
 * element in RoomItems.tsx either
 *
 *   - carries a pointer handler itself, or sits inside an element that does —
 *     it is part of something you can press: a bowl, an intersection, the
 *     return-stone button, MOVE and the settings; or
 *   - says `raycast={...}` — somebody decided, in writing, that it takes no rays.
 *
 * A new piece of decoration added without either fails here, which is the
 * point: nobody has to remember that a group handler reaches its children.
 */

const SOURCE = fileURLToPath(new URL("./RoomItems.tsx", import.meta.url));
const MESH_LIKE = new Set(["mesh", "RoundedBox", "instancedMesh", "Text"]);
const HANDLER = /\bon(Click|PointerDown|PointerUp|PointerMove|PointerOver)\s*=/;

type Offender = { tag: string; line: number };

export function blockersIn(source: string): Offender[] {
  return scanJsx(source)
    .filter((tag) => MESH_LIKE.has(tag.name))
    .filter((tag) => !/\braycast\s*=/.test(tag.attrs))
    .filter((tag) => !HANDLER.test(tag.attrs) && !tag.parents.some((parent) => HANDLER.test(parent.attrs)))
    .map((tag) => ({ tag: tag.name, line: tag.line }));
}

describe("colliders on the Go table", () => {
  it("has nothing that stops a pointer without doing anything", () => {
    const offenders = blockersIn(readFileSync(SOURCE, "utf8"));
    expect(offenders, offenders.map((o) => `<${o.tag}> at RoomItems.tsx:${o.line}`).join("\n")).toEqual([]);
    expect(blockersIn(readFileSync(new URL("./RockForm.tsx", import.meta.url), "utf8"))).toEqual([]);
  });

  it("actually reads the table — so an empty answer means clean, not blind", () => {
    const tags = scanJsx(readFileSync(SOURCE, "utf8"));
    // Enough of the file to be meaningful, and the specific things we know are there.
    expect(tags.filter((t) => MESH_LIKE.has(t.name)).length).toBeGreaterThan(20);
    // The glowing points are light only; the board-wide catcher under them
    // takes the press and snaps it (go-snap.ts).
    expect(tags.some((t) => t.name === "instancedMesh" && /raycast=\{noRaycast\}/.test(t.attrs) && !HANDLER.test(t.attrs))).toBe(true);
    expect(tags.some((t) => t.name === "mesh" && /onClick=/.test(t.attrs) && /onPointerMove=/.test(t.attrs))).toBe(true);
    expect(tags.some((t) => /onPointerDown=\{takeTable\}/.test(t.attrs))).toBe(true);
  });

  it("follows fragments, which is the first thing it tripped on", () => {
    expect(scanJsx(`function A() { return <><mesh /></>; }`).map((t) => t.name)).toEqual(["", "mesh"]);
  });

  it("refuses a file it cannot follow instead of guessing", () => {
    expect(() => scanJsx(`function A() { return <group><mesh></group>; }`)).toThrow(/closes/);
    expect(() => scanJsx(`function A() { return <group><mesh />; }`)).toThrow(/left open/);
  });

  it("is not fooled by generics, comparisons or arrows", () => {
    const tricky = `
      const r = useRef<THREE.Mesh>(null);
      const ok = a < b && c > d;
      function T() { return <group onClick={() => x > 1}><mesh /></group>; }`;
    expect(scanJsx(tricky).map((t) => t.name)).toEqual(["group", "mesh"]);
  });

  describe("the rule itself", () => {
    const wrap = (body: string) => `function GoTable() { return <group>${body}</group>; }`;

    it("catches plain decoration — the desk, the legs, the board", () => {
      expect(blockersIn(wrap(`<RoundedBox args={[1, 1, 1]} />`))).toHaveLength(1);
      expect(blockersIn(wrap(`<mesh><boxGeometry /></mesh>`))).toHaveLength(1);
    });

    it("lets decoration through once somebody has said it takes no rays", () => {
      expect(blockersIn(wrap(`<mesh raycast={noRaycast}><boxGeometry /></mesh>`))).toEqual([]);
    });

    it("lets a thing you can press through, and everything inside it", () => {
      expect(blockersIn(wrap(`<mesh onClick={go}><boxGeometry /></mesh>`))).toEqual([]);
      expect(blockersIn(wrap(`<group onClick={go}><mesh /><Text>label</Text></group>`))).toEqual([]);
    });

    it("does NOT treat the room's claim-everything wrapper as a reason", () => {
      // The wrapper is in a different component. Being rendered inside it at
      // run time is exactly how the desk became a blocker, so it must not
      // excuse anything here — and lexically, it does not.
      const two = `
        function RoomItems() { return <group onPointerDown={claim}><GoTable /></group>; }
        function GoTable() { return <group><RoundedBox args={[1, 1, 1]} /></group>; }`;
      expect(blockersIn(two)).toHaveLength(1);
    });
  });
});
