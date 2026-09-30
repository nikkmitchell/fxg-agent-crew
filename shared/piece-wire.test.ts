import { describe, expect, it } from "vitest";
import { PIECE_LIMITS, PieceBudget, ownPath, readPieceOp, readSpec, resolveOwn } from "./piece-wire";

describe("what a live piece may send", () => {
  it("adds a part, with everything out of bounds clamped rather than refused", () => {
    expect(readPieceOp({ t: "add", id: 3, spec: { shape: "box", size: [0.2, 99, -1], at: [0, 1, 40], color: "#A0522D", pressable: true } })).toEqual({
      t: "add",
      id: 3,
      spec: { shape: "box", size: [0.2, PIECE_LIMITS.size, 0.001], at: [0, 1, PIECE_LIMITS.reach], color: "#a0522d", pressable: true },
    });
  });

  it("drops what is not a part's description: unknown shapes, bad colours, NaN, wrong-length vectors", () => {
    expect(readSpec({ shape: "teapot", color: "red", emissive: "#12345", at: [0, NaN, 0], turn: [1, 2], opacity: 7 })).toEqual({ opacity: 1 });
  });

  it("loads models and sounds only from its own space: no other server, no climbing out", () => {
    expect(readSpec({ model: "models/drum.glb" }).model).toBe("models/drum.glb");
    for (const elsewhere of ["https://evil.example/x.glb", "//evil.example/x.glb", "/s/other/x.glb", "../other/x.glb", "a/../../x.glb", "models/drum.exe"]) {
      expect(readSpec({ model: elsewhere }).model).toBeUndefined();
    }
    expect(ownPath("./sounds/hit.ogg")).toBe("sounds/hit.ogg");
    expect(readPieceOp({ t: "sound", sound: { url: "https://evil.example/a.mp3" } })).toBeNull();
  });

  it("plays tones within reason: pitch, length and loudness clamped", () => {
    expect(readPieceOp({ t: "sound", sound: { tone: 1e6, ms: 1e6, gain: 9, wave: "noise" } })).toEqual({
      t: "sound",
      sound: { tone: 8000, ms: PIECE_LIMITS.toneMs, wave: "sine", gain: PIECE_LIMITS.gain },
    });
  });

  it("shares small plain values under plain keys, and nothing bigger", () => {
    expect(readPieceOp({ t: "state", k: "hits", v: { n: 3 } })).toEqual({ t: "state", k: "hits", v: { n: 3 } });
    expect(readPieceOp({ t: "state", k: "bad key!", v: 1 })).toBeNull();
    expect(readPieceOp({ t: "emit", name: "hit", data: "x".repeat(PIECE_LIMITS.valueBytes) })).toBeNull();
  });

  it("is nothing at all when it is not a message a piece may send", () => {
    for (const junk of [null, 7, "add", { t: "eval", code: "x" }, { t: "add", id: -1 }, { t: "add", id: 1.5 }, { t: "tween", id: 1 }]) {
      expect(readPieceOp(junk)).toBeNull();
    }
  });
});

describe("a piece's own files", () => {
  const piece = "https://saha.ing/s/xr.instruments/pieces/drums.js?v=d42";
  it("are beside the piece, in its space, and carry its deploy so a push reloads them", () => {
    expect(resolveOwn(piece, "models/drum.glb")).toBe("https://saha.ing/s/xr.instruments/pieces/models/drum.glb?v=d42");
    expect(resolveOwn("https://saha.ing/s/xr.instruments/@wip/drums.js", "hit.ogg")).toBe("https://saha.ing/s/xr.instruments/@wip/hit.ogg");
  });
  it("never reach another space, or another branch's files", () => {
    expect(resolveOwn(piece, "../../other/x.glb")).toBeNull();
    expect(resolveOwn("https://saha.ing/s/xr.instruments/@wip/drums.js", "../x.glb")).toBeNull();
  });
});

describe("how much a piece may send", () => {
  it("a second's worth at once, then refilled as time passes", () => {
    let now = 0;
    const budget = new PieceBudget(3, () => now);
    expect([budget.take(), budget.take(), budget.take(), budget.take()]).toEqual([true, true, true, false]);
    now += 400;
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
  });
});
