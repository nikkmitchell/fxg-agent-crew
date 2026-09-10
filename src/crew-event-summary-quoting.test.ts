import { describe, expect, it } from "vitest";
import { summariseCrewEvent } from "./crew-event-summary";

/**
 * The parser and the reader must agree about what did and did not happen.
 *
 * The adapter refusing to execute a quoted event is only half the fix. A person
 * scrolling the room sees the same JSON either way, and "moved saha-inventory
 * to in progress" reads as a record of a change whether or not one occurred.
 */

const fence = (info: string, payload: unknown) =>
  ["```" + info, JSON.stringify({ version: 1, payload }, null, 2), "```"].join("\n");

const move = { type: "task.transitioned", taskId: "saha-inventory", to: "in_progress" };

describe("a quoted event reads as an example", () => {
  it("marks it as not run", () => {
    const summary = summariseCrewEvent(fence("crew-event-example", move));

    expect(summary?.quoted).toBe(true);
    expect(summary?.headline).toContain("not run");
  });

  it("states it in the conditional, so it cannot be read as a record", () => {
    const summary = summariseCrewEvent(fence("crew-event-example", move));

    expect(summary?.headline).toContain("would have move saha-inventory to in progress");
    expect(summary?.headline).not.toMatch(/^moved/);
  });

  it("leaves a real event's wording exactly as it was", () => {
    const summary = summariseCrewEvent(fence("crew-event", move));

    expect(summary?.quoted).toBe(false);
    expect(summary?.headline).toBe("moved saha-inventory to in progress");
  });

  it("keeps the raw block verbatim either way, because the record must stay checkable", () => {
    const shown = fence("crew-event-example", move);

    expect(summariseCrewEvent(shown)?.raw).toBe(shown);
  });

  it("rephrases every verb the summariser can produce", () => {
    // A missed verb reads as "would have commented on X", which is a sentence
    // about something that happened. Each of these is a real headline shape.
    const cases: Array<[unknown, string]> = [
      [{ type: "task.transitioned", taskId: "t1", to: "done" }, "would have move"],
      [{ type: "project.upserted", project: { name: "Saha.ing" } }, "would have create"],
      [{ type: "task.upserted", task: { title: "A card" } }, "would have update"],
      [{ type: "task.commented", taskId: "t1", comment: { body: "hi" } }, "would have comment"],
    ];

    for (const [payload, expected] of cases) {
      expect(summariseCrewEvent(fence("crew-event-example", payload))?.headline).toContain(expected);
    }
  });
});
