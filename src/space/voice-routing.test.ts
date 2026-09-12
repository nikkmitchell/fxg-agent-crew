import { describe, expect, it } from "vitest";
import { planVoice } from "./voice-routing";
import { SPOKEN_LIMIT } from "../../shared/voice";

describe("where a spoken sentence goes", () => {
  it("sends to the room and nowhere else by default", () => {
    const plan = planVoice("where are we with the board", "room");
    expect(plan.refused).toBeNull();
    expect(plan.posts).toEqual([{ to: "room", say: "where are we with the board" }]);
  });

  it("adds the group chat without removing the room", () => {
    const plan = planVoice("where are we", "room-and-agents", { speaker: "Nikk2" });
    expect(plan.posts.map((post) => post.to)).toEqual(["room", "group-chat"]);
    // The room post is IDENTICAL either way: choosing to tell the agents must
    // not change what the people standing next to you hear.
    expect(plan.posts[0]).toEqual({ to: "room", say: "where are we" });
  });

  it("marks a group-chat post as a transcript, and says who", () => {
    const plan = planVoice("ship it", "room-and-agents", { speaker: "Nikk2" });
    const chat = plan.posts.find((post) => post.to === "group-chat");
    expect(chat).toBeDefined();
    if (chat?.to !== "group-chat") throw new Error("unreachable");
    expect(chat.content).toContain("Nikk2");
    expect(chat.content).toContain("voice transcript");
    expect(chat.content).toContain("ship it");
  });

  it("still says it came from the room when nobody is named", () => {
    const plan = planVoice("ship it", "room-and-agents");
    const chat = plan.posts.find((post) => post.to === "group-chat");
    if (chat?.to !== "group-chat") throw new Error("unreachable");
    expect(chat.content).toContain("Said in the room");
  });

  it("carries a confidence when recognition gave one, and omits it when not", () => {
    expect(planVoice("yes", "room", { confidence: 0.62 }).posts[0]).toEqual({
      to: "room",
      say: "yes",
      confidence: 0.62,
    });
    expect(planVoice("yes", "room").posts[0]).toEqual({ to: "room", say: "yes" });
  });

  it("refuses silence rather than posting an empty line", () => {
    for (const nothing of ["", "   ", "\n\t "]) {
      const plan = planVoice(nothing, "room-and-agents");
      expect(plan.posts).toEqual([]);
      expect(plan.refused).toMatch(/Nothing was heard/);
    }
  });

  it("refuses something too long to say, before the server has to", () => {
    const plan = planVoice("x".repeat(SPOKEN_LIMIT + 1), "room");
    expect(plan.posts).toEqual([]);
    expect(plan.refused).toContain(String(SPOKEN_LIMIT + 1));
  });

  it("accepts exactly the limit", () => {
    expect(planVoice("x".repeat(SPOKEN_LIMIT), "room").refused).toBeNull();
  });

  it("never alters the words", () => {
    const said = "move  the   card to  done, please";
    const plan = planVoice(`  ${said}  `, "room-and-agents");
    expect(plan.posts[0]).toMatchObject({ say: said });
    const chat = plan.posts[1];
    if (chat.to !== "group-chat") throw new Error("unreachable");
    expect(chat.content).toContain(said);
  });
});
