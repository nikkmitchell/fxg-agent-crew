import { describe, expect, it } from "vitest";
import { thingLabel } from "./thing-label";

describe("the words over a thing", () => {
  it("shows a thing's caption as it wrote it: no name in front, not as trouble", () => {
    // The Stacks captions itself "The Stacks · walk up to a shelf…"; it was drawn in pink as
    // "The Stacks: The Stacks · walk up to a shelf…" (seen in the 2026-10-23 headset footage).
    expect(thingLabel("The Stacks", { caption: "The Stacks · walk up to a shelf" })).toEqual({ text: "The Stacks · walk up to a shelf", trouble: false });
  });

  it("puts what is wrong first, with the thing's name, as trouble", () => {
    expect(thingLabel("Drums", { problem: "Drums did not start", caption: "Tap to play" })).toEqual({ text: "Drums: Drums did not start", trouble: true });
    expect(thingLabel("Drums", { missing: "x no longer lists drums", problem: "p" })).toEqual({ text: "Drums: x no longer lists drums", trouble: true });
  });

  it("puts what moving it says over its caption, and says nothing when there is nothing to say", () => {
    expect(thingLabel("Drums", { notice: "Saved where it stands", caption: "Tap to play" })).toEqual({ text: "Drums: Saved where it stands", trouble: false });
    expect(thingLabel("Drums", {})).toBeNull();
    expect(thingLabel("Drums", { caption: "" })).toBeNull();
  });
});
