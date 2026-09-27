import { describe, expect, it } from "vitest";
import { PUBLIC_STUN, iceServersFrom } from "./ice.js";

describe("where a call finds its way", () => {
  it("is the public STUN servers alone until a relay is configured", () => {
    expect(iceServersFrom({})).toEqual([PUBLIC_STUN]);
    expect(iceServersFrom({ VOICE_TURN_URLS: "turn:saha.ing:3478" })).toEqual([PUBLIC_STUN]);
  });

  it("adds the relay, with its login, when all three are set", () => {
    const servers = iceServersFrom({
      VOICE_TURN_URLS: " turn:saha.ing:3478 , turn:saha.ing:3478?transport=tcp ",
      VOICE_TURN_USERNAME: "saha",
      VOICE_TURN_CREDENTIAL: "pw",
    });
    expect(servers[1]).toEqual({ urls: ["turn:saha.ing:3478", "turn:saha.ing:3478?transport=tcp"], username: "saha", credential: "pw" });
  });

  it("asks a STUN server China can reach before Google's", () => {
    expect(PUBLIC_STUN.urls[0]).toBe("stun:stun.miwifi.com:3478");
  });
});
