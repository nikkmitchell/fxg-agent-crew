import { describe, expect, test } from "vitest";
import { newestId, replyToSpeak } from "./reply-speech";
import { SPOKEN_LIMIT } from "../../shared/voice";
import type { RoomMessage } from "./useRoomFeed";

function message(id: number, username: string, content: string, streaming = false): RoomMessage {
  return {
    id,
    username,
    content,
    msgType: "text",
    createdAt: "2026-09-13 09:00:00",
    updatedAt: "2026-09-13 09:00:00",
    streaming,
  };
}

describe("replyToSpeak", () => {
  test("reads the newest thing somebody else said", () => {
    const spoken = replyToSpeak(
      [message(1, "Inkstone", "first"), message(2, "Inkstone", "second")],
      0,
      "nikk2",
    );
    expect(spoken?.id).toBe(2);
    expect(spoken?.say).toBe("Inkstone says: second");
  });

  test("says nothing about messages already read", () => {
    expect(replyToSpeak([message(1, "Inkstone", "old")], 1, "nikk2")).toBeNull();
  });

  test("never reads your own words back to you", () => {
    expect(replyToSpeak([message(9, "Nikk2", "hello")], 0, "nikk2")).toBeNull();
  });

  test("your own words are yours whatever the case", () => {
    // The room spells him `nikk2` and WebHarness spells him `Nikk2`; a
    // case-sensitive check reads his own sentence back a second after he says it.
    expect(replyToSpeak([message(9, "NIKK2", "hello")], 0, "nikk2")).toBeNull();
  });

  test("waits for a streaming message to finish", () => {
    expect(replyToSpeak([message(3, "Inkstone", "half a th", true)], 0, "nikk2")).toBeNull();
  });

  test("skips an empty message rather than speaking silence", () => {
    expect(replyToSpeak([message(3, "Inkstone", "   ")], 0, "nikk2")).toBeNull();
  });

  test("says nothing when nobody has spoken", () => {
    expect(replyToSpeak([], 0, "nikk2")).toBeNull();
  });

  test("with no session, nothing is read out", () => {
    // `you` unknown means every message looks like somebody else's, including
    // your own — better silent than repeating you to yourself.
    expect(replyToSpeak([message(1, "Nikk2", "hi")], 0, null)?.say).toBe("Nikk2 says: hi");
  });

  test("a long message is read in whole sentences and says there is more", () => {
    // It used to cut at the last WORD that fit, which still stopped
    // mid-sentence: "I would not" heard in place of "I would not merge this
    // until the tests pass". Whole sentences only now.
    const long = Array.from({ length: 30 }, (_, i) => `This is sentence ${i + 1}.`).join(" ");
    const spoken = replyToSpeak([message(1, "Inkstone", long)], 0, "nikk2");
    expect(spoken?.shortened).toBe(true);
    expect(spoken?.say).toContain("There is more of that on the Chat panel");
    // What is read ends on a full stop before the pointer — never mid-sentence.
    const read = spoken?.say.replace(/^Inkstone says: /, "").replace(/ There is more of that on the Chat panel\.$/, "");
    expect(read?.endsWith(".")).toBe(true);
    expect(long.startsWith(read ?? "\u0000")).toBe(true);
  });

  test("a single sentence too long to say is pointed at, not read in half", () => {
    const unbroken = "word ".repeat(200).trim();
    const spoken = replyToSpeak([message(1, "Inkstone", unbroken)], 0, "nikk2");
    expect(spoken?.shortened).toBe(true);
    expect(spoken?.say).toContain("There is a long message on the Chat panel");
    expect(spoken?.say).not.toContain("word word");
  });

  test("a message at the limit is read whole", () => {
    const exact = "a".repeat(SPOKEN_LIMIT);
    const spoken = replyToSpeak([message(1, "Inkstone", exact)], 0, "nikk2");
    expect(spoken?.shortened).toBe(false);
    expect(spoken?.say).toBe(`Inkstone says: ${exact}`);
  });
});

describe("newestId", () => {
  test("is the highest id present, so arriving mid-conversation reads nothing", () => {
    expect(newestId([message(4, "a", "x"), message(11, "b", "y"), message(7, "c", "z")])).toBe(11);
  });

  test("an empty room primes at zero", () => {
    expect(newestId([])).toBe(0);
  });
});
