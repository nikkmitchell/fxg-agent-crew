import { describe, expect, test } from "vitest";
import { newestId, replyToSpeak } from "./reply-speech";
import { SPOKEN_LIMIT, saidInRoomHeading } from "../../shared/voice";
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
  /**
   * THE DOUBLE-SPEAK THESE PREVENT. An agent says a short line it wrote in the
   * room — spoken in its own voice by the box — and posts the full version to
   * the chat. Without the heading test, the headset then reads that full
   * version aloud in the browser's robot, on top of the summary the listener
   * has just heard. Nikk heard exactly that and called it "the previous text to
   * speech, the auto very robotic recording".
   */
  test("stays quiet about the written half of something THIS listener heard", () => {
    const chat = `${saidInRoomHeading("Nightjar")}the whole argument, at length`;
    const heard = ["the whole argument, at length"];
    expect(replyToSpeak([message(5, "Nightjar", chat)], 0, "nikk2", heard)).toBeNull();
  });

  /**
   * THE SILENCE THIS EXISTS TO PREVENT, and it is the whole reason the skip is
   * per listener. A room utterance is only spoken to the person it is addressed
   * to. Everybody else hears no utterance — so if the mark alone silenced the
   * chat copy, a bystander would get nothing at all, and a room where nobody
   * can hear anything looks exactly like a room where nobody is talking.
   */
  test("still reads the written half aloud to somebody who did NOT hear it", () => {
    const chat = `${saidInRoomHeading("Nightjar")}the whole argument, at length`;
    const spoken = replyToSpeak([message(5, "Nightjar", chat)], 0, "nikk2", []);
    expect(spoken?.id).toBe(5);
  });

  test("a marked message this listener did not hear is not confused with one it did", () => {
    const chat = `${saidInRoomHeading("Nightjar")}the second thing`;
    const heard = ["a completely different line"];
    expect(replyToSpeak([message(6, "Nightjar", chat)], 0, "nikk2", heard)?.id).toBe(6);
  });

  test("still speaks an ordinary reply that arrived after a marked one", () => {
    const marked = `${saidInRoomHeading("Nightjar")}the long version`;
    const spoken = replyToSpeak(
      [message(5, "Nightjar", marked), message(6, "Inkstone", "a plain answer")],
      0,
      "nikk2",
      ["the long version"],
    );
    expect(spoken?.id).toBe(6);
    expect(spoken?.say).toBe("Inkstone says: a plain answer");
  });

  /**
   * A MARKED MESSAGE MUST NOT SHADOW AN EARLIER UNMARKED ONE. The loop takes
   * the newest that qualifies; if skipping were done by bailing out rather than
   * by `continue`, a marked message arriving last would silence a real reply
   * that came just before it.
   */
  test("speaks an earlier plain reply even when the newest is marked", () => {
    const marked = `${saidInRoomHeading("Nightjar")}the long version`;
    const spoken = replyToSpeak(
      [message(6, "Inkstone", "answer me"), message(7, "Nightjar", marked)],
      0,
      "nikk2",
      ["the long version"],
    );
    expect(spoken?.id).toBe(6);
  });

  /**
   * A LATER PART MUST CARRY THE MARK TOO. A long written version is posted in
   * parts; if only part one were marked, a headset would skip the opening and
   * then read the REST of it aloud — the worst of both, and it would sound like
   * the reply started halfway through.
   */
  test("stays quiet about part two as well as part one", () => {
    const one = `${saidInRoomHeading("Nightjar", 1, 2)}the opening half`;
    const two = `${saidInRoomHeading("Nightjar", 2, 2)}the closing half`;
    const heard = ["the opening half", "the closing half"];
    expect(replyToSpeak([message(5, "Nightjar", one), message(6, "Nightjar", two)], 0, "nikk2", heard)).toBeNull();
  });

  test("a part this listener did not hear is still read to them", () => {
    const two = `${saidInRoomHeading("Nightjar", 2, 2)}the closing half`;
    expect(replyToSpeak([message(6, "Nightjar", two)], 0, "nikk2", [])?.id).toBe(6);
  });

  test("a message that merely mentions the room is still spoken", () => {
    const spoken = replyToSpeak(
      [message(8, "Inkstone", "I said in the room that we should wait")],
      0,
      "nikk2",
    );
    expect(spoken?.id).toBe(8);
  });

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

  test("a long message is read in whole sentences, with nothing tacked on the end", () => {
    // It used to end every shortened reply with "There is more of that on the
    // Chat panel." Nikk: "can we remove that so you don't have to say that at
    // the end of everything... we can see". The panel is in view.
    const long = Array.from({ length: 30 }, (_, i) => `This is sentence ${i + 1}.`).join(" ");
    const spoken = replyToSpeak([message(1, "Inkstone", long)], 0, "nikk2");
    expect(spoken?.shortened).toBe(true);
    expect(spoken?.say).not.toMatch(/chat panel/i);
    const read = spoken?.say.replace(/^Inkstone says: /, "");
    // Whole sentences only, and the start of what was actually written.
    expect(read?.endsWith(".")).toBe(true);
    expect(long.startsWith(read ?? "\u0000")).toBe(true);
  });

  test("a single sentence too long to say only says who replied", () => {
    // Better than half a sentence, and no pointer to a panel you can already see.
    const unbroken = "word ".repeat(200).trim();
    const spoken = replyToSpeak([message(1, "Inkstone", unbroken)], 0, "nikk2");
    expect(spoken?.shortened).toBe(true);
    expect(spoken?.say).toBe("Inkstone replied.");
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
