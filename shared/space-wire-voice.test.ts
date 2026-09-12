import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./space-wire";

/**
 * Voice signalling frames, which are the one thing a client can ask the server
 * to copy to somebody else. Everything here is about what must NOT get through.
 */
const frame = (value: unknown) => parseClientMessage(JSON.stringify(value));

describe("saying whether your microphone is on", () => {
  it("takes a yes and a no", () => {
    expect(frame({ type: "voicePresence", on: true })).toEqual({ type: "voicePresence", on: true });
    expect(frame({ type: "voicePresence", on: false })).toEqual({
      type: "voicePresence",
      on: false,
    });
  });

  it("refuses anything that is not a yes or a no", () => {
    for (const on of ["true", 1, null, undefined, {}]) {
      expect(frame({ type: "voicePresence", on })).toBeNull();
    }
  });
});

describe("relaying a step of a call", () => {
  const offer = { kind: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };

  it("takes an offer, an answer and a candidate", () => {
    expect(frame({ type: "voice", to: "wren", signal: offer })).toEqual({
      type: "voice",
      to: "wren",
      signal: offer,
    });
    expect(frame({ type: "voice", to: "wren", signal: { kind: "answer", sdp: "v=0" } })).not.toBeNull();
    expect(
      frame({
        type: "voice",
        to: "wren",
        signal: { kind: "candidate", candidate: "candidate:1 1 udp", sdpMid: "0", sdpMLineIndex: 0 },
      }),
    ).not.toBeNull();
  });

  it("allows the nulls a candidate is genuinely allowed to have", () => {
    const parsed = frame({
      type: "voice",
      to: "wren",
      signal: { kind: "candidate", candidate: "", sdpMid: null, sdpMLineIndex: null },
    });
    // An empty candidate string is how end-of-candidates is signalled, so it is
    // valid and must survive.
    expect(parsed).not.toBeNull();
  });

  it("refuses a frame with no recipient", () => {
    expect(frame({ type: "voice", signal: offer })).toBeNull();
    expect(frame({ type: "voice", to: "", signal: offer })).toBeNull();
    expect(frame({ type: "voice", to: 7, signal: offer })).toBeNull();
  });

  it("refuses a signal it does not recognise", () => {
    for (const signal of [
      undefined,
      null,
      {},
      { kind: "hangup" },
      { kind: "offer" },
      { kind: "offer", sdp: "" },
      { kind: "offer", sdp: 7 },
      { kind: "candidate" },
      { kind: "candidate", candidate: 7 },
      { kind: "candidate", candidate: "x", sdpMid: 7, sdpMLineIndex: null },
      { kind: "candidate", candidate: "x", sdpMid: null, sdpMLineIndex: "0" },
    ]) {
      expect(frame({ type: "voice", to: "wren", signal })).toBeNull();
    }
  });

  it("refuses a payload big enough to be a transport rather than a call", () => {
    // The relay is the one thing a client can make the server copy to somebody
    // else. Without a cap it is a free message bus with no record.
    expect(frame({ type: "voice", to: "wren", signal: { kind: "offer", sdp: "x".repeat(16_001) } })).toBeNull();
    expect(
      frame({
        type: "voice",
        to: "wren",
        signal: { kind: "candidate", candidate: "x".repeat(1_001), sdpMid: null, sdpMLineIndex: null },
      }),
    ).toBeNull();
  });

  it("does not let a client name its own sender", () => {
    // `from` is stamped by the server. A frame carrying one must not survive
    // parsing with it intact, or somebody could introduce themselves as
    // somebody else and be listened to as them.
    const parsed = frame({ type: "voice", to: "wren", from: "nikk", signal: offer });
    expect(parsed).toEqual({ type: "voice", to: "wren", signal: offer });
    expect(parsed && "from" in parsed).toBe(false);
  });
});
