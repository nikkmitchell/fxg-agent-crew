import { describe, expect, it } from "vitest";
import { initialCrewState, reduceCrewEvent, type CrewEvent, type CrewState, type EventEnvelope } from "./event-core";

const envelope = (eventId: string, sourceCursor: number, payload: CrewEvent, source = "test"): EventEnvelope => ({
  version: 1,
  eventId,
  source,
  sourceCursor,
  occurredAt: "2026-09-02T00:00:00Z",
  payload,
});

const taskEvent: CrewEvent = {
  type: "task.upserted",
  task: { id: "task-1", title: "Wire the room", status: "assigned", assigneeId: "codex", points: 5 },
};

describe("reduceCrewEvent", () => {
  it("deduplicates event ids", () => {
    const first = reduceCrewEvent(initialCrewState, envelope("one", 1, taskEvent));
    expect(reduceCrewEvent(first, envelope("one", 2, { ...taskEvent }))).toBe(first);
  });

  it("tracks cursors independently per source", () => {
    const one = reduceCrewEvent(initialCrewState, envelope("one", 4, taskEvent, "room-a"));
    const two = reduceCrewEvent(one, envelope("two", 1, { type: "presence.snapshotted", usernames: [] }, "presence"));
    expect(two.cursors).toEqual({ "room-a": 4, presence: 1 });
  });

  it("rejects stale source events without mutating domain data", () => {
    const one = reduceCrewEvent(initialCrewState, envelope("one", 4, taskEvent));
    const stale = reduceCrewEvent(one, envelope("stale", 3, { type: "task.transitioned", taskId: "task-1", to: "in_progress" }));
    expect(stale.tasks["task-1"].status).toBe("assigned");
    expect(stale.rejectedEvents.at(-1)?.reason).toBe("stale source cursor");
  });

  it("allows defined task transitions", () => {
    const one = reduceCrewEvent(initialCrewState, envelope("one", 1, taskEvent));
    const started = reduceCrewEvent(one, envelope("two", 2, { type: "task.transitioned", taskId: "task-1", to: "in_progress" }));
    const reviewed = reduceCrewEvent(started, envelope("three", 3, { type: "task.transitioned", taskId: "task-1", to: "review" }));
    expect(reviewed.tasks["task-1"].status).toBe("review");
  });

  it("requires a blocker reason", () => {
    let state: CrewState = reduceCrewEvent(initialCrewState, envelope("one", 1, taskEvent));
    state = reduceCrewEvent(state, envelope("two", 2, { type: "task.transitioned", taskId: "task-1", to: "in_progress" }));
    state = reduceCrewEvent(state, envelope("three", 3, { type: "task.transitioned", taskId: "task-1", to: "blocked" }));
    expect(state.tasks["task-1"].status).toBe("in_progress");
    expect(state.rejectedEvents.at(-1)?.reason).toBe("blocked tasks require a reason");
  });

  it("orders and deduplicates room messages by upstream id", () => {
    const message = (id: number, content: string): CrewEvent => ({
      type: "message.received",
      message: { id, roomName: "AgentParty", username: "nikk", content, createdAt: "now" },
    });
    let state = reduceCrewEvent(initialCrewState, envelope("m2", 2, message(2, "second"), "room"));
    state = reduceCrewEvent(state, envelope("m3", 3, message(1, "first"), "room"));
    state = reduceCrewEvent(state, envelope("m4", 4, message(2, "second updated"), "room"));
    expect(state.messages.map(({ id, content }) => [id, content])).toEqual([[1, "first"], [2, "second updated"]]);
  });
});

