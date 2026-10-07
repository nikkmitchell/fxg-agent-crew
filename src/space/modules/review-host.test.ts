import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ ownCard: vi.fn(), review: vi.fn(), reviewFinding: vi.fn(), reviews: vi.fn(), reviewFindings: vi.fn(), publishReview: vi.fn(), questions: vi.fn(), askQuestion: vi.fn() }));
vi.mock("../../space-client", () => ({ space: api }));

const { createReviewHost } = await import("./review-host");
const { openQuestionNow, resetQuestionPanel, sendOpenQuestion } = await import("./question-form");
const { closeReviewView, reviewViewNow } = await import("./review-view");

const round = {
  id: "open-source-library-1", project: "open-source-library", title: "Library books", space: "open.library", entry: "library", mode: "full",
  candidate: { deploy: "cand-1" }, baseline: null, checklist: [], card: { status: "backlog", owners: [] }, findings: 0, by: "Sill", at: "2026-10-07T12:00:00.000Z",
};
const host = () => createReviewHost({ camera: () => new THREE.PerspectiveCamera(), me: () => ({ id: "Nikk2", name: "Nikk2", me: true, agent: false }), renderer: { xr: { isPresenting: false } } });

afterEach(() => {
  vi.clearAllMocks();
  resetQuestionPanel();
  closeReviewView();
});

describe("ctx.reviews in the room (Mica 7347)", () => {
  it("takes a round through the board's own claim then accept, and gives it back with release", async () => {
    api.ownCard.mockResolvedValue({ ok: true });
    expect(await host().accept("r1")).toEqual({ ok: true });
    expect(api.ownCard.mock.calls).toEqual([["r1", "claim"], ["r1", "accept"]]);
    expect(await host().decline("r1")).toEqual({ ok: true });
    expect(api.ownCard).toHaveBeenLastCalledWith("r1", "release");
  });

  it("opens exactly the round's deploy for this viewer, and refuses a baseline it does not have", async () => {
    api.review.mockResolvedValue({ round });
    expect(await host().open(round.id, "candidate")).toEqual({ ok: true });
    expect(reviewViewNow()).toMatchObject({ space: "open.library", entry: "library", deploy: "cand-1", mode: "full", variant: "candidate" });
    expect(await host().open(round.id, "baseline")).toEqual({ ok: false, why: "this round has no baseline" });
    host().back();
    expect(reviewViewNow()).toBeNull();
  });

  it("writes a finding in the room's panel and files it on the round with the panel's key", async () => {
    const finding = { id: "f1", round: round.id, by: "Nikk2", at: "2026-10-07T12:01:00.000Z", variant: "candidate", deploy: "cand-1", text: "Opens in the right hand." };
    api.reviewFinding.mockResolvedValue({ existing: false, finding });
    const submitting = host().submit("studio", round.id, { variant: "candidate" });
    const key = openQuestionNow()!.key;
    await sendOpenQuestion("Opens in the right hand.");
    expect(api.reviewFinding).toHaveBeenCalledWith(round.id, "candidate", "Opens in the right hand.", key);
    expect(await submitting.result).toEqual({ ok: true, finding });
    expect(openQuestionNow()).toBeNull();
  });

  it("asks for a review in the room's panel: the target shown, the title written, published once with the panel's key (Mica 7405)", async () => {
    api.publishReview.mockResolvedValue({ existing: false, round });
    const asking = host().request("studio", { project: "open-source-library", space: "open.library", entry: "library", mode: "full", candidate: "cand-1", checklist: ["Books open"] });
    const open = openQuestionNow()!;
    expect(open.header).toContain("open.library · library (full) at cand-1");
    await sendOpenQuestion("Library books");
    expect(api.publishReview).toHaveBeenCalledWith({ project: "open-source-library", space: "open.library", entry: "library", mode: "full", candidate: "cand-1", checklist: ["Books open"], title: "Library books" }, open.key);
    expect(await asking.result).toEqual({ ok: true, round });
  });
});
