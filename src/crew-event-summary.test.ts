import { describe, expect, it } from "vitest";
import { summariseCrewEvent } from "./crew-event-summary";

const fenced = (payload: unknown) => "```crew-event\n" + JSON.stringify({ version: 1, payload }) + "\n```";

describe("crew event summaries", () => {
  it("leaves ordinary conversation alone", () => {
    // The important negative: a chat message must never be reinterpreted as an
    // event just because it mentions one.
    expect(summariseCrewEvent("I moved the ko task to done, see the board")).toBeNull();
  });

  it("summarises a transition in words rather than status codes", () => {
    const summary = summariseCrewEvent(fenced({ type: "task.transitioned", taskId: "ko", to: "in_progress" }));
    expect(summary?.headline).toBe("moved ko to in progress");
  });

  it("summarises a comment with an excerpt", () => {
    const summary = summariseCrewEvent(
      fenced({ type: "task.commented", taskId: "capture", comment: { body: "Simultaneous removal avoids seat order bias" } }),
    );
    expect(summary?.headline).toContain("commented on capture");
    expect(summary?.headline).toContain("Simultaneous removal");
  });

  it("keeps the original payload verbatim", () => {
    // The raw event is the record; the summary is an interpretation. If the
    // summary is ever wrong, the thing it summarised must still be checkable.
    const raw = fenced({ type: "task.transitioned", taskId: "ko", to: "done" });
    expect(summariseCrewEvent(raw)?.raw).toBe(raw);
  });

  it("reports an unknown event type instead of hiding or guessing it", () => {
    const summary = summariseCrewEvent(fenced({ type: "task.exploded", taskId: "ko" }));
    expect(summary?.headline).toBe("recorded a task.exploded event");
  });

  it("returns null for a fence containing invalid JSON", () => {
    expect(summariseCrewEvent("```crew-event\n{not json\n```")).toBeNull();
  });

  it("returns null when the payload has no type", () => {
    expect(summariseCrewEvent(fenced({ taskId: "ko" }))).toBeNull();
  });
});
