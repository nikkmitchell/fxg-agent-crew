import { describe, expect, it } from "vitest";
import { callList, shouldCall } from "./voice-pairing";

describe("deciding who dials", () => {
  it("has exactly one caller for any pair, in either direction", () => {
    for (const [a, b] of [
      ["baiwei2", "nikk2"],
      ["nikk2", "baiwei2"],
      ["Inkstone", "claude-nikk2mbp"],
      ["a", "b"],
    ] as const) {
      // The property that matters: not WHO, but that it is never both and
      // never neither. Both dialling collapses the connection; neither
      // dialling is the silence Nikk and Bai Wei actually got.
      expect(shouldCall(a, b) !== shouldCall(b, a)).toBe(true);
    }
  });

  it("never calls itself", () => {
    expect(shouldCall("nikk2", "nikk2")).toBe(false);
    expect(callList("nikk2", ["nikk2"])).toEqual([]);
  });

  it("gives the same answer on both machines", () => {
    // Neither side asks the other, so the two must agree from the names alone.
    const mine = shouldCall("baiwei2", "nikk2");
    const theirs = shouldCall("nikk2", "baiwei2");
    expect(mine).toBe(true);
    expect(theirs).toBe(false);
  });
});

describe("the deadlock that shipped", () => {
  /**
   * Replays the exact sequence from the live test, with both halves of the
   * rule applied: on an announcement, and on switching your own microphone on.
   */
  const conversation = (firstOn: string, secondOn: string) => {
    const dialled: string[] = [];
    // The first person switches on. Nobody else is talking yet.
    dialled.push(...callList(firstOn, []));
    // Their announcement reaches the second, who is not on yet and so does
    // nothing but remember it.
    const secondKnows = [firstOn];
    // The second switches on: announces, AND dials whoever is already talking.
    dialled.push(...callList(secondOn, secondKnows));
    // The announcement reaches the first, who is on and dials if it is theirs.
    dialled.push(...callList(firstOn, [secondOn]));
    return dialled;
  };

  it("dials exactly once when the higher id switches on first", () => {
    // Nikk first, Bai Wei second — the order that failed in production.
    expect(conversation("nikk2", "baiwei2")).toEqual(["nikk2"]);
  });

  it("dials exactly once when the lower id switches on first", () => {
    // Bai Wei first, Nikk second — the order that happened to work.
    expect(conversation("baiwei2", "nikk2")).toEqual(["nikk2"]);
  });

  it("dials exactly once whichever way round, for any pair of names", () => {
    for (const [a, b] of [
      ["alice", "bob"],
      ["bob", "alice"],
      ["Nikk2", "nikk2"],
      ["claude-nikk2mbp", "Inkstone"],
    ] as const) {
      expect(conversation(a, b), `${a} then ${b}`).toHaveLength(1);
      expect(conversation(b, a), `${b} then ${a}`).toHaveLength(1);
    }
  });

  it("dials everybody already talking when a third person joins in", () => {
    // Three people, and the newcomer sorts below two of them.
    expect(callList("aaa", ["mmm", "zzz"])).toEqual(["mmm", "zzz"]);
    // And above them, in which case they will dial the newcomer instead.
    expect(callList("zzz", ["aaa", "mmm"])).toEqual([]);
  });
});
