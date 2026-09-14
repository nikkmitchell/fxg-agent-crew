import { describe, expect, it } from "vitest";
import { micGlyph, micPress, type MicState } from "./mic-press";

const state = (over: Partial<MicState> = {}): MicState => ({
  available: true,
  listening: false,
  sending: false,
  heard: "",
  alwaysOn: false,
  ...over,
});

describe("pressing the microphone", () => {
  it("starts listening from cold", () => {
    expect(micPress(state())).toBe("start");
  });

  it("SENDS on the second press, which is the whole bug", () => {
    // Recognition ends itself after an utterance, so by the time somebody
    // presses again they are not listening and words are waiting. The old
    // behaviour was to show "Tap Send" and leave the only Send control inside
    // the settings menu, so from a headset the mic simply never sent anything.
    expect(micPress(state({ heard: "walking over to the board" }))).toBe("send");
  });

  it("stops and sends when the press comes while still listening", () => {
    // Somebody who presses mid-sentence means "I am done" — not "throw that
    // away".
    expect(micPress(state({ listening: true, heard: "have a look at" }))).toBe("stopAndSend");
  });

  it("just stops when listening produced nothing", () => {
    expect(micPress(state({ listening: true }))).toBe("stop");
  });

  it("only ever stops in always-on, because each sentence has already gone", () => {
    expect(micPress(state({ listening: true, heard: "already sent", alwaysOn: true }))).toBe("stop");
    expect(micPress(state({ heard: "already sent", alwaysOn: true }))).toBe("start");
  });

  it("ignores a press while a post is in flight", () => {
    // Two posts of the same words is worse than a press that did nothing.
    expect(micPress(state({ sending: true, heard: "once is enough" }))).toBe("ignore");
    expect(micPress(state({ sending: true, listening: true }))).toBe("ignore");
  });

  it("refuses rather than pretending when the browser has no recognition", () => {
    // Saying so is the point: a button that looks live and does nothing is the
    // failure being fixed, not a smaller version of it.
    expect(micPress(state({ available: false }))).toBe("refuse");
  });

  it("treats whitespace as nothing heard", () => {
    // Otherwise a stray space makes the button offer to send silence.
    expect(micPress(state({ heard: "   " }))).toBe("start");
    expect(micPress(state({ listening: true, heard: "  \n " }))).toBe("stop");
  });
});

describe("what the button shows", () => {
  it("is a microphone when it is waiting to be used", () => {
    expect(micGlyph(state())).toBe("🎙");
  });

  it("shows that the next press sends, rather than a mic already used", () => {
    expect(micGlyph(state({ heard: "something" }))).toBe("▲");
  });

  it("shows a stop while listening, and a wait while posting", () => {
    expect(micGlyph(state({ listening: true }))).toBe("◼");
    expect(micGlyph(state({ sending: true, heard: "x" }))).toBe("…");
  });

  it("never offers to send in always-on, where there is nothing pending", () => {
    expect(micGlyph(state({ heard: "gone already", alwaysOn: true }))).toBe("🎙");
  });

  it("is a single glyph, because it is drawn as one", () => {
    // `glyph` mode draws one line at 84px. A word here would be squeezed, which
    // is the failure the label-aspect work was about.
    for (const s of [state(), state({ listening: true }), state({ sending: true }), state({ heard: "x" })]) {
      expect([...micGlyph(s)].length).toBe(1);
    }
  });
});
