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

  it("splits something too long to say, rather than refusing it", () => {
    // It used to refuse here so the server would not have to. Nothing is
    // refused for length any more, and nothing is lost: the opening is spoken
    // and the remainder is written down beside it.
    const long = `${"word ".repeat(80).trim()}. And a second sentence that goes on.`;
    const plan = planVoice(long, "room");
    expect(plan.refused).toBeNull();
    const room = plan.posts.find((post) => post.to === "room");
    expect(room, "still goes to the room").toBeTruthy();
    if (room && room.to === "room") {
      expect(room.say.length).toBeLessThanOrEqual(SPOKEN_LIMIT);
      expect(room.detail, "the rest is kept, not dropped").toBeTruthy();
      // Every word survives somewhere.
      expect(`${room.say} ${room.detail}`.replace(/\s+/g, " ")).toContain("second sentence");
    }
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

describe("a long transcript sent to the room and the agents", () => {
  it("reaches the group chat in labelled parts that each fit, instead of bouncing", () => {
    // WebHarness refuses a message over 2000 characters, so this used to be
    // accepted by the room and refused by the chat. Every part now says who
    // spoke, that it is a transcript, and which part of how many it is.
    const long = Array.from({ length: 150 }, (_, i) => `This is sentence ${i + 1} of what I said.`).join(" ");
    const plan = planVoice(long, "room-and-agents", { speaker: "Nikk2" });
    expect(plan.refused).toBeNull();

    const chat = plan.posts.filter((post) => post.to === "group-chat");
    expect(chat.length).toBeGreaterThan(1);
    chat.forEach((post, index) => {
      if (post.to !== "group-chat") return;
      expect(post.content.length).toBeLessThanOrEqual(2_000);
      expect(post.content).toContain(`Nikk2 said in the room (voice transcript, part ${index + 1} of ${chat.length}): `);
    });
    const words = chat
      .map((post) => (post.to === "group-chat" ? post.content.replace(/^.*?\): /, "") : ""))
      .join(" ");
    expect(words, "every word survives, in order").toBe(long);
  });

  it("keeps a short transcript as a single unnumbered message", () => {
    const plan = planVoice("hello Sill", "room-and-agents", { speaker: "Nikk2" });
    const chat = plan.posts.filter((post) => post.to === "group-chat");
    expect(chat).toEqual([{ to: "group-chat", content: "Nikk2 said in the room (voice transcript): hello Sill" }]);
  });
});
