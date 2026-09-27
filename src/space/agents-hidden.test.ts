import { afterEach, describe, expect, it } from "vitest";
import { agentsHiddenIn, resetAgentsHidden, setAgentsHidden, setAgentsHiddenForEveryone } from "./agents-hidden";

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

describe("hidden for everyone by the room (Nikk 5384)", () => {
  afterEach(() => resetAgentsHidden());
  it("is separate from your own choice, which it does not change", () => {
    setAgentsHiddenForEveryone(true);
    expect(agentsHiddenIn("saha.ing"), "your own choice is untouched").toBe(false);
    setAgentsHiddenForEveryone(false);
    expect(agentsHiddenIn("saha.ing")).toBe(false);
  });
});
