import { describe, expect, it } from "vitest";
import { initialCrewState, reduceCrewEvent, type CrewEvent, type CrewState, type EventEnvelope } from "./event-core";

const envelope = (
  eventId: string,
  sourceCursor: number,
  payload: CrewEvent,
  source = "test",
  stream = "room-1",
): EventEnvelope => ({
  version: 1,
  eventId,
  stream,
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
  it("stores projects and scopes new tasks to an existing project", () => {
    const withProject = reduceCrewEvent(initialCrewState, envelope("project", 1, {
      type: "project.upserted",
      project: {
        id: "many-player-go",
        title: "Multiplayer Go",
        summary: "Use Saha.ing to develop a Go variant for three or more players.",
        goal: "Prove the project workflow with a genuinely playable release.",
        milestones: ["Agree on rules", "Build the first playable board"],
      },
    }));
    const withTask = reduceCrewEvent(withProject, envelope("task", 2, {
      type: "task.upserted",
      task: { id: "go-rules", projectId: "many-player-go", title: "Agree on rules", status: "backlog", points: 3 },
    }));

    expect(withTask.projects["many-player-go"].title).toBe("Multiplayer Go");
    expect(withTask.tasks["go-rules"].projectId).toBe("many-player-go");
  });

  it("rejects a scoped task when its project does not exist", () => {
    const state = reduceCrewEvent(initialCrewState, envelope("task", 1, {
      type: "task.upserted",
      task: { id: "orphan", projectId: "missing", title: "Orphan", status: "backlog", points: 1 },
    }));
    expect(state.tasks.orphan).toBeUndefined();
    expect(state.rejectedEvents.at(-1)?.reason).toBe("project not found");
  });

  it("deduplicates event ids", () => {
    const first = reduceCrewEvent(initialCrewState, envelope("one", 1, taskEvent));
    expect(reduceCrewEvent(first, envelope("one", 2, { ...taskEvent }))).toBe(first);
  });

  it("tracks cursors independently per stream and author", () => {
    // Keyed by stream and author together: a room carries the id sequence, and
    // one participant must not be able to rewind another's position in it.
    const one = reduceCrewEvent(initialCrewState, envelope("one", 4, taskEvent, "alice", "room-a"));
    const two = reduceCrewEvent(one, envelope("two", 1, { type: "presence.snapshotted", usernames: [] }, "presence", "room-a"));

    expect(Object.keys(two.cursors)).toHaveLength(2);
    expect(Object.values(two.cursors).sort()).toEqual([1, 4]);
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


/**
 * Replay idempotency is the property the whole event core exists to provide,
 * and it was the one thing not yet pinned: dedup-by-id was covered, but not
 * "feed the entire log twice and get the same state". Those are different
 * claims — per-event dedup can hold while ordering, cursors or derived
 * collections still drift on a second pass.
 *
 * It matters because replay is not hypothetical here. Every page load
 * reconstructs state from the log, and a mount that re-derives even one extra
 * entry is exactly the bug that shipped and was fixed on the UI side
 * (a completed run re-emitting its terminal event on every reload).
 */
describe("replay idempotency", () => {
  const log: EventEnvelope[] = [
    envelope("e1", 1, { type: "agent.upserted", agent: { id: "codex", name: "Codex", role: "eng" } as never }),
    envelope("e2", 2, taskEvent),
    envelope("e3", 3, { type: "task.transitioned", taskId: "task-1", to: "in_progress" }),
    envelope("e4", 4, { type: "task.transitioned", taskId: "task-1", to: "blocked", blocker: "waiting on auth" }),
    envelope("e5", 5, { type: "message.received", message: { id: 10, roomName: "AgentParty", username: "nikk", content: "status?", createdAt: "2026-09-02T01:00:00Z" } }),
    envelope("e6", 6, { type: "presence.snapshotted", usernames: ["codex", "claude"] }),
  ];

  const replay = (events: EventEnvelope[]) => events.reduce(reduceCrewEvent, initialCrewState);

  it("produces identical state when the whole log is replayed twice", () => {
    expect(replay(log)).toEqual(replay(log));
  });

  it("is unchanged by re-applying the log to already-built state", () => {
    const once = replay(log);
    const twice = log.reduce(reduceCrewEvent, once);

    // The second pass must be a no-op, not merely non-crashing: no duplicated
    // messages, no re-advanced cursor, no extra rejections.
    expect(twice.messages).toEqual(once.messages);
    expect(twice.cursors).toEqual(once.cursors);
    expect(twice.tasks).toEqual(once.tasks);
    expect(twice.rejectedEvents).toEqual(once.rejectedEvents);
  });

  it("reaches the same state regardless of how the log is chunked", () => {
    const whole = replay(log);
    const split = log.slice(3).reduce(reduceCrewEvent, replay(log.slice(0, 3)));

    // A reconnect resumes mid-log; that must not change the outcome.
    expect(split).toEqual(whole);
  });

  it("fails closed on an unsupported schema version", () => {
    const future = { ...envelope("future", 99, taskEvent), version: 2 as unknown as 1 };
    const next = reduceCrewEvent(initialCrewState, future);

    // Partially applying an envelope we do not understand is worse than
    // refusing it: it would put state on screen that no version of the
    // contract actually describes.
    expect(next.tasks).toEqual({});
    expect(next.rejectedEvents.at(-1)?.reason).toContain("version");
  });
});

/**
 * Regressions for three defects found by reviewing the reducer after the
 * adapter landed. Each is written to fail against the previous behaviour.
 */
describe("seam and lifecycle regressions", () => {
  const seedTask = (state: CrewState, cursor = 1) =>
    reduceCrewEvent(state, envelope("wh:1:0", cursor, {
      type: "task.upserted",
      task: { id: "t1", title: "Wire the room", status: "assigned", points: 1 },
    }));

  it("accepts multiple events sharing one cursor, as one message with two blocks produces", () => {
    // The adapter derives sourceCursor from the WebHarness message id, so both
    // blocks of a two-block message carry the same cursor. Rejecting on
    // equality silently dropped the second action — confirmed end-to-end
    // against a running local instance before this fix.
    const seeded = seedTask(initialCrewState);
    const first = reduceCrewEvent(seeded, envelope("wh:7:0", 7, { type: "task.transitioned", taskId: "t1", to: "in_progress" }));
    const second = reduceCrewEvent(first, envelope("wh:7:1", 7, { type: "task.transitioned", taskId: "t1", to: "review" }));

    expect(second.tasks.t1.status).toBe("review");
    expect(second.rejectedEvents).toEqual([]);
  });

  it("still rejects a genuinely stale cursor from an older poll window", () => {
    // Relaxing to `<` must not lose the protection entirely.
    const seeded = seedTask(initialCrewState, 10);
    const stale = reduceCrewEvent(seeded, envelope("wh:5:0", 5, { type: "task.transitioned", taskId: "t1", to: "in_progress" }));

    expect(stale.rejectedEvents.at(-1)?.reason).toContain("stale source cursor");
    expect(stale.tasks.t1.status).toBe("assigned");
  });

  it("marks presence by transport username, not by display name", () => {
    // usernames carries authenticated ids; `name` is a mutable self-chosen
    // display name. Matching on name marked everyone offline, silently.
    const withAgent = reduceCrewEvent(initialCrewState, envelope("wh:1:0", 1, {
      type: "agent.upserted",
      agent: { id: "baipad-gpt001", name: "Inkstone", avatarSeed: "x", online: false },
    } as never));
    const after = reduceCrewEvent(withAgent, envelope("wh:2:0", 2, {
      type: "presence.snapshotted",
      usernames: ["baipad-gpt001"],
    }));

    expect(after.agents["baipad-gpt001"].online).toBe(true);
  });

  it("marks an agent offline when absent from the snapshot", () => {
    const withAgent = reduceCrewEvent(initialCrewState, envelope("wh:1:0", 1, {
      type: "agent.upserted",
      agent: { id: "baipad-gpt001", name: "Inkstone", avatarSeed: "x", online: true },
    } as never));
    const after = reduceCrewEvent(withAgent, envelope("wh:2:0", 2, { type: "presence.snapshotted", usernames: [] }));

    expect(after.agents["baipad-gpt001"].online).toBe(false);
  });

  it("keeps replay idempotent at a volume that would have triggered pruning", () => {
    // 6000 events, deliberately above the 5000 cap a removed pruning attempt
    // used. That attempt BROKE this property: evicted ids came back as
    // stale-cursor rejections, which mutate state. Its own test hid the break
    // by running 20 events against a 5000 threshold, so pruning never
    // executed and the assertion passed for the wrong reason.
    //
    // This runs past that threshold precisely so it cannot pass vacuously.
    let state = initialCrewState;
    const log = Array.from({ length: 6000 }, (_, i) =>
      envelope(`wh:${i + 1}:0`, i + 1, { type: "presence.snapshotted", usernames: [] }),
    );
    for (const event of log) state = reduceCrewEvent(state, event);

    const replayed = log.reduce(reduceCrewEvent, state);

    expect(replayed).toEqual(state);
    expect(replayed.rejectedEvents).toEqual([]);
  }, 15_000);
});


describe("cursors are per stream, not per author", () => {
  const noop: CrewEvent = { type: "presence.snapshotted", usernames: [] };

  it("does not let a busy room make a quiet room look stale", () => {
    // The same user posts in two rooms. Message ids are per-room sequences, so
    // room-B's message 1 is not "behind" room-A's message 100 — keying order by
    // username alone rejected every event in the quieter room.
    let state = reduceCrewEvent(initialCrewState, envelope("a:100", 100, noop, "claude", "room-a"));
    state = reduceCrewEvent(state, envelope("b:1", 1, noop, "claude", "room-b"));

    expect(state.rejectedEvents).toEqual([]);
    expect(Object.keys(state.cursors)).toHaveLength(2);
  });

  it("stays correct when two rooms interleave", () => {
    const log = [
      envelope("a:10", 10, noop, "claude", "room-a"),
      envelope("b:2", 2, noop, "claude", "room-b"),
      envelope("a:11", 11, noop, "claude", "room-a"),
      envelope("b:3", 3, noop, "claude", "room-b"),
      envelope("a:12", 12, noop, "claude", "room-a"),
    ];

    const state = log.reduce(reduceCrewEvent, initialCrewState);

    expect(state.rejectedEvents).toEqual([]);
    expect(log.reduce(reduceCrewEvent, state)).toEqual(state);
  });

  it("still rejects a genuinely stale event within one stream", () => {
    // Scoping must not remove the protection it was scoping.
    let state = reduceCrewEvent(initialCrewState, envelope("a:10", 10, noop, "claude", "room-a"));
    state = reduceCrewEvent(state, envelope("a:5", 5, noop, "claude", "room-a"));

    expect(state.rejectedEvents.at(-1)?.reason).toContain("stale source cursor");
  });

  it("keeps two authors in one room independent", () => {
    let state = reduceCrewEvent(initialCrewState, envelope("a:100", 100, noop, "alice", "room-a"));
    state = reduceCrewEvent(state, envelope("a:2", 2, noop, "bob", "room-a"));

    // One participant must not be able to rewind another's position.
    expect(state.rejectedEvents).toEqual([]);
  });
})

describe("a profile update preserves observed presence", () => {
  const profile = (id: string, name: string): CrewEvent =>
    ({ type: "agent.upserted", agent: { id, name, avatarSeed: "x" } } as CrewEvent);

  it("does not mark a genuinely online agent offline when they edit their profile", () => {
    // The bug this pins was introduced BY the previous fix: rebuilding `online`
    // as false stopped an agent claiming presence, and simultaneously wiped
    // real presence on every profile edit. Refusing the field is not enough —
    // the merge has to keep what polling observed.
    let state = reduceCrewEvent(initialCrewState, envelope("e1", 1, profile("claude", "Claude")));
    state = reduceCrewEvent(state, envelope("e2", 2, { type: "presence.snapshotted", usernames: ["claude"] }));
    expect(state.agents.claude.online).toBe(true);

    state = reduceCrewEvent(state, envelope("e3", 3, profile("claude", "Claude the Renamed")));

    expect(state.agents.claude.name).toBe("Claude the Renamed");
    expect(state.agents.claude.online).toBe(true);
  });

  it("defaults a never-observed agent to offline rather than inventing presence", () => {
    const state = reduceCrewEvent(initialCrewState, envelope("e1", 1, profile("newcomer", "New")));

    expect(state.agents.newcomer.online).toBe(false);
  });
})
