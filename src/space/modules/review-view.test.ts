import { describe, expect, it } from "vitest";
import type { ModuleRoomItem } from "../../../shared/room-items";
import { REVIEW_VIEW_ID, withReviewView } from "./review-view";

const thing = (id: string, view: "full" | "placed"): ModuleRoomItem => ({
  id, kind: "module", revision: 0, source: { space: "review.studio", branch: "main", entry: "studio", deploy: "s1" },
  name: id, role: view === "full" ? "space" : "item", view, position: { x: 0, y: 0, z: 0, rotationY: 0 }, scale: 1, addedBy: "Mica",
});
const view = { round: "r1", title: "Library books", variant: "candidate" as const, space: "open.library", entry: "library", mode: "full" as const, deploy: "cand-1" };

describe("a review's version, opened for you alone (Mica 7348)", () => {
  it("stands in for the room's full view at the exact deploy, and gives it back on close", () => {
    const room = [thing("studio", "full"), thing("lamp", "placed")];
    const shown = withReviewView(room, view, "Nikk2");
    expect(shown.map((item) => item.id)).toEqual(["lamp", REVIEW_VIEW_ID]);
    expect(shown[1]).toMatchObject({ view: "full", source: { space: "open.library", entry: "library", deploy: "cand-1" } });
    expect(withReviewView(room, null, "Nikk2").map((item) => item.id)).toEqual(["studio", "lamp"]);
  });

  it("puts an item in front of you among the room's things, leaving the full view", () => {
    const shown = withReviewView([thing("studio", "full")], { ...view, mode: "item" }, "Nikk2");
    expect(shown.map((item) => item.id)).toEqual(["studio", REVIEW_VIEW_ID]);
    expect(shown[1]).toMatchObject({ view: "placed" });
  });
});
