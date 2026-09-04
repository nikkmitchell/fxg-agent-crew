import { describe, expect, it } from "vitest";
import {
  type BoardTask,
  accept,
  acceptanceOf,
  canAccept,
  canClaim,
  claim,
  stepProgress,
  tasksFor,
} from "./project-model";

const task = (over: Partial<BoardTask> = {}): BoardTask => ({
  id: "t1",
  title: "Define multiplayer capture rules",
  status: "backlog",
  points: 3,
  projectId: "p1",
  owners: [],
  acceptedBy: [],
  comments: [],
  links: [],
  images: [],
  ...over,
});

describe("acceptance is three states, not two", () => {
  it("is unassigned when nobody owns it", () => {
    expect(acceptanceOf(task())).toBe("unassigned");
  });

  it("is awaiting_acceptance when assigned but not acknowledged", () => {
    // The state that matters: batch-assigned work nobody has agreed to looks
    // identical to active work unless this is tracked separately.
    expect(acceptanceOf(task({ owners: ["baiwei"] }))).toBe("awaiting_acceptance");
  });

  it("is accepted once an owner acknowledges", () => {
    expect(acceptanceOf(task({ owners: ["baiwei"], acceptedBy: ["baiwei"] }))).toBe("accepted");
  });

  it("does not count acceptance from someone who is not an owner", () => {
    // Otherwise anyone could mark someone else's task as taken on.
    expect(acceptanceOf(task({ owners: ["baiwei"], acceptedBy: ["someone-else"] }))).toBe(
      "awaiting_acceptance",
    );
  });
});

describe("claiming", () => {
  it("is offered only on unassigned tasks", () => {
    expect(canClaim(task(), "claude")).toBe(true);
    expect(canClaim(task({ owners: ["baiwei"] }), "claude")).toBe(false);
  });

  it("accepts in the same motion", () => {
    // A claim that landed in awaiting_acceptance would be waiting on the person
    // who just claimed it — a state with no meaning.
    const claimed = claim(task(), "claude");
    expect(claimed.owners).toEqual(["claude"]);
    expect(acceptanceOf(claimed)).toBe("accepted");
  });

  it("does not mutate the original", () => {
    const original = task();
    claim(original, "claude");
    expect(original.owners).toEqual([]);
  });

  it("refuses an empty username rather than creating a nameless owner", () => {
    expect(claim(task(), "")).toEqual(task());
  });
});

describe("accepting", () => {
  it("is offered only to a named owner who has not yet accepted", () => {
    expect(canAccept(task({ owners: ["baiwei"] }), "baiwei")).toBe(true);
    expect(canAccept(task({ owners: ["baiwei"] }), "claude")).toBe(false);
    expect(canAccept(task({ owners: ["baiwei"], acceptedBy: ["baiwei"] }), "baiwei")).toBe(false);
  });

  it("is idempotent, so a double click cannot record two acceptances", () => {
    const once = accept(task({ owners: ["baiwei"] }), "baiwei");
    expect(accept(once, "baiwei").acceptedBy).toEqual(["baiwei"]);
  });

  it("keeps other owners' acceptances when one of several accepts", () => {
    const shared = task({ owners: ["baiwei", "claude"], acceptedBy: ["baiwei"] });
    expect(accept(shared, "claude").acceptedBy).toEqual(["baiwei", "claude"]);
  });
});

describe("my work", () => {
  it("returns only tasks the person owns, accepted or not", () => {
    const mine = task({ id: "a", owners: ["claude"] });
    const theirs = task({ id: "b", owners: ["baiwei"] });
    const nobody = task({ id: "c" });
    expect(tasksFor([mine, theirs, nobody], "claude").map((t) => t.id)).toEqual(["a"]);
  });
});

describe("step progress is about steps, not cards", () => {
  it("reports done over total", () => {
    expect(
      stepProgress([
        { id: "1", title: "Rules", status: "done" },
        { id: "2", title: "Board", status: "in_progress" },
        { id: "3", title: "Scoring", status: "not_started" },
      ]),
    ).toEqual({ done: 1, total: 3, percent: 33 });
  });

  it("reports 0 rather than dividing by zero on an empty project", () => {
    expect(stepProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("does not count in_progress as done", () => {
    // A step being worked on is not a step finished; conflating them is how a
    // progress bar starts overstating.
    expect(stepProgress([{ id: "1", title: "Rules", status: "in_progress" }]).percent).toBe(0);
  });
});
