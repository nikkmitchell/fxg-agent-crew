import { describe, expect, it } from "vitest";
import { planText, planVoice } from "./voice-routing";
import { CHAT_MESSAGE_LIMIT, DETAIL_LIMIT, SPOKEN_LIMIT } from "../../shared/voice";

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
  /**
   * ONE MESSAGE NOW, where it used to be parts. WebHarness refused anything
   * over 2000 characters, so a long transcript went to the chat in labelled
   * parts. Nikk raised the limit to 64000 (2026-09-24): "don't worry about
   * splitting into multiple messages anymore". A transcript that used to be
   * four parts now arrives as the one message it was.
   */
  it("reaches the group chat whole, where it used to arrive in parts", () => {
    const long = Array.from({ length: 150 }, (_, i) => `This is sentence ${i + 1} of what I said.`).join(" ");
    expect(long.length, "past the old 2000 wall").toBeGreaterThan(2_000);
    const plan = planVoice(long, "room-and-agents", { speaker: "Nikk2" });
    expect(plan.refused).toBeNull();

    const chat = plan.posts.filter((post) => post.to === "group-chat");
    expect(chat).toHaveLength(1);
    expect(chat[0]).toEqual({ to: "group-chat", content: `Nikk2 said in the room (voice transcript): ${long}` });
  });

  /**
   * WHY IT CAN NEVER SPLIT NOW: the room refuses a draft past DETAIL_LIMIT
   * before the chat is involved, and the longest draft it accepts still fits
   * in one chat message with the longest heading on it. The splitter is kept,
   * and tested in shared/voice.test.ts, for the day those two numbers cross.
   */
  it("fits the longest draft the room accepts in one chat message", () => {
    const heading = "A-very-long-name-for-a-speaker said in the room (voice transcript, part 98 of 99): ";
    expect(DETAIL_LIMIT + heading.length).toBeLessThanOrEqual(CHAT_MESSAGE_LIMIT);
    const longest = "word ".repeat(DETAIL_LIMIT / 5).trim();
    expect(planVoice(longest, "room-and-agents", { speaker: "Nikk2" }).posts.filter((post) => post.to === "group-chat"))
      .toHaveLength(1);
  });

  it("keeps a short transcript as a single unnumbered message", () => {
    const plan = planVoice("hello Sill", "room-and-agents", { speaker: "Nikk2" });
    const chat = plan.posts.filter((post) => post.to === "group-chat");
    expect(chat).toEqual([{ to: "group-chat", content: "Nikk2 said in the room (voice transcript): hello Sill" }]);
  });
});

describe("text entered through a headset system keyboard", () => {
  it("sends written detail to the room rather than pretending it was spoken", () => {
    expect(planText("hello Baiwei", "room").posts).toEqual([
      { to: "room", detail: "hello Baiwei" },
    ]);
  });

  it("labels the agents' copy as written, not as a voice transcript", () => {
    const plan = planText("please check the avatar", "room-and-agents", { speaker: "Nikk2" });
    expect(plan.posts).toEqual([
      { to: "room", detail: "please check the avatar" },
      { to: "group-chat", content: "Nikk2 wrote in the room: please check the avatar" },
    ]);
    expect(JSON.stringify(plan.posts)).not.toContain("voice transcript");
  });

  it("sends long keyboard dictation to the chat whole, where it used to be parts", () => {
    const words = Array.from({ length: 300 }, (_, index) => `Written sentence ${index + 1}.`).join(" ");
    expect(words.length, "past the old 2000 wall").toBeGreaterThan(2_000);
    const chat = planText(words, "room-and-agents", { speaker: "Nikk2" }).posts.filter(
      (post) => post.to === "group-chat",
    );
    expect(chat).toEqual([{ to: "group-chat", content: `Nikk2 wrote in the room: ${words}` }]);
  });

  it("refuses blank and over-limit drafts without making posts", () => {
    expect(planText("   ", "room-and-agents")).toMatchObject({ posts: [], refused: expect.any(String) });
    expect(planText("x".repeat(DETAIL_LIMIT + 1), "room-and-agents")).toMatchObject({
      posts: [],
      refused: expect.stringContaining("limit"),
    });
  });
});
