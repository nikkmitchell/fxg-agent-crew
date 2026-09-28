import { describe, expect, it } from "vitest";
import { agentScreenShownIn } from "./ScreenWall";

describe("agents' screens and the lobby (Nikk, 2026-09-28)", () => {
  it("hides the greeter's screen in the lobby", () => {
    expect(agentScreenShownIn("lobby", "Nightjar")).toBe(false);
  });
  it("still shows other people's agents' screens in the lobby", () => {
    expect(agentScreenShownIn("lobby", "Skein")).toBe(true);
  });
  it("shows the greeter's screen in the working rooms", () => {
    expect(agentScreenShownIn("saha.ing", "Nightjar")).toBe(true);
    expect(agentScreenShownIn("meditation.AR", "Nightjar")).toBe(true);
  });
});
