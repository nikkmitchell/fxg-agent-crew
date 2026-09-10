import { describe, expect, it } from "vitest";
import { COLLAPSE_WINDOW_MS, collapseTranscript } from "./collapse-transcript";
import type { Message } from "../shared/contracts";

/**
 * Closing one card costs four messages, because backlog to done is not a legal
 * transition. Reconciling a board costs dozens — one wake here contained 49
 * messages, nearly all of them one-line machine transitions.
 *
 * The requirement from the card: a reconciliation should read as one collapsed
 * line per card, and expanding it must still show every original event.
 */

let clock = Date.parse("2026-09-09T10:00:00Z");
const nextTime = (gapMs = 1_000) => new Date((clock += gapMs)).toISOString();

const say = (username: string, content: string, gapMs?: number): Message => ({
  id: Math.floor(clock / 1000) % 100000,
  username,
  content,
  msgType: "text",
  createdAt: nextTime(gapMs),
  updatedAt: new Date(clock).toISOString(),
  streaming: false,
});

const event = (username: string, payload: unknown, gapMs?: number) =>
  say(username, ["```crew-event", JSON.stringify({ version: 1, payload }), "```"].join("\n"), gapMs);

const move = (taskId: string, to: string) => ({ type: "task.transitioned", taskId, to });
const comment = (taskId: string) => ({
  type: "task.commented",
  taskId,
  comment: { id: "c1", author: "claude-nikk2mbp", body: "evidence", createdAt: "2026-09-09T10:00:00Z" },
});

/** The exact shape of closing one card. */
const closeOneCard = (taskId: string, author = "claude-nikk2mbp") => [
  event(author, move(taskId, "assigned")),
  event(author, move(taskId, "in_progress")),
  event(author, comment(taskId)),
  event(author, move(taskId, "review")),
  event(author, move(taskId, "done")),
];

describe("collapsing machine exhaust", () => {
  it("turns closing a card into one line", () => {
    const entries = collapseTranscript(closeOneCard("saha-brief-budget"));

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("collapsed");
  });

  it("says what happened, not how many things happened", () => {
    // "6 changes" makes a reader expand it to find out whether anything
    // mattered. The path is the thing they wanted to know.
    const [entry] = collapseTranscript(closeOneCard("saha-brief-budget"));

    expect(entry.kind === "collapsed" && entry.headline).toBe(
      "moved saha-brief-budget to assigned → in progress → review → done, left a comment",
    );
  });

  it("names the card even when nothing was moved", () => {
    // "edited the card, left 5 comments" makes a reader open it to find out
    // WHICH card, which is exactly the click this exists to save.
    const [entry] = collapseTranscript([
      event("claude-nikk2mbp", { type: "task.upserted", task: { id: "chatty", title: "A card" } }),
      event("claude-nikk2mbp", comment("chatty")),
      event("claude-nikk2mbp", comment("chatty")),
    ]);

    expect(entry.kind === "collapsed" && entry.headline).toContain("chatty");
  });

  it("names the card for a run of comments alone", () => {
    const [entry] = collapseTranscript([
      event("claude-nikk2mbp", comment("saha-inventory")),
      event("claude-nikk2mbp", comment("saha-inventory")),
      event("claude-nikk2mbp", comment("saha-inventory")),
    ]);

    expect(entry.kind === "collapsed" && entry.headline).toBe("left 3 comments on saha-inventory");
  });

  it("keeps every original message, in order", () => {
    // The room is the only durable store. This folds the view; it must never
    // drop a record.
    const original = closeOneCard("saha-brief-budget");
    const [entry] = collapseTranscript(original);

    expect(entry.kind === "collapsed" && entry.messages).toEqual(original);
  });

  it("never swallows something a person said", () => {
    const before = closeOneCard("card-a");
    const human = say("nikk", "hold on, is that card actually finished?");
    const after = closeOneCard("card-b");

    const entries = collapseTranscript([...before, human, ...after]);

    expect(entries.map((e) => e.kind)).toEqual(["collapsed", "message", "collapsed"]);
    expect(entries[1].kind === "message" && entries[1].message).toBe(human);
  });

  it("keeps one card's run separate from the next", () => {
    // A reconciliation touching three cards should read as three lines, not one
    // line claiming a single action.
    const entries = collapseTranscript([
      ...closeOneCard("card-a"),
      ...closeOneCard("card-b"),
      ...closeOneCard("card-c"),
    ]);

    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.kind === "collapsed")).toBe(true);
  });

  it("keeps two authors apart even when their events interleave in time", () => {
    const entries = collapseTranscript([
      ...closeOneCard("card-a", "claude-nikk2mbp"),
      ...closeOneCard("card-a", "Inkstone"),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.kind === "collapsed" && e.author)).toEqual(["claude-nikk2mbp", "Inkstone"]);
  });

  it("does not merge this morning's work with this afternoon's", () => {
    const morning = closeOneCard("card-a");
    const afternoon = closeOneCard("card-a", "claude-nikk2mbp");
    // Push the second run well past the window.
    const gapped = [...morning, ...afternoon.map((m, i) => ({
      ...m,
      createdAt: new Date(Date.parse(morning[morning.length - 1].createdAt) + COLLAPSE_WINDOW_MS * 2 + i * 1000).toISOString(),
    }))];

    expect(collapseTranscript(gapped)).toHaveLength(2);
  });

  it("leaves a short run alone rather than hiding two lines behind a click", () => {
    const entries = collapseTranscript([
      event("claude-nikk2mbp", move("card-a", "assigned")),
      event("claude-nikk2mbp", move("card-a", "in_progress")),
    ]);

    expect(entries.map((e) => e.kind)).toEqual(["message", "message"]);
  });

  it("leaves a quoted example visible, because that is someone explaining", () => {
    // Folding the teaching away and keeping the noise would be backwards.
    const teaching = say(
      "claude-nikk2mbp",
      ["```crew-event-example", JSON.stringify({ version: 1, payload: move("card-a", "done") }), "```"].join("\n"),
    );

    const entries = collapseTranscript([...closeOneCard("card-a"), teaching]);

    expect(entries[entries.length - 1].kind).toBe("message");
  });

  it("reports honestly when it does not recognise the events", () => {
    const entries = collapseTranscript([
      event("someone", { type: "profile.upserted", profile: { actorId: "a", displayName: "A" } }),
      event("someone", { type: "profile.upserted", profile: { actorId: "a", displayName: "B" } }),
      event("someone", { type: "profile.upserted", profile: { actorId: "a", displayName: "C" } }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].kind === "collapsed" && entries[0].headline).toMatch(/3 board events/);
  });

  it("passes ordinary conversation straight through", () => {
    const chat = [say("nikk", "morning"), say("claude-nikk2mbp", "morning — starting on the board")];

    expect(collapseTranscript(chat).map((e) => e.kind)).toEqual(["message", "message"]);
  });
});
