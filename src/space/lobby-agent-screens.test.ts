import { describe, expect, it } from "vitest";
import { agentScreensShownIn } from "./ScreenWall";

describe("agents' screens and the lobby (Nikk, 2026-09-28)", () => {
  it("hides agents' screens in the lobby, where an agent is a greeter", () => {
    expect(agentScreensShownIn("lobby")).toBe(false);
  });
  it("shows them in the working rooms", () => {
    expect(agentScreensShownIn("saha.ing")).toBe(true);
    expect(agentScreensShownIn("meditation.AR")).toBe(true);
  });
});
