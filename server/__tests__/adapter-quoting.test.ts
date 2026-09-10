import { describe, expect, it } from "vitest";
import { adaptMessages, encodeActionRequest, encodeQuotedExample } from "../webharness/adapter.js";
import type { CrewEvent } from "../../shared/crew-events.js";
import type { Message } from "../../shared/contracts.js";

/**
 * An event must be showable without being run.
 *
 * The bug these tests exist for actually happened: someone posted a crew-event
 * fence to demonstrate how a new agent claims a card, the adapter executed it,
 * and the board recorded a claim that agent never made — attributed to them,
 * authored by the person teaching them. The room is both the place we explain
 * this format and the channel that runs it.
 *
 * Between colleagues that is a documentation problem. With an untrusted
 * participant in the room it is an injection primitive, because "here is what
 * you must never send" is byte-identical to sending it.
 */

const opts = { roomName: "AgentParty", canMutateProject: () => true };

const message = (id: number, content: string, overrides: Partial<Message> = {}): Message => ({
  id,
  username: "teacher",
  content,
  msgType: "text",
  createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z",
  streaming: false,
  ...overrides,
});

/** The exact shape from the incident: a claim on someone else's behalf. */
const claim: CrewEvent = { type: "task.transitioned", taskId: "saha-inventory", to: "in_progress" };

describe("quoting an event instead of running it", () => {
  it("does not execute a quoted block", () => {
    const result = adaptMessages([message(1, encodeQuotedExample(claim))], opts);

    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.quoted).toHaveLength(1);
  });

  it("reports the quoted block rather than skipping it in silence", () => {
    // A recognised quotation and an unparsed fence must not look alike. If
    // this were merely skipped, the author's only evidence that their example
    // was inert would be "the board did not change" — which is also exactly
    // what a mistyped info string looks like.
    const result = adaptMessages([message(7, encodeQuotedExample(claim))], opts);

    expect(result.quoted[0]).toMatchObject({ messageId: 7, blockIndex: 0 });
    expect(JSON.parse(result.quoted[0].body)).toEqual({ version: 1, payload: claim });
  });

  it("still executes the real fence, so quoting is opt-in and cannot disarm the channel", () => {
    const result = adaptMessages([message(2, encodeActionRequest(claim))], opts);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload).toEqual(claim);
    expect(result.quoted).toEqual([]);
  });

  it("carries both in one message: the lesson and the thing itself", () => {
    const content = [
      "To claim a card you send this:",
      encodeQuotedExample(claim),
      "Here is me actually doing it:",
      encodeActionRequest(claim),
    ].join("\n\n");

    const result = adaptMessages([message(3, content)], opts);

    expect(result.events).toHaveLength(1);
    expect(result.quoted).toHaveLength(1);
  });

  it("never parses the quoted body, so malformed examples are still inert", () => {
    // Deliberately unparseable. A design that validated quotations first would
    // reject this one, and a rejection is a message the attacker controls.
    const content = ["```crew-event-example", "{ not json at all", "```"].join("\n");

    const result = adaptMessages([message(4, content)], opts);

    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.quoted).toHaveLength(1);
  });

  it("the quoted example is copy-paste correct once the suffix is dropped", () => {
    // If the two encoders drifted, the documented form would stop matching the
    // executable one and every example in the room would teach the wrong thing.
    const shown = encodeQuotedExample(claim);
    const real = encodeActionRequest(claim);

    expect(shown.replace("```crew-event-example", "```crew-event")).toBe(real);
    expect(adaptMessages([message(5, shown.replace("```crew-event-example", "```crew-event"))], opts).events)
      .toHaveLength(1);
  });
});

describe("the executable fence must start a line", () => {
  // Verified against the durable log before tightening: 830 messages, 146
  // fences under both the old and new pattern, zero differing. A stricter rule
  // applies on every replay, so one that newly refuses something erases it from
  // the board — see docs/ADR-001.
  it("ignores a fence buried mid-sentence", () => {
    const content = `as I was saying \`\`\`crew-event\n${JSON.stringify({ version: 1, payload: claim })}\n\`\`\``;

    expect(adaptMessages([message(6, content)], opts).events).toEqual([]);
  });

  it("still accepts a fence indented up to three spaces, as CommonMark allows", () => {
    const content = ["   ```crew-event", JSON.stringify({ version: 1, payload: claim }), "   ```"].join("\n");

    expect(adaptMessages([message(8, content)], opts).events).toHaveLength(1);
  });

  it("does not mistake the example fence for the real one", () => {
    // The suffix must not be readable as `crew-event` followed by junk.
    const content = ["```crew-event-example", JSON.stringify({ version: 1, payload: claim }), "```"].join("\n");

    const result = adaptMessages([message(9, content)], opts);
    expect(result.events).toEqual([]);
    expect(result.quoted).toHaveLength(1);
  });
});
