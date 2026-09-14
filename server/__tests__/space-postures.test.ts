import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { Presence } from "../space/presence.js";
import { DECLARED_POSTURE_TTL_MS, DeclaredPostures } from "../space/postures.js";
import { deskFor } from "../../shared/space-layout.js";

/**
 * A restart forgets where everyone stands, and must not forget that an agent
 * said it was working. Nikk, after a deploy: "now neither of your screens are
 * showing" — both agents were drawn asleep, which hides a shared screen.
 */
const boot = () => {
  const database = openDatabase(":memory:", DatabaseSync);
  let clock = 1_000_000;
  const memory = new DeclaredPostures(database, () => clock);
  // Each `room()` is the server coming back up against the same database.
  const room = () => new Presence(() => clock, memory);
  return { memory, room, tick: (ms: number) => { clock += ms; } };
};

describe("what an agent said it was doing, across a restart", () => {
  it("comes back working after a restart if it said it was working", () => {
    const { room } = boot();
    room().animate("Sill", { posture: "thinking" }, "agent");
    const after = room();
    const sill = after.join("Sill", "agent", true);
    expect(sill.avatar.posture).toBe("thinking");
  });

  it("still comes back working after it filed a card and spoke, which is what working looks like", () => {
    const { room, memory } = boot();
    const before = room();
    before.animate("Sill", { posture: "thinking" }, "agent");
    before.sendTo("Sill", "agent", deskFor("Sill"), "moved a card");
    before.spoke("Sill", "agent");
    expect(memory.recall("Sill")).toBe("thinking");
    expect(room().join("Sill", "agent", true).avatar.posture).toBe("thinking");
  });

  it("forgets a declared rest once the agent acts, as the live room does", () => {
    const { room, memory } = boot();
    const before = room();
    before.animate("Sill", { posture: "sleeping" }, "agent");
    before.spoke("Sill", "agent");
    expect(memory.recall("Sill")).toBeNull();
  });

  it("treats two spellings of one agent as one", () => {
    const { room } = boot();
    room().animate("Inkstone", { posture: "thinking" }, "agent");
    expect(room().join("inkstone", "agent", true).avatar.posture).toBe("thinking");
  });

  it("does not bring back a declaration from long ago", () => {
    const { room, tick } = boot();
    room().animate("Sill", { posture: "thinking" }, "agent");
    tick(DECLARED_POSTURE_TTL_MS + 1);
    expect(room().join("Sill", "agent", true).avatar.posture).not.toBe("thinking");
  });

  it("keeps the room in memory only when no store is given, as before", () => {
    const first = new Presence();
    first.animate("Sill", { posture: "thinking" }, "agent");
    expect(new Presence().join("Sill", "agent", true).avatar.posture).not.toBe("thinking");
  });
});
