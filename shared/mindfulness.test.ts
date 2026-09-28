import { describe, expect, it } from "vitest";
import {
  EMPTY_MINDFULNESS,
  MINDFULNESS_PRACTICES,
  chooseMindfulness,
  normalizeMindfulnessText,
  nextMindfulness,
  paintMindfulness,
  writeMindfulnessNote,
  type MindfulnessView,
} from "./mindfulness.js";

const measure = (text: string, size: number) => text.length * size * 0.52;
const texts = (view: MindfulnessView, screen?: "practice" | "share-preview" | "remove-preview" | "room-page") =>
  paintMindfulness(view, measure, { screen }).ink.flatMap((item) => item.kind === "text" ? [item.text] : []);

describe("the room's optional mindfulness practices", () => {
  it("keeps each new practice draft independent and offers a no-pressure finish", () => {
    const prior = { ...EMPTY_MINDFULNESS, id: "bright-spot" as const, note: "private words" };
    const chosen = chooseMindfulness(prior, "grounding");
    expect(chosen).toEqual({ id: "grounding", step: 0, complete: false, note: "" });
    expect(texts(EMPTY_MINDFULNESS).join(" ")).toContain("No timer, score, or required sharing");
    expect(MINDFULNESS_PRACTICES.flatMap((practice) => practice.steps).join(" ")).toContain("You may pass");
  });

  it("advances synchronously without a clock and ends instead of recording a score", () => {
    let view: MindfulnessView = chooseMindfulness(EMPTY_MINDFULNESS, "notice");
    view = nextMindfulness(view);
    expect(view.step).toBe(1);
    view = nextMindfulness(view);
    view = nextMindfulness(view);
    view = nextMindfulness(view);
    expect(view.complete).toBe(true);
    expect(texts(view).join(" ")).toContain("No score, streak, or reflection to keep");
  });

  it("requires a second, explicit share-confirm action and explains room visibility and retention", () => {
    const preview = texts({ id: "bright-spot", step: 2, complete: false, note: "tea with a friend" }, "share-preview").join(" ");
    expect(preview).toContain("tea with a friend");
    expect(preview).toContain("Everyone in this room can read this card");
    expect(preview).toContain("until you remove it");
    expect(preview).toContain("does not expire");
    const painted = paintMindfulness(EMPTY_MINDFULNESS, measure, { screen: "share-preview" });
    expect(painted.targets.map((target) => target.id)).toEqual(["cancel-share", "confirm-share"]);
  });

  it("previews exactly the normalized text the server stores", () => {
    const draft = writeMindfulnessNote(EMPTY_MINDFULNESS, "  tea\n\twith a friend  ");
    expect(draft.note).toBe("tea with a friend");
    expect(normalizeMindfulnessText(draft.note)).toBe(draft.note);
    expect(normalizeMindfulnessText("x".repeat(241))).toBeNull();
  });

  it("shows old shared cards without exposing who wrote them", () => {
    const painted = paintMindfulness(EMPTY_MINDFULNESS, measure, {
      screen: "room-page",
      cards: [{ id: "a", text: "A quiet cup of tea", createdAt: "2026-09-27T12:00:00.000Z", mine: false }],
    });
    const ink = painted.ink.flatMap((item) => item.kind === "text" ? [item.text] : []).join(" ");
    expect(ink).toContain("A quiet cup of tea");
    expect(ink).toContain("no expiry");
    expect(ink).not.toContain("false");
    expect(painted.targets.some((target) => target.id === "remove-card")).toBe(false);
    const stamp = painted.ink.find((item) => item.kind === "text" && item.text.startsWith("Shared ·"));
    expect(stamp?.kind === "text" ? stamp.text : "").not.toContain(":");
  });

  it("gives XR pointer users a visible hover and pressed state", () => {
    const base = paintMindfulness(EMPTY_MINDFULNESS, measure);
    const hovered = paintMindfulness(EMPTY_MINDFULNESS, measure, { hoveredTarget: "choose:grounding" });
    const pressed = paintMindfulness(EMPTY_MINDFULNESS, measure, { pressedTarget: "choose:grounding" });
    expect(base.ink.some((item) => item.kind === "rect" && item.fill === "#b2c4de")).toBe(false);
    expect(hovered.ink.some((item) => item.kind === "rect" && item.fill === "#b2c4de")).toBe(true);
    expect(pressed.ink.some((item) => item.kind === "rect" && item.fill === "#8ca8cb")).toBe(true);
  });

  it("previews the exact card again before its writer removes it", () => {
    const card = { id: "a", text: "My own card", createdAt: "2026-09-27T12:00:00.000Z", mine: true };
    const preview = paintMindfulness(EMPTY_MINDFULNESS, measure, { screen: "remove-preview", cards: [card] });
    const ink = preview.ink.flatMap((item) => item.kind === "text" ? [item.text] : []).join(" ");
    expect(ink).toContain("My own card");
    expect(ink).toContain("This cannot be undone");
    expect(preview.targets.map((target) => target.id)).toEqual(["cancel-remove", "confirm-remove"]);
  });
});
