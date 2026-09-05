import { describe, expect, it } from "vitest";
import { byPriority, nextUnclaimed, priorityLabel } from "./priority";
import type { CrewTask } from "./event-core";

const task = (id: string, over: Partial<CrewTask> = {}): CrewTask =>
  ({ id, title: id, status: "backlog", points: 1, ...over }) as CrewTask;

describe("ordering by priority", () => {
  it("puts the most urgent first", () => {
    const ordered = byPriority([task("c", { priority: 3 }), task("a", { priority: 1 }), task("b", { priority: 2 })]);
    expect(ordered.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts untriaged cards after triaged ones, but does not treat them as lowest", () => {
    // An untriaged card is not a card judged unimportant. It sits after the
    // triaged ones because we cannot rank it, not because someone said it does
    // not matter — and it must remain findable rather than buried under 5s.
    const ordered = byPriority([task("unset"), task("five", { priority: 5 }), task("one", { priority: 1 })]);
    expect(ordered.map((t) => t.id)).toEqual(["one", "five", "unset"]);
  });

  it("breaks ties by id so the order is stable between renders", () => {
    // The board polls every fifteen seconds now. Unstable ties would make cards
    // visibly swap places on their own.
    const first = byPriority([task("zeta", { priority: 2 }), task("alpha", { priority: 2 })]);
    const second = byPriority([task("alpha", { priority: 2 }), task("zeta", { priority: 2 })]);
    expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
  });

  it("does not mutate the caller's array", () => {
    const input = [task("b", { priority: 2 }), task("a", { priority: 1 })];
    byPriority(input);
    expect(input.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("what to pick up next", () => {
  it("is the most urgent card nobody owns", () => {
    const tasks = [
      task("owned", { priority: 1, owners: ["someone"] }),
      task("free", { priority: 2 }),
      task("later", { priority: 4 }),
    ];
    expect(nextUnclaimed(tasks)?.id).toBe("free");
  });

  it("ignores finished cards even when unowned", () => {
    expect(nextUnclaimed([task("done-one", { priority: 1, status: "done" })])).toBeNull();
  });

  it("returns null rather than a guess when everything is taken", () => {
    // "Nothing is unclaimed" is a real answer and a useful one: the board is
    // fully taken, not the function failing.
    expect(nextUnclaimed([task("a", { priority: 1, owners: ["x"] })])).toBeNull();
  });

  it("will offer an untriaged card when nothing triaged is free", () => {
    expect(nextUnclaimed([task("triaged", { priority: 1, owners: ["x"] }), task("unset")])?.id).toBe("unset");
  });
});

describe("labels", () => {
  it("says unset rather than inventing a level", () => {
    expect(priorityLabel(undefined)).toBe("unset");
  });

  it("names the levels in words an agent can act on", () => {
    expect(priorityLabel(1)).toBe("now");
    expect(priorityLabel(5)).toBe("someday");
  });
});
