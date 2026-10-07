import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api-request";
import type { Question } from "../../../shared/questions";

/**
 * The room's question panel (question-form.ts): the room writes and sends, the
 * thing only opens it, one panel a page, one request key a panel.
 */

const api = vi.hoisted(() => ({ questions: vi.fn(), askQuestion: vi.fn() }));
vi.mock("../../space-client", () => ({ space: api }));

const { cancelOpenQuestion, createQuestionHost, openQuestionNow, placeNear, resetQuestionPanel, sendOpenQuestion } = await import("./question-form");

const question: Question = {
  id: "open-source-library-1a2b3c4d", project: "open-source-library", space: "open.library",
  text: "How do I rig a hand?", askedBy: "Nikk2", askedAt: "2026-10-07T10:00:00.000Z",
  card: { status: "backlog", owners: [], updatedAt: "2026-10-07T10:00:00.000Z" }, answer: null,
};

function room(me: { id: string; name: string } | null = { id: "Nikk2", name: "Nikk2" }) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 2);
  camera.updateMatrixWorld();
  return createQuestionHost({ camera: () => camera, me: () => (me ? { ...me, me: true, agent: false } : null), renderer: { xr: { isPresenting: true } } });
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  api.questions.mockResolvedValue({ space: "open.library", project: "open-source-library", questions: [] });
  api.askQuestion.mockResolvedValue({ ok: true, result: { existing: false, question } });
});
afterEach(() => {
  resetQuestionPanel();
  vi.clearAllMocks();
});

describe("asking from a thing", () => {
  it("opens one panel near the thing, facing you, saying where the question goes and as whom", async () => {
    const host = room();
    const pad = new THREE.Object3D();
    pad.position.set(0, 1.1, 0);
    pad.updateMatrixWorld();
    void host.ask("library/lectern", { prompt: "Ask the Library", near: pad }).result;
    expect(api.questions).toHaveBeenCalledWith("library", { limit: 1 });
    await settled();
    const open = openQuestionNow()!;
    expect(open.header).toBe("Ask the Library · posted publicly to the open-source-library board as Nikk2");
    expect(open.sending).toBe(false);
    // Between the pad and you, below your eyes, turned toward you.
    expect(open.at.z).toBeGreaterThan(0);
    expect(open.at.z).toBeLessThan(2);
    expect(open.at.y).toBeLessThan(1.6);
    expect(open.yaw).toBeCloseTo(0);
    // A second thing asking meanwhile is told, not stacked.
    expect(await host.ask("other", {}).result).toMatchObject({ ok: false, why: "busy" });
  });

  it("sends once and gives the thing the card", async () => {
    const host = room();
    const asked = host.ask("library", {}).result;
    await settled();
    const key = openQuestionNow()!.key;
    await sendOpenQuestion("How do I rig a hand?");
    expect(api.askQuestion).toHaveBeenCalledWith("library", "How do I rig a hand?", key);
    expect(await asked).toEqual({ ok: true, question });
    expect(openQuestionNow()).toBeNull();
  });

  it("keeps the words after a dropped connection, and sending again is the same question", async () => {
    const host = room();
    const asked = host.ask("library", {}).result;
    await settled();
    api.askQuestion.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await sendOpenQuestion("How do I rig a hand?");
    const open = openQuestionNow()!;
    expect(open).toMatchObject({ draft: "How do I rig a hand?", sending: false });
    expect(open.problem).toMatch(/Send again/);
    await sendOpenQuestion("How do I rig a hand?");
    const keys = api.askQuestion.mock.calls.map((call) => call[2]);
    expect(keys).toEqual([open.key, open.key]);
    expect(await asked).toMatchObject({ ok: true });
  });

  it("leaves words that are not a question yet for the writer to fix, and closes on a refusal", async () => {
    const host = room();
    const asked = host.ask("library", {}).result;
    await settled();
    api.askQuestion.mockRejectedValueOnce(new ApiError("that is too short to be a question", 400, "BAD_QUESTION"));
    await sendOpenQuestion("Hm");
    expect(openQuestionNow()!.problem).toBe("that is too short to be a question");
    api.askQuestion.mockRejectedValueOnce(new ApiError("that is 5 questions here in ten minutes", 429, "TOO_MANY"));
    await sendOpenQuestion("How do I rig a hand?");
    expect(await asked).toMatchObject({ ok: false, why: "too-many" });
    expect(openQuestionNow()).toBeNull();
  });

  it("says at once when the space's questions go nowhere, before anything is typed", async () => {
    api.questions.mockRejectedValueOnce(new ApiError("questions asked in open.library have nowhere to go yet", 409, "NO_INTAKE"));
    const asked = room().ask("library", {}).result;
    expect(await asked).toMatchObject({ ok: false, why: "no-intake", message: expect.stringContaining("nowhere to go") });
    expect(openQuestionNow()).toBeNull();
  });

  it("closes when the thing is taken away, and a late Send goes nowhere", async () => {
    const host = room();
    const asking = host.ask("library", {});
    await settled();
    asking.close();
    expect(await asking.result).toMatchObject({ ok: false, why: "removed" });
    expect(openQuestionNow()).toBeNull();
    await sendOpenQuestion("Too late?");
    expect(api.askQuestion).not.toHaveBeenCalled();
  });

  it("asks nobody's question when nobody is signed in, and a closed panel is a cancel", async () => {
    expect(await room(null).ask("library", {}).result).toMatchObject({ ok: false, why: "signed-out" });
    const asked = room().ask("library", {}).result;
    await settled();
    cancelOpenQuestion();
    expect(await asked).toMatchObject({ ok: false, why: "cancelled" });
  });
});

describe("listing", () => {
  it("is the board's own list, and fails with a reason rather than an empty shelf", async () => {
    api.questions.mockResolvedValueOnce({ space: "open.library", project: "open-source-library", questions: [question] });
    expect(await room().list("library/lectern", { mine: true })).toEqual([question]);
    expect(api.questions).toHaveBeenCalledWith("library", { mine: true });
    api.questions.mockRejectedValueOnce(new ApiError("questions asked in open.library have nowhere to go yet", 409, "NO_INTAKE"));
    await expect(room().list("library", {})).rejects.toMatchObject({ why: "no-intake" });
  });
});

describe("where the panel goes without a thing to stand by", () => {
  it("is in front of you, nearer in a headset", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld();
    expect(placeNear(undefined, camera, true).at.z).toBeCloseTo(-0.55);
    expect(placeNear(undefined, camera, false).at.z).toBeCloseTo(-0.9);
  });
});
