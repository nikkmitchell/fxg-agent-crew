import { describe, expect, it } from "vitest";
import { MESSAGE_LIMIT, briefBudget, describeBudget, wireSize } from "../message-budget.js";
import { encodeActionRequest } from "../crew-events.js";

/**
 * The editor has to know where the wall is while you type.
 *
 * A card travels as `task.upserted`, which replaces the stored card — the whole
 * task is sent, not the field you edited. So the brief never had 2000
 * characters to itself, and on one real card the title alone made a
 * 300-character brief unsendable. The textarea invited 4000 either way.
 */

const card = {
  id: "saha-brief-budget",
  projectId: "saha-ing",
  title: "A card brief can be longer than the transport can carry",
  status: "in_progress",
  points: 2,
  kind: "build",
  owners: ["claude-nikk2mbp"],
  acceptedBy: ["claude-nikk2mbp"],
};

describe("what a card actually costs on the wire", () => {
  it("measures the encoded message, not the raw JSON", () => {
    // encodeActionRequest pretty-prints with two-space indent, which roughly
    // doubles the payload. An estimate from JSON.stringify(task).length would
    // be wrong in the direction that loses writing.
    const payload = { type: "task.upserted", task: card } as const;

    expect(wireSize(payload)).toBe(encodeActionRequest(payload).length);
    expect(wireSize(payload)).toBeGreaterThan(JSON.stringify(card).length);
  });

  it("charges the brief against what the rest of the card already spent", () => {
    const empty = briefBudget(card, "");
    const written = briefBudget(card, "x".repeat(100));

    expect(written.overhead).toBe(empty.used);
    expect(written.used).toBeGreaterThan(empty.used + 100);
  });

  it("measures overhead by encoding the card without the field, not by subtracting", () => {
    // The field's key, its quotes, its JSON escaping and the comma before it are
    // all real characters. A subtraction assumes they cost nothing.
    const budget = briefBudget(card, "hello");

    expect(budget.used - budget.overhead).toBeGreaterThan("hello".length);
  });

  it("counts escaping, so a brief full of quotes and newlines costs more than its length", () => {
    const plain = briefBudget(card, "a".repeat(50));
    const escaped = briefBudget(card, '"\n'.repeat(25));

    expect(escaped.used).toBeGreaterThan(plain.used);
  });
});

describe("refusing before the writing is lost", () => {
  it("says it does not fit before the server would refuse it", () => {
    const budget = briefBudget(card, "x".repeat(4_000));

    expect(budget.fits).toBe(false);
    expect(budget.remaining).toBeLessThan(0);
    // The prediction must match the real encoded length the BFF checks.
    expect(budget.used).toBe(
      encodeActionRequest({ type: "task.upserted", task: { ...card, description: "x".repeat(4_000) } } as never).length,
    );
  });

  it("accepts a brief that exactly reaches the limit", () => {
    // Binary search for the largest brief that fits, then assert the boundary
    // is inclusive on the fitting side and exclusive one character later. An
    // off-by-one here either refuses valid writing or promises a save that fails.
    let low = 0;
    let high = 3_000;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (briefBudget(card, "x".repeat(mid)).fits) low = mid;
      else high = mid - 1;
    }

    expect(briefBudget(card, "x".repeat(low)).fits).toBe(true);
    expect(briefBudget(card, "x".repeat(low)).used).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(briefBudget(card, "x".repeat(low + 1)).fits).toBe(false);
  });

  it("ignores comments, because an upsert never carries them", () => {
    // This is the whole reason eleven cards became uneditable: the discussion
    // rode along in a payload that had nothing to do with it. If the budget
    // counted comments it would report a card as unwritable that is fine, and
    // if the SENDER counted them differently the number would describe a
    // message nobody posts.
    const chatty = {
      ...card,
      comments: Array.from({ length: 8 }, (_, i) => ({
        id: `c${i}`,
        author: "someone",
        body: "x".repeat(400),
        createdAt: "2026-09-09T00:00:00Z",
      })),
    };

    expect(briefBudget(chatty, "a brief").used).toBe(briefBudget(card, "a brief").used);
    expect(briefBudget(chatty, "a brief").fits).toBe(true);
  });

  it("corrects the reported case: it was the discussion, not the title", () => {
    // The card blamed the title: "on one card the title alone made a
    // 300-character brief unsendable". Measured against the real board, that is
    // not what happened. The longest title in the project is 407 characters and
    // still leaves 1,272 for a brief. What actually filled the message was the
    // comments, re-sent whole on every edit — which is why eleven cards had
    // stopped accepting ANY change, not just a long one.
    const longestRealTitle =
      "Now we have one chat room agentparty, but 3 projects, we should leave agentparty as the main " +
      "room that can be used to join seperate room and communicate in genera, and then for each " +
      "project it should also be it's own chat room, that way if there are 10 projects, and you're " +
      "only in 3 you don't need to see it, and in a project checking your work you don't need to " +
      "have a HUGE context of every other project.";

    expect(longestRealTitle.length).toBeGreaterThan(400);
    expect(briefBudget({ ...card, title: longestRealTitle }, "x".repeat(300)).fits).toBe(true);
    expect(briefBudget({ ...card, title: longestRealTitle }, "").remaining).toBeGreaterThan(1_000);
  });

  it("says exactly how much more text fits, and is right at both edges", () => {
    // `remaining` is the number the writer acts on, so an off-by-one here
    // either refuses valid writing or promises a save that will fail. It is
    // asserted against the encoder rather than against arithmetic.
    for (const start of ["", "already written. ", '"quoted" and\nnewlines']) {
      const room = briefBudget(card, start).remaining;

      expect(briefBudget(card, start + "x".repeat(room)).fits).toBe(true);
      expect(briefBudget(card, start + "x".repeat(room + 1)).fits).toBe(false);
    }
  });

  it("is not limit-minus-used, which would overstate the room left", () => {
    // The first character of a brief also pays for the key and its quotes.
    const empty = briefBudget(card, "");

    expect(empty.remaining).toBeLessThan(MESSAGE_LIMIT - empty.used);
  });
});

describe("telling the writer, in words they can act on", () => {
  it("reports how far over, and what the rest of the card is costing them", () => {
    const said = describeBudget(briefBudget(card, "x".repeat(4_000)));

    expect(said.tone).toBe("over");
    expect(said.text).toMatch(/too long to save/);
    expect(said.text).toMatch(/the rest of this card already costs/i);
  });

  it("warns while there is still room to react, not at the wall", () => {
    const budget = briefBudget(card, "");
    const nearLimit = briefBudget(card, "x".repeat(budget.remaining - 100));

    expect(describeBudget(nearLimit).tone).toBe("tight");
  });

  it("stays quiet and factual with room to spare", () => {
    expect(describeBudget(briefBudget(card, "short")).tone).toBe("ok");
  });
});
