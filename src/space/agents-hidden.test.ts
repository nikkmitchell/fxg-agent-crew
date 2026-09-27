import { afterEach, describe, expect, it } from "vitest";
import { agentsHiddenIn, resetAgentsHidden, setAgentsHidden } from "./agents-hidden";

/** Nikk (5299): hide the agents in the meditation room, for himself. */
describe("hiding the agents in a room", () => {
  afterEach(() => resetAgentsHidden());

  it("hides them in the room you chose and nowhere else, whatever the room name's case", () => {
    setAgentsHidden("meditation.AR", true);
    expect(agentsHiddenIn("meditation.AR")).toBe(true);
    expect(agentsHiddenIn("MEDITATION.ar")).toBe(true);
    expect(agentsHiddenIn("saha.ing")).toBe(false);
    expect(agentsHiddenIn(null)).toBe(false);
  });

  it("shows them again when switched back", () => {
    setAgentsHidden("meditation.AR", true);
    setAgentsHidden("meditation.AR", false);
    expect(agentsHiddenIn("meditation.AR")).toBe(false);
  });
});
