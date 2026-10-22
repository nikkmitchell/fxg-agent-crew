import { describe, expect, it } from "vitest";
import { Presence } from "../space/presence.js";
import { agentScreenShown } from "../../shared/screens.js";

describe("an agent walked back to its place has its screen back (Nikk, 2026-10-22)", () => {
  it("arrives home with no reason, so the screen shows; an ordinary route still says it arrived", () => {
    let clock = 0;
    const presence = new Presence(() => clock);
    presence.join("Sill", "agent", true);
    presence.animate("Sill", { posture: "thinking" }, "agent");
    const walkTo = (home: boolean) => {
      presence.walk("Sill", "agent", [{ x: 1, y: 0, z: 1 }], "back to where I was, having said it", { home });
      for (let i = 0; i < 400; i += 1) { clock += 100; presence.tick(0.1); }
      return presence.find("Sill")!;
    };
    const home = walkTo(true);
    expect(home.walking).toBeNull();
    expect(home.because).toBeNull();
    expect(agentScreenShown({ moving: false, because: home.because, attending: home.attending, avatar: home.avatar })).toBe(true);
    presence.walk("Sill", "agent", [{ x: 3, y: 0, z: 3 }], "to the board");
    for (let i = 0; i < 400; i += 1) { clock += 100; presence.tick(0.1); }
    expect(presence.find("Sill")!.because).toBe("to the board — arrived");
  });
});
